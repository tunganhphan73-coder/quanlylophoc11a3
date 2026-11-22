-- Run once in the Supabase SQL Editor before deploying the class-account
-- rate limit in app/api/teacher/class-accounts/route.ts.
begin;

create table if not exists public.class_account_rate_limits (
  teacher_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.class_account_rate_limits enable row level security;
revoke all on table public.class_account_rate_limits from public, anon, authenticated;

create or replace function public.consume_class_account_rate_limit()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'teacher'
  ) then
    return false;
  end if;

  insert into public.class_account_rate_limits (teacher_id, window_started_at, request_count, updated_at)
  values (auth.uid(), now(), 1, now())
  on conflict (teacher_id) do update
  set window_started_at = case
        when public.class_account_rate_limits.window_started_at <= now() - interval '1 hour' then now()
        else public.class_account_rate_limits.window_started_at
      end,
      request_count = case
        when public.class_account_rate_limits.window_started_at <= now() - interval '1 hour' then 1
        else public.class_account_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning request_count into v_request_count;

  return v_request_count <= 10;
end;
$$;

revoke all on function public.consume_class_account_rate_limit() from public, anon;
grant execute on function public.consume_class_account_rate_limit() to authenticated;

commit;
