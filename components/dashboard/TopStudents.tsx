"use client";

// =====================================================================
// "Wall of Fame" — top-N students by total points this grading period.
// Read-only display; shown identically to teacher, parent, and student
// dashboards (the underlying query is the only thing RLS restricts).
// =====================================================================
import { motion } from "framer-motion";
import type { StudentWithScore } from "@/lib/types";

const MEDALS = ["🥇", "🥈", "🥉"];

interface TopStudentsProps {
  students: StudentWithScore[];
}

export function TopStudents({ students }: TopStudentsProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-5 md:backdrop-blur-md">
      <h3 className="mb-4 font-serif text-lg text-white">Bảng vinh danh tuần này</h3>

      {students.length === 0 ? (
        <p className="py-6 text-center font-sans text-sm text-white/40">Chưa có học sinh nào được ghi điểm.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {students.map((student, index) => (
            <motion.li
              key={student.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.06 }}
              className="flex items-center justify-between rounded-lg bg-white/[0.03] px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="w-6 text-center text-lg">{MEDALS[index] ?? `#${index + 1}`}</span>
                <span className="font-sans text-sm text-white/90">{student.full_name}</span>
              </div>
              <span className="font-serif text-base font-medium text-[#E3B23C]">{student.totalPoints} đ</span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
