-- Allow BCS to append speaking-point entries for students in their own class.
-- Existing teacher write, update, and delete policies remain unchanged.
begin;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'point_logs'
      and policyname = 'point_logs_insert_bcs_own_class'
  ) then
    create policy point_logs_insert_bcs_own_class
      on public.point_logs for insert to authenticated
      with check (
        (select public.current_role_name()) = 'bcs'
        and created_by = (select auth.uid())
        and exists (
          select 1
          from public.students s
          where s.id = student_id
            and public.can_write_class(s.class_id)
        )
      );
  end if;
end;
$$;

commit;
