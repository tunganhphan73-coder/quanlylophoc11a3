-- Grant the server-only account reset lookup access to only the profile columns it filters on.
-- The route uses service_role and selects id, filtering by class_id, role, and access_role.
begin;

grant select (id, class_id, role, access_role)
  on table public.profiles to service_role;

commit;
