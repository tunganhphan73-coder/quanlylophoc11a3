import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { getEffectiveRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles")
    .select("id,full_name,role,access_role")
    .eq("id", user.id)
    .maybeSingle();
  if (getEffectiveRole(profile) !== "admin") redirect("/dashboard");

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-950 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-800">Khu vực quản trị</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Tình trạng hệ thống</h1>
            <p className="mt-2 text-sm text-slate-700">Kiểm tra tài khoản giáo viên và lỗi giao diện/JavaScript được ghi nhận. Nội dung nhạy cảm cơ bản được lọc trước khi lưu.</p>
          </div>
          <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">Về trang chính</Link>
        </header>
        <AdminConsole />
        <p className="mt-8 text-right text-[10px] text-slate-500">PTA-hanhkiem</p>
      </div>
    </main>
  );
}
