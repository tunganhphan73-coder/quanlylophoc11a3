# Academic data migrations

Apply the forward migrations in numeric order in a **development Supabase project first**:

1. `202611150001_academic_data.sql`
2. `202611150002_security_audit_search.sql`
3. `202611150003_admin_class_account_rate_limit.sql`
4. `202611150004_query_access_indexes.sql`
5. `202611150005_service_role_profile_lookup.sql`
6. `202611150006_bcs_point_log_insert.sql`
7. `202611150007_admin_demo_rfid.sql`
8. `202611150008_legacy_attendance_audit.sql`
9. `202611150009_rfid_scan_rpc.sql`
10. `202611220010_admin_console.sql`

The up migrations add new tables/columns/indexes/policies/functions and contain no `DROP` statements. Keep the existing `schema.sql` and `hardening-and-performance.sql` unchanged. Rollback scripts are in `supabase/rollbacks/`; read each script before use. Rollback 003 restores the teacher-only rate-limit function and intentionally retains the shared account-rate-limit table/counters. Rollback 007 is intentionally non-destructive: it turns off the attendance flag and deactivates readers while keeping records and schema intact.

## Compatibility and data model

- `profiles.role` remains constrained to the current `teacher | parent | student` values. `profiles.access_role` adds `bcs | admin`; BCS is stored as legacy role `student` plus `access_role = 'bcs'`. This keeps old clients and existing role checks compatible while the app adopts the effective role in GĐ2.
- `classes.enable_conduct` defaults to `false`, so every existing class stays on the old UI and write path until a teacher enables the new conduct tools.
- `students.student_number` is backfilled in existing roster order (`created_at`, then `id`) and assigned under a class-row lock for later inserts. It is unique within each class.
- New academic tables: `subjects`, `semesters`, `grades`, `attendance_records`, `conduct_events`, `conduct_results`, `feedbacks`, and the private `feedback_rate_limits` counter.
- `grades.term_average` is database-generated as `(2 × GK + 3 × CK) / 5`, rounded to one decimal, only after both scores exist. Scores are constrained to 0–10 with at most one decimal place.
- The conduct semester suggestion uses the confirmed existing baseline and thresholds: 50 points; Tốt ≥55, Khá ≥50.5, Đạt ≥50, otherwise Chưa đạt. Speaking counts are summarized separately. Existing weekly `point_logs` calculation remains unchanged.

## RLS, locks, and audit

- Effective role/class helper functions are `STABLE SECURITY DEFINER` and use `(select auth.uid())`. New class-scoped tables grant reads to accounts bound to the class; writes are limited by role and class.
- BCS can create/update drafts in its assigned class and lock a row on submission. RLS denies BCS updates to locked rows; a database trigger also rejects unlocking/altering a locked row or changing its record id. BCS must supply `entered_by_name`.
- BCS can use AI OCR only for logbook pages. The additive `point_logs_insert_bcs_own_class` policy permits inserts for its own class with `created_by = auth.uid()`; existing teacher-only update/delete policies are unchanged, and roster OCR remains teacher/admin-only.
- Teacher/admin changes to an already locked grade or conduct event must use `change_grade_with_reason` or `change_conduct_event_with_reason`, which require a non-empty reason. Direct table updates to locked records fail the trigger check.
- `grade_audit_logs` is written by AFTER triggers on `grades` and `conduct_events`. Authenticated users receive SELECT only through a teacher/admin class-scoped policy; there is no client write policy or DML grant.
- Conduct summaries are database views by student/subject/week, student/subject/semester, and student/semester overall; the final teacher decision remains one row per student/semester.
- Students and parents can only insert feedback for their own class. They have no feedback UPDATE/DELETE policies. Hidden feedback is visible only to teachers/admins. A trigger limits feedback to 5 per account per 10 minutes.

## Index rationale

Existing indexes retained from `schema.sql`:

- `idx_classes_teacher_id`: teacher-owned class listing and class FK.
- `idx_students_class_id`: class-scoped roster and student FK.
- `idx_students_class_team_name`: class/team roster ordering.
- `idx_profiles_class_id`: shared-account class lookup and profiles FK.
- `idx_point_logs_student_created_at`: student/week history (student FK prefix).
- `idx_comments_class_created_at_id`: newest-first class feed and class FK.

Added by migration 001:

- `idx_profiles_one_bcs_per_class`, `idx_profiles_one_student_per_class`: enforce at most one account of each effective role per class.
- `idx_students_class_student_number`: stable STT lookup and uniqueness within the class.
- `idx_subjects_class_normalized_name`: unique subject label per class; its `class_id` prefix also serves the subject FK.
- `semesters_class_school_year_number_key`: unique semester per class/year; its `class_id` prefix serves the semester FK.
- `grades_student_subject_semester_key`: required unique grade row and student FK prefix.
- `grades_id_class_student_key`: composite key used to validate grade feedback targets against the same class/student.
- `idx_grades_class_semester_student`: class RLS, selected-semester roster, and class/semester/student query.
- `idx_grades_subject_id`, `idx_grades_semester_id`, `idx_grades_created_by`: the remaining grade FKs and subject/period/actor filters.
- `idx_conduct_events_class_semester_student_week`: class RLS and class/semester/student/week aggregation.
- `idx_conduct_events_student_week`: student history by Monday `week_start`.
- `idx_conduct_events_subject_id`, `idx_conduct_events_semester_id`, `idx_conduct_events_created_by`: remaining conduct FKs and filters.
- `attendance_records_student_day_key`: one attendance status per student/day and student lookup.
- `idx_attendance_class_semester_date`, `idx_attendance_student_semester_date`: class attendance sheets and student history.
- `idx_attendance_semester_id`, `idx_attendance_created_by`: remaining attendance FKs.
- `conduct_results_student_semester_key`: one final result per student/semester.
- `idx_conduct_results_class_semester`, `idx_conduct_results_semester_id`, `idx_conduct_results_decided_by`: class summary and remaining result FKs.
- `idx_feedbacks_class_created_at`: paginated newest-first class feedback.
- `idx_feedbacks_student_id`, `idx_feedbacks_grade_id`, `idx_feedbacks_created_by`: feedback FKs and detail filters.
- `idx_point_logs_created_by`, `idx_comments_created_by`: indexes the pre-existing creator FKs without changing those tables.

Added by migration 002:

- `idx_students_normalized_name_trgm`: GIN trigram index on immutable, lowercase, accent-stripped student names for the server-side class-scoped search.
- `idx_grade_audit_class_created`, `idx_grade_audit_student_created`, `idx_grade_audit_actor_created`, `idx_grade_audit_source_record_created`: audit history by class, student, actor, or source record in time order.
- `idx_feedbacks_class_student_created`: student-targeted feedback pages within a class in newest-first order.
- `idx_grade_audit_class_student_created`: student-specific audit history for teacher/admin review.
- `idx_conduct_events_class_student_subject_term_week_created`: paged detail rows ordered newest first for the same scope as the weekly conduct summary.

Added by migration 007 (admin-only experimental attendance; uses new tables so the legacy attendance schema and audit CHECK remain intact):

- `idx_rfid_cards_tid_unique`, `idx_rfid_cards_epc_unique`: O(1) card matching and database-level prevention of assigning one TID/EPC to multiple students.
- `idx_rfid_cards_student_id`, `idx_rfid_cards_created_by`: card list by student and creator FK lookup.
- `rfid_readers.token_hash` unique index: constant-time device-token lookup by its stored digest.
- `idx_attendance_events_reader_id`, `idx_attendance_events_card_id`, `idx_attendance_events_student_id`: event foreign-key joins and reader/student history.
- `idx_attendance_events_scanned_at`: time-window event queries.
- `idx_attendance_events_review`: partial index for exceptions needing review; successful scans are excluded.
- `rfid_attendance_student_day_session_key`: enforce one attendance record per student/date/session and support duplicate-scan conflict handling.
- `idx_rfid_attendance_class_date`, `idx_rfid_attendance_student_date`: class daily roster and a student's attendance history.
- `idx_rfid_attendance_event_id`, `idx_rfid_attendance_created_by`: event/actor foreign-key lookups.
- `idx_rfid_audit_class_created`, `idx_rfid_audit_student_created`, `idx_rfid_audit_source_record_created`: paged audit history by class, student, or source record.

Migration 007 leaves afternoon times unset because the supplied specification did not provide those values. The admin must configure them before afternoon scans are enabled.

Migration 008 adds an AFTER audit trigger to the existing manual `attendance_records` table and writes to the separate `rfid_audit_logs` sink. It does not modify the legacy audit CHECK constraint, table shape, or policies. Its rollback is deliberately a documented no-op under the no-DROP rule.

Migration 009 adds the service-role-only `record_rfid_scan` RPC, per-reader scan serialization/rate limiting, and the `rfid_attendance_today` view that infers unexcused absence after a configured session closes. The view uses the class timezone; legacy attendance tables remain untouched. Its rollback only disables attendance and readers.

Migration 010 adds an append-only, sanitized error-report table for the Admin console and a per-user database-backed rate limit (10 reports/minute). Only service-role code can insert or change reports; authenticated Admins can select reports through RLS. The teacher directory reads teacher profiles and joins emails from paginated Supabase Auth users server-side. Its rollback is intentionally a documented no-op to preserve error history.

Added by migration 009:

- `idx_attendance_events_reader_received`: per-reader recent-scan count used by the transactional rate limit, ordered newest first.

Added by migration 010:

- `idx_app_error_reports_created_at`: supports the Admin error feed's newest-first pagination.
- `idx_app_error_reports_digest_created_at`: supports grouping/review by error digest without indexing empty digests.

GĐ5 application wiring adds `/api/rfid/scan`, `/api/admin/rfid/readers`, the admin-only RFID panel, and `tools/rfid-gateway/`. The reader token is returned once at creation, stored as SHA-256 only, and must be kept in the ignored gateway `config.json`. The scan API is server-to-server; the hardware adapter should send TID/EPC to the loopback gateway, which forwards to the Vercel endpoint.

## Development verification

After applying both migrations to a non-production database, verify:

1. Existing classes have `enable_conduct = false`; their old roster and `point_logs` still load.
2. Two auth profiles cannot be bound as BCS to the same class, and two shared student profiles cannot be bound to the same class.
3. A teacher can create/read grades for an owned class; an unrelated class ID is rejected by RLS/trigger.
4. A BCS can save and lock an own-class draft, then cannot update/unlock it through the table REST endpoint. Student role cannot write `grades` or `conduct_events`.
5. A student/parent from class A cannot read/write class B; they cannot update/delete feedback. A hidden feedback disappears from student/parent reads.
6. With `enable_conduct = false`, the search RPC returns no rows and conduct inserts fail. With it enabled, teacher/BCS/parent/student/admin search `nguyen van an` and get the accented match only from their class, with at most 10 rows and the stable STT.
7. Insert/update/delete against `grades` and `conduct_events` creates corresponding `grade_audit_logs` rows with actor and entered name. A teacher update/unlock of a locked record without the reason RPC fails; with a reason it succeeds and logs that reason.
8. Midterm/final values reject scores outside 0–10 or more than one decimal; `term_average` matches the database formula.
9. Compare conduct summary totals with grouped detail queries for the same class, semester, subject, student, and week.
10. In the Dashboard, compare weekly `+`, `−`, and speaking totals with every row in the detail modal; use “Tải thêm mục ĐGTX” until the end of the list. Then compare semester totals with `conduct_semester_summaries`.
11. For teacher/admin, open a selected student's “Nhật ký thay đổi điểm / ĐGTX”; verify INSERT/UPDATE/DELETE, entered name, old/new values, and reason for protected edits. The panel pages by 30 rows.
12. Check the planned query paths with `EXPLAIN (ANALYZE, BUFFERS)` in development: feedback (`class_id`, `student_id`, `created_at`), audit (`class_id`, `student_id`, `created_at`), conduct detail (class/student/subject/semester/week plus created_at), grades (class/semester/student), and students (class/full_name/id).
13. Weekly point logs, month/week history logs, and the class roster are fetched in bounded 500-row pages, not silently cut at PostgREST's default response cap. Detail pages for feedback, audit, and conduct events expose a “load more” action.
14. In the project, run `npm run build` and `npx tsc --noEmit` after GĐ2/GĐ3/GĐ4 wire the new schema into TypeScript.
15. In development, confirm non-admin authenticated users cannot access the new RFID tables, scan events reject update/delete, cross-class attendance rows are rejected, and `enable_attendance` defaults false and can only be changed by an admin.
16. With a development reader token, test unknown, revoked, TID/EPC mismatch, duplicate, morning-present, morning-late, outside-session, replayed offline scan, and 121st request within one minute. Confirm each scan result is in `attendance_events`, only accepted events create one locked attendance row, and the audit panel lists card/manual changes.
17. Verify `/admin-demo` is denied for non-admins by both middleware and its server role check; the reader manager API also returns 403 for any non-admin session.

The source SQL has not been run against Production or a local PostgreSQL server. Apply migrations to a development project first, inspect any migration error, and only promote after the checks above pass.
