-- Rollback for 202611150002_security_audit_search.sql only.
-- WARNING: export grade_audit_logs before running; this removes only the new
-- audit/search layer. Apply before rollback 202611150001_academic_data.rollback.sql.

begin;

drop trigger if exists grades_guard_scoring_record on public.grades;
drop trigger if exists conduct_events_guard_scoring_record on public.conduct_events;
drop trigger if exists attendance_records_validate_class_child on public.attendance_records;
drop trigger if exists conduct_results_validate_class_child on public.conduct_results;
drop trigger if exists grades_audit_after_change on public.grades;
drop trigger if exists conduct_events_audit_after_change on public.conduct_events;
drop trigger if exists feedbacks_validate_and_rate_limit on public.feedbacks;
drop trigger if exists feedbacks_validate_update_target on public.feedbacks;

drop view if exists public.conduct_semester_summaries;
drop view if exists public.conduct_student_semester_summaries;
drop view if exists public.conduct_weekly_summaries;

drop policy if exists profiles_admin_select_additive on public.profiles;
drop policy if exists classes_admin_all_additive on public.classes;
drop policy if exists students_admin_all_additive on public.students;
drop policy if exists point_logs_admin_all_additive on public.point_logs;
drop policy if exists comments_admin_all_additive on public.comments;
drop policy if exists grade_audit_select_teacher_admin on public.grade_audit_logs;
drop policy if exists subjects_select_class on public.subjects;
drop policy if exists subjects_teacher_admin_write on public.subjects;
drop policy if exists semesters_select_class on public.semesters;
drop policy if exists semesters_teacher_admin_write on public.semesters;
drop policy if exists grades_select_class on public.grades;
drop policy if exists grades_teacher_bcs_insert on public.grades;
drop policy if exists grades_teacher_bcs_update_unlocked on public.grades;
drop policy if exists grades_teacher_admin_delete on public.grades;
drop policy if exists conduct_events_select_class on public.conduct_events;
drop policy if exists conduct_events_teacher_bcs_insert on public.conduct_events;
drop policy if exists conduct_events_teacher_bcs_update_unlocked on public.conduct_events;
drop policy if exists conduct_events_teacher_admin_delete on public.conduct_events;
drop policy if exists attendance_select_class on public.attendance_records;
drop policy if exists attendance_teacher_admin_write on public.attendance_records;
drop policy if exists conduct_results_select_class on public.conduct_results;
drop policy if exists conduct_results_teacher_admin_write on public.conduct_results;
drop policy if exists feedbacks_select_class on public.feedbacks;
drop policy if exists feedbacks_parent_student_insert on public.feedbacks;
drop policy if exists feedbacks_teacher_admin_update on public.feedbacks;
drop policy if exists feedbacks_teacher_admin_delete on public.feedbacks;

drop table if exists public.grade_audit_logs;

drop function if exists public.search_students_for_entry(uuid, text);
drop function if exists public.normalize_student_search_name(text);
drop function if exists public.change_grade_with_reason(uuid, numeric, numeric, boolean, text);
drop function if exists public.change_conduct_event_with_reason(uuid, integer, integer, text, date, boolean, text);
drop function if exists public.can_write_class(uuid);
drop function if exists public.set_profile_access_role(uuid, text, uuid);
drop function if exists public.guard_scoring_record();
drop function if exists public.validate_class_child_record();
drop function if exists public.audit_scoring_record_change();
drop function if exists public.validate_feedback_and_rate_limit();
drop function if exists public.validate_feedback_update_target();

-- Restore the three helper functions and signup trigger to their legacy
-- implementations from supabase/schema.sql / trusted-class-account-profiles.sql.
create or replace function public.current_role_name()
returns text
language sql stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_class_id()
returns uuid
language sql stable
security definer set search_path = public
as $$
  select class_id from public.profiles where id = auth.uid();
$$;

create or replace function public.has_class_access(target_class_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.classes c
    where c.id = target_class_id
      and (
        c.teacher_id = auth.uid()
        or target_class_id = public.current_class_id()
      )
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_role text := 'student';
  new_class_id uuid := null;
begin
  if new.raw_app_meta_data ->> 'class_account_source' = 'teacher-created' then
    new_role := new.raw_app_meta_data ->> 'role';
    if new_role is null or new_role not in ('parent', 'student') then
      raise exception 'Invalid teacher-created class account role';
    end if;
    new_class_id := nullif(new.raw_app_meta_data ->> 'class_id', '')::uuid;
    if new_class_id is null then
      raise exception 'Teacher-created class account is missing its class';
    end if;
  elsif new.raw_user_meta_data ->> 'role' = 'teacher' then
    new_role := 'teacher';
  end if;

  insert into public.profiles (id, role, full_name, class_id)
  values (
    new.id,
    new_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new_class_id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

commit;
