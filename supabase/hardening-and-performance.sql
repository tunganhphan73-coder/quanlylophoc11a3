-- Apply once to an existing Supabase project before deploying the
-- performance/hardening changes. Safe to run again.
begin;

-- Users must not be able to change their own role or class membership.
drop policy if exists "profiles_update_own" on public.profiles;

-- Keep selected-week and latest-comment queries indexed as the tables grow.
create index if not exists idx_point_logs_student_created_at
  on public.point_logs (student_id, created_at desc);
create index if not exists idx_comments_class_created_at_id
  on public.comments (class_id, created_at desc, id desc);
drop index if exists public.idx_point_logs_student_id;
drop index if exists public.idx_comments_class_id;

-- Enforce the current form limits for new comments. NOT VALID lets old rows
-- remain readable while checking every new insert or update immediately.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comments_author_name_length_check'
  ) then
    alter table public.comments add constraint comments_author_name_length_check
      check (char_length(trim(author_name)) between 1 and 60) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'comments_content_length_check'
  ) then
    alter table public.comments add constraint comments_content_length_check
      check (char_length(trim(content)) between 1 and 1000) not valid;
  end if;
end;
$$;

-- Bound reactions to the small list the UI actually renders.
create or replace function public.toggle_comment_reaction(
  p_comment_id uuid,
  p_emoji text
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
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
    into v_current from public.comments where id = p_comment_id;
  update public.comments
    set reactions = jsonb_set(reactions, array[p_emoji], to_jsonb(v_current + 1), true)
    where id = p_comment_id
    returning reactions into v_new;
  return v_new;
end;
$$;
revoke all on function public.toggle_comment_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_comment_reaction(uuid, text) to authenticated;

-- Shared database-backed quota: at most 10 OCR requests per teacher per minute.
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

commit;
