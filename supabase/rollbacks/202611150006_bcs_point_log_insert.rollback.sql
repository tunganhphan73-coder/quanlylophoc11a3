-- Roll back the BCS-only point-log insert policy.
begin;

drop policy if exists point_logs_insert_bcs_own_class on public.point_logs;

commit;
