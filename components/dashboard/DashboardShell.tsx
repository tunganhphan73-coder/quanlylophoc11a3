"use client";

// =====================================================================
// MAIN DASHBOARD COMPONENT
// Fetches everything the current role is allowed to see (RLS enforces
// the actual boundary; this component just requests less for parent/
// student), computes scores client-side, and lays out:
//   - Pie chart (conduct breakdown) + Top Students ("Wall of Fame")
//   - Teacher-only: AI scanner + student/point manager
//   - Comment section (all roles)
// Layout: shared blue-and-white navigation for desktop and mobile.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ConductPieChart } from "@/components/dashboard/ConductPieChart";
import { TopStudents } from "@/components/dashboard/TopStudents";
import { CommentSection } from "@/components/dashboard/CommentSection";
import { ScannerPanel } from "@/components/dashboard/ScannerPanel";
import { StudentManager } from "@/components/dashboard/StudentManager";
import { ClassAccountsManager } from "@/components/dashboard/ClassAccountsManager";
import { AcademicTimeline } from "@/components/dashboard/AcademicTimeline";
import { CreateClassForm, AccountResult, type ClassAccountProvisionResult } from "@/components/dashboard/CreateClassForm";
import { attachScoresForWeek, getConductBreakdown, getTopStudents } from "@/lib/score-calculator";
import { getEffectiveRole, type EffectiveRole } from "@/lib/auth/roles";
import type { ClassRow, PointLog, Profile, Student } from "@/lib/types";
import { createTeachingWeeks, type TeachingWeek } from "@/components/dashboard/WeekSelector";
import { AcademicResults } from "@/components/dashboard/AcademicResults";
import type { StudentChoice } from "@/components/dashboard/StudentLookup";
import { BookOpen, Home, MessageCircle, ScanLine, UserRound, Users } from "lucide-react";
import { WeekSelector } from "@/components/dashboard/WeekSelector";

type DashboardTab = "home" | "feed" | "results" | "profile";
const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string; icon: typeof Home }> = [
  { id: "home", label: "Trang chủ", icon: Home },
  { id: "feed", label: "Bảng tin", icon: MessageCircle },
  { id: "results", label: "KQ học tập", icon: BookOpen },
  { id: "profile", label: "Cá nhân", icon: UserRound },
];

const ROLE_LABEL: Record<EffectiveRole, string> = {
  teacher: "Giáo viên",
  parent: "Phụ huynh",
  student: "Học sinh",
  bcs: "Ban cán sự",
  admin: "Quản trị viên",
};
const ROLE_AVATAR: Record<EffectiveRole, string> = { teacher: "GV", parent: "PH", student: "HS", bcs: "BCS", admin: "QT" };

interface DashboardShellProps {
  profile: Profile;
}

export function DashboardShell({ profile }: DashboardShellProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(profile.class_id);
  const [students, setStudents] = useState<Student[]>([]);
  const [pointLogs, setPointLogs] = useState<PointLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [teachingWeeks, setTeachingWeeks] = useState<TeachingWeek[]>(() => createTeachingWeeks());
  const [loadedWeekLockClassId, setLoadedWeekLockClassId] = useState<string | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [isWeekLoading, setIsWeekLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"mobile" | "desktop">("desktop");
  const classLoadSequence = useRef(0);
  const weekLoadSequence = useRef(0);
  const silentWeekReload = useRef(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<DashboardTab>(() =>
    profile.role === "parent" || profile.role === "student" ? "results" : "home",
  );
  const [viewedStudent, setViewedStudent] = useState<StudentChoice | null>(null);
  const [academicPeriod, setAcademicPeriod] = useState<{ schoolYear: string; semester: number } | null>(null);
  const [classAccountResult, setClassAccountResult] = useState<ClassAccountProvisionResult | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const effectiveRole = getEffectiveRole(profile) ?? profile.role;
  const isTeacher = effectiveRole === "teacher" || effectiveRole === "admin";
  const visibleTabs = effectiveRole === "parent" || effectiveRole === "student"
    ? DASHBOARD_TABS.filter((tab) => tab.id !== "home")
    : DASHBOARD_TABS;
  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;
  const selectedWeek = teachingWeeks.find((week) => week.id === selectedWeekId)
    ?? teachingWeeks.find((week) => week.isCurrent)
    ?? teachingWeeks[0];

  useEffect(() => {
    try {
      const savedMode = window.localStorage.getItem("dashboard-view-mode");
      if (savedMode === "mobile" || savedMode === "desktop") setViewMode(savedMode);
    } catch {
      // Keep the desktop default if local storage is unavailable.
    }
  }, []);

  function changeViewMode(mode: "mobile" | "desktop") {
    setViewMode(mode);
    try {
      window.localStorage.setItem("dashboard-view-mode", mode);
    } catch {
      // The selected mode still applies for this page session.
    }
  }

  useEffect(() => {
    if (!selectedClassId) return;
    setLoadedWeekLockClassId(null);
    let closedIds: string[] = [];
    try {
      const saved = window.localStorage.getItem(`closed-teaching-weeks-v2:${selectedClassId}`);
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) closedIds = parsed;
    } catch {
      closedIds = [];
    }
    setTeachingWeeks((current) => current.map((week) => ({ ...week, locked: closedIds.includes(week.id) })));
    setLoadedWeekLockClassId(selectedClassId);
  }, [selectedClassId]);

  useEffect(() => {
    if (!selectedClassId || loadedWeekLockClassId !== selectedClassId) return;
    try {
      window.localStorage.setItem(
        `closed-teaching-weeks-v2:${selectedClassId}`,
        JSON.stringify(teachingWeeks.filter((week) => week.locked).map((week) => week.id)),
      );
    } catch {
      // Keep this demo state in memory if browser storage is unavailable.
    }
  }, [teachingWeeks, loadedWeekLockClassId, selectedClassId]);

  // ---------------------------------------------------------------------
  // Load the class list (teachers: all their classes; parent/student:
  // just the one class their shared login is pinned to).
  // ---------------------------------------------------------------------
  useEffect(() => {
    async function loadClasses() {
      try {
        if (isTeacher) {
          const { data, error } = await supabase.from("classes").select("*").order("created_at", { ascending: true });
          if (error) throw error;
          setClasses(data ?? []);
          if (!selectedClassId && data && data.length > 0) setSelectedClassId(data[0].id);
        } else if (profile.class_id) {
          const { data, error } = await supabase.from("classes").select("*").eq("id", profile.class_id).single();
          if (error) throw error;
          if (data) setClasses([data]);
        }
      } catch {
        setDataError("Không tải được danh sách lớp. Hãy kiểm tra kết nối rồi tải lại trang.");
      }
    }
    loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------
  // Load the selected class roster once; week logs are queried separately below.
  // ---------------------------------------------------------------------
  const loadClassData = useCallback(async (backgroundRefresh = false) => {
    const requestSequence = ++classLoadSequence.current;
    if (!selectedClassId) {
      if (!backgroundRefresh) setIsLoading(false);
      setStudents([]);
      setPointLogs([]);
      setIsWeekLoading(false);
      return;
    }
    if (!backgroundRefresh) setIsLoading(true);
    if (!backgroundRefresh) {
      setStudents([]);
      setPointLogs([]);
    }

    try {
      const studentRows: Student[] = [];
      const pageSize = 500;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("students")
          .select("id,class_id,full_name,team_number,student_number,created_at")
          .eq("class_id", selectedClassId)
          .order("full_name").order("id")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (requestSequence !== classLoadSequence.current) return;
        studentRows.push(...((data ?? []) as Student[]));
        if ((data ?? []).length < pageSize) break;
      }
      if (requestSequence !== classLoadSequence.current) return;
      setDataError(null);
      const nextStudents = studentRows;
      silentWeekReload.current = backgroundRefresh;
      setStudents(nextStudents);
      setDataVersion((version) => version + 1);
      setIsLoading(false);
      if (nextStudents.length > 0) {
        if (!backgroundRefresh) setIsWeekLoading(true);
      } else {
        setPointLogs([]);
        setIsWeekLoading(false);
      }
    } catch {
      if (requestSequence !== classLoadSequence.current) return;
      setDataError("Không tải được danh sách học sinh. Hãy kiểm tra kết nối rồi thử lại.");
      setStudents([]);
      setIsLoading(false);
      setIsWeekLoading(false);
    }
  }, [selectedClassId, supabase]);

  useEffect(() => {
    loadClassData();
  }, [loadClassData]);

  // Fetch only this week's logs. This avoids downloading years of history and
  // aborts stale requests if the teacher changes week before a query finishes.
  useEffect(() => {
    const requestSequence = ++weekLoadSequence.current;
    let cancelled = false;
    const controller = new AbortController();
    const silentReload = silentWeekReload.current;
    silentWeekReload.current = false;

    if (!selectedClassId || students.length === 0) {
      setPointLogs([]);
      setIsWeekLoading(false);
      return () => { cancelled = true; controller.abort(); };
    }

    if (!silentReload) setIsWeekLoading(true);
    const studentIds = students.map((student) => student.id);
    void (async () => {
      try {
        const rows: PointLog[] = [];
        const pageSize = 500;
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .from("point_logs")
            .select("id,student_id,points_delta,reason,created_by,created_at")
            .in("student_id", studentIds)
            .gte("created_at", selectedWeek.startAt)
            .lt("created_at", selectedWeek.endAt)
            .order("created_at", { ascending: false }).order("id")
            .range(from, from + pageSize - 1)
            .abortSignal(controller.signal);
          if (error) throw error;
          rows.push(...((data ?? []) as PointLog[]));
          if ((data ?? []).length < pageSize) break;
        }
        if (cancelled || requestSequence !== weekLoadSequence.current) return;
        setDataError(null);
        setPointLogs(rows);
      } catch {
        if (cancelled || requestSequence !== weekLoadSequence.current) return;
        setPointLogs([]);
        setDataError("Không tải được điểm của tuần này. Hãy thử chọn lại tuần hoặc tải lại trang.");
      } finally {
        if (!cancelled && requestSequence === weekLoadSequence.current) setIsWeekLoading(false);
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [selectedClassId, selectedWeek.startAt, selectedWeek.endAt, students, supabase]);

  const studentsWithScores = useMemo(
    () => attachScoresForWeek(students, pointLogs, selectedWeek.startAt, selectedWeek.endAt),
    [students, pointLogs, selectedWeek],
  );
  const topStudents = useMemo(() => getTopStudents(studentsWithScores, 5), [studentsWithScores]);
  const conductBreakdown = useMemo(() => getConductBreakdown(studentsWithScores), [studentsWithScores]);

  function selectTeachingWeek(week: TeachingWeek) {
    if (week.id === selectedWeek.id) return;
    setIsWeekLoading(true);
    setSelectedWeekId(week.id);
  }

  function returnToCurrentWeek() {
    const currentWeek = teachingWeeks.find((week) => week.isCurrent);
    if (currentWeek) selectTeachingWeek(currentWeek);
  }

  function lockTeachingWeek(week: TeachingWeek) {
    if (new Date(week.startAt).getTime() > Date.now()) return;
    setTeachingWeeks((current) => current.map((item) => item.id === week.id ? { ...item, locked: true } : item));
  }

  function handleClassCreated(newClass: ClassRow, accounts: ClassAccountProvisionResult) {
    setClasses((prev) => [...prev, newClass]);
    setSelectedClassId(newClass.id);
    setClassAccountResult(accounts);
  }

  const handleClassConductToggle = useCallback((enabled: boolean) => {
    setClasses((current) => current.map((item) => item.id === selectedClassId ? { ...item, enable_conduct: enabled } : item));
  }, [selectedClassId]);

  const handleViewedStudent = useCallback((student: StudentChoice | null) => {
    setViewedStudent(student);
  }, []);
  const handleAcademicPeriodChange = useCallback((period: { schoolYear: string; semester: number } | null) => {
    setAcademicPeriod(period);
  }, []);

  async function handleSignOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.push("/login");
      router.refresh();
    } catch {
      setDataError("Không đăng xuất được. Hãy kiểm tra kết nối rồi thử lại.");
    }
  }

  return (
    <div className={`dashboard-layout ${viewMode === "mobile" ? "dashboard-mobile-preview" : "dashboard-desktop-preview"} relative min-h-screen w-full bg-blue-50`} data-dashboard-mode={viewMode}>
      <div className="min-h-screen w-full bg-blue-50/80">
        <aside className={`fixed inset-y-0 left-0 z-30 w-56 flex-col border-r border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur-xl ${viewMode === "mobile" ? "hidden" : "hidden md:flex"}`} aria-label="Điều hướng chính">
          <div className="mb-8 flex items-center gap-2 px-2 text-blue-900"><BookOpen className="h-5 w-5" /><span className="font-bold">PTA-hanhkiem</span></div>
          <nav className="space-y-1">
            {visibleTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? "page" : undefined} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${activeTab === id ? "bg-blue-800 text-white" : "text-slate-700 hover:bg-blue-50 hover:text-blue-900"}`}><Icon className="h-4 w-4" />{label}</button>)}
          </nav>
          <div className="mt-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700"><span className="font-semibold">{ROLE_LABEL[effectiveRole]}</span><p className="mt-1 truncate">{profile.full_name}</p></div>
        </aside>

        <div className={`dashboard-main mx-auto flex w-full flex-col pb-24 md:pb-8 ${viewMode === "mobile" ? "max-w-[480px] gap-4 px-3 py-4" : "max-w-6xl gap-6 px-4 py-5 md:ml-56 md:w-[calc(100%-14rem)] md:px-8 md:py-8"}`}>
          {/* ---------------- Header ---------------- */}
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-sans text-xs font-semibold uppercase tracking-widest text-slate-600">
                {ROLE_LABEL[effectiveRole]}
                {!isTeacher && " · Chỉ xem"}
              </p>
              <h1 className="truncate font-sans text-2xl font-bold tracking-tight text-blue-950 md:text-3xl">{selectedClass?.name ?? "Chưa có lớp học"}</h1>
              <p className="mt-1 truncate text-xs text-slate-600 sm:text-sm">
                {selectedClass ? `${(effectiveRole === "student" || effectiveRole === "bcs") ? (viewedStudent?.full_name ?? "Chọn học sinh") + " · " : ""}${selectedClass.name}${academicPeriod ? ` (${academicPeriod.schoolYear})` : ""}${selectedClass.enable_conduct ? " · ĐGTX bật" : ""}` : "Quản lý kết quả học tập của lớp"}
              </p>
            </div>

            <div className="dashboard-header-actions flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label="Chọn giao diện dashboard">
                <button
                  type="button"
                  onClick={() => changeViewMode("mobile")}
                  aria-pressed={viewMode === "mobile"}
                  className={`min-h-9 rounded-md px-2.5 font-sans text-[11px] transition sm:px-3 sm:text-xs ${viewMode === "mobile" ? "bg-blue-800 font-semibold text-white" : "text-slate-600 hover:text-slate-950"}`}
                  title="Xem bố cục điện thoại"
                >
                  ☎ Điện thoại
                </button>
                <button
                  type="button"
                  onClick={() => changeViewMode("desktop")}
                  aria-pressed={viewMode === "desktop"}
                  className={`min-h-9 rounded-md px-2.5 font-sans text-[11px] transition sm:px-3 sm:text-xs ${viewMode === "desktop" ? "bg-blue-800 font-semibold text-white" : "text-slate-600 hover:text-slate-950"}`}
                  title="Xem bố cục máy tính"
                >
                  ▣ Máy tính
                </button>
              </div>
              <span className="flex items-center gap-2 font-sans text-sm text-slate-800">
                {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-9 w-9 rounded-full border border-white/30 object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white" aria-hidden="true">{ROLE_AVATAR[effectiveRole]}</span>}
                <span className="hidden max-w-36 truncate sm:inline">{profile.full_name}</span>
              </span>
              {effectiveRole === "admin" && <Button size="sm" variant="outline" onClick={() => router.push("/admin")}>Quản trị</Button>}
              <Button size="sm" variant="ghost" onClick={handleSignOut}>
                Đăng xuất
              </Button>
            </div>
          </header>

          {classAccountResult && <AccountResult result={classAccountResult} onClose={() => setClassAccountResult(null)} />}

          {(isTeacher || effectiveRole === "bcs") && selectedClass && activeTab === "home" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Tổng quan lớp">
              <div className="dashboard-overview-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_minmax(220px,1fr)_auto] lg:items-end">
                <div className="min-w-0">
                  <label htmlFor="dashboard-class-select" className="mb-1 block text-xs font-semibold text-slate-700">Lớp đang xem</label>
                  {isTeacher && classes.length > 1 ? (
                    <select id="dashboard-class-select" value={selectedClassId ?? ""} onChange={(event) => setSelectedClassId(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus-visible:border-blue-700">
                      {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  ) : <p className="flex min-h-11 items-center text-lg font-bold text-blue-950">{selectedClass.name}</p>}
                  {isTeacher && <p className="mt-1 text-sm text-slate-600">{isLoading ? "Đang tải danh sách lớp…" : `${students.length} học sinh`}{!isLoading && (isWeekLoading ? " · Đang tải điểm tuần…" : ` · Trung bình ${studentsWithScores.length ? (studentsWithScores.reduce((total, student) => total + student.totalPoints, 0) / studentsWithScores.length).toFixed(1) : "—"} điểm`)}</p>}
                </div>
                {isTeacher && <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Tuần ghi nhận</label>
                  <WeekSelector weeks={teachingWeeks} selectedWeek={selectedWeek} onSelect={selectTeachingWeek} onReturnToCurrent={returnToCurrentWeek} />
                </div>}
                <div className="flex flex-wrap gap-2">
                  {(isTeacher || effectiveRole === "bcs") && <Button type="button" variant={scannerOpen ? "outline" : "default"} className="min-h-11" aria-expanded={scannerOpen} onClick={() => setScannerOpen((open) => !open)}><ScanLine className="mr-2 h-4 w-4" />{scannerOpen ? "Đóng quét ảnh" : "Quét ảnh"}</Button>}
                  {isTeacher && <Button type="button" variant="outline" className="min-h-11" onClick={() => setActiveTab("profile")}><Users className="mr-2 h-4 w-4" />Tài khoản lớp</Button>}
                  {isTeacher && <CreateClassForm teacherId={profile.id} onCreated={handleClassCreated} variant="compact" />}
                </div>
              </div>
            </section>
          )}

          {dataError && (
            <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 font-sans text-sm text-red-200">
              {dataError}
            </p>
          )}

          {!selectedClassId ? (
            isTeacher ? (
              <CreateClassForm teacherId={profile.id} onCreated={handleClassCreated} variant="empty" />
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/40 p-10 text-center md:backdrop-blur-md">
                <p className="font-sans text-white/70">
                  Tài khoản của bạn chưa được gán vào lớp học nào. Vui lòng liên hệ giáo viên.
                </p>
              </div>
            )
          ) : isLoading ? (
            <div className="rounded-xl border border-white/10 bg-black/40 p-10 text-center md:backdrop-blur-md">
              <p className="font-sans text-white/50">Đang tải dữ liệu lớp học...</p>
            </div>
          ) : activeTab === "results" && selectedClass ? (
            <AcademicResults classRow={selectedClass} students={students} profile={profile} role={effectiveRole} onClassConductToggle={handleClassConductToggle} onSelectedStudentChange={handleViewedStudent} onAcademicPeriodChange={handleAcademicPeriodChange} onNavigateHome={() => setActiveTab("home")} />
          ) : activeTab === "home" ? (
            <div className="space-y-5">
              {(isTeacher || effectiveRole === "bcs") && selectedClass && scannerOpen && <ScannerPanel classRow={selectedClass} students={students} role={effectiveRole} onDataChanged={loadClassData} />}
              {isTeacher && selectedClass && <StudentManager classRow={selectedClass} students={studentsWithScores} pointLogs={pointLogs} selectedWeek={selectedWeek} isWeekLoading={isWeekLoading} onLockWeek={lockTeachingWeek} onDataChanged={loadClassData} />}
              {isWeekLoading ? <div className="grid gap-6 md:grid-cols-2" aria-hidden="true"><div className="h-64 animate-pulse rounded-xl border border-white/10 bg-black/35" /><div className="h-64 animate-pulse rounded-xl border border-white/10 bg-black/35" /></div> : <div className="grid gap-6 md:grid-cols-2"><ConductPieChart breakdown={conductBreakdown} totalStudents={students.length} /><TopStudents students={topStudents} /></div>}
              {selectedClass && <details className="rounded-2xl border border-white/15 bg-black/45 p-4 text-white"><summary className="cursor-pointer font-semibold">Sổ ghi nhận cũ · xem lại điểm tuần</summary><div className="mt-4"><AcademicTimeline classId={selectedClass.id} students={students} role={profile.role} refreshKey={dataVersion} /></div></details>}
            </div>
          ) : activeTab === "feed" && selectedClass ? (
            <CommentSection classId={selectedClass.id} currentUserId={profile.id} currentUserRole={profile.role} />
          ) : activeTab === "profile" ? (
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
              <div className="flex items-center gap-4">
                {profile.avatar_url ? <img src={profile.avatar_url} alt="Ảnh đại diện" className="h-16 w-16 rounded-full border border-slate-200 object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-800 text-sm font-bold text-white">{ROLE_AVATAR[effectiveRole]}</span>}
                <div><p className="text-xs font-bold uppercase tracking-wider text-blue-800">{ROLE_LABEL[effectiveRole]}</p><h2 className="text-xl font-bold">{profile.full_name}</h2><p className="text-sm text-slate-700">{selectedClass?.name ?? "Chưa gán lớp"}</p></div>
              </div>
              <p className="text-sm text-slate-700">Các thay đổi thông tin tài khoản do giáo viên/quản trị viên quản lý.</p>
              {isTeacher && selectedClass && <ClassAccountsManager classRow={selectedClass} />}
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void handleSignOut()}>Đăng xuất</Button>
            </section>
          ) : null}
        </div>
        <div className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 text-[10px] font-medium tracking-wide text-slate-500/70 md:bottom-4" aria-hidden="true">
          PTA-hanhkiem
        </div>
        <nav className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-1 pb-[env(safe-area-inset-bottom)] pt-1 shadow-sm ${viewMode === "mobile" ? "flex" : "grid md:hidden"}`} style={viewMode === "mobile" ? undefined : { gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }} aria-label="Điều hướng chính">
          {visibleTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? "page" : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition ${activeTab === id ? "text-blue-800" : "text-slate-700"}`}><Icon className={`h-5 w-5 ${activeTab === id ? "text-blue-800" : "text-slate-600"}`} />{label}</button>)}
        </nav>
      </div>
    </div>
  );
}
