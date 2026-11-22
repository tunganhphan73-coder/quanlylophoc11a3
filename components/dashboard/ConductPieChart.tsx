"use client";

// =====================================================================
// Pie chart showing the % breakdown of conduct grades (Tốt / Khá / Đạt /
// Chưa đạt) for a class. Read-only — used identically on the teacher
// dashboard and the parent/student view-only dashboard.
// =====================================================================
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ConductBreakdown, ConductTier } from "@/lib/types";

const TIER_COLORS: Record<ConductTier, string> = {
  "Tốt": "#3E9C82",
  "Khá": "#E3B23C",
  "Đạt": "#6B8CBE",
  "Chưa đạt": "#B5495B",
};

interface ConductPieChartProps {
  breakdown: ConductBreakdown[];
  totalStudents: number;
}

export function ConductPieChart({ breakdown, totalStudents }: ConductPieChartProps) {
  const chartData = breakdown
    .filter((b) => b.count > 0)
    .map((b) => ({ name: b.tier, value: b.count, percentage: b.percentage }));

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-5 md:backdrop-blur-md">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="font-serif text-lg text-white">Xếp loại tuần này</h3>
        <span className="font-sans text-xs text-white/50">{totalStudents} học sinh</span>
      </div>

      {chartData.length === 0 ? (
        <p className="py-10 text-center font-sans text-sm text-white/40">Chưa có dữ liệu điểm để thống kê.</p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                label={({ name, percentage }) => `${name} ${percentage}%`}
                labelLine={false}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={TIER_COLORS[entry.name as ConductTier]} stroke="#0D1512" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#0D1512", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8 }}
                labelStyle={{ color: "#F4F1E8" }}
                formatter={(value: number, name: string) => [`${value} học sinh`, name]}
              />
              <Legend
                verticalAlign="bottom"
                height={32}
                formatter={(value) => <span style={{ color: "#F4F1E8CC", fontSize: 12 }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
