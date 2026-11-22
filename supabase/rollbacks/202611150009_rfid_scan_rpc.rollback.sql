-- Non-destructive rollback for migration 009.
-- Keep scan/audit data and schema intact. Turn off the feature and deactivate
-- readers instead of dropping RPCs, views, triggers, or indexes.
update public.classes set enable_attendance = false where enable_attendance is true;
update public.rfid_readers set is_active = false where is_active is true;
