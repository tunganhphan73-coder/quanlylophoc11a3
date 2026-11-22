-- Admin-only RFID demo foundation. Additive by design: legacy
-- attendance_records and grade_audit_logs are intentionally untouched.
--
-- Rollback policy: see ../rollbacks/202611150007_admin_demo_rfid.rollback.sql.

alter table public.classes
  add column if not exists enable_attendance boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rfid_card_status'
  ) then
    create type public.rfid_card_status as enum ('active', 'lost', 'revoked');
  end if;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'attendance_event_result'
  ) then
    create type public.attendance_event_result as enum (
      'accepted', 'duplicate', 'unknown_card', 'inactive_card', 'tid_mismatch', 'outside_session'
    );
  end if;
end;
$$;

create table if not exists public.rfid_cards (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  epc text,
  tid text,
  status public.rfid_card_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rfid_cards_epc_or_tid_check check (epc is not null or tid is not null)
);

create unique index if not exists idx_rfid_cards_tid_unique
  on public.rfid_cards (tid) where tid is not null;
create unique index if not exists idx_rfid_cards_epc_unique
  on public.rfid_cards (epc) where epc is not null;
create index if not exists idx_rfid_cards_student_id on public.rfid_cards (student_id);
create index if not exists idx_rfid_cards_created_by on public.rfid_cards (created_by);

create table if not exists public.rfid_readers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  location text not null default '',
  token_hash text not null unique,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references public.rfid_readers(id),
  tid text,
  epc text,
  scanned_at timestamptz not null,
  received_at timestamptz not null default now(),
  card_id uuid references public.rfid_cards(id),
  student_id uuid references public.students(id),
  result public.attendance_event_result not null,
  is_replayed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_events_reader_id on public.attendance_events (reader_id);
create index if not exists idx_attendance_events_card_id on public.attendance_events (card_id);
create index if not exists idx_attendance_events_student_id on public.attendance_events (student_id);
create index if not exists idx_attendance_events_scanned_at on public.attendance_events (scanned_at desc);
create index if not exists idx_attendance_events_review
  on public.attendance_events (result, received_at desc) where result <> 'accepted';

create or replace function public.prevent_attendance_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Attendance scan events are append-only';
end;
$$;

revoke all on function public.prevent_attendance_event_mutation() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'attendance_events_append_only') then
    create trigger attendance_events_append_only
      before update or delete on public.attendance_events
      for each row execute function public.prevent_attendance_event_mutation();
  end if;
end;
$$;

-- Existing attendance_records has a different status/date contract and
-- CHECK constraint. RFID demo rows live separately to preserve it intact.
create table if not exists public.rfid_attendance_records (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id),
  student_id uuid not null references public.students(id),
  attendance_date date not null,
  session text not null check (session in ('morning', 'afternoon')),
  status text not null check (status in ('present', 'late', 'absent_excused', 'absent_unexcused')),
  check_in_at timestamptz,
  source text not null check (source in ('rfid', 'manual')),
  event_id uuid references public.attendance_events(id),
  reason text not null default '',
  entered_by_name text not null default '',
  is_locked boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rfid_attendance_student_day_session_key unique (student_id, attendance_date, session),
  constraint rfid_attendance_source_fields_check check (
    (source = 'rfid' and event_id is not null)
    or
    (source = 'manual' and event_id is null and char_length(trim(entered_by_name)) between 1 and 100)
  )
);

create index if not exists idx_rfid_attendance_class_date
  on public.rfid_attendance_records (class_id, attendance_date);
create index if not exists idx_rfid_attendance_student_date
  on public.rfid_attendance_records (student_id, attendance_date desc);
create index if not exists idx_rfid_attendance_event_id
  on public.rfid_attendance_records (event_id);
create index if not exists idx_rfid_attendance_created_by
  on public.rfid_attendance_records (created_by);

create table if not exists public.attendance_settings (
  class_id uuid primary key references public.classes(id),
  timezone text not null default 'Asia/Ho_Chi_Minh',
  morning_start_time time not null default '06:45',
  morning_late_after time not null default '07:00',
  morning_close_time time not null default '07:30',
  -- Afternoon schedule is deliberately unset until the school supplies it.
  afternoon_start_time time,
  afternoon_late_after time,
  afternoon_close_time time,
  updated_at timestamptz not null default now(),
  constraint attendance_settings_morning_range_check
    check (morning_start_time <= morning_late_after and morning_late_after <= morning_close_time),
  constraint attendance_settings_afternoon_range_check
    check (
      (afternoon_start_time is null and afternoon_late_after is null and afternoon_close_time is null)
      or
      (afternoon_start_time is not null and afternoon_late_after is not null and afternoon_close_time is not null
       and afternoon_start_time <= afternoon_late_after and afternoon_late_after <= afternoon_close_time)
    )
);

-- Separate audit stream: the legacy grade_audit_logs.source_table CHECK is
-- kept unchanged, so RFID/manual-attendance changes cannot be inserted there.
create table if not exists public.rfid_audit_logs (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('rfid_cards', 'attendance_records')),
  record_id uuid not null,
  student_id uuid,
  class_id uuid,
  actor_id uuid,
  actor_role text not null,
  entered_by_name text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rfid_audit_class_created
  on public.rfid_audit_logs (class_id, created_at desc);
create index if not exists idx_rfid_audit_student_created
  on public.rfid_audit_logs (student_id, created_at desc);
create index if not exists idx_rfid_audit_source_record_created
  on public.rfid_audit_logs (source_table, record_id, created_at desc);

create or replace function public.validate_rfid_attendance_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_class uuid;
  v_enabled boolean;
begin
  select s.class_id into v_student_class from public.students s where s.id = new.student_id;
  if v_student_class is distinct from new.class_id then
    raise exception 'Student does not belong to attendance class';
  end if;
  select c.enable_attendance into v_enabled from public.classes c where c.id = new.class_id;
  if not coalesce(v_enabled, false) then
    raise exception 'RFID attendance is disabled for this class';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_rfid_attendance_record() from public, anon, authenticated;

create or replace function public.audit_rfid_demo_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record jsonb;
  v_old jsonb;
  v_new jsonb;
  v_student_id uuid;
  v_class_id uuid;
  v_actor_role text;
  v_entered_by text;
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

  v_student_id := nullif(v_record ->> 'student_id', '')::uuid;
  v_class_id := nullif(v_record ->> 'class_id', '')::uuid;
  if v_class_id is null and v_student_id is not null then
    select s.class_id into v_class_id from public.students s where s.id = v_student_id;
  end if;
  v_actor_role := coalesce(public.current_role_name(), nullif(auth.role(), ''), 'system');
  if v_actor_role = 'service_role' then v_actor_role := 'system'; end if;
  select nullif(trim(p.full_name), '') into v_entered_by
    from public.profiles p where p.id = (select auth.uid());
  v_entered_by := coalesce(nullif(trim(v_record ->> 'entered_by_name'), ''), v_entered_by, 'Hệ thống');

  insert into public.rfid_audit_logs (
    source_table, record_id, student_id, class_id, actor_id, actor_role,
    entered_by_name, action, old_values, new_values, reason
  ) values (
    case when tg_table_name = 'rfid_cards' then 'rfid_cards' else 'attendance_records' end,
    (v_record ->> 'id')::uuid,
    v_student_id,
    v_class_id,
    (select auth.uid()),
    v_actor_role,
    v_entered_by,
    tg_op,
    v_old,
    v_new,
    nullif(trim(v_record ->> 'reason'), '')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_rfid_demo_change() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'rfid_cards_audit_after_change') then
    create trigger rfid_cards_audit_after_change
      after insert or update or delete on public.rfid_cards
      for each row execute function public.audit_rfid_demo_change();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'rfid_attendance_audit_after_change') then
    create trigger rfid_attendance_audit_after_change
      after insert or update or delete on public.rfid_attendance_records
      for each row execute function public.audit_rfid_demo_change();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'rfid_attendance_validate_before_change') then
    create trigger rfid_attendance_validate_before_change
      before insert or update on public.rfid_attendance_records
      for each row execute function public.validate_rfid_attendance_record();
  end if;
end;
$$;

alter table public.rfid_cards enable row level security;
alter table public.rfid_readers enable row level security;
alter table public.attendance_events enable row level security;
alter table public.rfid_attendance_records enable row level security;
alter table public.attendance_settings enable row level security;
alter table public.rfid_audit_logs enable row level security;

revoke all on table public.rfid_cards, public.rfid_readers, public.attendance_events,
  public.rfid_attendance_records, public.attendance_settings, public.rfid_audit_logs
  from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.rfid_audit_logs
  from authenticated;
grant select, insert, update, delete on table public.rfid_cards, public.rfid_readers,
  public.rfid_attendance_records, public.attendance_settings
  to authenticated;
grant select, insert on table public.attendance_events to authenticated;
grant select on table public.rfid_audit_logs to authenticated;
grant all on table public.rfid_cards, public.rfid_readers, public.attendance_events,
  public.rfid_attendance_records, public.attendance_settings to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rfid_cards' and policyname='rfid_cards_admin_only') then
    create policy rfid_cards_admin_only on public.rfid_cards for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rfid_readers' and policyname='rfid_readers_admin_only') then
    create policy rfid_readers_admin_only on public.rfid_readers for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_events' and policyname='attendance_events_admin_select') then
    create policy attendance_events_admin_select on public.attendance_events for select to authenticated
      using ((select public.current_role_name()) = 'admin')
      ;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_events' and policyname='attendance_events_admin_insert') then
    create policy attendance_events_admin_insert on public.attendance_events for insert to authenticated
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rfid_attendance_records' and policyname='rfid_attendance_admin_only') then
    create policy rfid_attendance_admin_only on public.rfid_attendance_records for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_settings' and policyname='attendance_settings_admin_only') then
    create policy attendance_settings_admin_only on public.attendance_settings for all to authenticated
      using ((select public.current_role_name()) = 'admin')
      with check ((select public.current_role_name()) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rfid_audit_logs' and policyname='rfid_audit_admin_select') then
    create policy rfid_audit_admin_select on public.rfid_audit_logs for select to authenticated
      using ((select public.current_role_name()) = 'admin');
  end if;
end;
$$;

-- The experimental attendance switch is admin-controlled even though the
-- existing classes UPDATE policy is intentionally preserved for teachers.
create or replace function public.guard_admin_attendance_switch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.enable_attendance is distinct from old.enable_attendance
     and coalesce(public.current_role_name(), '') <> 'admin' then
    raise exception 'Only an admin can change enable_attendance';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_admin_attendance_switch() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'classes_guard_admin_attendance_switch') then
    create trigger classes_guard_admin_attendance_switch
      before update on public.classes
      for each row execute function public.guard_admin_attendance_switch();
  end if;
end;
$$;
