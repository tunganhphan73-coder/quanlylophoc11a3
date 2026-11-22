-- Rollback for 202611150001_academic_data.sql only.
-- WARNING: export any newly-entered academic data before running this file.
-- Apply rollback 202611150002_security_audit_search.rollback.sql first.
-- Every removed object below was introduced by migration 001; no legacy
-- table or legacy column is changed by this rollback.

begin;

drop trigger if exists students_assign_student_number on public.students;
drop function if exists public.assign_student_number();

drop table if exists public.feedbacks;
drop table if exists public.feedback_rate_limits;
drop table if exists public.conduct_results;
drop table if exists public.attendance_records;
drop table if exists public.conduct_events;
drop table if exists public.grades;
drop table if exists public.semesters;
drop table if exists public.subjects;

drop type if exists public.conduct_event_kind;

drop index if exists public.idx_profiles_one_bcs_per_class;
drop index if exists public.idx_profiles_one_student_per_class;
drop index if exists public.idx_students_class_student_number;

alter table public.students drop column if exists student_number;
alter table public.classes drop column if exists enable_conduct;
alter table public.profiles drop column if exists avatar_url;
alter table public.profiles drop column if exists access_role;

commit;
