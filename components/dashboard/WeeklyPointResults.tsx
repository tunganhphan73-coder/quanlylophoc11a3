import { getConductTier, WEEKLY_BASE_SCORE } from "@/lib/score-calculator";

export interface HomePointLog {
  id: string;
  student_id: string;
  points_delta: number;
  reason: string;
  created_at: string;
}

interface WeekSummary {
  key: string;
  start: Date;
  end: Date;
  score: number;
  plus: number;
  minus: number;
  logs: HomePointLog[];
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function weekKey(value: string) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
}

function formatScore(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(value);
}

function makeWeekSummaries(logs: HomePointLog[], startDate: string, endDate: string): WeekSummary[] {
  const start = new Date(`${startDate}T00:00:00`);
  const endExclusive = new Date(`${endDate}T00:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  const summaries: WeekSummary[] = [];

  while (cursor < endExclusive) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const key = dateKey(weekStart);
    const weekLogs = logs.filter((log) => weekKey(log.created_at) === key);
    const adjustment = weekLogs.reduce((sum, log) => sum + Number(log.points_delta), 0);
    summaries.push({
      key,
      start: weekStart,
      end: weekEnd,
      score: Math.round((WEEKLY_BASE_SCORE + adjustment) * 100) / 100,
      plus: weekLogs.reduce((sum, log) => sum + Math.max(0, Number(log.points_delta)), 0),
      minus: weekLogs.reduce((sum, log) => sum + Math.abs(Math.min(0, Number(log.points_delta))), 0),
      logs: weekLogs,
    });
    cursor.setDate(cursor.getDate() + 7);
  }

  return summaries;
}

export function WeeklyPointResults({ logs, startDate, endDate, studentName, onNavigateHome }: {
  logs: HomePointLog[];
  startDate: string;
  endDate: string;
  studentName: string;
  onNavigateHome?: () => void;
}) {
  const weeks = makeWeekSummaries(logs, startDate, endDate);
  const semesterAverage = weeks.length
    ? weeks.reduce((sum, week) => sum + week.score, 0) / weeks.length
    : WEEKLY_BASE_SCORE;
  const semesterConduct = getConductTier(semesterAverage);
  const totalPlus = weeks.reduce((sum, week) => sum + week.plus, 0);
  const totalMinus = weeks.reduce((sum, week) => sum + week.minus, 0);
  const totalEvents = logs.length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="weekly-points-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-800">Dữ liệu từ Trang chủ · {studentName}</p>
          <h3 id="weekly-points-heading" className="mt-1 text-lg font-bold text-slate-950">Tổng kết hạnh kiểm theo tuần · Học kỳ</h3>
          <p className="mt-1 text-sm text-slate-700">Mỗi tuần hiển thị điểm nền 50 và các lần cộng/trừ đã nhập ở Trang chủ. Điểm trung bình các tuần tạo thành kết quả hạnh kiểm học kỳ.</p>
        </div>
        {onNavigateHome && <button type="button" onClick={onNavigateHome} className="inline-flex min-h-10 items-center rounded-xl border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-900 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">Mở Trang chủ để nhập</button>}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric label="Hạnh kiểm TB học kỳ" value={`${formatScore(semesterAverage)} đ · ${semesterConduct}`} />
        <SummaryMetric label="Số tuần học kỳ" value={String(weeks.length)} />
        <SummaryMetric label="Tổng điểm cộng" value={`+${formatScore(totalPlus)}`} />
        <SummaryMetric label="Tổng điểm trừ" value={`−${formatScore(totalMinus)}`} />
      </div>
      <p className="mt-2 text-xs text-slate-600">Tổng lượt ghi nhận: {totalEvents} · Điểm mỗi tuần bắt đầu từ {WEEKLY_BASE_SCORE} điểm.</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {weeks.map((week, index) => (
          <details key={week.key} className="group rounded-xl border border-slate-200 bg-slate-50 p-3">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
              <span>
                <span className="block font-semibold text-slate-950">Tuần {index + 1} · {formatDate(week.start)}–{formatDate(week.end)}</span>
                <span className="mt-1 block text-xs text-slate-700">+{formatScore(week.plus)} · −{formatScore(week.minus)} · {week.logs.length} lượt ghi</span>
              </span>
              <span className={`rounded-lg px-3 py-1.5 font-mono text-lg font-bold ${week.score < 30 ? "bg-red-100 text-red-900" : "bg-blue-100 text-blue-950"}`}>{formatScore(week.score)} đ</span>
            </summary>
            <div className="mt-3 border-t border-slate-200 pt-2">
              {week.logs.length === 0 ? <p className="text-sm text-slate-700">Chưa có ghi nhận trong tuần này; điểm nền là {WEEKLY_BASE_SCORE} điểm.</p> : (
                <ul className="space-y-2">
                  {week.logs.map((log) => <li key={log.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 text-slate-800">{log.reason || "Không có lý do"}<time className="mt-1 block text-xs text-slate-600">{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(log.created_at))}</time></span>
                    <strong className={Number(log.points_delta) < 0 ? "text-red-800" : "text-emerald-800"}>{Number(log.points_delta) > 0 ? "+" : ""}{formatScore(Number(log.points_delta))} đ</strong>
                  </li>)}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-900">Tổng kết hạnh kiểm học kỳ</p>
        <p className="mt-1 text-sm text-slate-800">Kết quả đề xuất: <strong>{semesterConduct} · {formatScore(semesterAverage)} điểm/tuần</strong>. Trong học kỳ: cộng {formatScore(totalPlus)} điểm, trừ {formatScore(totalMinus)} điểm, {totalEvents} lượt ghi nhận qua {weeks.length} tuần.</p>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><span className="block text-xs font-semibold text-slate-700">{label}</span><strong className="mt-1 block font-mono text-lg text-blue-950">{value}</strong></div>;
}
