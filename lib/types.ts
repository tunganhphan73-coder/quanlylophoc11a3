// =====================================================================
// SHARED TYPES — mirrors supabase/schema.sql exactly.
// Import these anywhere you touch the database so the whole app agrees
// on shape (components, API routes, score calculator, etc).
// =====================================================================

export type UserRole = "teacher" | "parent" | "student";

export interface Profile {
  id: string;
  role: UserRole;
  access_role?: "bcs" | "admin" | null;
  full_name: string;
  class_id: string | null;
  avatar_url?: string | null;
  created_at: string;
}

export interface ClassRow {
  id: string;
  teacher_id: string;
  name: string;
  custom_speaking_point: number;
  enable_conduct?: boolean;
  enable_attendance?: boolean;
  created_at: string;
}

export type Gender = "male" | "female" | "other" | null;

export interface Student {
  id: string;
  class_id: string;
  full_name: string;
  gender: Gender;
  team_number: number;
  student_number?: number;
  created_at: string;
}

export interface PointLog {
  id: string;
  student_id: string;
  points_delta: number;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  class_id: string;
  author_name: string;
  content: string;
  reactions: Record<string, number>;
  created_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------
// Derived / computed shapes used across the dashboard
// ---------------------------------------------------------------------

/** Conduct tiers used for the Pie Chart. Thresholds live in score-calculator.ts. */
export type ConductTier = "Tốt" | "Khá" | "Đạt" | "Chưa đạt";

export interface StudentWithScore extends Student {
  totalPoints: number;
  conductTier: ConductTier;
}

export interface ConductBreakdown {
  tier: ConductTier;
  count: number;
  percentage: number;
}

// ---------------------------------------------------------------------
// Gemini OCR response shapes (app/api/ocr/route.ts)
// ---------------------------------------------------------------------

/** Mode 1: scanning a printed class roster to bulk-add students. */
export interface OcrRosterResult {
  mode: "roster";
  students: Array<{
    full_name: string;
    gender: Gender;
  }>;
}

/** Mode 2: scanning a handwritten logbook page (sổ liên lạc / sổ ghi điểm). */
export interface OcrLogbookEntry {
  student_name: string;
  times_spoken: number;
  bonus_points: number;
  /** Raw total as read from the page, before re-computing with the class multiplier. */
  total_points_on_page: number | null;
  has_signature: boolean;
}

export interface OcrLogbookResult {
  mode: "logbook";
  entries: OcrLogbookEntry[];
}

export type OcrResult = OcrRosterResult | OcrLogbookResult;
