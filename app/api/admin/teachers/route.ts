import { NextRequest, NextResponse } from "next/server";
import { getEffectiveRole } from "@/lib/auth/roles";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const PER_PAGE = 50;
type TeacherProfile = { id: string };

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return respond({ error: "Bạn cần đăng nhập." }, 401);
  const { data: actor } = await supabase.from("profiles").select("role,access_role").eq("id", user.id).maybeSingle();
  if (getEffectiveRole(actor) !== "admin") return respond({ error: "Chỉ admin mới xem được danh sách này." }, 403);

  const requestedPage = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  let failureStage = "service-client";
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return respond({ error: "Cấu hình Supabase phía server còn thiếu.", diagnostic: "missing-env" }, 503);
    }
    const admin = createAdminClient();
    const start = (page - 1) * PER_PAGE;
    failureStage = "profiles-query";
    const { data: profiles, error: profileError, count } = await admin.from("profiles")
      .select("id", { count: "exact" })
      .eq("role", "teacher")
      .is("access_role", null)
      .order("id", { ascending: true })
      .range(start, start + PER_PAGE - 1);
    if (profileError) throw profileError;

    const teacherProfiles = (profiles ?? []) as TeacherProfile[];
    const ids = teacherProfiles.map((row) => row.id);
    const idSet = new Set(ids);
    const authUsers = new Map<string, { email?: string; created_at?: string; full_name?: string }>();
    if (ids.length) {
      for (let authPage = 1; authPage <= 100; authPage += 1) {
        failureStage = "auth-admin-list-users";
        const { data, error } = await admin.auth.admin.listUsers({ page: authPage, perPage: 1000 });
        if (error) throw error;
        for (const authUser of data.users) {
          if (idSet.has(authUser.id)) {
            const metadata = authUser.user_metadata as Record<string, unknown> | undefined;
            authUsers.set(authUser.id, {
              email: authUser.email,
              created_at: authUser.created_at,
              full_name: typeof metadata?.full_name === "string" ? metadata.full_name : undefined,
            });
          }
        }
        if (data.users.length < 1000 || ids.every((id) => authUsers.has(id))) break;
      }
    }

    const teachers = teacherProfiles.map((row) => ({
      id: row.id,
      name: authUsers.get(row.id)?.full_name ?? "",
      email: authUsers.get(row.id)?.email ?? "",
      createdAt: authUsers.get(row.id)?.created_at ?? null,
    })).sort((first, second) => (second.createdAt ?? "").localeCompare(first.createdAt ?? ""));
    return respond({ teachers, page, perPage: PER_PAGE, total: count ?? 0, hasMore: start + teachers.length < (count ?? 0) });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 32) : "unknown";
    console.error("[admin/teachers] query failed", { stage: failureStage, code });
    return respond({ error: "Không đọc được tài khoản giáo viên.", diagnostic: `${failureStage}:${code}` }, 503);
  }
}
