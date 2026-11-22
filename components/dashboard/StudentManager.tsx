"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WEEKLY_UNQUALIFIED_MARKER } from "@/lib/score-calculator";
import type { ClassRow, PointLog, StudentWithScore } from "@/lib/types";
import { formatWeekRange, type TeachingWeek } from "@/components/dashboard/WeekSelector";

interface ScoreRule {
  id: string;
  label: string;
  points: number;
  reason: string;
}

const DEFAULT_SCORE_RULES: ScoreRule[] = [
  { id: "speak", label: "Phát biểu (mỗi lần)", points: 0.5, reason: "Phát biểu" },
  { id: "grade-10", label: "Đạt điểm 10", points: 5, reason: "Đạt điểm 10" },
  { id: "grade-9", label: "Đạt điểm 9", points: 4, reason: "Đạt điểm 9" },
  { id: "grade-8", label: "Đạt điểm 8", points: 3, reason: "Đạt điểm 8" },
  { id: "found-item", label: "Nhặt được của rơi", points: 5, reason: "Nhặt được của rơi" },
  { id: "team-award", label: "Hoạt động tập thể có giải", points: 5, reason: "Hoạt động tập thể có giải" },
  { id: "class-officer", label: "Ban cán sự (mỗi tuần)", points: 3, reason: "Điểm ban cán sự tuần" },
  { id: "late", label: "Đi muộn", points: -2, reason: "Đi muộn" },
  { id: "unprepared", label: "Không thuộc bài", points: -5, reason: "Không thuộc bài" },
  { id: "talking", label: "Nói chuyện riêng", points: -1, reason: "Nói chuyện riêng" },
  { id: "no-homework", label: "Không làm bài tập về nhà", points: -5, reason: "Không làm bài tập về nhà" },
  { id: "no-equipment", label: "Thiếu dụng cụ học tập", points: -2, reason: "Thiếu dụng cụ học tập" },
  {
    id: "serious-violation",
    label: "Vi phạm nghiêm trọng",
    points: -10,
    reason: `${WEEKLY_UNQUALIFIED_MARKER} Vi phạm nghiêm trọng`,
  },
];

interface AdjustmentDraft {
  ruleId: string;
  points: string;
  reason: string;
}

interface StudentManagerProps {
  classRow: ClassRow;
  students: StudentWithScore[];
  pointLogs: PointLog[];
  selectedWeek: TeachingWeek;
  isWeekLoading: boolean;
  onLockWeek: (week: TeachingWeek) => void;
  onDataChanged: (backgroundRefresh?: boolean) => void;
}

export function StudentManager({ classRow, students, pointLogs, selectedWeek, isWeekLoading, onLockWeek, onDataChanged }: StudentManagerProps) {
  const supabase = createClient();
  const [multiplier, setMultiplier] = useState(classRow.custom_speaking_point.toString());
  const [isSavingMultiplier, setIsSavingMultiplier] = useState(false);
  const [adjustment, setAdjustment] = useState<Record<string, AdjustmentDraft>>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [rules, setRules] = useState<ScoreRule[]>(DEFAULT_SCORE_RULES);
  const [loadedRulesKey, setLoadedRulesKey] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [confirmLockWeek, setConfirmLockWeek] = useState(false);
  const [showingHistoryFor, setShowingHistoryFor] = useState<StudentWithScore | null>(null);
  const [teamFilter, setTeamFilter] = useState<number | "all">("all");
  const [extraTeams, setExtraTeams] = useState<number[]>([]);
  const [savingTeamStudentId, setSavingTeamStudentId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleReason, setRuleReason] = useState("");
  const [ruleAmount, setRuleAmount] = useState("1");
  const [ruleKind, setRuleKind] = useState<"add" | "subtract">("add");

  const storageKey = `class-score-rules:${classRow.id}`;
  const positiveRules = useMemo(() => rules.filter((rule) => rule.points > 0), [rules]);
  const negativeRules = useMemo(() => rules.filter((rule) => rule.points < 0), [rules]);
  const teamNumbers = useMemo(
    () => Array.from(new Set([1, 2, 3, ...extraTeams, ...students.map((student) => normalizeTeamNumber(student.team_number))])).sort((a, b) => a - b),
    [extraTeams, students],
  );
  const teamCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const student of students) {
      const teamNumber = normalizeTeamNumber(student.team_number);
      counts.set(teamNumber, (counts.get(teamNumber) ?? 0) + 1);
    }
    return counts;
  }, [students]);
  const visibleStudents = useMemo(
    () => teamFilter === "all"
      ? students
      : students.filter((student) => normalizeTeamNumber(student.team_number) === teamFilter),
    [students, teamFilter],
  );
  const weekLogs = useMemo(() => {
    const start = new Date(selectedWeek.startAt).getTime();
    const end = new Date(selectedWeek.endAt).getTime();
    return pointLogs.filter((log) => {
      const time = new Date(log.created_at).getTime();
      return time >= start && time < end;
    });
  }, [pointLogs, selectedWeek]);

  useEffect(() => {
    setLoadedRulesKey(null);
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every(isScoreRule)) setRules(parsed);
        else setRules(DEFAULT_SCORE_RULES);
      } else {
        setRules(DEFAULT_SCORE_RULES);
      }
    } catch {
      setRules(DEFAULT_SCORE_RULES);
    }
    setLoadedRulesKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (loadedRulesKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(rules));
    } catch {
      setErrorMessage("Không thể lưu bộ quy định trên trình duyệt này.");
    }
  }, [rules, loadedRulesKey, storageKey]);

  useEffect(() => {
    setMultiplier(classRow.custom_speaking_point.toString());
  }, [classRow.id, classRow.custom_speaking_point]);

  useEffect(() => {
    setTeamFilter("all");
    setExtraTeams([]);
  }, [classRow.id]);

  async function saveMultiplier() {
    const parsed = Number(multiplier);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setErrorMessage("Điểm mỗi lần phát biểu phải là số từ 0 trở lên.");
      return;
    }
    setIsSavingMultiplier(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.from("classes").update({ custom_speaking_point: parsed }).eq("id", classRow.id);
      if (error) throw error;
      setNotice("Đã lưu điểm cho mỗi lần phát biểu.");
      onDataChanged(true);
    } catch {
      setErrorMessage("Không lưu được điểm phát biểu. Vui lòng thử lại.");
    } finally {
      setIsSavingMultiplier(false);
    }
  }

  async function updateStudentTeam(student: StudentWithScore, teamNumber: number) {
    if (!Number.isInteger(teamNumber) || teamNumber < 1 || savingTeamStudentId) return;
    setSavingTeamStudentId(student.id);
    setErrorMessage("");
    setNotice("");

    try {
      const { error } = await supabase
        .from("students")
        .update({ team_number: teamNumber })
        .eq("id", student.id)
        .eq("class_id", classRow.id);
      if (error) {
        setErrorMessage(error.code === "42703" || /team_number/i.test(error.message)
          ? "Chưa có cột Tổ trong cơ sở dữ liệu. Hãy chạy supabase/student-teams.sql trước."
          : "Không cập nhật được tổ của học sinh. Vui lòng thử lại.");
        return;
      }
      setNotice(`Đã chuyển ${student.full_name} sang Tổ ${teamNumber}.`);
      onDataChanged(true);
    } catch {
      setErrorMessage("Không cập nhật được tổ của học sinh. Hãy kiểm tra kết nối rồi thử lại.");
    } finally {
      setSavingTeamStudentId(null);
    }
  }

  function addTeam() {
    const newTeamNumber = Math.max(0, ...teamNumbers) + 1;
    setExtraTeams((current) => [...new Set([...current, newTeamNumber])]);
    setTeamFilter("all");
    setNotice(`Đã thêm Tổ ${newTeamNumber}. Chọn tổ trên thẻ học sinh để phân nhóm.`);
    setErrorMessage("");
  }

  function getDraft(studentId: string): AdjustmentDraft {
    return adjustment[studentId] ?? { ruleId: "", points: "", reason: "" };
  }

  function setDraft(studentId: string, patch: Partial<AdjustmentDraft>) {
    setAdjustment((previous) => ({
      ...previous,
      [studentId]: { ...getDraft(studentId), ...patch },
    }));
  }

  function selectRule(studentId: string, ruleId: string) {
    const rule = rules.find((item) => item.id === ruleId);
    setDraft(studentId, {
      ruleId,
      points: rule ? String(Math.abs(rule.points)) : "",
      reason: rule?.reason ?? "",
    });
  }

  async function submitAdjustment(student: StudentWithScore) {
    const draft = getDraft(student.id);
    const amount = Number(draft.points);
    const selectedRule = rules.find((rule) => rule.id === draft.ruleId);
    if (!selectedRule || !Number.isFinite(amount) || amount <= 0) {
      setErrorMessage("Hãy chọn quy định và kiểm tra số điểm trước khi ghi.");
      return;
    }

    const pointsDelta = Math.sign(selectedRule.points) * amount;
    setSavingStudentId(student.id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await supabase.from("point_logs").insert({
        student_id: student.id,
        points_delta: pointsDelta,
        reason: draft.reason.trim() || selectedRule.reason || selectedRule.label,
      });
      if (error) throw error;
      setDraft(student.id, { ruleId: "", points: "", reason: "" });
      setNotice(`${selectedRule.label}: ${formatSigned(pointsDelta)} đã ghi cho ${student.full_name}.`);
      onDataChanged(true);
    } catch {
      setErrorMessage("Không ghi được điểm. Hãy kiểm tra kết nối rồi thử lại.");
    } finally {
      setSavingStudentId(null);
    }
  }

  function resetRuleForm() {
    setEditingRuleId(null);
    setRuleName("");
    setRuleReason("");
    setRuleAmount("1");
    setRuleKind("add");
  }

  function startEditingRule(rule: ScoreRule) {
    setEditingRuleId(rule.id);
    setRuleName(rule.label);
    setRuleReason(rule.reason);
    setRuleAmount(String(Math.abs(rule.points)));
    setRuleKind(rule.points > 0 ? "add" : "subtract");
  }

  function saveRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(ruleAmount);
    if (!ruleName.trim() || !Number.isFinite(amount) || amount <= 0) return;
    const points = (ruleKind === "add" ? 1 : -1) * amount;
    const nextRule: ScoreRule = {
      id: editingRuleId ?? `rule-${Date.now()}`,
      label: ruleName.trim(),
      points,
      reason: ruleReason.trim() || ruleName.trim(),
    };
    setRules((current) => editingRuleId
      ? current.map((rule) => rule.id === editingRuleId ? nextRule : rule)
      : [...current, nextRule]);
    resetRuleForm();
    setNotice(editingRuleId ? "Đã cập nhật quy định." : "Đã thêm quy định.");
  }

  function deleteRule(rule: ScoreRule) {
    setRules((current) => current.filter((item) => item.id !== rule.id));
    if (editingRuleId === rule.id) resetRuleForm();
    setAdjustment((current) => Object.fromEntries(
      Object.entries(current).map(([studentId, draft]) => [
        studentId,
        draft.ruleId === rule.id ? { ruleId: "", points: "", reason: "" } : draft,
      ]),
    ));
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-black/45 p-4 shadow-2xl md:backdrop-blur-xl sm:p-6">
      <div className="mb-5 flex flex-col gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-[#E7B93F]/70">Thi đua lớp · Tuần {selectedWeek.number}</p>
          <h3 className="mt-1 font-sans text-lg font-semibold text-white sm:text-xl">Sổ chấm điểm &amp; quản lý thi đua</h3>
          <p className="mt-1 font-sans text-xs text-white/45">Mỗi học sinh bắt đầu tuần với 50 điểm. Điểm đã ghi sẽ lưu vào sổ điểm của lớp.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setShowRules(true); setErrorMessage(""); }} className="min-h-10 border-[#E7B93F]/35 text-[#E7B93F] hover:bg-[#E7B93F]/10">
            Quản lý bộ quy định
          </Button>
          <div className="flex items-end gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-2">
            <label className="flex flex-col gap-1 font-sans text-[10px] uppercase tracking-wider text-white/45">
              Điểm / lần phát biểu
              <Input type="number" min="0" step="0.1" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} className="h-9 w-24" />
            </label>
            <Button size="sm" variant="outline" disabled={isSavingMultiplier} onClick={saveMultiplier} className="min-h-9">
              {isSavingMultiplier ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-4">
        {selectedWeek.locked ? (
          <p className="mt-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 font-sans text-xs text-white/45">Tuần {selectedWeek.number} đã được giáo viên chốt sổ. Bạn đang ở chế độ chỉ xem.</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="font-sans text-[11px] text-white/35">Tuần chưa chốt · {formatWeekRange(selectedWeek)}</p>
            <Button size="sm" variant="outline" disabled={new Date(selectedWeek.startAt).getTime() > Date.now()} onClick={() => setConfirmLockWeek(true)} className="min-h-10 border-white/10 text-white/65 hover:border-[#E7B93F]/30 hover:text-[#E7B93F]">
              Chốt sổ tuần {selectedWeek.number}
            </Button>
          </div>
        )}
      </div>

      {errorMessage && <p role="alert" className="mb-3 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 font-sans text-xs text-red-300">{errorMessage}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-2 font-sans text-xs text-emerald-200">{notice}</p>}

      {students.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor={`team-filter-${classRow.id}`} className="font-sans text-xs font-medium text-white/65">Lọc học sinh theo tổ</label>
          <div className="flex items-center gap-3">
            <select
              id={`team-filter-${classRow.id}`}
              value={teamFilter}
              onChange={(event) => setTeamFilter(event.target.value === "all" ? "all" : Number(event.target.value))}
              className="min-h-11 min-w-40 flex-1 rounded-lg border border-[#E7B93F]/20 bg-[#111714] px-3 font-sans text-sm text-white outline-none focus:border-[#E7B93F]/55 sm:flex-none"
            >
              <option value="all">Tất cả tổ ({students.length})</option>
              {teamNumbers.map((teamNumber) => (
                <option key={teamNumber} value={teamNumber}>Tổ {teamNumber} ({teamCounts.get(teamNumber) ?? 0})</option>
              ))}
            </select>
            <span className="shrink-0 font-sans text-[11px] text-white/40">{visibleStudents.length} học sinh</span>
          </div>
          <button type="button" onClick={addTeam} className="min-h-10 self-start rounded-lg px-3 font-sans text-xs font-medium text-[#E7B93F] transition hover:bg-[#E7B93F]/[0.08] sm:self-auto">+ Thêm tổ</button>
        </div>
      )}

      {isWeekLoading ? (
        <div aria-label={`Đang tải điểm Tuần ${selectedWeek.number}`} aria-busy="true" className="space-y-2">
          {Array.from({ length: Math.min(students.length || 4, 6) }, (_, index) => <div key={index} className="h-[118px] animate-pulse rounded-xl border border-white/[0.07] bg-white/[0.035]" />)}
        </div>
      ) : students.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
          <p className="font-sans text-sm text-white/50">Chưa có học sinh trong lớp.</p>
          <p className="mt-1 font-sans text-xs text-white/30">Thêm học sinh bằng công cụ quét danh sách ở phía trên.</p>
        </div>
      ) : visibleStudents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
          <p className="font-sans text-sm text-white/55">Tổ {teamFilter} chưa có học sinh.</p>
          <button type="button" onClick={() => setTeamFilter("all")} className="mt-2 min-h-10 px-3 font-sans text-xs text-[#E7B93F] hover:text-[#F3D783]">Xem tất cả tổ</button>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleStudents.map((student, index) => {
            const draft = getDraft(student.id);
            const selectedRule = rules.find((rule) => rule.id === draft.ruleId);
            const amount = Number(draft.points);
            const canSubmit = !!selectedRule && Number.isFinite(amount) && amount > 0;
            const studentLogs = weekLogs
              .filter((log) => log.student_id === student.id)
              .sort((first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime());
            return (
              <motion.article
                key={student.id}
                layout
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.012, 0.2), duration: 0.2 }}
                className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 transition-colors hover:border-white/[0.13] sm:p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate font-sans text-sm font-medium text-white">{student.full_name}</p>
                      <button type="button" onClick={() => setShowingHistoryFor(student)} className="mt-1 inline-flex min-h-8 items-center gap-1.5 font-sans text-[11px] text-white/40 transition hover:text-[#E7B93F]">
                        <HistoryIcon /> Lịch sử Tuần {selectedWeek.number} ({studentLogs.length})
                      </button>
                    </div>
                    <label className="flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/25 px-2.5">
                      <span className="font-sans text-[10px] uppercase tracking-wider text-white/40">Tổ</span>
                      <select
                        aria-label={`Tổ của ${student.full_name}`}
                        value={normalizeTeamNumber(student.team_number)}
                        disabled={savingTeamStudentId !== null}
                        onChange={(event) => void updateStudentTeam(student, Number(event.target.value))}
                        className="min-h-9 min-w-14 bg-transparent font-sans text-xs font-semibold text-[#F3D783] outline-none disabled:opacity-50"
                      >
                        {teamNumbers.map((teamNumber) => <option key={teamNumber} value={teamNumber} className="bg-[#111714] text-white">{teamNumber}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-2">
                    <AnimatedScore score={student.totalPoints} />
                    <span className={`rounded-full border px-2 py-1 font-sans text-[10px] ${tierClass(student.totalPoints, student.conductTier)}`}>{student.totalPoints < 30 ? "Cảnh báo" : student.conductTier}</span>
                  </div>
                </div>

                <div className="student-adjustment-grid mt-3 grid gap-2 sm:grid-cols-[minmax(220px,1.2fr)_minmax(120px,0.55fr)_minmax(180px,1fr)_auto]">
                  <select
                    aria-label={`Chọn quy định cho ${student.full_name}`}
                    value={draft.ruleId}
                    onChange={(event) => selectRule(student.id, event.target.value)}
                    disabled={selectedWeek.locked}
                    className="min-h-11 w-full rounded-lg border border-white/10 bg-[#111714] px-3 text-sm text-white outline-none transition focus:border-[#E7B93F]/50 focus:ring-2 focus:ring-[#E7B93F]/10"
                  >
                    <option value="">Chọn quy định cộng / trừ điểm</option>
                    <optgroup label="Cộng điểm">{positiveRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.label} (+{formatScore(rule.points)}đ)</option>)}</optgroup>
                    <optgroup label="Trừ điểm">{negativeRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.label} (−{formatScore(Math.abs(rule.points))}đ)</option>)}</optgroup>
                  </select>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    aria-label="Số điểm áp dụng"
                    placeholder="Số điểm"
                    value={draft.points}
                    onChange={(event) => setDraft(student.id, { points: event.target.value })}
                    disabled={selectedWeek.locked}
                    className="min-h-11 w-full"
                  />
                  <Input
                    aria-label={`Lý do cho ${student.full_name}`}
                    placeholder="Lý do (không bắt buộc)"
                    value={draft.reason}
                    onChange={(event) => setDraft(student.id, { reason: event.target.value })}
                    disabled={selectedWeek.locked}
                    className="min-h-11 w-full"
                  />
                  <Button
                    size="sm"
                    disabled={selectedWeek.locked || !canSubmit || savingStudentId === student.id}
                    onClick={() => submitAdjustment(student)}
                    className={`min-h-11 w-full px-4 font-semibold sm:w-auto ${selectedRule && selectedRule.points < 0 ? "bg-red-500/90 text-white hover:bg-red-500" : "bg-[#E7B93F] text-[#14120B] hover:bg-[#F1C84C]"}`}
                  >
                    {savingStudentId === student.id ? "Đang ghi…" : selectedRule ? `Ghi ${selectedRule.points > 0 ? "+" : "−"}${formatScore(amount || Math.abs(selectedRule.points))}đ` : "Ghi điểm"}
                  </Button>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      {showRules && (
        <Dialog title="Quản lý bộ quy định" onClose={() => { setShowRules(false); resetRuleForm(); }}>
          <p className="mb-4 font-sans text-xs leading-5 text-white/45">Bộ quy định được lưu trên trình duyệt này cho từng lớp. Giáo viên có thể thêm, sửa hoặc xóa; điểm mới áp dụng vào lần ghi tiếp theo.</p>
          <form onSubmit={saveRule} className="grid gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 sm:grid-cols-2">
            <Input required aria-label="Tên quy định" placeholder="Tên quy định" value={ruleName} onChange={(event) => setRuleName(event.target.value)} className="min-h-11" />
            <Input required aria-label="Mức điểm" type="number" min="0.1" step="0.1" placeholder="Mức điểm" value={ruleAmount} onChange={(event) => setRuleAmount(event.target.value)} className="min-h-11" />
            <Input aria-label="Lý do mặc định" placeholder="Lý do mặc định" value={ruleReason} onChange={(event) => setRuleReason(event.target.value)} className="min-h-11 sm:col-span-2" />
            <div className="flex gap-2 sm:col-span-2">
              <button type="button" onClick={() => setRuleKind("add")} className={`min-h-10 flex-1 rounded-lg border text-sm transition ${ruleKind === "add" ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200" : "border-white/10 text-white/50"}`}>+ Cộng điểm</button>
              <button type="button" onClick={() => setRuleKind("subtract")} className={`min-h-10 flex-1 rounded-lg border text-sm transition ${ruleKind === "subtract" ? "border-red-300/40 bg-red-300/10 text-red-200" : "border-white/10 text-white/50"}`}>− Trừ điểm</button>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" className="min-h-10 bg-[#E7B93F] font-semibold text-[#14120B] hover:bg-[#F1C84C]">{editingRuleId ? "Lưu thay đổi" : "Thêm quy định"}</Button>
              {editingRuleId && <Button type="button" variant="outline" className="min-h-10" onClick={resetRuleForm}>Hủy sửa</Button>}
            </div>
          </form>

          <div className="mt-4 max-h-[42vh] space-y-4 overflow-y-auto pr-1">
            <RuleGroup title="Quy định cộng điểm" rules={positiveRules} onEdit={startEditingRule} onDelete={deleteRule} />
            <RuleGroup title="Quy định trừ điểm" rules={negativeRules} onEdit={startEditingRule} onDelete={deleteRule} />
          </div>
          <p className="mt-4 border-t border-white/[0.08] pt-3 font-sans text-[11px] leading-5 text-white/35">Điểm học sinh và lịch sử được ghi vào sổ điểm Supabase; danh sách quy định được lưu cục bộ trên trình duyệt này.</p>
        </Dialog>
      )}

      {showingHistoryFor && (
        <Dialog title={`Lịch sử tuần · ${showingHistoryFor.full_name}`} onClose={() => setShowingHistoryFor(null)}>
          {(() => {
            const logs = weekLogs.filter((log) => log.student_id === showingHistoryFor.id).sort((first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime());
            return logs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-5 text-center font-sans text-sm text-white/45">Chưa có lần cộng hoặc trừ điểm nào trong tuần này.</p>
            ) : (
              <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                    <div className="min-w-0">
                      <p className="break-words font-sans text-sm text-white/85">{cleanReason(log.reason)}</p>
                      <time className="mt-1 block font-sans text-[11px] text-white/35">{new Date(log.created_at).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}</time>
                    </div>
                    <span className={`shrink-0 font-mono text-sm font-semibold ${log.points_delta < 0 ? "text-red-300" : "text-emerald-200"}`}>{formatSigned(log.points_delta)}đ</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="mt-5 flex justify-end"><Button variant="outline" onClick={() => setShowingHistoryFor(null)}>Đóng</Button></div>
        </Dialog>
      )}

      {confirmLockWeek && (
        <Dialog title={`Chốt sổ Tuần ${selectedWeek.number}?`} onClose={() => setConfirmLockWeek(false)}>
          <p className="font-sans text-sm leading-6 text-white/60">Tuần {selectedWeek.number} ({formatWeekRange(selectedWeek)}) sẽ chuyển sang chỉ xem. Sau khi chốt, giáo viên không thể ghi thêm hoặc sửa điểm của tuần này.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmLockWeek(false)}>Hủy</Button>
            <Button onClick={() => { onLockWeek(selectedWeek); setConfirmLockWeek(false); setNotice(`Giáo viên đã chốt sổ Tuần ${selectedWeek.number}.`); }} className="bg-[#E7B93F] text-[#14120B] hover:bg-[#F1C84C]">Xác nhận chốt sổ</Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function RuleGroup({ title, rules, onEdit, onDelete }: { title: string; rules: ScoreRule[]; onEdit: (rule: ScoreRule) => void; onDelete: (rule: ScoreRule) => void }) {
  return (
    <section>
      <h4 className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">{title}</h4>
      {rules.length === 0 ? <p className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-white/35">Chưa có quy định.</p> : (
        <div className="space-y-1.5">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-sans text-xs text-white/75">{rule.label}</span>
              <span className={`shrink-0 font-mono text-xs ${rule.points > 0 ? "text-emerald-200" : "text-red-300"}`}>{formatSigned(rule.points)}đ</span>
              <button type="button" onClick={() => onEdit(rule)} className="min-h-9 rounded-md px-2 text-xs text-[#E7B93F] hover:bg-[#E7B93F]/10">Sửa</button>
              <button type="button" onClick={() => onDelete(rule)} className="min-h-9 rounded-md px-2 text-xs text-red-300/75 hover:bg-red-300/10">Xóa</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 md:backdrop-blur-sm sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} className="simple-dialog max-h-[92dvh] w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <h3 className="font-sans text-lg font-semibold text-white">{title}</h3>
          <button type="button" aria-label="Đóng" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/50 transition hover:bg-white/[0.06] hover:text-white"><span aria-hidden="true">×</span></button>
        </div>
        <div className="max-h-[calc(92dvh-88px)] overflow-y-auto overscroll-contain">{children}</div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function AnimatedScore({ score }: { score: number }) {
  const value = useMotionValue(score);
  const spring = useSpring(value, { stiffness: 100, damping: 20, mass: 0.7 });
  const display = useTransform(spring, (current) => formatScore(current));
  useEffect(() => { value.set(score); }, [score, value]);
  return <motion.span className={`font-mono text-lg font-bold tabular-nums ${score < 30 ? "text-red-300" : score < 50 ? "text-amber-200" : "text-[#E7B93F]"}`}>{display}</motion.span>;
}

function HistoryIcon() {
  return <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8m0-5v5h5m4-1v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function tierClass(score: number, tier: string) {
  if (score < 30) return "border-red-400/25 bg-red-400/[0.08] text-red-200";
  if (score < 50) return "border-amber-300/20 bg-amber-300/[0.06] text-amber-100/80";
  if (tier === "Tốt") return "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100/90";
  return "border-[#E7B93F]/20 bg-[#E7B93F]/[0.06] text-[#F3D783]";
}

function formatScore(score: number) {
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatSigned(points: number) {
  return `${points > 0 ? "+" : "−"}${formatScore(Math.abs(points))}`;
}

function cleanReason(reason: string) {
  return reason.replace(WEEKLY_UNQUALIFIED_MARKER, "").trim() || "Điều chỉnh điểm";
}

function isScoreRule(value: unknown): value is ScoreRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<ScoreRule>;
  return typeof rule.id === "string" && typeof rule.label === "string" && Number.isFinite(rule.points) && typeof rule.reason === "string";
}

function normalizeTeamNumber(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}
