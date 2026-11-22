-- =====================================================================
-- CLASS & EMULATION MANAGEMENT — SUPABASE SCHEMA
-- =====================================================================
-- Run this whole file once in the Supabase SQL editor on a fresh project.
-- It creates: profiles, classes, students, point_logs, comments, OCR rate limits,
-- a signup trigger, a reaction RPC, and Row Level Security for the
-- three roles: teacher / parent / student.
--
-- ACCOUNT MODEL
--   - Teacher: one normal auth.users account per teacher.
--   - Parent & Student: ONE SHARED auth.users account per class, created
--     by the teacher (e.g. "10a1.parent@class.local" / "10a1.student@class.local").
--     Because the login is shared, profiles.class_id pins that shared
--     account to exactly one class, and comments.author_name captures
--     "who is actually typing" on that shared login.
-- =====================================================================

-- ---------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. PROFILES
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('teacher', 'parent', 'student')),
  full_name text not null default '',
  -- Only used by parent/student shared accounts: which class this shared
  -- login belongs to. Null for teachers (they own classes via classes.teacher_id).
  class_id uuid null,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user. Teachers have personal accounts; parent/student rows represent a single shared class login.';

-- ---------------------------------------------------------------------
-- 2. CLASSES
-- ---------------------------------------------------------------------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  -- Points awarded per "speaking turn" tally mark, customizable per class.
  custom_speaking_point numeric(6, 2) not null default 0.5,
  created_at timestamptz not null default now()
);

-- Now that `classes` exists, point profiles.class_id at it.
alter table public.profiles
  add constraint profiles_class_id_fkey
  foreign key (class_id) references public.classes (id) on delete set null;

-- ---------------------------------------------------------------------
-- 3. STUDENTS
-- ---------------------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  full_name text not null,
  gender text null check (gender in ('male', 'female', 'other')),
  team_number integer not null default 1 check (team_number > 0),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. POINT LOGS
-- ---------------------------------------------------------------------
create table if not exists public.point_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  points_delta numeric(6, 2) not null,
  reason text not null default '',
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_point_logs_student_created_at
  on public.point_logs (student_id, created_at desc);

-- ---------------------------------------------------------------------
-- 5. COMMENTS
-- ---------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  -- Free-text name typed by whoever is using the shared parent/student login.
  author_name text not null constraint comments_author_name_length_check
    check (char_length(trim(author_name)) between 1 and 60),
  content text not null constraint comments_content_length_check
    check (char_length(trim(content)) between 1 and 1000),
  -- e.g. {"👍": 3, "❤️": 1} — emoji key -> count of taps.
  reactions jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_classes_teacher_id on public.classes (teacher_id);
create index if not exists idx_students_class_id on public.students (class_id);
create index if not exists idx_students_class_team_name on public.students (class_id, team_number, full_name);
-- Composite indexes include the former single-column prefixes as well as
-- created_at, so separate indexes would add write cost without helping reads.
create index if not exists idx_comments_class_created_at_id on public.comments (class_id, created_at desc, id desc);
create index if not exists idx_profiles_class_id on public.profiles (class_id);

-- =====================================================================
-- SIGNUP TRIGGER
-- =====================================================================
-- When a new auth.users row is created, auto-create its profiles row.
-- Teacher self-registration may request role=teacher in user_metadata.
-- Parent/student roles and class_id must come from server-owned app_metadata
-- set by the teacher's Auth Admin API call; never trust client user_metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_role text := 'student';
  new_class_id uuid := null;
begin
  -- Only the teacher's server-side Admin API can set app_metadata. Public
  -- sign-ups can freely choose user_metadata, so never take a class binding
  -- or a parent/student role from that field.
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
    -- Teacher self-registration is an intentional public flow.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================================
-- HELPER FUNCTIONS (used inside RLS policies)
-- =====================================================================
-- Current user's role, read once per statement.
create or replace function public.current_role_name()
returns text
language sql stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Current user's pinned class (for shared parent/student logins).
create or replace function public.current_class_id()
returns uuid
language sql stable
security definer set search_path = public
as $$
  select class_id from public.profiles where id = auth.uid();
$$;

-- Does the current user (teacher or shared parent/student login) have
-- read/write-scoped access to a given class?
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

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.point_logs enable row level security;
alter table public.comments enable row level security;

-- ---- profiles ---------------------------------------------------------
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

-- ---- classes -----------------------------------------------------------
create policy "classes_select_teacher_owns_or_member"
  on public.classes for select
  using (
    teacher_id = auth.uid()
    or id = public.current_class_id()
  );

create policy "classes_insert_teacher"
  on public.classes for insert
  with check (
    public.current_role_name() = 'teacher'
    and teacher_id = auth.uid()
  );

create policy "classes_update_teacher_owns"
  on public.classes for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy "classes_delete_teacher_owns"
  on public.classes for delete
  using (teacher_id = auth.uid());

-- ---- students ------------------------------------------------------------
create policy "students_select_class_access"
  on public.students for select
  using (public.has_class_access(class_id));

create policy "students_write_teacher_only"
  on public.students for insert
  with check (
    public.current_role_name() = 'teacher'
    and exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
  );

create policy "students_update_teacher_only"
  on public.students for update
  using (exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()))
  with check (exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()));

create policy "students_delete_teacher_only"
  on public.students for delete
  using (exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()));

-- ---- point_logs ------------------------------------------------------------
create policy "point_logs_select_class_access"
  on public.point_logs for select
  using (
    exists (
      select 1 from public.students s
      where s.id = student_id and public.has_class_access(s.class_id)
    )
  );

create policy "point_logs_write_teacher_only"
  on public.point_logs for insert
  with check (
    public.current_role_name() = 'teacher'
    and exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      where s.id = student_id and c.teacher_id = auth.uid()
    )
  );

create policy "point_logs_update_teacher_only"
  on public.point_logs for update
  using (
    exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      where s.id = student_id and c.teacher_id = auth.uid()
    )
  );

create policy "point_logs_delete_teacher_only"
  on public.point_logs for delete
  using (
    exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      where s.id = student_id and c.teacher_id = auth.uid()
    )
  );

-- ---- comments ------------------------------------------------------------
-- Everyone with class access can read.
create policy "comments_select_class_access"
  on public.comments for select
  using (public.has_class_access(class_id));

-- Everyone with class access can post a comment (teacher included).
create policy "comments_insert_class_access"
  on public.comments for insert
  with check (public.has_class_access(class_id) and created_by = auth.uid());

-- Only the teacher who owns the class can delete/moderate comments.
create policy "comments_delete_teacher_only"
  on public.comments for delete
  using (
    exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
  );

-- NOTE: we deliberately do NOT expose a generic UPDATE policy on comments.
-- Reaction taps go through the toggle_comment_reaction() RPC below, which
-- is SECURITY DEFINER and only ever touches the `reactions` column — this
-- avoids a shared class login being able to edit someone else's comment
-- text via a raw UPDATE.

-- =====================================================================
-- RPC: toggle an emoji reaction on a comment (safe partial update)
-- =====================================================================
create or replace function public.toggle_comment_reaction(
  p_comment_id uuid,
  p_emoji text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_class_id uuid;
  v_current int;
  v_new jsonb;
begin
  if p_emoji is null or p_emoji not in ('👍', '❤️', '🎉', '👏', '😮') then
    raise exception 'Unsupported reaction';
  end if;

  select class_id into v_class_id from public.comments where id = p_comment_id;

  if v_class_id is null then
    raise exception 'Comment not found';
  end if;

  if not public.has_class_access(v_class_id) then
    raise exception 'Not authorized for this class';
  end if;

  select coalesce((reactions ->> p_emoji)::int, 0)
    into v_current
    from public.comments where id = p_comment_id;

  update public.comments
    set reactions = jsonb_set(reactions, array[p_emoji], to_jsonb(v_current + 1), true)
    where id = p_comment_id
    returning reactions into v_new;

  return v_new;
end;
$$;

revoke all on function public.toggle_comment_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_comment_reaction(uuid, text) to authenticated;

-- A small per-teacher rate limit prevents repeated OCR requests from
-- overwhelming the app or consuming provider quota in a burst.
create table if not exists public.ocr_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ocr_rate_limits enable row level security;
revoke all on table public.ocr_rate_limits from public, anon, authenticated;

create or replace function public.consume_ocr_rate_limit()
returns boolean
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'teacher'
  ) then
    return false;
  end if;

  insert into public.ocr_rate_limits (user_id, window_started_at, request_count, updated_at)
  values (auth.uid(), now(), 1, now())
  on conflict (user_id) do update
  set window_started_at = case
        when public.ocr_rate_limits.window_started_at <= now() - interval '1 minute' then now()
        else public.ocr_rate_limits.window_started_at
      end,
      request_count = case
        when public.ocr_rate_limits.window_started_at <= now() - interval '1 minute' then 1
        else public.ocr_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning window_started_at, request_count into v_window_started_at, v_request_count;

  return v_request_count <= 10;
end;
$$;

revoke all on function public.consume_ocr_rate_limit() from public, anon;
grant execute on function public.consume_ocr_rate_limit() to authenticated;

-- =====================================================================
-- SEED EXAMPLE (optional — remove or adapt for real use)
-- =====================================================================
-- Teachers self-register through Supabase Auth (email/password), which
-- fires handle_new_user() above with { role: 'teacher', full_name }.
--
-- To create a shared parent/student login for a class, the teacher app
-- calls supabase.auth.admin.createUser (server-side, via a service-role
-- key) with:
--   email: '10a1-parent@yourschool.class',
--   password: '<generated>',
--   user_metadata: { role: 'parent', full_name: 'Phụ huynh lớp 10A1', class_id: '<classes.id>' }
-- and again with role: 'student' for the student shared login.
