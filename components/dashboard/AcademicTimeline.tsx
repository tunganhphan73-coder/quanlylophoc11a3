"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getConductTier, WEEKLY_BASE_SCORE, WEEKLY_UNQUALIFIED_MARKER } from "@/lib/score-calculator";
import type { Profile, Student } from "@/lib/types";

type PeriodKind = "week" | "month";
type PeriodRange = { key: string; startAt: string; endAt: string; label: string; dateLabel: string };
type ScoreLog = { id: string; student_id: string; points_delta: number; reason: string; created_at: string };

const dateRangeFormatter = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" });
const timestampFormatter = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getPeriodRanges(kind: PeriodKind): PeriodRange[] {
  const now = new Date();

  if (kind === "week") {
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

    return Array.from({ length: 12 }, (_, index) => {
      const start = new Date(monday);
      start.setDate(start.getDate() - index * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const lastDay = new Date(end.getTime() - 1);
      return {
        key: dateKey(start),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        label: index === 0 ? "Tuần hiện tại" : `Tuần ${dateRangeFormatter.format(start)} – ${dateRangeFormatter.format(lastDay)}`,
        dateLabel: `${dateRangeFormatter.format(start)} – ${dateRangeFormatter.format(lastDay)}`,
      };
    });
  }

  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const monthLabel = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(start);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      label: index === 0 ? `Tháng này · ${monthLabel}` : monthLabel,
      dateLabel: monthLabel,
    };
  });
}

function signedPoints(value: number) {
  const rounded = Math.round(value * 100) / 100;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${rounded > 0 ? "+" : ""}${formatted} đ`;
}

function formatScore(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function AcademicTimeline({
  classId,
  students,
  role,
  refreshKey = 0,
}: {
  classId: string;
  students: Student[];
  role: Profile["role"];
  refreshKey?: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [periodKind, setPeriodKind] = useState<PeriodKind>("week");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("all");
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ScoreLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const fetchedSignature = useRef("");

  const ranges = useMemo(() => getPeriodRanges(periodKind), [periodKind]);
  const selectedPeriod = ranges.find((range) => range.key === selectedPeriodKey) ?? ranges[0];
  const studentIdsKey = students.map((student) => student.id).join(",");

  useEffect(() => {
    setSelectedPeriodKey("");
    setExpandedStudentId(null);
  }, [periodKind]);

  useEffect(() => {
    if (!classId || !selectedPeriod || !studentIdsKey) {
      setLogs([]);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const studentIds = studentIdsKey.split(",");
    // Same class/period/roster and only refreshKey changed -> refresh quietly, no skeleton flash.
    const signature = `${classId}|${selectedPeriod.startAt}|${selectedPeriod.endAt}|${studentIdsKey}`;
    if (fetchedSignature.current !== signature) setIsLoading(true);
    setErrorMessage("");

    void (async () => {
      try {
        const rows: ScoreLog[] = [];
        const pageSize = 500;
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .from("point_logs")
            .select("id, student_id, points_delta, reason, created_at")
            .in("student_id", studentIds)
            .gte("created_at", selectedPeriod.startAt)
            .lt("created_at", selectedPeriod.endAt)
            .order("created_at", { ascending: false }).order("id")
            .range(from, from + pageSize - 1)
            .abortSignal(controller.signal);
          if (error) throw error;
          rows.push(...((data ?? []) as ScoreLog[]));
          if ((data ?? []).length < pageSize) break;
        }
        if (!active) return;
        setLogs(rows);
        fetchedSignature.current = signature;
      } catch {
        if (!active) return;
        setLogs([]);
        setErrorMessage("Không tải được sổ điểm. Hãy thử tải lại trang hoặc liên hệ giáo viên.");
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [classId, selectedPeriod?.endAt, selectedPeriod?.startAt, studentIdsKey, refreshKey, supabase]);

  const studentRecords = useMemo(() => students.map((student) => {
    const studentLogs = logs.filter((log) => log.student_id === student.id);
    const adjustment = studentLogs.reduce((sum, log) => sum + Number(log.points_delta), 0);
    const weeklyScore = Math.round((WEEKLY_BASE_SCORE + adjustment) * 100) / 100;
    const forcedUnqualified = studentLogs.some((log) => log.reason.includes(WEEKLY_UNQUALIFIED_MARKER));
    return {
      student,
      logs: studentLogs,
      adjustment: Math.round(adjustment * 100) / 100,
      weeklyScore,
      conductTier: getConductTier(weeklyScore, forcedUnqualified),
    };
  }), [logs, students]);

  const visibleRecords = selectedStudentId === "all"
    ? studentRecords
    : studentRecords.filter((record) => record.student.id === selectedStudentId);
  const totalAdjustment = logs.reduce((sum, log) => sum + Number(log.points_delta), 0);
  const studentsWithLogs = new Set(logs.map((log) => log.student_id)).size;
  const weeklyAverage = studentRecords.length
    ? studentRecords.reduce((sum, record) => sum + record.weeklyScore, 0) / studentRecords.length
    : WEEKLY_BASE_SCORE;
  const isTeacher = role === "teacher";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/45 p-4 shadow-2xl md:backdrop-blur-xl sm:p-6">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#E7B93F]/[0.06] blur-3xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.08] pb-4 sm:items-end sm:pb-5">
          <div>
            <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.24em] text-[#E7B93F]/70">
              {isTeacher ? "Sổ ghi nhận" : `${role === "parent" ? "Phụ huynh" : "Học sinh"} · Chỉ xem`}
            </p>
            <h2 className="mt-2 font-sans text-xl font-semibold tracking-tight text-white sm:text-2xl">Điểm theo tuần và tháng</h2>
            <p className="mt-2 max-w-2xl font-sans text-sm leading-6 text-white/50">
              Điểm được tính từ các lượt giáo viên đã lưu trong sổ điểm. Mỗi tuần bắt đầu từ {WEEKLY_BASE_SCORE} điểm.
            </p>
            {!isTeacher && (
              <p className="mt-1 max-w-2xl font-sans text-xs leading-5 text-white/35">
                Tài khoản hiện gắn theo lớp nên sổ này hiển thị dữ liệu của lớp ở chế độ chỉ xem.
              </p>
            )}
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.16em] text-emerald-200/80">
            Dữ liệu đã ghi
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(180px,0.65fr)] sm:items-center">
          <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/30 p-1" role="group" aria-label="Chọn cách xem điểm">
            {(["week", "month"] as PeriodKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={periodKind === kind}
                onClick={() => setPeriodKind(kind)}
                className={`min-h-11 rounded-lg px-4 font-sans text-sm transition ${periodKind === kind ? "bg-[#E7B93F] font-semibold text-[#14120B]" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}
              >
                {kind === "week" ? "Theo tuần" : "Theo tháng"}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="score-period">Chọn tuần hoặc tháng</label>
          <select
            id="score-period"
            value={selectedPeriod.key}
            onChange={(event) => { setSelectedPeriodKey(event.target.value); setExpandedStudentId(null); }}
            className="min-h-12 w-full rounded-xl border border-white/10 bg-[#111411] px-3 font-sans text-sm text-white outline-none focus:border-[#E7B93F]/50"
          >
            {ranges.map((range) => <option key={range.key} value={range.key}>{range.label}</option>)}
          </select>
          <label className="sr-only" htmlFor="score-student">Lọc theo học sinh</label>
          <select
            id="score-student"
            value={selectedStudentId}
            onChange={(event) => { setSelectedStudentId(event.target.value); setExpandedStudentId(null); }}
            className="min-h-12 w-full rounded-xl border border-white/10 bg-[#111411] px-3 font-sans text-sm text-white outline-none focus:border-[#E7B93F]/50"
          >
            <option value="all">Tất cả học sinh</option>
            {students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MetricCard
            label={periodKind === "week" ? "Điểm trung bình tuần" : "Tổng cộng / trừ tháng"}
            value={periodKind === "week" ? `${formatScore(weeklyAverage)} đ` : signedPoints(totalAdjustment)}
            detail={periodKind === "week" ? selectedPeriod.dateLabel : selectedPeriod.dateLabel}
          />
          <MetricCard label="Lượt ghi điểm" value={String(logs.length)} detail="Lượt được lưu trong hệ thống" />
          <MetricCard label="Học sinh có ghi nhận" value={`${studentsWithLogs}/${students.length}`} detail="Trong khoảng thời gian đã chọn" />
        </div>

        {errorMessage && <p role="alert" className="mt-4 rounded-lg border border-red-400/20 bg-red-950/20 p-3 font-sans text-sm text-red-300">{errorMessage}</p>}

        {isLoading ? (
          <div className="mt-4 space-y-2" aria-label="Đang tải sổ điểm">
            {[0, 1, 2].map((item) => <div key={item} className="h-[68px] animate-pulse rounded-xl border border-white/[0.07] bg-white/[0.035]" />)}
          </div>
        ) : errorMessage ? null : students.length === 0 ? (
          <p className="mt-4 rounded-xl border border-white/[0.07] bg-black/25 p-5 text-center font-sans text-sm text-white/45">Lớp chưa có học sinh trong danh sách.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {visibleRecords.map(({ student, logs: studentLogs, adjustment, weeklyScore, conductTier }) => {
              const expanded = expandedStudentId === student.id;
              const scoreColor = periodKind === "week" && weeklyScore < 30 ? "text-rose-300" : "text-[#F3D783]";
              return (
                <article key={student.id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/25">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedStudentId(expanded ? null : student.id)}
                    className="flex min-h-[72px] w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-white/[0.025] sm:px-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-sans text-sm font-medium text-white">{student.full_name}</span>
                      <span className="mt-1 block font-sans text-xs text-white/40">
                        {studentLogs.length} lượt ghi{periodKind === "week" ? ` · ${conductTier}` : " trong tháng"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`font-mono text-base font-semibold ${scoreColor}`}>
                        {periodKind === "week" ? `${formatScore(weeklyScore)} đ` : signedPoints(adjustment)}
                      </span>
                      <svg className={`h-4 w-4 text-white/35 transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-white/[0.07] px-3 py-3 sm:px-4">
                      {studentLogs.length === 0 ? (
                        <p className="font-sans text-xs text-white/40">Chưa có lượt ghi trong khoảng thời gian này{periodKind === "week" ? ` · điểm tuần hiện tại là ${WEEKLY_BASE_SCORE}đ` : ""}.</p>
                      ) : (
                        <ul className="space-y-2">
                          {studentLogs.map((log) => (
                            <li key={log.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-lg bg-white/[0.025] px-3 py-2.5">
                              <span className="min-w-0 flex-1">
                                <span className="block break-words font-sans text-xs text-white/80">{log.reason || "Không có ghi chú"}</span>
                                <time className="mt-1 block font-sans text-[10px] text-white/35" dateTime={log.created_at}>{timestampFormatter.format(new Date(log.created_at))}</time>
                              </span>
                              <span className={`shrink-0 font-mono text-xs font-semibold ${Number(log.points_delta) < 0 ? "text-rose-300" : "text-emerald-200"}`}>
                                {signedPoints(Number(log.points_delta))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-4 font-sans text-[11px] leading-5 text-white/30">
          Điểm tuần = {WEEKLY_BASE_SCORE} điểm nền + tổng điểm đã ghi trong tuần. Chế độ tháng cộng các lượt tăng/giảm trong tháng; điểm nền được tính lại theo từng tuần.
        </p>
      </div>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/30 px-3 py-3 sm:px-4">
      <span className="block font-sans text-[10px] uppercase tracking-[0.13em] text-white/40">{label}</span>
      <span className="mt-1.5 block font-mono text-lg font-semibold text-[#F3D783]">{value}</span>
      <span className="mt-1 block font-sans text-[10px] text-white/35">{detail}</span>
    </div>
  );
}
