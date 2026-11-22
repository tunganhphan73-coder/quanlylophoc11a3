-- Secure new parent/student profile creation for an existing installation.
-- This only replaces the auth.users trigger function; it does not alter rows,
-- tables, points, accounts, or existing class memberships.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_role text := 'student';
  new_class_id uuid := null;
begin
  -- Only the server-side Auth Admin API can set app_metadata. Public sign-ups
  -- can choose user_metadata, so never take class access from that field.
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

commit;
