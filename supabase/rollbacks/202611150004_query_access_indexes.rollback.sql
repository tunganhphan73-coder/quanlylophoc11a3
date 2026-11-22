-- Rollback for 202611150004_query_access_indexes.sql only.
-- These indexes are optional performance aids and contain no user data.
begin;

drop index if exists public.idx_feedbacks_class_student_created;
drop index if exists public.idx_grade_audit_class_student_created;
drop index if exists public.idx_conduct_events_class_student_subject_term_week_created;

commit;
