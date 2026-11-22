// =====================================================================
// SCORE CALCULATOR
// Single source of truth for turning raw logbook data + point_logs into
// the numbers the dashboard shows. Both app/api/ocr/route.ts (when saving
// a scanned logbook page) and the dashboard (when aggregating history)
// import from here, so the math can never drift between the two.
// =====================================================================
import type { ConductBreakdown, ConductTier, OcrLogbookEntry, PointLog, Student, StudentWithScore } from "./types";

/** Every student starts each school week at this score. */
export const WEEKLY_BASE_SCORE = 50;
export const WEEKLY_UNQUALIFIED_MARKER = "[Xếp loại chưa đạt trong tuần]";

// ---------------------------------------------------------------------
// 1. Dynamic grading: tally marks * per-class multiplier + bonus
// ---------------------------------------------------------------------

/**
 * Computes the final point value for one logbook row.
 *
 * total = (times_spoken * custom_speaking_point) + bonus_points
 *
 * `custom_speaking_point` lives on `classes` and is editable per class in
 * class settings, so the SAME tally count is worth different points in
 * different classes.
 */
export function calculateLogbookPoints(
  entry: Pick<OcrLogbookEntry, "times_spoken" | "bonus_points">,
  customSpeakingPoint: number
): number {
  const speakingScore = entry.times_spoken * customSpeakingPoint;
  const total = speakingScore + entry.bonus_points;
  // Round to 2 decimal places to avoid floating point noise (e.g. 0.1 + 0.2).
  return Math.round(total * 100) / 100;
}

/**
 * Turns a whole scanned logbook page into ready-to-insert point_logs rows,
 * given a name -> student_id lookup for that class (built by matching OCR
 * names against `students` before calling this).
 */
export function buildPointLogsFromLogbook(
  entries: OcrLogbookEntry[],
  customSpeakingPoint: number,
  nameToStudentId: Record<string, string>,
  createdBy: string | null
): Array<Pick<PointLog, "student_id" | "points_delta" | "reason" | "created_by">> {
  const rows: Array<Pick<PointLog, "student_id" | "points_delta" | "reason" | "created_by">> = [];

  for (const entry of entries) {
    const studentId = nameToStudentId[normalizeName(entry.student_name)];
    if (!studentId) continue; // Unmatched names are surfaced separately in the UI for manual linking.

    const total = calculateLogbookPoints(entry, customSpeakingPoint);
    const reasonParts = [
      `Phát biểu ${entry.times_spoken} lần (x${customSpeakingPoint}đ)`,
      entry.bonus_points ? `Thưởng ${entry.bonus_points >= 0 ? "+" : ""}${entry.bonus_points}đ` : null,
      entry.has_signature ? "Có chữ ký xác nhận" : "Thiếu chữ ký",
    ].filter(Boolean);

    rows.push({
      student_id: studentId,
      points_delta: total,
      reason: reasonParts.join(" · "),
      created_by: createdBy,
    });
  }

  return rows;
}

/** Loose match helper so "Nguyễn Văn A" and "nguyen van a " line up. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics for fuzzy matching
    .replace(/đ/g, "d")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

export interface StudentNameMatch {
  student: Student;
  /** Heuristic similarity score, from 0 to 1. */
  score: number;
}

/**
 * Find a confident match for an OCR-read name in the selected class roster.
 * Initials and small OCR typos are supported. Ambiguous names are left for
 * the teacher to correct instead of being attached to the wrong student.
 */
export function findBestStudentNameMatch(
  name: string,
  students: Student[]
): StudentNameMatch | null {
  const normalized = normalizeName(name);
  if (!normalized || students.length === 0) return null;

  const exact = students.filter((student) => normalizeName(student.full_name) === normalized);
  if (exact.length === 1) return { student: exact[0], score: 1 };
  if (exact.length > 1) return null;

  const queryTokens = normalized.split(" ").filter(Boolean);
  const scored = students
    .map((student) => {
      const candidateTokens = normalizeName(student.full_name).split(" ").filter(Boolean);
      const tokenScores: number[] = [];
      let lastMatchedIndex = -1;

      for (const queryToken of queryTokens) {
        let bestScore = 0;
        let bestIndex = -1;

        for (let index = lastMatchedIndex + 1; index < candidateTokens.length; index++) {
          const score = nameTokenSimilarity(queryToken, candidateTokens[index]);
          if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
          }
        }

        tokenScores.push(bestScore);
        if (bestIndex >= 0 && bestScore >= 0.45) lastMatchedIndex = bestIndex;
      }

      const averageTokenScore = tokenScores.reduce((sum, score) => sum + score, 0) / queryTokens.length;
      const rosterCoverage = Math.min(queryTokens.length / candidateTokens.length, 1);
      const score = averageTokenScore * 0.84 + rosterCoverage * 0.16;

      return { student, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUpScore = scored[1]?.score ?? 0;
  const minimumScore = queryTokens.length === 1 ? 0.94 : 0.76;
  const requiredMargin = 0.1;

  if (!best || best.score < minimumScore || best.score - runnerUpScore < requiredMargin) {
    return null;
  }

  return { student: best.student, score: Math.round(best.score * 100) / 100 };
}

function nameTokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 1 && b.startsWith(a)) return 0.9;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let row = 1; row <= a.length; row++) {
    let diagonal = previous[0];
    previous[0] = row;

    for (let column = 1; column <= b.length; column++) {
      const previousRowValue = previous[column];
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + substitutionCost
      );
      diagonal = previousRowValue;
    }
  }

  return previous[b.length];
}

// ---------------------------------------------------------------------
// 2. Conduct tiers (Tốt / Khá / Đạt / Chưa đạt)
// ---------------------------------------------------------------------

// Thresholds are intentionally simple totals over the current grading
// period; tune freely — this is the ONE place that defines "good conduct".
export const CONDUCT_THRESHOLDS: Record<Exclude<ConductTier, "Chưa đạt">, number> = {
  "Tốt": 55,
  "Khá": 50.5,
  "Đạt": 50,
};

export function getConductTier(totalPoints: number, forcedUnqualified = false): ConductTier {
  if (forcedUnqualified) return "Chưa đạt";
  if (totalPoints >= CONDUCT_THRESHOLDS["Tốt"]) return "Tốt";
  if (totalPoints >= CONDUCT_THRESHOLDS["Khá"]) return "Khá";
  if (totalPoints >= CONDUCT_THRESHOLDS["Đạt"]) return "Đạt";
  return "Chưa đạt";
}

// ---------------------------------------------------------------------
// 3. Aggregation helpers used by the dashboard
// ---------------------------------------------------------------------

export function attachScores(students: Student[], logs: PointLog[]): StudentWithScore[] {
  const { start, end } = getCurrentWeekBounds();
  return attachScoresBetween(students, logs, start, end);
}

/** Computes each student's score for an explicitly selected teaching week. */
export function attachScoresForWeek(students: Student[], logs: PointLog[], weekStart: string, weekEnd: string): StudentWithScore[] {
  return attachScoresBetween(students, logs, new Date(weekStart).getTime(), new Date(weekEnd).getTime());
}

function attachScoresBetween(students: Student[], logs: PointLog[], start: number, end: number): StudentWithScore[] {
  const totalsByStudent = new Map<string, number>();
  const unqualifiedStudents = new Set<string>();

  for (const log of logs) {
    const createdAt = new Date(log.created_at).getTime();
    if (createdAt < start || createdAt >= end) continue;
    totalsByStudent.set(log.student_id, (totalsByStudent.get(log.student_id) ?? 0) + log.points_delta);
    if (log.reason.includes(WEEKLY_UNQUALIFIED_MARKER)) unqualifiedStudents.add(log.student_id);
  }

  return students.map((s) => {
    const totalPoints = Math.round((WEEKLY_BASE_SCORE + (totalsByStudent.get(s.id) ?? 0)) * 100) / 100;
    return { ...s, totalPoints, conductTier: getConductTier(totalPoints, unqualifiedStudents.has(s.id)) };
  });
}

/** School week runs Monday 00:00 through the following Monday 00:00, local time. */
function getCurrentWeekBounds(referenceDate = new Date()): { start: number; end: number } {
  const monday = new Date(referenceDate);
  monday.setHours(0, 0, 0, 0);
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);

  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);

  return { start: monday.getTime(), end: nextMonday.getTime() };
}

export function getTopStudents(studentsWithScores: StudentWithScore[], limit = 5): StudentWithScore[] {
  return [...studentsWithScores].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, limit);
}

const TIER_ORDER: ConductTier[] = ["Tốt", "Khá", "Đạt", "Chưa đạt"];

export function getConductBreakdown(studentsWithScores: StudentWithScore[]): ConductBreakdown[] {
  const total = studentsWithScores.length || 1;
  const counts: Record<ConductTier, number> = { "Tốt": 0, "Khá": 0, "Đạt": 0, "Chưa đạt": 0 };

  for (const s of studentsWithScores) counts[s.conductTier] += 1;

  return TIER_ORDER.map((tier) => ({
    tier,
    count: counts[tier],
    percentage: Math.round((counts[tier] / total) * 1000) / 10, // one decimal place
  }));
}
