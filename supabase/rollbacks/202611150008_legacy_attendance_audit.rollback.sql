-- Non-destructive rollback note for migration 202611150008.
-- The additive audit trigger is intentionally retained to avoid a DROP
-- operation and preserve the audit trail. To stop capture, use a reviewed
-- forward migration after the user explicitly authorizes that policy change.
select 'No-op rollback: attendance audit trigger remains enabled by design.' as rollback_note;
