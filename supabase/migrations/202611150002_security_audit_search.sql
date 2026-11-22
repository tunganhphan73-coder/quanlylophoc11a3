-- Migration 202611150002: roles, RLS, immutable audit, search and summaries.
-- Depends on 202611150001_academic_data.sql.
-- This forward migration only adds/replaces functions, policies, views,
-- triggers and grants. Existing policies and legacy tables stay in place.

begin;

-- Effective role: admin/BCS are stored in the additive access_role column;
-- teacher/parent/student continue to use the legacy role column.
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(profile.access_role, profile.role)
  from public.profiles as profile
  where profile.id = (select auth.uid());
$$;

create or replace function public.current_class_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile.class_id
  from public.profiles as profile
  where profile.id = (select auth.uid());
$$;

create or replace function public.has_class_access(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_role_name() = 'admin', false)
    or exists (
      select 1
      from public.classes as class_row
      where class_row.id = target_class_id
        and (
          class_row.teacher_id = (select auth.uid())
          or class_row.id = public.current_class_id()
        )
    );
$$;

create or replace function public.can_write_class(target_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case public.current_role_name()
    when 'admin' then true
    when 'bcs' then public.current_class_id() = target_class_id
    when 'teacher' then exists (
      select 1 from public.classes as class_row
      where class_row.id = target_class_id
        and class_row.teacher_id = (select auth.uid())
    )
    else false
  end;
$$;

-- These helpers are needed by authenticated RLS policies and RPCs, but must
-- not be callable by anonymous clients through PostgREST.
revoke all on function public.current_role_name() from public, anon;
revoke all on function public.current_class_id() from public, anon;
revoke all on function public.has_class_access(uuid) from public, anon;
revoke all on function public.can_write_class(uuid) from public, anon;
grant execute on function public.current_role_name() to authenticated, service_role;
grant execute on function public.current_class_id() to authenticated, service_role;
grant execute on function public.has_class_access(uuid) to authenticated, service_role;
grant execute on function public.can_write_class(uuid) to authenticated;

-- Map service-created BCS auth users into the legacy-compatible role value
-- while retaining their effective role and class binding additively.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_role text := 'student';
  new_access_role text := null;
  new_class_id uuid := null;
  requested_role text;
begin
  if new.raw_app_meta_data ->> 'class_account_source' = 'teacher-created' then
    requested_role := new.raw_app_meta_data ->> 'role';
    if requested_role is null or requested_role not in ('parent', 'student', 'bcs') then
      raise exception 'Invalid teacher-created class account role';
    end if;
    new_class_id := nullif(new.raw_app_meta_data ->> 'class_id', '')::uuid;
    if new_class_id is null or not exists (select 1 from public.classes where id = new_class_id) then
      raise exception 'Teacher-created class account is missing a valid class';
    end if;
    if requested_role = 'bcs' then
      new_role := 'student';
      new_access_role := 'bcs';
    else
      new_role := requested_role;
    end if;
  elsif new.raw_app_meta_data ->> 'class_account_source' = 'trusted-admin'
        and new.raw_app_meta_data ->> 'role' = 'admin' then
    -- app_metadata can only be written by a trusted Auth Admin API caller.
    new_role := 'teacher';
    new_access_role := 'admin';
  elsif new.raw_user_meta_data ->> 'role' = 'teacher' then
    new_role := 'teacher';
  end if;

  insert into public.profiles (id, role, access_role, full_name, class_id)
  values (
    new.id,
    new_role,
    new_access_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new_class_id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- This administrative helper is callable only with the service-role JWT or
-- from trusted SQL administration. It never accepts a role from user metadata.
create or replace function public.set_profile_access_role(
  p_user_id uuid,
  p_access_role text,
  p_class_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Only the service role can assign elevated profile roles';
  end if;

  if p_access_role is null or p_access_role not in ('admin', 'bcs') then
    raise exception 'access_role must be admin or bcs';
  end if;
  if p_access_role = 'admin' and p_class_id is not null then
    raise exception 'Admin profiles cannot be pinned to one class';
  end if;
  if p_access_role = 'bcs' and (p_class_id is null or not exists (select 1 from public.classes where id = p_class_id)) then
    raise exception 'BCS profile requires an existing class';
  end if;

  update public.profiles
  set role = case p_access_role when 'bcs' then 'student' when 'admin' then 'teacher' else role end,
      access_role = p_access_role,
      class_id = p_class_id
  where id = p_user_id;

  if not found then
    raise exception 'Profile does not exist';
  end if;
end;
$$;

revoke all on function public.set_profile_access_role(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_profile_access_role(uuid, text, uuid) to service_role;

-- Add admin access to legacy tables without replacing existing policies.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_admin_select_additive') then
    create policy profiles_admin_select_additive on public.profiles for select to authenticated
      using ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='classes' and policyname='classes_admin_all_additive') then
    create policy classes_admin_all_additive on public.classes for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='students' and policyname='students_admin_all_additive') then
    create policy students_admin_all_additive on public.students for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='point_logs' and policyname='point_logs_admin_all_additive') then
    create policy point_logs_admin_all_additive on public.point_logs for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='comments' and policyname='comments_admin_all_additive') then
    create policy comments_admin_all_additive on public.comments for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
end;
$$;

-- Audit rows are written only from database triggers. Client roles get no
-- INSERT/UPDATE/DELETE grant or policy.
create table if not exists public.grade_audit_logs (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('grades', 'conduct_events')),
  record_id uuid not null,
  student_id uuid not null,
  class_id uuid not null,
  actor_id uuid,
  actor_role text not null,
  entered_by_name text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_grade_audit_class_created on public.grade_audit_logs (class_id, created_at desc);
create index if not exists idx_grade_audit_student_created on public.grade_audit_logs (student_id, created_at desc);
create index if not exists idx_grade_audit_actor_created on public.grade_audit_logs (actor_id, created_at desc);
create index if not exists idx_grade_audit_source_record_created on public.grade_audit_logs (source_table, record_id, created_at desc);

alter table public.grade_audit_logs enable row level security;
revoke all on table public.grade_audit_logs from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.grade_audit_logs from authenticated;
grant select on table public.grade_audit_logs to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grade_audit_logs' and policyname='grade_audit_select_teacher_admin') then
    create policy grade_audit_select_teacher_admin on public.grade_audit_logs for select to authenticated
      using (
        (select public.current_role_name()) in ('teacher', 'admin')
        and public.has_class_access(class_id)
      );
  end if;
end;
$$;

-- Add row-level security to new class-scoped tables.
alter table public.subjects enable row level security;
alter table public.semesters enable row level security;

revoke all on table public.subjects, public.semesters from public, anon;
revoke all on table public.grades, public.conduct_events from public, anon;
revoke all on table public.attendance_records, public.conduct_results from public, anon;
revoke all on table public.feedbacks from public, anon;
grant select, insert, update, delete on table public.subjects, public.semesters to authenticated;
grant select, insert, update, delete on table public.grades, public.conduct_events to authenticated;
grant select, insert, update, delete on table public.attendance_records, public.conduct_results to authenticated;
grant select, insert, update, delete on table public.feedbacks to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='subjects' and policyname='subjects_select_class') then
    create policy subjects_select_class on public.subjects for select to authenticated
      using (public.has_class_access(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='subjects' and policyname='subjects_teacher_admin_write') then
    create policy subjects_teacher_admin_write on public.subjects for all to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id))
      with check ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='semesters' and policyname='semesters_select_class') then
    create policy semesters_select_class on public.semesters for select to authenticated
      using (public.has_class_access(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='semesters' and policyname='semesters_teacher_admin_write') then
    create policy semesters_teacher_admin_write on public.semesters for all to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id))
      with check ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grades' and policyname='grades_select_class') then
    create policy grades_select_class on public.grades for select to authenticated
      using (public.has_class_access(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grades' and policyname='grades_teacher_bcs_insert') then
    create policy grades_teacher_bcs_insert on public.grades for insert to authenticated
      with check ((select public.current_role_name()) in ('teacher', 'admin', 'bcs') and public.can_write_class(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grades' and policyname='grades_teacher_bcs_update_unlocked') then
    create policy grades_teacher_bcs_update_unlocked on public.grades for update to authenticated
      using (
        public.can_write_class(class_id)
        and ((select public.current_role_name()) in ('teacher', 'admin') or (select public.current_role_name()) = 'bcs' and not is_locked)
      )
      with check (public.can_write_class(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grades' and policyname='grades_teacher_admin_delete') then
    create policy grades_teacher_admin_delete on public.grades for delete to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='conduct_events' and policyname='conduct_events_select_class') then
    create policy conduct_events_select_class on public.conduct_events for select to authenticated
      using (public.has_class_access(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='conduct_events' and policyname='conduct_events_teacher_bcs_insert') then
    create policy conduct_events_teacher_bcs_insert on public.conduct_events for insert to authenticated
      with check (
        (select public.current_role_name()) in ('teacher', 'admin', 'bcs')
        and public.can_write_class(class_id)
        and exists (select 1 from public.classes c where c.id = class_id and c.enable_conduct)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='conduct_events' and policyname='conduct_events_teacher_bcs_update_unlocked') then
    create policy conduct_events_teacher_bcs_update_unlocked on public.conduct_events for update to authenticated
      using (
        public.can_write_class(class_id)
        and exists (select 1 from public.classes c where c.id = class_id and c.enable_conduct)
        and ((select public.current_role_name()) in ('teacher', 'admin') or (select public.current_role_name()) = 'bcs' and not is_locked)
      )
      with check (public.can_write_class(class_id) and exists (select 1 from public.classes c where c.id = class_id and c.enable_conduct));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='conduct_events' and policyname='conduct_events_teacher_admin_delete') then
    create policy conduct_events_teacher_admin_delete on public.conduct_events for delete to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_records' and policyname='attendance_select_class') then
    create policy attendance_select_class on public.attendance_records for select to authenticated
      using (public.has_class_access(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_records' and policyname='attendance_teacher_admin_write') then
    create policy attendance_teacher_admin_write on public.attendance_records for all to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id))
      with check ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='conduct_results' and policyname='conduct_results_select_class') then
    create policy conduct_results_select_class on public.conduct_results for select to authenticated
      using (public.has_class_access(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='conduct_results' and policyname='conduct_results_teacher_admin_write') then
    create policy conduct_results_teacher_admin_write on public.conduct_results for all to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id))
      with check ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feedbacks' and policyname='feedbacks_select_class') then
    create policy feedbacks_select_class on public.feedbacks for select to authenticated
      using (
        public.has_class_access(class_id)
        and ((select public.current_role_name()) in ('teacher', 'admin') or not is_hidden)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feedbacks' and policyname='feedbacks_parent_student_insert') then
    create policy feedbacks_parent_student_insert on public.feedbacks for insert to authenticated
      with check (
        (select public.current_role_name()) in ('parent', 'student')
        and public.has_class_access(class_id)
        and created_by = (select auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feedbacks' and policyname='feedbacks_teacher_admin_update') then
    create policy feedbacks_teacher_admin_update on public.feedbacks for update to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id))
      with check ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feedbacks' and policyname='feedbacks_teacher_admin_delete') then
    create policy feedbacks_teacher_admin_delete on public.feedbacks for delete to authenticated
      using ((select public.current_role_name()) in ('teacher', 'admin') and public.can_write_class(class_id));
  end if;
end;
$$;

-- Validate class ownership across all foreign-key references and enforce BCS
-- submission locks even when clients call the PostgREST table API directly.
create or replace function public.guard_scoring_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_role_name();
  v_class_id uuid;
  v_actor_class_id uuid := public.current_class_id();
  v_reason text;
  v_old_locked boolean := false;
begin
  if tg_op = 'DELETE' then
    v_class_id := old.class_id;
    if v_role not in ('teacher', 'admin') or not public.can_write_class(v_class_id) then
      raise exception 'Only the class teacher or admin may delete scoring records';
    end if;
    if old.is_locked and nullif(current_setting('app.scoring_change_reason', true), '') is null then
      raise exception 'A reason is required to delete a locked record';
    end if;
    return old;
  end if;

  v_class_id := new.class_id;
  if v_role not in ('teacher', 'admin', 'bcs') or not public.can_write_class(v_class_id) then
    raise exception 'Not authorized to write scoring records for this class';
  end if;

  if not exists (select 1 from public.students s where s.id = new.student_id and s.class_id = new.class_id)
     or not exists (select 1 from public.subjects s where s.id = new.subject_id and s.class_id = new.class_id)
     or not exists (select 1 from public.semesters s where s.id = new.semester_id and s.class_id = new.class_id) then
    raise exception 'Student, subject and semester must belong to the same class';
  end if;

  if tg_table_name = 'conduct_events' then
    if not exists (select 1 from public.classes c where c.id = new.class_id and c.enable_conduct) then
      raise exception 'Detailed conduct is disabled for this class';
    end if;
    if not exists (
      select 1 from public.semesters s
      where s.id = new.semester_id and new.event_date between s.start_date and s.end_date
    ) then
      raise exception 'Conduct event date must fall inside its semester';
    end if;
  end if;

  if v_role = 'bcs' then
    if new.class_id <> v_actor_class_id then
      raise exception 'BCS can write only to its assigned class';
    end if;
    if nullif(trim(new.entered_by_name), '') is null then
      raise exception 'The name of the BCS member entering this record is required';
    end if;
  else
    new.entered_by_name := coalesce(nullif(trim(new.entered_by_name), ''), (
      select nullif(trim(p.full_name), '') from public.profiles p where p.id = (select auth.uid())
    ), 'Giáo viên');
  end if;
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    v_old_locked := old.is_locked;
    if old.class_id <> new.class_id and v_role = 'bcs' then
      raise exception 'BCS cannot move a record to another class';
    end if;
    if v_role = 'bcs' then
      if old.is_locked then
        raise exception 'BCS cannot edit a locked record';
      end if;
      if old.is_locked is distinct from new.is_locked and new.is_locked is not true then
        raise exception 'BCS may lock a record but cannot unlock it';
      end if;
    elsif v_role in ('teacher', 'admin') and v_old_locked then
      v_reason := nullif(trim(current_setting('app.scoring_change_reason', true)), '');
      if v_reason is null then
        raise exception 'A reason is required to overwrite or unlock a locked record';
      end if;
      new.change_reason := v_reason;
    end if;
  end if;

  if v_role = 'bcs' and exists (
    select 1 from public.semesters s where s.id = new.semester_id and s.is_closed
  ) then
    raise exception 'BCS cannot submit or edit records in a closed semester';
  end if;

  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'Scoring record id cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.validate_class_child_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.students s where s.id = new.student_id and s.class_id = new.class_id)
     or not exists (select 1 from public.semesters s where s.id = new.semester_id and s.class_id = new.class_id) then
    raise exception 'Student and semester must belong to the selected class';
  end if;
  if tg_table_name = 'attendance_records'
     and not exists (
       select 1 from public.semesters s
       where s.id = new.semester_id and new.event_date between s.start_date and s.end_date
     ) then
    raise exception 'Attendance date must fall inside its semester';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_class_child_record() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.grades'::regclass and tgname='grades_guard_scoring_record' and not tgisinternal) then
    create trigger grades_guard_scoring_record
      before insert or update or delete on public.grades
      for each row execute function public.guard_scoring_record();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.conduct_events'::regclass and tgname='conduct_events_guard_scoring_record' and not tgisinternal) then
    create trigger conduct_events_guard_scoring_record
      before insert or update or delete on public.conduct_events
      for each row execute function public.guard_scoring_record();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.attendance_records'::regclass and tgname='attendance_records_validate_class_child' and not tgisinternal) then
    create trigger attendance_records_validate_class_child
      before insert or update on public.attendance_records
      for each row execute function public.validate_class_child_record();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.conduct_results'::regclass and tgname='conduct_results_validate_class_child' and not tgisinternal) then
    create trigger conduct_results_validate_class_child
      before insert or update on public.conduct_results
      for each row execute function public.validate_class_child_record();
  end if;
end;
$$;

create or replace function public.audit_scoring_record_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record jsonb;
  v_action text := tg_op;
  v_reason text := nullif(trim(current_setting('app.scoring_change_reason', true)), '');
  v_entered_by text;
  v_class_id uuid;
  v_student_id uuid;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_record := v_new;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_record := v_old;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record := v_new;
  end if;

  v_class_id := (v_record ->> 'class_id')::uuid;
  v_student_id := (v_record ->> 'student_id')::uuid;
  v_entered_by := coalesce(nullif(trim(v_record ->> 'entered_by_name'), ''), (
    select nullif(trim(profile.full_name), '')
    from public.profiles as profile
    where profile.id = (select auth.uid())
  ), 'Hệ thống');
  if v_reason is null and tg_op = 'INSERT' then
    v_reason := coalesce(nullif(trim(v_record ->> 'change_reason'), ''), nullif(trim(v_record ->> 'reason'), ''));
  elsif v_reason is null and tg_op = 'UPDATE'
        and v_new ->> 'change_reason' is distinct from v_old ->> 'change_reason' then
    v_reason := nullif(trim(v_new ->> 'change_reason'), '');
  end if;

  insert into public.grade_audit_logs (
    source_table, record_id, student_id, class_id, actor_id, actor_role,
    entered_by_name, action, old_values, new_values, reason
  ) values (
    tg_table_name,
    (v_record ->> 'id')::uuid,
    v_student_id,
    v_class_id,
    (select auth.uid()),
    coalesce(public.current_role_name(), nullif(auth.role(), ''), 'system'),
    v_entered_by,
    v_action,
    v_old,
    v_new,
    v_reason
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_scoring_record_change() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.grades'::regclass and tgname='grades_audit_after_change' and not tgisinternal) then
    create trigger grades_audit_after_change
      after insert or update or delete on public.grades
      for each row execute function public.audit_scoring_record_change();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.conduct_events'::regclass and tgname='conduct_events_audit_after_change' and not tgisinternal) then
    create trigger conduct_events_audit_after_change
      after insert or update or delete on public.conduct_events
      for each row execute function public.audit_scoring_record_change();
  end if;
end;
$$;

-- Locked-row teacher edits must go through a reason-bearing RPC. Direct table
-- updates cannot supply the transaction-local reason checked by the trigger.
create or replace function public.change_grade_with_reason(
  p_grade_id uuid,
  p_midterm_score numeric,
  p_final_score numeric,
  p_is_locked boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class_id uuid;
begin
  if public.current_role_name() not in ('teacher', 'admin') then
    raise exception 'Only a teacher or admin can overwrite grades';
  end if;
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) > 500 then
    raise exception 'A reason of 1 to 500 characters is required';
  end if;
  select class_id into v_class_id from public.grades where id = p_grade_id for update;
  if v_class_id is null or not public.can_write_class(v_class_id) then
    raise exception 'Grade not found or not authorized';
  end if;

  perform set_config('app.scoring_change_reason', trim(p_reason), true);
  update public.grades
  set midterm_score = p_midterm_score,
      final_score = p_final_score,
      is_locked = p_is_locked,
      change_reason = trim(p_reason),
      updated_at = now()
  where id = p_grade_id;
end;
$$;

create or replace function public.change_conduct_event_with_reason(
  p_event_id uuid,
  p_points integer,
  p_speak_count integer,
  p_event_reason text,
  p_event_date date,
  p_is_locked boolean,
  p_change_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class_id uuid;
begin
  if public.current_role_name() not in ('teacher', 'admin') then
    raise exception 'Only a teacher or admin can overwrite conduct records';
  end if;
  if nullif(trim(p_change_reason), '') is null or char_length(trim(p_change_reason)) > 500 then
    raise exception 'A reason of 1 to 500 characters is required';
  end if;
  select class_id into v_class_id from public.conduct_events where id = p_event_id for update;
  if v_class_id is null or not public.can_write_class(v_class_id) then
    raise exception 'Conduct event not found or not authorized';
  end if;

  perform set_config('app.scoring_change_reason', trim(p_change_reason), true);
  update public.conduct_events
  set points = p_points,
      speak_count = p_speak_count,
      reason = p_event_reason,
      event_date = p_event_date,
      is_locked = p_is_locked,
      change_reason = trim(p_change_reason),
      updated_at = now()
  where id = p_event_id;
end;
$$;

revoke all on function public.change_grade_with_reason(uuid, numeric, numeric, boolean, text) from public, anon;
revoke all on function public.change_conduct_event_with_reason(uuid, integer, integer, text, date, boolean, text) from public, anon;
grant execute on function public.change_grade_with_reason(uuid, numeric, numeric, boolean, text) to authenticated;
grant execute on function public.change_conduct_event_with_reason(uuid, integer, integer, text, date, boolean, text) to authenticated;

-- Feedback target validation and a small database-backed limit (5 per
-- account in 10 minutes). The atomic upsert avoids per-request race windows.
create or replace function public.validate_feedback_and_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
begin
  if v_user_id is null or public.current_role_name() not in ('parent', 'student') then
    raise exception 'Only an authenticated parent/student account may submit feedback';
  end if;
  if not public.has_class_access(new.class_id) then
    raise exception 'Feedback class is outside this account scope';
  end if;
  if new.student_id is not null and not exists (
    select 1 from public.students s where s.id = new.student_id and s.class_id = new.class_id
  ) then
    raise exception 'Feedback student must belong to the selected class';
  end if;
  if new.grade_id is not null and not exists (
    select 1 from public.grades g where g.id = new.grade_id and g.class_id = new.class_id
  ) then
    raise exception 'Feedback grade must belong to the selected class';
  end if;
  new.created_by := v_user_id;

  insert into public.feedback_rate_limits (user_id, window_started_at, request_count, updated_at)
  values (v_user_id, now(), 1, now())
  on conflict (user_id) do update
  set window_started_at = case
        when public.feedback_rate_limits.window_started_at <= now() - interval '10 minutes' then now()
        else public.feedback_rate_limits.window_started_at
      end,
      request_count = case
        when public.feedback_rate_limits.window_started_at <= now() - interval '10 minutes' then 1
        else public.feedback_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning request_count into v_count;

  if v_count > 5 then
    raise exception 'Feedback rate limit exceeded';
  end if;
  return new;
end;
$$;

create or replace function public.validate_feedback_update_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.student_id is not null and not exists (
    select 1 from public.students s where s.id = new.student_id and s.class_id = new.class_id
  ) then
    raise exception 'Feedback student must belong to the selected class';
  end if;
  if new.grade_id is not null and not exists (
    select 1 from public.grades g where g.id = new.grade_id and g.class_id = new.class_id
  ) then
    raise exception 'Feedback grade must belong to the selected class';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_feedback_and_rate_limit() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.feedbacks'::regclass and tgname='feedbacks_validate_and_rate_limit' and not tgisinternal) then
    create trigger feedbacks_validate_and_rate_limit
      before insert on public.feedbacks
      for each row execute function public.validate_feedback_and_rate_limit();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.feedbacks'::regclass and tgname='feedbacks_validate_update_target' and not tgisinternal) then
    create trigger feedbacks_validate_update_target
      before update on public.feedbacks
      for each row execute function public.validate_feedback_update_target();
  end if;
end;
$$;

-- Accent-insensitive normalization used by a GIN trigram index and search RPC.
do $$
declare
  v_unaccent_schema name;
  v_trgm_schema name;
begin
  select n.nspname into v_unaccent_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'unaccent';
  select n.nspname into v_trgm_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';
  if v_unaccent_schema is null or v_trgm_schema is null then
    raise exception 'unaccent and pg_trgm extensions are required';
  end if;

  execute format($sql$
    create or replace function public.normalize_student_search_name(p_name text)
    returns text
    language sql
    immutable
    parallel safe
    set search_path = %1$I, public, pg_temp
    as $function$
      select btrim(regexp_replace(
        lower(translate(%1$I.unaccent(coalesce(p_name, '')), 'Đđ', 'Dd')),
        '[^[:alnum:]]+', ' ', 'g'
      ))
    $function$
  $sql$, v_unaccent_schema);

  execute format(
    'create index if not exists idx_students_normalized_name_trgm on public.students using gin (public.normalize_student_search_name(full_name) %I.gin_trgm_ops)',
    v_trgm_schema
  );

  execute format($sql$
    create or replace function public.search_students_for_entry(p_class_id uuid, p_query text)
    returns table(student_id uuid, full_name text, student_number integer, match_score real)
    language plpgsql
    stable
    security definer
    set search_path = %1$I, public, pg_temp
    as $function$
    declare
      v_query text := public.normalize_student_search_name(p_query);
      v_enabled boolean;
      v_role text := public.current_role_name();
    begin
      if (select auth.uid()) is null then
        raise exception 'Authentication required';
      end if;
      if char_length(v_query) < 2 or char_length(v_query) > 100 then
        return;
      end if;
      if v_role not in ('teacher', 'bcs', 'parent', 'student', 'admin')
         or not public.has_class_access(p_class_id) then
        raise exception 'Not authorized to search this class';
      end if;
      select c.enable_conduct into v_enabled from public.classes c where c.id = p_class_id;
      if not coalesce(v_enabled, false) then
        return;
      end if;

      return query
      with roster as (
        select s.id, s.full_name, s.student_number,
               public.normalize_student_search_name(s.full_name) as normalized_name,
               row_number() over (order by s.student_number)::integer as class_number
        from public.students s
        where s.class_id = p_class_id
      )
      select r.id, r.full_name, r.class_number,
             similarity(r.normalized_name, v_query)::real
      from roster r
      where r.normalized_name like ('%%' || v_query || '%%')
         or r.normalized_name %% v_query
      order by (r.normalized_name = v_query) desc,
               (position(v_query in r.normalized_name) > 0) desc,
               similarity(r.normalized_name, v_query) desc,
               r.class_number
      limit 10;
    end
    $function$
  $sql$, v_trgm_schema);
end;
$$;

revoke all on function public.normalize_student_search_name(text) from public, anon;
grant execute on function public.normalize_student_search_name(text) to authenticated;
revoke all on function public.search_students_for_entry(uuid, text) from public, anon;
grant execute on function public.search_students_for_entry(uuid, text) to authenticated;

-- Single grouped queries for weekly and semester summaries; security_invoker
-- keeps the underlying class RLS policies in force.
create or replace view public.conduct_weekly_summaries
with (security_invoker = true)
as
select class_id,
       semester_id,
       student_id,
       subject_id,
       week_start,
       coalesce(sum(points) filter (where kind = 'plus'), 0)::integer as total_plus,
       coalesce(sum(points) filter (where kind = 'minus'), 0)::integer as total_minus,
       coalesce(sum(speak_count) filter (where kind = 'speaking'), 0)::integer as total_speaking
from public.conduct_events
group by class_id, semester_id, student_id, subject_id, week_start;

create or replace view public.conduct_semester_summaries
with (security_invoker = true)
as
select event.class_id,
       event.semester_id,
       event.student_id,
       event.subject_id,
       coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)::integer as total_plus,
       coalesce(sum(event.points) filter (where event.kind = 'minus'), 0)::integer as total_minus,
       coalesce(sum(event.speak_count) filter (where event.kind = 'speaking'), 0)::integer as total_speaking,
       (50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
          - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0))::numeric as suggested_score,
       case
         when 50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
                   - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0) >= 55 then 'Tốt'
         when 50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
                   - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0) >= 50.5 then 'Khá'
         when 50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
                   - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0) >= 50 then 'Đạt'
         else 'Chưa đạt'
       end as suggested_result,
       result.final_result,
       result.reason as teacher_reason
from public.conduct_events as event
left join public.conduct_results as result
  on result.class_id = event.class_id
 and result.semester_id = event.semester_id
 and result.student_id = event.student_id
group by event.class_id, event.semester_id, event.student_id, event.subject_id,
         result.final_result, result.reason;

grant select on public.conduct_weekly_summaries, public.conduct_semester_summaries to authenticated;

-- Overall result belongs to one student/semester (not one subject). Keeping
-- this aggregate in PostgreSQL avoids client-side rollups and duplicate final
-- results when the student has conduct events in several subjects.
create or replace view public.conduct_student_semester_summaries
with (security_invoker = true)
as
select student.class_id,
       semester.id as semester_id,
       student.id as student_id,
       coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)::integer as total_plus,
       coalesce(sum(event.points) filter (where event.kind = 'minus'), 0)::integer as total_minus,
       coalesce(sum(event.speak_count) filter (where event.kind = 'speaking'), 0)::integer as total_speaking,
       (50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
          - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0))::numeric as suggested_score,
       case
         when 50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
                   - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0) >= 55 then 'Tốt'
         when 50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
                   - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0) >= 50.5 then 'Khá'
         when 50 + coalesce(sum(event.points) filter (where event.kind = 'plus'), 0)
                   - coalesce(sum(event.points) filter (where event.kind = 'minus'), 0) >= 50 then 'Đạt'
         else 'Chưa đạt'
       end as suggested_result,
       result.final_result,
       result.reason as teacher_reason
from public.students as student
join public.semesters as semester on semester.class_id = student.class_id
left join public.conduct_events as event
  on event.class_id = student.class_id
 and event.semester_id = semester.id
 and event.student_id = student.id
left join public.conduct_results as result
  on result.class_id = student.class_id
 and result.semester_id = semester.id
 and result.student_id = student.id
group by student.class_id, semester.id, student.id,
         result.final_result, result.reason;

grant select on public.conduct_student_semester_summaries to authenticated;

-- Explain the new index choices where operators can inspect them in SQL Editor.
comment on index public.idx_profiles_one_bcs_per_class is 'Enforces at most one BCS account per class.';
comment on index public.idx_profiles_one_student_per_class is 'Enforces at most one shared student account per class.';
comment on index public.idx_students_class_student_number is 'Stable roster number lookup and duplicate-number protection within a class.';
comment on index public.idx_students_normalized_name_trgm is 'GIN trigram index for accent-insensitive student name search within the already-scoped class.';
comment on index public.idx_subjects_class_normalized_name is 'Enforces unique normalized subject names within a class and supports class-scoped subject lookup.';
comment on index public.semesters_class_school_year_number_key is 'Enforces one instance of each semester per class/school year and supports class-scoped semester lookup.';
comment on index public.grades_student_subject_semester_key is 'Enforces a single grade row per student, subject and semester; supports student grade lookups.';
comment on index public.grades_id_class_student_key is 'Supports class-safe grade feedback references by grade, class and student.';
comment on index public.attendance_records_student_day_key is 'Enforces one attendance status per student per date and supports daily attendance lookup.';
comment on index public.conduct_results_student_semester_key is 'Enforces one final conduct result per student and semester.';
comment on index public.idx_grades_class_semester_student is 'RLS and class/semester grade roster lookups; starts with class_id for class isolation.';
comment on index public.idx_grades_subject_id is 'Supports subject foreign-key checks and subject grade filters.';
comment on index public.idx_grades_semester_id is 'Supports semester foreign-key checks and semester filters.';
comment on index public.idx_grades_created_by is 'Supports created_by foreign-key checks and audit actor filtering.';
comment on index public.idx_conduct_events_class_semester_student_week is 'Supports class-scoped weekly/semester aggregates and RLS filters.';
comment on index public.idx_conduct_events_student_week is 'Supports a student timeline grouped by Monday week_start.';
comment on index public.idx_conduct_events_subject_id is 'Supports subject foreign-key checks and per-subject summaries.';
comment on index public.idx_conduct_events_semester_id is 'Supports semester foreign-key checks and semester summaries.';
comment on index public.idx_conduct_events_created_by is 'Supports created_by foreign-key checks and audit actor filtering.';
comment on index public.idx_attendance_class_semester_date is 'Supports class attendance lists and semester/date filters.';
comment on index public.idx_attendance_student_semester_date is 'Supports an individual student attendance history.';
comment on index public.idx_attendance_semester_id is 'Supports semester foreign-key checks.';
comment on index public.idx_attendance_created_by is 'Supports attendance creator foreign-key checks.';
comment on index public.idx_conduct_results_class_semester is 'Supports class results by semester.';
comment on index public.idx_conduct_results_semester_id is 'Supports semester foreign-key checks.';
comment on index public.idx_conduct_results_decided_by is 'Supports teacher/admin decision foreign-key checks.';
comment on index public.idx_feedbacks_class_created_at is 'Supports paginated class feedback feeds.';
comment on index public.idx_feedbacks_student_id is 'Supports student feedback lookup and student foreign-key checks.';
comment on index public.idx_feedbacks_grade_id is 'Supports grade feedback lookup and grade foreign-key checks.';
comment on index public.idx_feedbacks_created_by is 'Supports feedback creator foreign-key checks.';
comment on index public.idx_point_logs_created_by is 'Supports point-log creator foreign-key checks.';
comment on index public.idx_comments_created_by is 'Supports comment creator foreign-key checks.';
comment on index public.idx_grade_audit_class_created is 'Supports teacher audit history by class and time.';
comment on index public.idx_grade_audit_student_created is 'Supports student audit history by time.';
comment on index public.idx_grade_audit_actor_created is 'Supports actor audit history by time.';
comment on index public.idx_grade_audit_source_record_created is 'Supports locating audit rows for a source record.';

commit;
