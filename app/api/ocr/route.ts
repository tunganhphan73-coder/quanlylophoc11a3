// =====================================================================
// POST /api/ocr
// AI Smart Scanner — 2 modes, backed by Groq or Gemini vision:
//   mode = "roster"  -> printed class list photo  -> { students: [...] }
//   mode = "logbook" -> handwritten logbook page   -> { entries: [...] }
//
// The teacher's client uploads a photo (base64) + picks a mode. This
// route only calls the selected AI provider and returns JSON — it never writes
// to the database itself, so the teacher UI can show a review/edit step
// before anything is saved (important because OCR is never 100% correct
// on handwriting).
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { callOcrForJson, type OcrProvider } from "@/lib/ocr-ai";
import { OcrProviderError } from "@/lib/ocr-provider-error";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth/roles";
import type { OcrLogbookResult, OcrRosterResult } from "@/lib/types";
import { isSameOriginRequest } from "@/lib/security/request-origin";

// Groq (25s) + Gemini (20s) can exceed a short serverless default; ignored outside Vercel.
export const maxDuration = 60;

const ROSTER_PROMPT = `Bạn là một hệ thống OCR chuyên đọc danh sách học sinh in trên giấy (sổ điểm danh, danh sách lớp).
Hãy đọc kỹ ảnh được cung cấp và trích xuất TOÀN BỘ danh sách học sinh.

Trả về DUY NHẤT một JSON object theo đúng schema sau, không thêm bất kỳ chữ nào khác, không dùng markdown:
{
  "students": [
    { "full_name": "Họ và tên đầy đủ", "gender": "male" | "female" | "other" | null }
  ]
}

Quy tắc:
- Giữ nguyên dấu tiếng Việt trong tên.
- Nếu không xác định được giới tính từ ảnh, đặt gender = null.
- Bỏ qua các dòng tiêu đề, số thứ tự không phải tên học sinh.
- Nếu ảnh mờ hoặc không đọc được một dòng, bỏ qua dòng đó thay vì đoán bừa.`;

const LOGBOOK_PROMPT = `Bạn là một hệ thống OCR chuyên đọc sổ liên lạc / sổ ghi điểm phát biểu viết tay của giáo viên.
Mỗi dòng trong sổ thường gồm: tên học sinh, các dấu gạch kiểm (tally marks, ví dụ: |||| hoặc IIII) đếm số lần phát biểu,
điểm thưởng viết tay (nếu có), tổng điểm viết tay (nếu có), và chữ ký hoặc dấu tích xác nhận ở cuối dòng.

Hãy đọc kỹ ảnh và trích xuất TOÀN BỘ các dòng. Trả về DUY NHẤT một JSON object theo đúng schema sau,
không thêm bất kỳ chữ nào khác, không dùng markdown:
{
  "entries": [
    {
      "student_name": "Họ và tên học sinh",
      "times_spoken": 0,
      "bonus_points": 0,
      "total_points_on_page": null,
      "has_signature": false
    }
  ]
}

Quy tắc:
- "times_spoken": đếm CHÍNH XÁC số dấu gạch/tally marks cho học sinh đó (đây là số lần phát biểu).
- "bonus_points": điểm thưởng viết thêm bằng tay, số 0 nếu không có ghi gì.
- "total_points_on_page": nếu giáo viên có viết sẵn một con số tổng ở cuối dòng thì lấy đúng số đó, nếu không có thì để null
  (KHÔNG tự tính toán — hệ thống sẽ tự tính lại tổng điểm ở bước sau).
- "has_signature": true nếu cuối dòng có chữ ký, dấu tích, hoặc con dấu xác nhận; false nếu để trống.
- Giữ nguyên dấu tiếng Việt trong tên.`;

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Nội dung gửi lên phải là JSON." }, { status: 415 });
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 4.5 * 1024 * 1024) {
      return NextResponse.json({ error: "Ảnh quá lớn. Hãy chọn ảnh nhỏ hơn hoặc cắt ảnh gọn hơn." }, { status: 413 });
    }

    // --- 1. Auth guard: teachers/admins can use both modes; BCS can only
    // scan logbooks for their own class. Row-level policy limits the save.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
    }

    const { data: profile } = await supabase.from("profiles").select("role, access_role").eq("id", user.id).single();

    const role = getEffectiveRole(profile);
    if (role !== "teacher" && role !== "admin" && role !== "bcs") {
      return NextResponse.json({ error: "Tài khoản này không có quyền dùng tính năng quét AI." }, { status: 403 });
    }

    // --- 2. Parse the upload ---------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON không hợp lệ." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Dữ liệu gửi lên không hợp lệ." }, { status: 400 });
    }
    const { mode, imageBase64, mimeType, provider = "auto" } = body as {
      mode: "roster" | "logbook";
      imageBase64: string;
      mimeType: string;
      provider?: OcrProvider;
    };

    if (typeof imageBase64 !== "string" || !imageBase64 || typeof mimeType !== "string") {
      return NextResponse.json({ error: "Thiếu dữ liệu ảnh." }, { status: 400 });
    }
    if (mode !== "roster" && mode !== "logbook") {
      return NextResponse.json({ error: "Chế độ quét không hợp lệ." }, { status: 400 });
    }
    if (role === "bcs" && mode !== "logbook") {
      return NextResponse.json({ error: "Ban cán sự chỉ được quét sổ liên lạc để nhập điểm cho lớp mình." }, { status: 403 });
    }
    if (!["auto", "gemini", "groq"].includes(provider)) {
      return NextResponse.json({ error: "Nhà cung cấp AI không hợp lệ." }, { status: 400 });
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
      return NextResponse.json({ error: "Ảnh cần ở định dạng JPEG, PNG, WEBP hoặc GIF." }, { status: 400 });
    }
    // Vercel limits function request bodies to 4.5 MB. Keep the encoded
    // base64 payload below 4 MiB so JSON overhead remains under that limit.
    if (imageBase64.length > 4 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Ảnh quá lớn để gửi lên máy chủ. Hãy chọn ảnh nhỏ hơn hoặc cắt ảnh gọn hơn." },
        { status: 413 },
      );
    }
    const cleanBase64 = imageBase64.includes(",") ? imageBase64.split(",", 2)[1] : imageBase64;
    if (!cleanBase64 || cleanBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
      return NextResponse.json({ error: "Dữ liệu ảnh không hợp lệ." }, { status: 400 });
    }

    const { data: mayScan, error: rateLimitError } = await supabase.rpc("consume_ocr_rate_limit");
    if (rateLimitError) {
      console.error("[/api/ocr] rate-limit RPC is unavailable:", rateLimitError.message);
      return NextResponse.json(
        { error: "Cần chạy file supabase/hardening-and-performance.sql trong SQL Editor trước khi dùng quét AI." },
        { status: 503 },
      );
    }
    if (!mayScan) {
      return NextResponse.json(
        { error: "Bạn đã quét 10 lần trong một phút. Vui lòng đợi một lát rồi thử lại." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    // Strip a data: URL prefix if the client sent one whole (e.g. "data:image/png;base64,....").
    // --- 3. Call the selected AI provider with the mode-specific prompt ---
    if (mode === "roster") {
      const result = await callOcrForJson<OcrRosterResult>({
        prompt: ROSTER_PROMPT,
        imageBase64: cleanBase64,
        mimeType,
        provider,
      });
      return NextResponse.json(
        { mode: "roster", students: result.students ?? [] } satisfies OcrRosterResult,
        { headers: { "Cache-Control": "no-store, private" } },
      );
    }

    const result = await callOcrForJson<OcrLogbookResult>({
      prompt: LOGBOOK_PROMPT,
      imageBase64: cleanBase64,
      mimeType,
      provider,
    });
    return NextResponse.json(
      { mode: "logbook", entries: result.entries ?? [] } satisfies OcrLogbookResult,
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    console.error("[/api/ocr] error:", error);
    const message = error instanceof Error ? error.message : "Lỗi không xác định khi quét ảnh.";
    return NextResponse.json({ error: message }, { status: error instanceof OcrProviderError ? 502 : 500 });
  }
}
