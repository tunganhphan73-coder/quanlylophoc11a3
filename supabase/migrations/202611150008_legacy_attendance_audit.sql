-- GĐ4: audit the existing manual attendance table without changing its
-- columns, CHECK constraints, policies, or current read/write behavior.
-- Requires 202611150007_admin_demo_rfid.sql (defines the separate audit sink).

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.attendance_records'::regclass
      and tgname = 'attendance_records_rfid_audit_after_change'
      and not tgisinternal
  ) then
    create trigger attendance_records_rfid_audit_after_change
      after insert or update or delete on public.attendance_records
      for each row execute function public.audit_rfid_demo_change();
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'rfid_audit_logs'
      and policyname = 'rfid_audit_teacher_attendance_select'
  ) then
    create policy rfid_audit_teacher_attendance_select
      on public.rfid_audit_logs for select to authenticated
      using (
        (select public.current_role_name()) = 'teacher'
        and source_table = 'attendance_records'
        and public.can_write_class(class_id)
      );
  end if;
end;
$$;
