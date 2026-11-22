-- Non-destructive rollback for 202611150007_admin_demo_rfid.sql.
-- Deliberately keeps the additive schema and audit history intact.
-- Disable the feature on every class and stop all readers; existing legacy
-- attendance_records behavior is unchanged.
update public.classes set enable_attendance = false where enable_attendance is true;
update public.rfid_readers set is_active = false where is_active is true;
