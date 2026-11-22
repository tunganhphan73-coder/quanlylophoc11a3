"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle, BookOpen, CalendarCheck2, Check, ChevronDown, ClipboardList,
  LockKeyhole, MessageCircle, Plus, Search, Settings2, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StudentLookup, type StudentChoice } from "@/components/dashboard/StudentLookup";
import { WeeklyPointResults, type HomePointLog } from "@/components/dashboard/WeeklyPointResults";
import type { EffectiveRole } from "@/lib/auth/roles";
import type { ClassRow, Profile, Student } from "@/lib/types";

type Semester = { id: string; school_year: string; semester_number: 1 | 2; start_date: string; end_date: string; is_closed: boolean };
type Subject = { id: string; name: string; sort_order: number; is_active: boolean };
type Grade = { id: string; student_id: string; subject_id: string; semester_id: string; midterm_score: number | null; final_score: number | null; term_average: number | null; is_locked: boolean; entered_by_name: string };
type ConductSemester = { subject_id: string; total_plus: number; total_minus: number; total_speaking: number; suggested_score: number; suggested_result: string; final_result: string | null; teacher_reason: string | null };
type ConductOverall = { total_plus: number; total_minus: number; total_speaking: number; suggested_score: number; suggested_result: string; final_result: string | null; teacher_reason: string | null };
type ConductWeek = { subject_id: string; week_start: string; total_plus: number; total_minus: number; total_speaking: number };
type Attendance = { id: string; event_date: string; status: "present" | "excused" | "unexcused"; reason: string; entered_by_name: string };
type Feedback = { id: string; student_id: string | null; grade_id: string | null; content: string; author_name: string; is_hidden: boolean; created_at: string };
type ConductEvent = { id: string; kind: "plus" | "minus" | "speaking"; points: number | null; speak_count: number | null; reason: string | null; event_date: string; entered_by_name: string; is_locked: boolean };
type AuditLog = { id: string; source_table: "grades" | "conduct_events"; record_id: string; actor_role: string; entered_by_name: string | null; action: "INSERT" | "UPDATE" | "DELETE"; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; reason: string | null; created_at: string };
const PAGE_SIZE = 30;

const scoreText = z.string().trim().refine((value) => value === "" || /^(10(?:\.0)?|[0-9](?:\.\d)?)$/.test(value), "Điểm phải nằm trong khoảng 0–10, tối đa 1 chữ số thập phân.");
const gradeFormSchema = z.object({
  midterm: scoreText,
  final: scoreText,
  changeReason: z.string().trim().max(500, "Lý do tối đa 500 ký tự."),
  locked: z.boolean(),
}).refine((value) => value.midterm !== "" || value.final !== "", { message: "Nhập ít nhất một cột điểm.", path: ["midterm"] });
type GradeFormValues = z.infer<typeof gradeFormSchema>;

const conductFormSchema = z.object({
  studentId: z.string().uuid("Chọn học sinh từ danh sách."),
  subjectId: z.string().uuid("Chọn môn học."),
  kind: z.enum(["plus", "minus", "speaking"]),
  amount: z.coerce.number().int().min(1, "Giá trị phải từ 1 trở lên."),
  reason: z.string().trim().max(500, "Lý do tối đa 500 ký tự."),
  eventDate: z.string().min(10, "Chọn ngày."),
  enteredByName: z.string().trim().max(80, "Tên tối đa 80 ký tự."),
}).superRefine((value, ctx) => {
  if (value.kind !== "speaking" && (value.amount > 10 || !value.reason)) {
    ctx.addIssue({ code: "custom", path: [value.amount > 10 ? "amount" : "reason"], message: value.amount > 10 ? "Điểm cộng/trừ tối đa 10." : "Điểm cộng/trừ cần có lý do." });
  }
  if (value.kind === "speaking" && value.amount > 999) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: "Số lần phát biểu tối đa 999." });
  }
  if (value.enteredByName.length > 80) {
    ctx.addIssue({ code: "custom", path: ["enteredByName"], message: "Tên tối đa 80 ký tự." });
  }
});
type ConductFormValues = z.input<typeof conductFormSchema>;

const subjectSchema = z.object({ name: z.string().trim().min(1).max(80) });
const semesterSchema = z.object({
  school_year: z.string().regex(/^\d{4}-\d{4}$/, "Dạng năm học: 2026-2027."),
  semester_number: z.coerce.number().int().min(1).max(2),
  start_date: z.string().min(10),
  end_date: z.string().min(10),
}).refine((item) => item.start_date <= item.end_date, { message: "Ngày kết thúc phải sau ngày bắt đầu.", path: ["end_date"] });
const eventEditSchema = z.object({
  amount: z.coerce.number().int().min(1).max(999),
  reason: z.string().trim().max(500),
  eventDate: z.string().min(10),
  changeReason: z.string().trim().min(1, "Cần nêu lý do thay đổi.").max(500),
  locked: z.boolean(),
});
type EventEditValues = z.input<typeof eventEditSchema>;

const cardClass = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
const inputClass = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-700 focus:ring-2 focus:ring-blue-200";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2";
const outlineButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2";

interface AcademicResultsProps {
  classRow: ClassRow;
  students: Student[];
  profile: Profile;
  role: EffectiveRole;
  onClassConductToggle: (enabled: boolean) => void;
  onSelectedStudentChange: (student: StudentChoice | null) => void;
  onAcademicPeriodChange: (period: { schoolYear: string; semester: number } | null) => void;
  onNavigateHome?: () => void;
}

export function AcademicResults({ classRow, students, profile, role, onClassConductToggle, onSelectedStudentChange, onAcademicPeriodChange, onNavigateHome }: AcademicResultsProps) {
  const supabase = useMemo(() => createClient(), []);
  const isTeacher = role === "teacher" || role === "admin";
  const canEnter = isTeacher || role === "bcs";
  const canFeedbackModerate = isTeacher;
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentChoice | null>(null);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [homePointLogs, setHomePointLogs] = useState<HomePointLog[]>([]);
  const [homePointLogError, setHomePointLogError] = useState<string | null>(null);
  const [conductSemesters, setConductSemesters] = useState<ConductSemester[]>([]);
  const [conductOverall, setConductOverall] = useState<ConductOverall | null>(null);
  const [finalResult, setFinalResult] = useState("Đạt");
  const [finalReason, setFinalReason] = useState("");
  const [conductWeeks, setConductWeeks] = useState<ConductWeek[]>([]);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [feedbackHasMore, setFeedbackHasMore] = useState(false);
  const [feedbackLoadingMore, setFeedbackLoadingMore] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [eventModal, setEventModal] = useState<{ subject: Subject; week: string } | null>(null);
  const [events, setEvents] = useState<ConductEvent[]>([]);
  const [eventHasMore, setEventHasMore] = useState(false);
  const [eventLoadingMore, setEventLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [showSemesterForm, setShowSemesterForm] = useState(false);
  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackAuthor, setFeedbackAuthor] = useState("");
  const [feedbackTarget, setFeedbackTarget] = useState("student");
  const [feedbackGradeId, setFeedbackGradeId] = useState("");
  const [attendanceStatus, setAttendanceStatus] = useState<"excused" | "unexcused">("excused");
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [attendanceReason, setAttendanceReason] = useState("");
  const [enteredByName, setEnteredByName] = useState("");

  const selectedSemester = semesters.find((semester) => semester.id === semesterId) ?? null;
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);
  const currentDate = new Date().toISOString().slice(0, 10);
  const today = new Date();
  const schoolYearStart = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  const defaultSchoolYear = `${schoolYearStart}-${schoolYearStart + 1}`;

  const loadSetup = useCallback(async () => {
    setSetupLoading(true);
    setError(null);
    const [subjectResult, semesterResult] = await Promise.all([
      supabase.from("subjects").select("id,name,sort_order,is_active").eq("class_id", classRow.id).order("sort_order").order("name").range(0, 99),
      supabase.from("semesters").select("id,school_year,semester_number,start_date,end_date,is_closed").eq("class_id", classRow.id).order("start_date", { ascending: false }).range(0, 19),
    ]);
    if (subjectResult.error || semesterResult.error) {
      setError("Không tải được môn học hoặc học kỳ. Hãy kiểm tra đã chạy đủ migration GĐ1 chưa.");
      setSetupLoading(false);
      return;
    }
    const nextSubjects = (subjectResult.data ?? []) as Subject[];
    const nextSemesters = (semesterResult.data ?? []) as Semester[];
    setSubjects(nextSubjects);
    setSemesters(nextSemesters);
    setSemesterId((current) => {
      if (nextSemesters.some((semester) => semester.id === current)) return current;
      return nextSemesters.find((semester) => semester.start_date <= currentDate && semester.end_date >= currentDate)?.id ?? nextSemesters[0]?.id ?? "";
    });
    setSetupLoading(false);
  }, [classRow.id, currentDate, supabase]);

  useEffect(() => { void loadSetup(); }, [loadSetup]);

  useEffect(() => {
    onAcademicPeriodChange(selectedSemester ? { schoolYear: selectedSemester.school_year, semester: selectedSemester.semester_number } : null);
  }, [onAcademicPeriodChange, selectedSemester?.id]);

  useEffect(() => {
    setSelectedStudent(null);
    onSelectedStudentChange(null);
    setSemesterId("");
  }, [classRow.id, onSelectedStudentChange]);

  const loadStudentResults = useCallback(async () => {
    if (!selectedStudent || !semesterId) {
      setGrades([]); setHomePointLogs([]); setHomePointLogError(null); setConductSemesters([]); setConductWeeks([]); setAttendance([]); setFeedbacks([]);
      setFeedbackHasMore(false); setAuditLogs([]); setAuditHasMore(false);
      setConductOverall(null);
      return;
    }
    setLoading(true);
    setError(null);
    const requests: PromiseLike<any>[] = [
      supabase.from("grades").select("id,student_id,subject_id,semester_id,midterm_score,final_score,term_average,is_locked,entered_by_name")
        .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).eq("semester_id", semesterId).range(0, 99),
      supabase.from("attendance_records").select("id,event_date,status,reason,entered_by_name")
        .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).eq("semester_id", semesterId).order("event_date", { ascending: false }).range(0, 499),
    ];
    if (isTeacher) {
      requests.push(supabase.from("grade_audit_logs").select("id,source_table,record_id,actor_role,entered_by_name,action,old_values,new_values,reason,created_at")
        .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).order("created_at", { ascending: false }).range(0, PAGE_SIZE - 1));
    }
    if (classRow.enable_conduct) {
      requests.push(
        supabase.from("conduct_semester_summaries").select("subject_id,total_plus,total_minus,total_speaking,suggested_score,suggested_result,final_result,teacher_reason")
          .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).eq("semester_id", semesterId).range(0, 99),
        supabase.from("conduct_weekly_summaries").select("subject_id,week_start,total_plus,total_minus,total_speaking")
          .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).eq("semester_id", semesterId).order("week_start", { ascending: false }).range(0, 499),
        supabase.from("conduct_student_semester_summaries").select("total_plus,total_minus,total_speaking,suggested_score,suggested_result,final_result,teacher_reason")
          .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).eq("semester_id", semesterId).maybeSingle(),
      );
    }
    const semesterStart = selectedSemester ? new Date(`${selectedSemester.start_date}T00:00:00`).toISOString() : "";
    const semesterEnd = selectedSemester ? new Date(`${selectedSemester.end_date}T00:00:00`) : undefined;
    if (semesterEnd) semesterEnd.setDate(semesterEnd.getDate() + 1);
    const pointLogsPromise = (async () => {
      if (!semesterStart || !semesterEnd) return { rows: [] as HomePointLog[], error: null as unknown };
      const rows: HomePointLog[] = [];
      const pageSize = 500;
      try {
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase.from("point_logs")
            .select("id,student_id,points_delta,reason,created_at")
            .eq("student_id", selectedStudent.id)
            .gte("created_at", semesterStart)
            .lt("created_at", semesterEnd.toISOString())
            .order("created_at", { ascending: false }).order("id")
            .range(from, from + pageSize - 1);
          if (error) return { rows: [] as HomePointLog[], error };
          rows.push(...((data ?? []) as HomePointLog[]));
          if ((data ?? []).length < pageSize) break;
        }
      } catch (error) {
        return { rows: [] as HomePointLog[], error };
      }
      return { rows, error: null as unknown };
    })();
    const [results, pointLogsResult] = await Promise.all([Promise.all(requests), pointLogsPromise]);
    const gradeResult = results[0];
    const attendanceResult = results[1];
    const auditResult = isTeacher ? results[2] : null;
    const conductOffset = isTeacher ? 3 : 2;
    const gradeIds = (gradeResult.data ?? []).map((grade: Grade) => grade.id);
    let feedbackQuery = supabase.from("feedbacks").select("id,student_id,grade_id,content,author_name,is_hidden,created_at")
      .eq("class_id", classRow.id).order("created_at", { ascending: false }).range(0, PAGE_SIZE - 1);
    feedbackQuery = gradeIds.length
      ? feedbackQuery.or(`student_id.eq.${selectedStudent.id},grade_id.in.(${gradeIds.join(",")})`)
      : feedbackQuery.eq("student_id", selectedStudent.id);
    const feedbackResult = await feedbackQuery;
    const conductResult = classRow.enable_conduct ? results[conductOffset] : null;
    const weekResult = classRow.enable_conduct ? results[conductOffset + 1] : null;
    const overallResult = classRow.enable_conduct ? results[conductOffset + 2] : null;
    if ([gradeResult, attendanceResult, feedbackResult, auditResult, conductResult, weekResult, overallResult].some((result) => result?.error)) {
      setError("Không tải được dữ liệu học kỳ. Hãy thử tải lại hoặc kiểm tra quyền truy cập dữ liệu.");
    }
    setGrades((gradeResult.data ?? []) as Grade[]);
    setHomePointLogs(pointLogsResult.rows);
    setHomePointLogError(pointLogsResult.error ? "Không tải được điểm thi đua đã nhập ở Trang chủ." : null);
    setAttendance((attendanceResult.data ?? []) as Attendance[]);
    const nextFeedbacks = feedbackResult.data ?? [];
    setFeedbacks(nextFeedbacks as Feedback[]);
    setFeedbackHasMore(nextFeedbacks.length === PAGE_SIZE);
    setAuditLogs((auditResult?.data ?? []) as AuditLog[]);
    setAuditHasMore((auditResult?.data ?? []).length === PAGE_SIZE);
    setConductSemesters((conductResult?.data ?? []) as ConductSemester[]);
    setConductOverall((overallResult?.data ?? null) as ConductOverall | null);
    if (overallResult?.data) {
      setFinalResult(overallResult.data.final_result ?? overallResult.data.suggested_result);
      setFinalReason(overallResult.data.teacher_reason ?? "");
    } else {
      setFinalResult("Đạt");
      setFinalReason("");
    }
    const nextWeeks = (weekResult?.data ?? []) as ConductWeek[];
    setConductWeeks(nextWeeks);
    setSelectedWeek((current) => current && nextWeeks.some((week) => week.week_start === current) ? current : nextWeeks[0]?.week_start ?? getCurrentWeekStart());
    setLoading(false);
  }, [classRow.enable_conduct, classRow.id, isTeacher, selectedSemester?.end_date, selectedSemester?.id, selectedSemester?.start_date, selectedStudent, semesterId, supabase]);

  useEffect(() => { void loadStudentResults(); }, [loadStudentResults]);

  const selectStudent = useCallback((student: StudentChoice | null) => {
    setSelectedStudent(student);
    onSelectedStudentChange(student);
  }, [onSelectedStudentChange]);
  const selectedGradeRows = grades;
  const selectedFeedbacks = feedbacks;
  const totalExcused = attendance.filter((row) => row.status === "excused").length;
  const totalUnexcused = attendance.filter((row) => row.status === "unexcused").length;
  const weekOptions = Array.from(new Set(conductWeeks.map((row) => row.week_start))).sort((a, b) => b.localeCompare(a));

  async function toggleConduct() {
    setBusy(true); setError(null); setNotice(null);
    const enabled = !classRow.enable_conduct;
    const { error: updateError } = await supabase.from("classes").update({ enable_conduct: enabled }).eq("id", classRow.id);
    setBusy(false);
    if (updateError) { setError("Không thể cập nhật cài đặt ĐGTX. Kiểm tra migration và quyền giáo viên."); return; }
    onClassConductToggle(enabled);
    setNotice(enabled ? "Đã bật ĐGTX chi tiết và tra cứu tên cho lớp." : "Đã tắt ĐGTX chi tiết và tra cứu tên cho lớp.");
  }

  async function toggleSemesterClosed() {
    if (!selectedSemester) return;
    const nextClosed = !selectedSemester.is_closed;
    const confirmed = window.confirm(nextClosed
      ? `Bạn chắc chắn muốn chốt Học kỳ ${selectedSemester.semester_number} (${selectedSemester.school_year})? BCS sẽ không thể gửi thêm điểm hoặc ĐGTX.`
      : `Bạn chắc chắn muốn mở lại Học kỳ ${selectedSemester.semester_number} (${selectedSemester.school_year})?`);
    if (!confirmed) return;
    setBusy(true); setError(null); setNotice(null);
    const { error: updateError } = await supabase.from("semesters").update({ is_closed: nextClosed }).eq("id", selectedSemester.id).eq("class_id", classRow.id);
    setBusy(false);
    if (updateError) { setError("Không thể cập nhật trạng thái học kỳ."); return; }
    setNotice(nextClosed ? "Giáo viên đã chốt học kỳ." : "Đã mở lại học kỳ.");
    await loadSetup();
  }

  async function createSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = subjectSchema.safeParse({ name: newSubject });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Tên môn chưa hợp lệ."); return; }
    setBusy(true); setError(null);
    const { error: insertError } = await supabase.from("subjects").insert({ class_id: classRow.id, name: parsed.data.name });
    setBusy(false);
    if (insertError) { setError("Không thể thêm môn học. Môn trùng tên hoặc quyền chưa đủ."); return; }
    setNewSubject(""); setShowSubjectForm(false); setNotice("Đã thêm môn học."); await loadSetup();
  }

  async function createSemester(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = semesterSchema.safeParse({
      school_year: data.get("school_year"), semester_number: data.get("semester_number"),
      start_date: data.get("start_date"), end_date: data.get("end_date"),
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Thông tin học kỳ chưa hợp lệ."); return; }
    setBusy(true); setError(null);
    const { error: insertError } = await supabase.from("semesters").insert({ class_id: classRow.id, ...parsed.data });
    setBusy(false);
    if (insertError) { setError("Không thể tạo học kỳ. Kiểm tra ngày hoặc học kỳ đã tồn tại."); return; }
    setShowSemesterForm(false); setNotice("Đã tạo học kỳ."); await loadSetup();
  }

  async function addConductEvent(values: ConductFormValues) {
    const parsed = conductFormSchema.safeParse({
      ...values,
      enteredByName: role === "bcs" ? enteredByName : values.enteredByName,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Thông tin ĐGTX chưa hợp lệ."); return; }
    const value = parsed.data;
    if (role === "bcs" && !value.enteredByName.trim()) { setError("Ban cán sự cần nhập tên người đang ghi."); return; }
    setBusy(true); setError(null); setNotice(null);
    const { error: insertError } = await supabase.from("conduct_events").insert({
      class_id: classRow.id,
      student_id: value.studentId,
      semester_id: semesterId,
      subject_id: value.subjectId,
      kind: value.kind,
      points: value.kind === "speaking" ? null : value.amount,
      speak_count: value.kind === "speaking" ? value.amount : null,
      reason: value.kind === "speaking" ? null : value.reason.trim(),
      event_date: value.eventDate,
      entered_by_name: value.enteredByName.trim() || profile.full_name || "Giáo viên",
      is_locked: role === "bcs",
    });
    setBusy(false);
    if (insertError) { setError(insertError.message.includes("enable_conduct") ? "Hãy bật ĐGTX chi tiết cho lớp trước." : "Không lưu được ĐGTX. Kiểm tra ngày, học kỳ hoặc quyền ghi."); return; }
    setNotice(role === "bcs" ? "Đã gửi ĐGTX và khóa bản ghi." : "Đã lưu mục ĐGTX.");
    eventForm.reset({ studentId: selectedStudent?.id ?? "", subjectId: subjects[0]?.id ?? "", kind: "plus", amount: 1, reason: "", eventDate: currentDate, enteredByName: profile.full_name ?? "" });
    await loadStudentResults();
  }

  async function openEventDetails(subject: Subject, week: string) {
    if (!selectedStudent || !semesterId) return;
    setEventModal({ subject, week }); setDetailLoading(true); setEvents([]); setEventHasMore(false);
    const { data, error: eventError } = await supabase.from("conduct_events")
      .select("id,kind,points,speak_count,reason,event_date,entered_by_name,is_locked")
      .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).eq("subject_id", subject.id)
      .eq("semester_id", semesterId).eq("week_start", week).order("created_at", { ascending: false }).range(0, PAGE_SIZE - 1);
    if (eventError) setError("Không tải được chi tiết ĐGTX.");
    setEvents((data ?? []) as ConductEvent[]); setEventHasMore((data ?? []).length === PAGE_SIZE); setDetailLoading(false);
  }

  async function loadMoreEvents() {
    if (!eventModal || !selectedStudent || !semesterId || eventLoadingMore || !eventHasMore) return;
    setEventLoadingMore(true);
    try {
      const from = events.length;
      const { data, error: eventError } = await supabase.from("conduct_events")
        .select("id,kind,points,speak_count,reason,event_date,entered_by_name,is_locked")
        .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).eq("subject_id", eventModal.subject.id)
        .eq("semester_id", semesterId).eq("week_start", eventModal.week).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
      if (eventError) throw eventError;
      const next = (data ?? []) as ConductEvent[];
      setEvents((current) => [...current, ...next]); setEventHasMore(next.length === PAGE_SIZE);
    } catch { setError("Không tải thêm được chi tiết ĐGTX."); }
    finally { setEventLoadingMore(false); }
  }

  async function loadMoreFeedback() {
    if (!selectedStudent || feedbackLoadingMore || !feedbackHasMore) return;
    setFeedbackLoadingMore(true);
    try {
      const gradeIds = grades.map((grade) => grade.id);
      let query = supabase.from("feedbacks").select("id,student_id,grade_id,content,author_name,is_hidden,created_at")
        .eq("class_id", classRow.id).order("created_at", { ascending: false }).range(feedbacks.length, feedbacks.length + PAGE_SIZE - 1);
      query = gradeIds.length
        ? query.or(`student_id.eq.${selectedStudent.id},grade_id.in.(${gradeIds.join(",")})`)
        : query.eq("student_id", selectedStudent.id);
      const { data, error: feedbackError } = await query;
      if (feedbackError) throw feedbackError;
      const next = (data ?? []) as Feedback[];
      setFeedbacks((current) => [...current, ...next]); setFeedbackHasMore(next.length === PAGE_SIZE);
    } catch { setError("Không tải thêm được góp ý."); }
    finally { setFeedbackLoadingMore(false); }
  }

  async function loadMoreAuditLogs() {
    if (!selectedStudent || auditLoadingMore || !auditHasMore || !isTeacher) return;
    setAuditLoadingMore(true);
    try {
      const from = auditLogs.length;
      const { data, error: auditError } = await supabase.from("grade_audit_logs")
        .select("id,source_table,record_id,actor_role,entered_by_name,action,old_values,new_values,reason,created_at")
        .eq("class_id", classRow.id).eq("student_id", selectedStudent.id).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
      if (auditError) throw auditError;
      const next = (data ?? []) as AuditLog[];
      setAuditLogs((current) => [...current, ...next]); setAuditHasMore(next.length === PAGE_SIZE);
    } catch { setError("Không tải thêm được nhật ký thay đổi."); }
    finally { setAuditLoadingMore(false); }
  }

  async function saveGrade(subjectId: string, existing: Grade | undefined, values: GradeFormValues) {
    if (!selectedStudent || !semesterId) return;
    const parsed = gradeFormSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Điểm chưa hợp lệ."); return; }
    const midterm = parsed.data.midterm === "" ? null : Number(parsed.data.midterm);
    const final = parsed.data.final === "" ? null : Number(parsed.data.final);
    if (role === "bcs" && !enteredByName.trim()) { setError("Ban cán sự cần nhập tên người đang ghi."); return; }
    if (existing?.is_locked && isTeacher && !parsed.data.changeReason.trim()) { setError("Sửa hoặc mở khóa bản ghi đã khóa cần ghi lý do."); return; }
    setBusy(true); setError(null); setNotice(null);
    let saveError: { message: string } | null = null;
    if (existing?.is_locked && isTeacher) {
      const { error: rpcError } = await supabase.rpc("change_grade_with_reason", {
        p_grade_id: existing.id,
        p_midterm_score: midterm,
        p_final_score: final,
        p_is_locked: parsed.data.locked,
        p_reason: parsed.data.changeReason.trim(),
      });
      saveError = rpcError;
    } else {
      const { error: upsertError } = await supabase.from("grades").upsert({
        class_id: classRow.id,
        student_id: selectedStudent.id,
        subject_id: subjectId,
        semester_id: semesterId,
        midterm_score: midterm,
        final_score: final,
        is_locked: role === "bcs" ? true : parsed.data.locked,
        entered_by_name: role === "bcs" ? enteredByName.trim() : profile.full_name,
      }, { onConflict: "student_id,subject_id,semester_id" });
      saveError = upsertError;
    }
    setBusy(false);
    if (saveError) { setError("Không lưu được điểm. Bản ghi khóa cần lý do và quyền giáo viên/admin."); return; }
    setNotice(role === "bcs" ? "Đã gửi điểm và khóa bản ghi." : "Đã lưu điểm.");
    await loadStudentResults();
  }

  async function saveConductResult() {
    if (!selectedStudent || !semesterId) return;
    setBusy(true); setError(null);
    const { error: resultError } = await supabase.from("conduct_results").upsert({
      class_id: classRow.id, student_id: selectedStudent.id, semester_id: semesterId,
      final_result: finalResult, reason: finalReason.trim(), decided_by: profile.id,
    }, { onConflict: "student_id,semester_id" });
    setBusy(false);
    if (resultError) { setError("Không lưu được kết quả rèn luyện cuối cùng."); return; }
    setNotice("Đã chốt kết quả rèn luyện do giáo viên chọn."); await loadStudentResults();
  }

  async function addAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent || !semesterId) return;
    setBusy(true); setError(null);
    const { error: insertError } = await supabase.from("attendance_records").insert({
      class_id: classRow.id, student_id: selectedStudent.id, semester_id: semesterId,
      event_date: attendanceDate, status: attendanceStatus, reason: attendanceReason.trim(),
      entered_by_name: profile.full_name,
    });
    setBusy(false);
    if (insertError) { setError("Không lưu được chuyên cần. Có thể ngày này đã có ghi nhận hoặc ngoài học kỳ."); return; }
    setAttendanceReason(""); setNotice("Đã ghi nhận chuyên cần."); await loadStudentResults();
  }

  async function addFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent) return;
    if (feedbackText.trim().length < 1 || feedbackText.trim().length > 1000 || feedbackAuthor.trim().length < 1 || feedbackAuthor.trim().length > 60) {
      setError("Tên người gửi cần 1–60 ký tự, nội dung góp ý 1–1000 ký tự."); return;
    }
    setBusy(true); setError(null);
    const { error: insertError } = await supabase.from("feedbacks").insert({
      class_id: classRow.id,
      student_id: feedbackTarget === "student" ? selectedStudent.id : null,
      grade_id: feedbackTarget === "grade" ? feedbackGradeId : null,
      content: feedbackText.trim(), author_name: feedbackAuthor.trim(), created_by: profile.id,
    });
    setBusy(false);
    if (insertError) { setError("Không gửi được góp ý. Hãy kiểm tra đích góp ý hoặc giới hạn gửi."); return; }
    setFeedbackText(""); setNotice("Đã gửi góp ý."); await loadStudentResults();
  }

  async function moderateFeedback(feedback: Feedback, action: "hide" | "delete") {
    setBusy(true); setError(null);
    const result = action === "delete"
      ? await supabase.from("feedbacks").delete().eq("id", feedback.id).eq("class_id", classRow.id)
      : await supabase.from("feedbacks").update({ is_hidden: !feedback.is_hidden }).eq("id", feedback.id).eq("class_id", classRow.id);
    setBusy(false);
    if (result.error) { setError("Không thể quản lý góp ý này."); return; }
    setNotice(action === "delete" ? "Đã xóa góp ý." : feedback.is_hidden ? "Đã hiện góp ý." : "Đã ẩn góp ý.");
    await loadStudentResults();
  }

  const eventForm = useForm<ConductFormValues>({
    resolver: zodResolver(conductFormSchema),
    defaultValues: { studentId: selectedStudent?.id ?? "", subjectId: subjects[0]?.id ?? "", kind: "plus", amount: 1, reason: "", eventDate: currentDate, enteredByName: profile.full_name ?? "" },
  });
  useEffect(() => {
    if (selectedStudent) eventForm.setValue("studentId", selectedStudent.id);
  }, [eventForm, selectedStudent]);
  useEffect(() => {
    if (!eventForm.getValues("subjectId") && subjects[0]) eventForm.setValue("subjectId", subjects[0].id);
  }, [eventForm, subjects]);
  return (
    <section className="space-y-4" aria-labelledby="academic-results-title">
      <div className="rounded-2xl bg-blue-800 p-5 text-white shadow-md sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-100">Kết quả học tập</p>
          <h2 id="academic-results-title" className="mt-1 text-xl font-bold sm:text-2xl">Bảng điểm & ĐGTX</h2>
          <p className="mt-1 text-sm text-blue-100">{classRow.name} · Điểm trung bình do cơ sở dữ liệu tính.</p>
        </div>
        {(isTeacher) && (
          <button type="button" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/30 px-3 text-sm font-semibold hover:bg-white/10 sm:mt-0" onClick={toggleConduct} disabled={busy}>
            <Settings2 className="h-4 w-4" /> ĐGTX chi tiết: {classRow.enable_conduct ? "Đang bật" : "Đang tắt"}
          </button>
        )}
      </div>

      {(error || notice) && <div role={error ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
        {error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}{error ?? notice}
      </div>}

      <div className={cardClass}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.65fr)]">
          {classRow.enable_conduct ? (
            <StudentLookup classId={classRow.id} role={role} value={selectedStudent} onChange={selectStudent} label={role === "parent" || role === "student" ? "Tìm học sinh để xem kết quả" : "Chọn học sinh để nhập hoặc xem kết quả"} />
          ) : (
            <div>
              <label htmlFor="student-basic-select" className="mb-1.5 block text-xs font-semibold text-slate-700">Chọn học sinh</label>
              <select id="student-basic-select" className={inputClass} value={selectedStudent?.id ?? ""} onChange={(event) => {
                const student = students.find((item) => item.id === event.target.value);
                setSelectedStudent(student ? { id: student.id, full_name: student.full_name, student_number: student.student_number ?? students.indexOf(student) + 1 } : null);
              }}>
                <option value="">Chọn học sinh trong lớp</option>
                {students.map((student, index) => <option key={student.id} value={student.id}>{student.student_number ?? index + 1}. {student.full_name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="semester-select" className="mb-1.5 block text-xs font-semibold text-slate-700">Học kỳ</label>
            <div className="relative">
              <select id="semester-select" className={`${inputClass} appearance-none pr-9`} value={semesterId} onChange={(event) => setSemesterId(event.target.value)}>
                <option value="">Chưa có học kỳ</option>
                {semesters.map((semester) => <option key={semester.id} value={semester.id}>Năm {semester.school_year} · Học kỳ {semester.semester_number}{semester.is_closed ? " · Đã chốt" : ""}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-500" />
            </div>
          </div>
        </div>

        {isTeacher && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button type="button" className={outlineButtonClass} onClick={() => setShowSubjectForm((value) => !value)}><BookOpen className="h-4 w-4" /> Thêm môn học</button>
            <button type="button" className={outlineButtonClass} onClick={() => setShowSemesterForm((value) => !value)}><CalendarCheck2 className="h-4 w-4" /> Thêm học kỳ</button>
            {selectedSemester && <button type="button" className={selectedSemester.is_closed ? outlineButtonClass : buttonClass} onClick={() => void toggleSemesterClosed()} disabled={busy}>{selectedSemester.is_closed ? "Mở lại học kỳ" : "Chốt học kỳ"}</button>}
          </div>
        )}
        {showSubjectForm && isTeacher && <form onSubmit={createSubject} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className={inputClass} value={newSubject} onChange={(event) => setNewSubject(event.target.value)} placeholder="Tên môn học" maxLength={80} required />
          <button className={buttonClass} disabled={busy}><Plus className="h-4 w-4" /> Lưu môn</button>
        </form>}
        {showSemesterForm && isTeacher && <form onSubmit={createSemester} className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <input className={inputClass} name="school_year" defaultValue={defaultSchoolYear} aria-label="Năm học" />
          <select className={inputClass} name="semester_number" aria-label="Học kỳ"><option value="1">Học kỳ 1</option><option value="2">Học kỳ 2</option></select>
          <input className={inputClass} name="start_date" type="date" aria-label="Ngày bắt đầu" required />
          <input className={inputClass} name="end_date" type="date" aria-label="Ngày kết thúc" required />
          <button className={buttonClass} disabled={busy}>Lưu học kỳ</button>
        </form>}
        {setupLoading && <p role="status" className="mt-3 animate-pulse text-sm text-slate-600">Đang tải môn học và học kỳ…</p>}
        {!setupLoading && semesters.length === 0 && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Chưa có học kỳ. Giáo viên tạo học kỳ để bắt đầu nhập bảng điểm.</p>}
      </div>

      {!selectedStudent ? (
        <div className={cardClass + " text-center text-sm text-slate-600"}>
          <Search className="mx-auto mb-2 h-5 w-5 text-blue-700" />
          {classRow.enable_conduct ? "Tìm và chọn học sinh trong lớp để xem điểm, chuyên cần và ĐGTX." : "Chọn học sinh để xem bảng điểm và chuyên cần."}
        </div>
      ) : loading ? (
        <div className={cardClass + " animate-pulse text-sm text-slate-600"} role="status">Đang tải kết quả của {selectedStudent.full_name}…</div>
      ) : !selectedSemester ? (
        <div className={cardClass + " text-sm text-slate-700"}>Chưa có học kỳ để hiển thị kết quả.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard icon={<CalendarCheck2 className="h-4 w-4" />} title="Nghỉ có phép" value={totalExcused} tone="blue" />
            <MetricCard icon={<AlertCircle className="h-4 w-4" />} title="Nghỉ không phép" value={totalUnexcused} tone="red" />
          </div>

          <section className={cardClass} aria-labelledby="grades-heading">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xs font-bold uppercase tracking-wider text-blue-800">{selectedStudent.student_number}. {selectedStudent.full_name}</p><h3 id="grades-heading" className="mt-1 text-lg font-bold text-slate-950">Bảng điểm · Học kỳ {selectedSemester.semester_number}</h3></div>
              {selectedSemester.is_closed && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"><LockKeyhole className="h-3.5 w-3.5" /> Đã chốt</span>}
            </div>
            {role === "bcs" && canEnter && <label className="mb-3 block max-w-sm text-xs font-semibold text-slate-700">Tên thành viên BCS đang nhập
              <input className={`${inputClass} mt-1`} value={enteredByName} onChange={(event) => setEnteredByName(event.target.value)} maxLength={80} placeholder="Nhập tên người ghi điểm" />
            </label>}
            {classRow.enable_conduct && canEnter && (isTeacher || !selectedSemester.is_closed) && subjects.length > 0 && <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3 sm:p-4">
              <div className="mb-3"><h4 className="font-semibold text-slate-950">Nhập điểm cộng, điểm trừ hoặc số lần phát biểu</h4><p className="mt-1 text-xs text-slate-700">Ghi nhận cho {selectedStudent.student_number}. {selectedStudent.full_name} · Tuần {formatDate(selectedWeek)}.</p></div>
              <form onSubmit={eventForm.handleSubmit(addConductEvent)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="sm:col-span-2 xl:col-span-4">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">Chọn loại ghi nhận</span>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="Loại ghi nhận điểm">
                    {([ ["plus", "Điểm cộng (+)"], ["minus", "Điểm trừ (−)"], ["speaking", "Phát biểu" ] ] as const).map(([kind, label]) => {
                      const active = eventForm.watch("kind") === kind;
                      return <button key={kind} type="button" aria-pressed={active} className={`min-h-11 rounded-xl border px-2 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${active ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"}`} onClick={() => eventForm.setValue("kind", kind, { shouldValidate: true })}>{label}</button>;
                    })}
                  </div>
                </div>
                <label className="text-xs font-semibold text-slate-700">Môn học<select className={`${inputClass} mt-1`} {...eventForm.register("subjectId")}><option value="">Chọn môn</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><FieldError text={eventForm.formState.errors.subjectId?.message} /></label>
                <label className="text-xs font-semibold text-slate-700">{eventForm.watch("kind") === "speaking" ? "Số lần phát biểu" : eventForm.watch("kind") === "minus" ? "Số điểm trừ" : "Số điểm cộng"}<input type="number" min={1} max={eventForm.watch("kind") === "speaking" ? 999 : 10} className={`${inputClass} mt-1`} {...eventForm.register("amount")} /><FieldError text={eventForm.formState.errors.amount?.message} /></label>
                <label className="text-xs font-semibold text-slate-700">Ngày ghi nhận<input type="date" className={`${inputClass} mt-1`} {...eventForm.register("eventDate")} /></label>
                {eventForm.watch("kind") !== "speaking" && <label className="text-xs font-semibold text-slate-700 sm:col-span-2">{eventForm.watch("kind") === "minus" ? "Tại sao bị trừ điểm?" : "Lý do cộng điểm"}<input className={`${inputClass} mt-1`} maxLength={500} {...eventForm.register("reason")} placeholder={eventForm.watch("kind") === "minus" ? "Ví dụ: đi muộn, không thuộc bài…" : "Ví dụ: phát biểu xây dựng bài…"} /><FieldError text={eventForm.formState.errors.reason?.message} /></label>}
                <div className="flex items-end"><button type="submit" className={`${buttonClass} w-full sm:w-auto`} disabled={busy || subjects.length === 0}><Plus className="h-4 w-4" />{busy ? "Đang lưu…" : role === "bcs" ? "Gửi và khóa" : "Ghi nhận"}</button></div>
              </form>
            </div>}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-700"><tr><th className="px-3 py-3">Môn học</th><th className="px-3 py-3">ĐGTX</th><th className="px-3 py-3">GK</th><th className="px-3 py-3">CK</th><th className="px-3 py-3">TBM</th><th className="px-3 py-3">Thao tác</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {subjects.filter((subject) => subject.is_active).map((subject) => {
                    const grade = grades.find((item) => item.subject_id === subject.id);
                    const conduct = conductSemesters.find((item) => item.subject_id === subject.id);
                    const week = conductWeeks.find((item) => item.subject_id === subject.id && item.week_start === selectedWeek);
                    const canEdit = canEnter && (isTeacher || !selectedSemester.is_closed) && !(role === "bcs" && grade?.is_locked);
                    return <GradeEntryRow key={subject.id} subject={subject} grade={grade} isTeacher={isTeacher} canEdit={canEdit} canEnter={canEnter} busy={busy} onSave={(values) => saveGrade(subject.id, grade, values)} conduct={conduct} week={week} enableConduct={!!classRow.enable_conduct} onOpenDetails={() => selectedWeek && openEventDetails(subject, selectedWeek)} />;
                  })}
                  {subjects.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">Chưa có môn học. Giáo viên thêm môn học phía trên.</td></tr>}
                </tbody>
              </table>
            </div>
            {classRow.enable_conduct && canEnter && selectedSemester.is_closed && <p className="mt-3 text-xs text-amber-800">Học kỳ đã chốt; BCS và giáo viên không thể thêm dữ liệu mới.</p>}
          </section>

          {homePointLogError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{homePointLogError}</p>}
          <WeeklyPointResults
            logs={homePointLogs}
            startDate={selectedSemester.start_date}
            endDate={selectedSemester.end_date}
            studentName={selectedStudent.full_name}
            onNavigateHome={isTeacher ? onNavigateHome : undefined}
          />

          {classRow.enable_conduct && (
            <>
              <section className={cardClass} aria-labelledby="conduct-heading">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-xs font-bold uppercase tracking-wider text-blue-800">Đánh giá thường xuyên</p><h3 id="conduct-heading" className="mt-1 text-lg font-bold text-slate-950">Rèn luyện theo môn và tuần</h3></div>
                  {weekOptions.length > 0 && <select className={`${inputClass} w-auto min-w-48`} value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)} aria-label="Chọn tuần ĐGTX">
                    {weekOptions.map((week) => <option key={week} value={week}>Tuần bắt đầu {formatDate(week)}</option>)}
                  </select>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {subjects.filter((subject) => subject.is_active).map((subject) => {
                    const summary = conductSemesters.find((item) => item.subject_id === subject.id);
                    const weekly = conductWeeks.find((item) => item.subject_id === subject.id && item.week_start === selectedWeek);
                    return <article key={subject.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-2"><h4 className="font-semibold text-slate-900">{subject.name}</h4><button type="button" className="rounded-lg p-1.5 text-blue-800 hover:bg-blue-100" onClick={() => selectedWeek && openEventDetails(subject, selectedWeek)} aria-label={`Xem ĐGTX môn ${subject.name}`}><ClipboardList className="h-4 w-4" /></button></div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold"><span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900">+{weekly?.total_plus ?? 0}</span><span className="rounded-full bg-red-100 px-2 py-1 text-red-900">−{weekly?.total_minus ?? 0}</span><span className="rounded-full bg-blue-100 px-2 py-1 text-blue-900">💬 {weekly?.total_speaking ?? 0}</span></div>
                      <p className="mt-2 text-xs text-slate-700">Học kỳ: +{summary?.total_plus ?? 0} · −{summary?.total_minus ?? 0} · Phát biểu {summary?.total_speaking ?? 0}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">Gợi ý theo môn: {summary?.suggested_score ?? 50} điểm · {summary?.suggested_result ?? "Đạt"}</p>
                    </article>;
                  })}
                </div>
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-900">Tổng kết rèn luyện cả học kỳ</p>
                  <p className="mt-1 text-sm text-slate-800">Tổng +{conductOverall?.total_plus ?? 0} · −{conductOverall?.total_minus ?? 0} · phát biểu {conductOverall?.total_speaking ?? 0}. Gợi ý: <strong>{conductOverall?.suggested_score ?? 50} điểm · {conductOverall?.suggested_result ?? "Đạt"}</strong>.</p>
                  {isTeacher && <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(180px,.5fr)_1fr_auto]">
                    <label className="text-xs font-semibold text-slate-700">Kết quả cuối<select className={`${inputClass} mt-1`} value={finalResult} onChange={(event) => setFinalResult(event.target.value)}><option>Tốt</option><option>Khá</option><option>Đạt</option><option>Chưa đạt</option></select></label>
                    <label className="text-xs font-semibold text-slate-700">Nhận xét<input className={`${inputClass} mt-1`} value={finalReason} onChange={(event) => setFinalReason(event.target.value)} maxLength={500} placeholder="Lý do nếu giáo viên ghi đè mức gợi ý" /></label>
                    <button type="button" className={`${buttonClass} self-end`} disabled={busy} onClick={() => saveConductResult()}>Chốt học kỳ</button>
                  </div>}
                </div>
              </section>
            </>
          )}

          <section className={cardClass} aria-labelledby="attendance-heading">
            <div className="mb-3 flex items-center gap-2"><CalendarCheck2 className="h-5 w-5 text-blue-800" /><h3 id="attendance-heading" className="text-lg font-bold text-slate-950">Chuyên cần học kỳ</h3></div>
            <div className="flex flex-wrap gap-2"><span className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-900">Có phép: {totalExcused}</span><span className="rounded-full bg-red-100 px-3 py-1.5 text-sm font-semibold text-red-900">Không phép: {totalUnexcused}</span><span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-800">Có mặt: {attendance.filter((row) => row.status === "present").length}</span></div>
            {isTeacher && selectedSemester && <form onSubmit={addAttendance} className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input type="date" className={inputClass} value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} required />
              <select className={inputClass} value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value as "excused" | "unexcused")}><option value="excused">Nghỉ có phép</option><option value="unexcused">Nghỉ không phép</option></select>
              <input className={inputClass} value={attendanceReason} onChange={(event) => setAttendanceReason(event.target.value)} placeholder="Lý do / ghi chú" maxLength={300} />
              <button className={buttonClass} disabled={busy}>Ghi chuyên cần</button>
            </form>}
            {attendance.length > 0 && <ul className="mt-4 divide-y divide-slate-100">{attendance.slice(0, 8).map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="font-medium text-slate-900">{formatDate(row.event_date)} · {row.status === "excused" ? "Nghỉ có phép" : row.status === "unexcused" ? "Nghỉ không phép" : "Có mặt"}</span><span className="text-slate-600">{row.reason || row.entered_by_name}</span></li>)}</ul>}
          </section>

          <section className={cardClass} aria-labelledby="feedback-heading">
            <div className="mb-3 flex items-center gap-2"><MessageCircle className="h-5 w-5 text-blue-800" /><h3 id="feedback-heading" className="text-lg font-bold text-slate-950">Góp ý và trao đổi</h3></div>
            {(role === "parent" || role === "student") && <form onSubmit={addFeedback} className="grid gap-2 sm:grid-cols-2">
              <input className={inputClass} value={feedbackAuthor} onChange={(event) => setFeedbackAuthor(event.target.value)} placeholder="Tên người gửi" maxLength={60} required />
              <select className={inputClass} value={feedbackTarget} onChange={(event) => setFeedbackTarget(event.target.value)}><option value="student">Góp ý về học sinh</option><option value="grade" disabled={grades.length === 0}>Góp ý về một cột điểm</option></select>
              {feedbackTarget === "grade" && <select className={inputClass} value={feedbackGradeId} onChange={(event) => setFeedbackGradeId(event.target.value)} required><option value="">Chọn cột điểm</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{subjectById.get(grade.subject_id)?.name ?? "Môn học"} · GK {grade.midterm_score ?? "—"} · CK {grade.final_score ?? "—"}</option>)}</select>}
              <textarea className={`${inputClass} min-h-24 py-3 sm:col-span-2`} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="Viết góp ý (tối đa 1000 ký tự)" maxLength={1000} required />
              <div className="sm:col-span-2"><button className={buttonClass} disabled={busy}>Gửi góp ý</button></div>
            </form>}
            <div className="mt-4 space-y-2">
              {selectedFeedbacks.map((feedback) => <article key={feedback.id} className={`rounded-xl border p-3 ${feedback.is_hidden ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{feedback.author_name} · {formatDate(feedback.created_at.slice(0, 10))}{feedback.is_hidden ? " · Đang ẩn" : ""}</p>{canFeedbackModerate && <div className="flex gap-1"><button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-800 hover:bg-white" disabled={busy} onClick={() => void moderateFeedback(feedback, "hide")}>{feedback.is_hidden ? "Hiện" : "Ẩn"}</button><button type="button" className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-800 hover:bg-red-50" disabled={busy} onClick={() => void moderateFeedback(feedback, "delete")}>Xóa</button></div>}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{feedback.content}</p>
              </article>)}
              {selectedFeedbacks.length === 0 && <p className="text-sm text-slate-600">Chưa có góp ý cho học sinh này.</p>}
              {feedbackHasMore && <button type="button" className={`${outlineButtonClass} w-full`} disabled={feedbackLoadingMore} onClick={() => void loadMoreFeedback()}>{feedbackLoadingMore ? "Đang tải…" : "Tải thêm góp ý"}</button>}
            </div>
          </section>

          {isTeacher && <section className={cardClass} aria-labelledby="audit-heading">
            <div className="mb-3 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-blue-800" /><h3 id="audit-heading" className="text-lg font-bold text-slate-950">Nhật ký thay đổi điểm / ĐGTX</h3></div>
            <p className="mb-3 text-sm text-slate-700">Nhật ký được ghi tự động từ cơ sở dữ liệu và chỉ giáo viên/admin xem được.</p>
            <div className="space-y-2">
              {auditLogs.map((log) => <article key={log.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{log.source_table === "grades" ? "Điểm môn học" : "ĐGTX"} · {log.action === "INSERT" ? "Tạo" : log.action === "UPDATE" ? "Sửa" : "Xóa"}</p><time className="text-xs text-slate-600">{new Date(log.created_at).toLocaleString("vi-VN")}</time></div>
                <p className="mt-1 text-sm text-slate-700">Người nhập: {log.entered_by_name || "Không ghi tên"} · Vai trò: {log.actor_role}</p>
                {log.reason && <p className="mt-1 text-sm text-slate-700">Lý do: {log.reason}</p>}
                <details className="mt-2 text-xs text-slate-700"><summary className="cursor-pointer font-semibold">Xem dữ liệu trước/sau</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2">{JSON.stringify({ trước: log.old_values, sau: log.new_values }, null, 2)}</pre></details>
              </article>)}
              {auditLogs.length === 0 && <p className="text-sm text-slate-600">Chưa có lần ghi điểm/ĐGTX nào sau khi bật audit migration.</p>}
              {auditHasMore && <button type="button" className={`${outlineButtonClass} w-full`} disabled={auditLoadingMore} onClick={() => void loadMoreAuditLogs()}>{auditLoadingMore ? "Đang tải…" : "Tải thêm nhật ký"}</button>}
            </div>
          </section>}
        </>
      )}

      {eventModal && <EventDetailModal subject={eventModal.subject} week={eventModal.week} events={events} loading={detailLoading} loadingMore={eventLoadingMore} hasMore={eventHasMore} role={role} onLoadMore={loadMoreEvents} onClose={() => setEventModal(null)} onEventUpdated={async () => { await loadStudentResults(); await openEventDetails(eventModal.subject, eventModal.week); }} />}
    </section>
  );

}

function GradeEntryRow({ subject, grade, isTeacher, canEdit, canEnter, busy, onSave, conduct, week, enableConduct, onOpenDetails }: {
  subject: Subject; grade?: Grade; isTeacher: boolean; canEdit: boolean; canEnter: boolean; busy: boolean;
  onSave: (values: GradeFormValues) => Promise<void>; conduct?: ConductSemester; week?: ConductWeek; enableConduct: boolean;
  onOpenDetails: () => void;
}) {
  const form = useForm<GradeFormValues>({
    resolver: zodResolver(gradeFormSchema),
    defaultValues: { midterm: grade?.midterm_score == null ? "" : String(grade.midterm_score), final: grade?.final_score == null ? "" : String(grade.final_score), changeReason: "", locked: grade?.is_locked ?? false },
  });
  useEffect(() => { form.reset({ midterm: grade?.midterm_score == null ? "" : String(grade.midterm_score), final: grade?.final_score == null ? "" : String(grade.final_score), changeReason: "", locked: grade?.is_locked ?? false }); }, [form, grade]);
  return <tr className="align-top">
    <th scope="row" className="min-w-36 px-3 py-3 font-semibold text-slate-950">{subject.name}</th>
    <td className="px-3 py-3">
      {enableConduct ? <button type="button" className="flex flex-wrap gap-1.5 text-xs font-bold" onClick={onOpenDetails} aria-label={`Mở chi tiết ĐGTX ${subject.name}`}>
        <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900">+{week?.total_plus ?? 0}</span><span className="rounded-full bg-red-100 px-2 py-1 text-red-900">−{week?.total_minus ?? 0}</span><span className="rounded-full bg-blue-100 px-2 py-1 text-blue-900">💬{week?.total_speaking ?? 0}</span>
      </button> : <span className="text-xs text-slate-600">—</span>}
    </td>
    {canEnter ? <td colSpan={3} className="px-3 py-2">
      <form onSubmit={form.handleSubmit((values) => onSave(values))} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
        <label className="text-[10px] font-semibold uppercase text-slate-700">Giữa kỳ<input inputMode="decimal" disabled={!canEdit || busy} className={`${inputClass} mt-1`} placeholder="—" {...form.register("midterm")} /><FieldError text={form.formState.errors.midterm?.message} /></label>
        <label className="text-[10px] font-semibold uppercase text-slate-700">Cuối kỳ<input inputMode="decimal" disabled={!canEdit || busy} className={`${inputClass} mt-1`} placeholder="—" {...form.register("final")} /><FieldError text={form.formState.errors.final?.message} /></label>
        <div className="pt-5"><span className="block min-h-5 text-center font-bold text-slate-950">{grade?.term_average ?? "—"}</span></div>
        {grade?.is_locked && isTeacher && <label className="col-span-3 text-xs text-slate-700">Lý do sửa/mở khóa<input className={`${inputClass} mt-1`} disabled={busy} maxLength={500} {...form.register("changeReason")} placeholder="Bắt buộc khi chỉnh bản ghi khóa" /></label>}
        {isTeacher && <label className="col-span-2 flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" disabled={!canEdit || busy} {...form.register("locked")} />Khóa sau khi lưu</label>}
        <button type="submit" className={`${buttonClass} min-h-9 px-3 text-xs`} disabled={!canEdit || busy || (grade?.is_locked && !isTeacher)}>{grade?.is_locked ? "Đã khóa" : grade ? "Lưu" : "Ghi điểm"}</button>
        {grade?.is_locked && <p className="col-span-3 inline-flex items-center gap-1 text-xs text-slate-600"><LockKeyhole className="h-3.5 w-3.5" />Bản ghi đã khóa{grade.entered_by_name ? ` · ${grade.entered_by_name}` : ""}</p>}
        {form.formState.errors.root && <p className="col-span-3 text-xs text-red-700">{form.formState.errors.root.message}</p>}
      </form>
    </td> : <><td className="px-3 py-3 text-slate-900">{grade?.midterm_score ?? "—"}</td><td className="px-3 py-3 text-slate-900">{grade?.final_score ?? "—"}</td><td className="px-3 py-3 font-semibold text-slate-950">{grade?.term_average ?? "—"}</td></>}
    {!canEnter && <td className="px-3 py-3 text-xs text-slate-600">{grade?.is_locked && <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" />Đã chốt</span>}</td>}
    {canEnter && <td className="hidden" />}
  </tr>;
}

function MetricCard({ icon, title, value, tone }: { icon: React.ReactNode; title: string; value: number; tone: "blue" | "red" }) {
  return <div className={`rounded-2xl border p-4 ${tone === "red" ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"}`}>
    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">{icon}{title}</div><p className="mt-1 text-2xl font-bold text-slate-950">{value} <span className="text-sm font-medium">ngày</span></p>
  </div>;
}

function FieldError({ text }: { text?: string }) { return text ? <span className="mt-1 block text-[11px] font-medium text-red-700">{text}</span> : null; }

function EventEditControl({ event, onSaved }: { event: ConductEvent; onSaved: () => Promise<void> }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<EventEditValues>({
    resolver: zodResolver(eventEditSchema),
    defaultValues: { amount: event.kind === "speaking" ? event.speak_count ?? 1 : event.points ?? 1, reason: event.reason ?? "", eventDate: event.event_date, changeReason: "", locked: event.is_locked },
  });
  useEffect(() => { form.reset({ amount: event.kind === "speaking" ? event.speak_count ?? 1 : event.points ?? 1, reason: event.reason ?? "", eventDate: event.event_date, changeReason: "", locked: event.is_locked }); }, [event, form]);
  async function save(values: EventEditValues) {
    const parsed = eventEditSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Dữ liệu chưa hợp lệ."); return; }
    if (event.kind !== "speaking" && (parsed.data.amount > 10 || !parsed.data.reason)) { setError("Điểm cộng/trừ tối đa 10 và cần có lý do."); return; }
    setBusy(true); setError(null);
    const { error: updateError } = await supabase.rpc("change_conduct_event_with_reason", {
      p_event_id: event.id,
      p_points: event.kind === "speaking" ? null : parsed.data.amount,
      p_speak_count: event.kind === "speaking" ? parsed.data.amount : null,
      p_event_reason: event.kind === "speaking" ? null : parsed.data.reason,
      p_event_date: parsed.data.eventDate,
      p_is_locked: parsed.data.locked,
      p_change_reason: parsed.data.changeReason,
    });
    setBusy(false);
    if (updateError) { setError("Không thể sửa mục này. Kiểm tra quyền giáo viên/admin và lý do thay đổi."); return; }
    setOpen(false); await onSaved();
  }
  return <div className="mt-2">
    <button type="button" className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-50" onClick={() => setOpen((value) => !value)}>{open ? "Đóng sửa" : event.is_locked ? "Sửa / mở khóa" : "Sửa mục"}</button>
    {open && <form onSubmit={form.handleSubmit(save)} className="mt-2 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">{event.kind === "speaking" ? "Số lần" : "Điểm"}<input type="number" min={1} max={event.kind === "speaking" ? 999 : 10} className={`${inputClass} mt-1`} {...form.register("amount")} /></label>
      <label className="text-xs font-semibold text-slate-700">Ngày<input type="date" className={`${inputClass} mt-1`} {...form.register("eventDate")} /></label>
      {event.kind !== "speaking" && <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Lý do mục<input className={`${inputClass} mt-1`} maxLength={500} {...form.register("reason")} /></label>}
      <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Lý do sửa / mở khóa<input className={`${inputClass} mt-1`} maxLength={500} {...form.register("changeReason")} placeholder="Bắt buộc để lưu và ghi audit" /></label>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" {...form.register("locked")} />Khóa bản ghi</label>
      <button type="submit" className={buttonClass} disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button>
      {error && <p role="alert" className="text-xs text-red-700 sm:col-span-2">{error}</p>}
    </form>}
  </div>;
}

function formatDate(value: string) { return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("vi-VN"); }

function getCurrentWeekStart() {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function EventDetailModal({ subject, week, events, loading, loadingMore, hasMore, role, onLoadMore, onClose, onEventUpdated }: { subject: Subject; week: string; events: ConductEvent[]; loading: boolean; loadingMore: boolean; hasMore: boolean; role: EffectiveRole; onLoadMore: () => Promise<void>; onClose: () => void; onEventUpdated: () => Promise<void> }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="event-detail-title" className="max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-800">{formatDate(week)} · {subject.name}</p><h2 id="event-detail-title" className="mt-1 text-lg font-bold text-slate-950">Chi tiết đánh giá thường xuyên</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Đóng"><X className="h-5 w-5" /></button></div>
      {loading ? <p className="mt-5 animate-pulse text-sm text-slate-600" role="status">Đang tải chi tiết…</p> : events.length === 0 ? <p className="mt-5 text-sm text-slate-600">Tuần này chưa có mục ĐGTX.</p> : <ul className="mt-4 divide-y divide-slate-100">{events.map((event) => <li key={event.id} className="py-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-900">{event.kind === "plus" ? `Cộng ${event.points}` : event.kind === "minus" ? `Trừ ${event.points}` : `Phát biểu ${event.speak_count} lần`}{event.is_locked ? " · Đã khóa" : ""}</p><p className="mt-1 text-sm text-slate-700">{event.reason || "Phát biểu"}</p><p className="mt-1 text-xs text-slate-600">{event.entered_by_name}</p></div><time className="text-xs text-slate-600">{formatDate(event.event_date)}</time></div>{(role === "teacher" || role === "admin") && <EventEditControl event={event} onSaved={onEventUpdated} />}</li>)}</ul>}
      {!loading && hasMore && <button type="button" className={`${outlineButtonClass} mt-3 w-full`} disabled={loadingMore} onClick={() => void onLoadMore()}>{loadingMore ? "Đang tải…" : "Tải thêm mục ĐGTX"}</button>}
      <button type="button" onClick={onClose} className={`${buttonClass} mt-4 w-full`}>Đóng</button>
    </section>
  </div>;
}
