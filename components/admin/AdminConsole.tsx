"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, ShieldAlert, Users } from "lucide-react";

type TeacherRow = { id: string; name: string; email: string; createdAt: string | null };
type ErrorRow = { id: number; userId: string | null; actorRole: string | null; digest: string; message: string; route: string; createdAt: string };

const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50";

export function AdminConsole() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [teacherQuery, setTeacherQuery] = useState("");
  const [teacherPage, setTeacherPage] = useState(1);
  const [teacherTotal, setTeacherTotal] = useState(0);
  const [teacherHasMore, setTeacherHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [teacherResponse, errorResponse] = await Promise.all([
        fetch(`/api/admin/teachers?page=${teacherPage}`, { cache: "no-store" }),
        fetch("/api/admin/errors", { cache: "no-store" }),
      ]);
      const [teacherData, errorData] = await Promise.all([teacherResponse.json(), errorResponse.json()]);
      if (!teacherResponse.ok) throw new Error(`${teacherData.error ?? "Không tải được danh sách giáo viên."}${teacherData.diagnostic ? ` (${teacherData.diagnostic})` : ""}`);
      setTeachers(teacherData.teachers ?? []);
      setTeacherTotal(teacherData.total ?? 0);
      setTeacherHasMore(Boolean(teacherData.hasMore));
      if (errorResponse.ok) setErrors(errorData.errors ?? []);
      else if (errorResponse.status === 503) setError("Danh sách lỗi chưa sẵn sàng. Admin cần chạy migration supabase/migrations/202611220010_admin_console.sql.");
      else throw new Error(errorData.error ?? "Không tải được báo cáo lỗi.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu quản trị.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teacherPage]);

  useEffect(() => { void load(); }, [load]);

  const filteredTeachers = useMemo(() => {
    const query = teacherQuery.trim().toLocaleLowerCase("vi");
    if (!query) return teachers;
    return teachers.filter((teacher) => `${teacher.name} ${teacher.email}`.toLocaleLowerCase("vi").includes(query));
  }, [teacherQuery, teachers]);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} className={button}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" /> Cập nhật
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}

      <section className={card} aria-labelledby="teachers-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-800"><Users className="h-5 w-5" aria-hidden="true" /></span>
            <div><h2 id="teachers-title" className="font-bold">Tài khoản giáo viên</h2><p className="text-sm text-slate-600">{loading ? "Đang tải…" : `${teacherTotal} tài khoản`}</p></div>
          </div>
          <label className="relative w-full sm:max-w-xs">
            <span className="sr-only">Tìm giáo viên</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true" />
            <input value={teacherQuery} onChange={(event) => setTeacherQuery(event.target.value)} placeholder="Tìm tên hoặc email" className="min-h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-950 placeholder:text-slate-500 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/30" />
          </label>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600"><th className="px-3 py-3 font-semibold">Giáo viên</th><th className="px-3 py-3 font-semibold">Email đăng nhập</th><th className="px-3 py-3 font-semibold">Ngày tạo</th></tr></thead>
            <tbody>
              {!loading && filteredTeachers.map((teacher) => <tr key={teacher.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-semibold">{teacher.name || "Chưa cập nhật tên"}</td><td className="px-3 py-3">{teacher.email || "Không có email"}</td><td className="px-3 py-3">{teacher.createdAt ? new Date(teacher.createdAt).toLocaleDateString("vi-VN") : "—"}</td></tr>)}
              {!loading && filteredTeachers.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-600">Không tìm thấy tài khoản phù hợp.</td></tr>}
              {loading && <tr><td colSpan={3} className="px-3 py-8 text-center text-slate-600">Đang tải danh sách giáo viên…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
          <span>Trang {teacherPage}</span>
          <div className="flex gap-2">
            <button type="button" className={button} disabled={teacherPage <= 1 || loading} onClick={() => setTeacherPage((page) => Math.max(1, page - 1))}>Trước</button>
            <button type="button" className={button} disabled={!teacherHasMore || loading} onClick={() => setTeacherPage((page) => page + 1)}>Tiếp</button>
          </div>
        </div>
      </section>

      <section className={card} aria-labelledby="errors-title">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-800"><ShieldAlert className="h-5 w-5" aria-hidden="true" /></span>
          <div><h2 id="errors-title" className="font-bold">Lỗi ứng dụng</h2><p className="text-sm text-slate-600">{errors.length} lỗi mới nhất được ghi nhận</p></div>
        </div>
        <div className="mt-4 space-y-3">
          {!loading && errors.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold text-slate-900">{item.message || "Ứng dụng gặp lỗi"}</p><time className="shrink-0 text-xs text-slate-600">{new Date(item.createdAt).toLocaleString("vi-VN")}</time></div>
            <p className="mt-2 break-all text-xs text-slate-700">Đường dẫn: {item.route || "—"} · Vai trò: {item.actorRole || "khách"} · Mã: {item.digest || "—"}</p>
          </article>)}
          {!loading && errors.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">Chưa ghi nhận lỗi nào.</p>}
          {loading && <p className="py-6 text-center text-sm text-slate-600">Đang tải báo cáo lỗi…</p>}
        </div>
      </section>
    </div>
  );
}
