-- GĐ4: Add composite indexes for filtered history pages.
-- All changes are additive and safe to apply after migrations 001-003.
begin;

create index if not exists idx_feedbacks_class_student_created
  on public.feedbacks (class_id, student_id, created_at desc);

create index if not exists idx_grade_audit_class_student_created
  on public.grade_audit_logs (class_id, student_id, created_at desc);

create index if not exists idx_conduct_events_class_student_subject_term_week_created
  on public.conduct_events (class_id, student_id, subject_id, semester_id, week_start, created_at desc);

comment on index public.idx_feedbacks_class_student_created is
  'Supports class-scoped, student-specific feedback pages ordered newest first.';
comment on index public.idx_grade_audit_class_student_created is
  'Supports teacher/admin audit pages filtered by class and student in time order.';
comment on index public.idx_conduct_events_class_student_subject_term_week_created is
  'Supports paged conduct detail for one class, student, subject, semester and week.';

commit;
