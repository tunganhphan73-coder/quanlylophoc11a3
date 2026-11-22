-- Migration 202611150001: additive academic data model.
-- Safe with existing classes/profiles/points/comments. No existing table,
-- column, route, or record is removed or renamed.
-- Apply before 202611150002_security_audit_search.sql.

begin;

create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- Keep the legacy role CHECK intact. `access_role` supplies only the two
-- additional effective roles; legacy teacher/parent/student rows keep working.
alter table public.profiles
  add column if not exists access_role text,
  add column if not exists avatar_url text;

alter table public.classes
  add column if not exists enable_conduct boolean not null default false;

-- Stable roster number used to disambiguate students with the same name.
alter table public.students
  add column if not exists student_number integer;

with numbered_students as (
  select id,
         row_number() over (partition by class_id order by created_at, id)::integer as assigned_number
  from public.students
)
update public.students as student
set student_number = numbered_students.assigned_number
from numbered_students
where student.id = numbered_students.id
  and student.student_number is null;

alter table public.students
  alter column student_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_access_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_access_role_check
      check (access_role is null or access_role in ('admin', 'bcs')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_bcs_access_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_bcs_access_role_check
      check (access_role is distinct from 'bcs' or (role = 'student' and class_id is not null)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_admin_access_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_admin_access_role_check
      check (access_role is distinct from 'admin' or class_id is null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.students'::regclass
      and conname = 'students_student_number_positive_check'
  ) then
    alter table public.students
      add constraint students_student_number_positive_check
      check (student_number > 0) not valid;
  end if;
end;
$$;

alter table public.profiles validate constraint profiles_access_role_check;
alter table public.profiles validate constraint profiles_bcs_access_role_check;
alter table public.profiles validate constraint profiles_admin_access_role_check;
alter table public.students validate constraint students_student_number_positive_check;

-- Refuse to install the student-account uniqueness rule if an existing class
-- already has duplicates. No account is deleted or silently reassigned.
do $$
begin
  if exists (
    select class_id
    from public.profiles
    where role = 'student' and access_role is null and class_id is not null
    group by class_id
    having count(*) > 1
  ) then
    raise exception 'More than one legacy student profile exists for a class. Resolve duplicates before applying migration 202611150001.';
  end if;
end;
$$;

create unique index if not exists idx_profiles_one_bcs_per_class
  on public.profiles (class_id)
  where access_role = 'bcs';

create unique index if not exists idx_profiles_one_student_per_class
  on public.profiles (class_id)
  where role = 'student' and access_role is null and class_id is not null;

create unique index if not exists idx_students_class_student_number
  on public.students (class_id, student_number);

-- A subject and semester belong to exactly one class.
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_subjects_class_normalized_name
  on public.subjects (class_id, lower(trim(name)));

create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  school_year text not null check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
  semester_number smallint not null check (semester_number in (1, 2)),
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint semesters_valid_date_range_check check (start_date <= end_date),
  constraint semesters_class_school_year_number_key unique (class_id, school_year, semester_number)
);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  student_id uuid not null references public.students (id),
  subject_id uuid not null references public.subjects (id),
  semester_id uuid not null references public.semesters (id),
  midterm_score numeric(3, 1),
  final_score numeric(3, 1),
  term_average numeric(3, 1) generated always as (
    case
      when midterm_score is not null and final_score is not null
        then round((midterm_score * 2 + final_score * 3) / 5, 1)::numeric(3, 1)
      else null
    end
  ) stored,
  is_locked boolean not null default false,
  entered_by_name text not null default '',
  change_reason text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grades_midterm_score_range_check
    check (midterm_score is null or (midterm_score between 0 and 10 and midterm_score * 10 = trunc(midterm_score * 10))),
  constraint grades_final_score_range_check
    check (final_score is null or (final_score between 0 and 10 and final_score * 10 = trunc(final_score * 10))),
  constraint grades_student_subject_semester_key unique (student_id, subject_id, semester_id),
  constraint grades_id_class_student_key unique (id, class_id, student_id)
);

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'conduct_event_kind') then
    create type public.conduct_event_kind as enum ('plus', 'minus', 'speaking');
  end if;
end;
$$;

create table if not exists public.conduct_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  student_id uuid not null references public.students (id),
  semester_id uuid not null references public.semesters (id),
  subject_id uuid not null references public.subjects (id),
  kind public.conduct_event_kind not null,
  points integer default 1,
  speak_count integer,
  reason text,
  event_date date not null default current_date,
  week_start date generated always as (date_trunc('week', event_date::timestamp)::date) stored,
  entered_by_name text not null default '',
  is_locked boolean not null default false,
  change_reason text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conduct_events_kind_fields_check check (
    (kind in ('plus', 'minus') and points is not null and points between 1 and 10 and speak_count is null and char_length(trim(coalesce(reason, ''))) between 1 and 500)
    or
    (kind = 'speaking' and points is null and speak_count is not null and speak_count >= 1)
  )
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  student_id uuid not null references public.students (id),
  semester_id uuid not null references public.semesters (id),
  event_date date not null,
  status text not null check (status in ('present', 'excused', 'unexcused')),
  reason text not null default '',
  entered_by_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint attendance_records_student_day_key unique (student_id, event_date)
);

create table if not exists public.conduct_results (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  student_id uuid not null references public.students (id),
  semester_id uuid not null references public.semesters (id),
  final_result text not null check (final_result in ('Tốt', 'Khá', 'Đạt', 'Chưa đạt')),
  reason text not null default '',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint conduct_results_student_semester_key unique (student_id, semester_id)
);

create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id),
  student_id uuid references public.students (id),
  grade_id uuid references public.grades (id),
  content text not null check (char_length(trim(content)) between 1 and 1000),
  author_name text not null check (char_length(trim(author_name)) between 1 and 60),
  is_hidden boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint feedbacks_exactly_one_target_check check ((student_id is not null) <> (grade_id is not null))
);

create table if not exists public.feedback_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Index every new FK and the class/period access paths used by RLS and lists.
-- The unique indexes on (class_id, normalized subject name) and
-- (class_id, school_year, semester_number) also cover these class_id FKs.
create index if not exists idx_grades_class_semester_student on public.grades (class_id, semester_id, student_id);
create index if not exists idx_grades_subject_id on public.grades (subject_id);
create index if not exists idx_grades_semester_id on public.grades (semester_id);
create index if not exists idx_grades_created_by on public.grades (created_by);
create index if not exists idx_conduct_events_class_semester_student_week on public.conduct_events (class_id, semester_id, student_id, week_start);
create index if not exists idx_conduct_events_student_week on public.conduct_events (student_id, week_start);
create index if not exists idx_conduct_events_subject_id on public.conduct_events (subject_id);
create index if not exists idx_conduct_events_semester_id on public.conduct_events (semester_id);
create index if not exists idx_conduct_events_created_by on public.conduct_events (created_by);
create index if not exists idx_attendance_class_semester_date on public.attendance_records (class_id, semester_id, event_date desc);
create index if not exists idx_attendance_student_semester_date on public.attendance_records (student_id, semester_id, event_date desc);
create index if not exists idx_attendance_semester_id on public.attendance_records (semester_id);
create index if not exists idx_attendance_created_by on public.attendance_records (created_by);
create index if not exists idx_conduct_results_class_semester on public.conduct_results (class_id, semester_id);
create index if not exists idx_conduct_results_semester_id on public.conduct_results (semester_id);
create index if not exists idx_conduct_results_decided_by on public.conduct_results (decided_by);
create index if not exists idx_feedbacks_class_created_at on public.feedbacks (class_id, created_at desc);
create index if not exists idx_feedbacks_student_id on public.feedbacks (student_id);
create index if not exists idx_feedbacks_grade_id on public.feedbacks (grade_id);
create index if not exists idx_feedbacks_created_by on public.feedbacks (created_by);

create index if not exists idx_point_logs_created_by on public.point_logs (created_by);
create index if not exists idx_comments_created_by on public.comments (created_by);

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.grades enable row level security;
alter table public.conduct_events enable row level security;
alter table public.attendance_records enable row level security;
alter table public.conduct_results enable row level security;
alter table public.feedbacks enable row level security;
alter table public.feedback_rate_limits enable row level security;

revoke all on table public.feedback_rate_limits from public, anon, authenticated;

-- Allocate a stable class STT. Locking the class row serializes inserts into
-- the same roster; the unique index is the final duplicate-number guard.
create or replace function public.assign_student_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_number integer;
begin
  if new.student_number is null then
    perform 1 from public.classes where id = new.class_id for update;
    select coalesce(max(student_number), 0) + 1
      into v_student_number
      from public.students
      where class_id = new.class_id;
    new.student_number := v_student_number;
  end if;
  if new.student_number < 1 then
    raise exception 'Student number must be positive';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.students'::regclass
      and tgname = 'students_assign_student_number'
      and not tgisinternal
  ) then
    create trigger students_assign_student_number
      before insert on public.students
      for each row execute function public.assign_student_number();
  end if;
end;
$$;

commit;
