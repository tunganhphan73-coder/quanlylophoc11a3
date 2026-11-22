import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/security/request-origin";
import { getEffectiveRole } from "@/lib/auth/roles";

const ROLES = ["parent", "student", "bcs"] as const;
type AccountRole = (typeof ROLES)[number];

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Nội dung gửi lên phải là JSON." }, { status: 415 });
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_048) {
      return NextResponse.json({ error: "Dữ liệu gửi lên quá lớn." }, { status: 413 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Bạn cần đăng nhập bằng tài khoản giáo viên." }, { status: 401 });
    }

    const { data: profile } = await supabase.from("profiles").select("role, access_role").eq("id", user.id).single();
    const actorRole = getEffectiveRole(profile);
    if (actorRole !== "teacher" && actorRole !== "admin") {
      return NextResponse.json({ error: "Chỉ giáo viên hoặc quản trị viên mới có thể tạo tài khoản lớp." }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON không hợp lệ." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
    }
    const input = body as { classId?: unknown; role?: unknown; action?: unknown };
    const classId = typeof input.classId === "string" ? input.classId : "";
    const role = input.role;
    const action = input.action === undefined ? "create" : input.action;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(classId) || !ROLES.includes(role as AccountRole) || (action !== "create" && action !== "reset")) {
      return NextResponse.json({ error: "Lớp hoặc loại tài khoản không hợp lệ." }, { status: 400 });
    }

    let classQuery = supabase
      .from("classes")
      .select("id, name")
      .eq("id", classId);
    if (actorRole === "teacher") classQuery = classQuery.eq("teacher_id", user.id);
    const { data: classRow } = await classQuery.single();
    if (!classRow) {
      return NextResponse.json({ error: "Bạn không có quyền tạo tài khoản cho lớp này." }, { status: 403 });
    }

    const { data: mayCreateAccount, error: rateLimitError } = await supabase.rpc("consume_class_account_rate_limit");
    if (rateLimitError) {
      console.error("[/api/teacher/class-accounts] rate-limit RPC is unavailable:", rateLimitError.message);
      return NextResponse.json(
        { error: "Cần chạy supabase/class-account-rate-limit.sql trước khi tạo tài khoản lớp." },
        { status: 503 },
      );
    }
    if (!mayCreateAccount) {
      return NextResponse.json(
        { error: "Đã đạt giới hạn tạo tài khoản trong giờ này. Vui lòng thử lại sau." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    const admin = createAdminClient();
    // This reserved example.com address is only a Supabase login identifier;
    // it is never used to send email. A unique class/role address also lets
    // Supabase Auth prevent duplicate shared accounts without querying
    // profiles using elevated database privileges.
    const email = `lop-${role}-${classId}@class-login.example.com`;
    const password = randomBytes(12).toString("base64url");
    if (action === "reset") {
      let profileQuery = admin.from("profiles").select("id").eq("class_id", classId);
      if (role === "bcs") profileQuery = profileQuery.eq("access_role", "bcs");
      else profileQuery = profileQuery.eq("role", role).is("access_role", null);
      const { data: profile, error: profileError } = await profileQuery.maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return NextResponse.json({ error: "Chưa có tài khoản loại này cho lớp." }, { status: 404 });
      const { data: existingUser, error: lookupError } = await admin.auth.admin.getUserById(profile.id);
      if (lookupError || !existingUser.user) throw lookupError ?? new Error("Không tìm thấy tài khoản Auth.");
      const { data: updatedUser, error: resetError } = await admin.auth.admin.updateUserById(profile.id, { password });
      if (resetError) throw resetError;
      return NextResponse.json(
        { email: updatedUser.user?.email ?? email, password, role, className: classRow.name, action: "reset" },
        { headers: { "Cache-Control": "no-store, private" } },
      );
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        full_name: `${role === "parent" ? "Phụ huynh" : role === "bcs" ? "Ban cán sự" : "Học sinh"} lớp ${classRow.name}`,
        class_id: classId,
      },
      // Authorization metadata is written only through the admin API. The
      // profile trigger trusts this app_metadata marker, never user_metadata.
      app_metadata: {
        role,
        class_id: classId,
        class_account_source: "teacher-created",
      },
    });

    if (error) {
      const authErrorCode = "code" in error ? String(error.code) : "";
      if (
        authErrorCode === "email_exists" ||
        authErrorCode === "user_already_exists" ||
        /already (been )?registered|already exists/i.test(error.message)
      ) {
        return NextResponse.json(
      { error: `Tài khoản ${accountRoleLabel(role as AccountRole)} của lớp này đã được tạo trước đó.` },
          { status: 409 }
        );
      }
      throw error;
    }
    if (!data.user) throw new Error("Supabase không trả về tài khoản mới.");

    return NextResponse.json(
      { email, password, role, className: classRow.name, action: "create" },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    console.error("[/api/teacher/class-accounts] error:", error);
    const message = error instanceof Error ? error.message : "Không thể tạo tài khoản.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function accountRoleLabel(role: AccountRole) {
  return role === "bcs" ? "ban cán sự" : role === "parent" ? "phụ huynh" : "học sinh";
}
