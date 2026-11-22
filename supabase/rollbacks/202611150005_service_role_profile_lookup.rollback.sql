-- Roll back the narrow profile lookup privilege added by migration 005.
begin;

revoke select (id, class_id, role, access_role)
  on table public.profiles from service_role;

commit;
