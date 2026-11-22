import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginRequest } from "@/lib/security/request-origin";

const bodySchema = z.object({ code: z.string().min(1).max(256) }).strict();

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Nội dung gửi lên phải là JSON." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_024) {
    return NextResponse.json({ error: "Dữ liệu gửi lên quá lớn." }, { status: 413 });
  }

  const configuredCode = process.env.ADMIN_LOGIN_CODE;
  if (!configuredCode) {
    return NextResponse.json({ error: "Admin entry is not configured." }, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const submitted = Buffer.from(parsed.data.code, "utf8");
  const expected = Buffer.from(configuredCode, "utf8");
  const matches = submitted.length === expected.length && timingSafeEqual(submitted, expected);
  if (!matches) {
    return NextResponse.json({ error: "Mã không đúng." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  // This code only reveals the admin form. Supabase email/password and the
  // trusted profile role check remain mandatory for actual authentication.
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store, private", "Pragma": "no-cache" },
  });
}
