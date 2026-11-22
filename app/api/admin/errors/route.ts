import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEffectiveRole } from "@/lib/auth/roles";
import { isSameOriginRequest } from "@/lib/security/request-origin";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const reportSchema = z.object({
  digest: z.string().trim().max(64).default(""),
  message: z.string().trim().max(500).default("Lỗi ứng dụng"),
  route: z.string().trim().max(300).default(""),
}).strict();

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: respond({ error: "Bạn cần đăng nhập." }, 401) } as const;
  const { data: actor } = await supabase.from("profiles").select("role,access_role").eq("id", user.id).maybeSingle();
  if (getEffectiveRole(actor) !== "admin") return { response: respond({ error: "Chỉ admin mới xem được báo cáo lỗi." }, 403) } as const;
  return { user, supabase } as const;
}

export async function GET() {
  const access = await requireAdmin();
  if ("response" in access) return access.response;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("app_error_reports")
      .select("id,user_id,actor_role,error_digest,message,route,created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (error) throw error;
    const errorRows = (data ?? []) as Array<{ id: number; user_id: string | null; actor_role: string | null; error_digest: string; message: string; route: string; created_at: string }>;
    const errors = errorRows.map((row) => ({ id: row.id, userId: row.user_id, actorRole: row.actor_role, digest: row.error_digest, message: row.message, route: row.route, createdAt: row.created_at }));
    return respond({ errors });
  } catch {
    return respond({ error: "Bảng báo cáo lỗi chưa sẵn sàng. Chạy migration 202611220010_admin_console.sql." }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return respond({ error: "Yêu cầu không hợp lệ." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return respond({ error: "Nội dung gửi lên phải là JSON." }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > 4_096) return respond({ error: "Dữ liệu gửi lên quá lớn." }, 413);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Do not store anonymous visitor events or accept arbitrary unauthenticated writes.
  if (!user) return new NextResponse(null, { status: 204 });

  let raw: unknown;
  try { raw = await request.json(); } catch { return respond({ error: "JSON không hợp lệ." }, 400); }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return respond({ error: "Dữ liệu lỗi không hợp lệ." }, 400);

  const { data: profile } = await supabase.from("profiles").select("role,access_role").eq("id", user.id).maybeSingle();
  const role = getEffectiveRole(profile);
  const message = parsed.data.message
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .slice(0, 500);
  const route = parsed.data.route.split(/[?#]/, 1)[0].slice(0, 300);

  try {
    const admin = createAdminClient();
    const { data: withinLimit, error: limitError } = await admin.rpc("consume_app_error_report_rate_limit", { p_user_id: user.id });
    if (limitError) throw limitError;
    if (!withinLimit) return new NextResponse(null, { status: 204 });
    const { error } = await admin.from("app_error_reports").insert({
      user_id: user.id,
      actor_role: role,
      error_digest: parsed.data.digest,
      message,
      route,
    });
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch {
    // Error reporting must never replace the original app error in the UI.
    return new NextResponse(null, { status: 204 });
  }
}
