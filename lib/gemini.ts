// Server-only Gemini wrapper for OCR. Never import this module in client code.
import "server-only";
import { OcrProviderError } from "@/lib/ocr-provider-error";

interface GeminiCallArgs {
  prompt: string;
  imageBase64: string;
  mimeType: string;
}

// Free-tier models are tried first by default. A comma-separated GEMINI_MODEL
// value can override the order; the defaults remain as fallbacks.
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
];

export async function callGeminiForJson<T>({ prompt, imageBase64, mimeType }: GeminiCallArgs): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Thiếu GEMINI_API_KEY trong cấu hình server.");

  const configuredModels = (process.env.GEMINI_MODEL || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const models = [...new Set([...configuredModels, ...GEMINI_FALLBACK_MODELS])];
  const failures: string[] = [];
  let lastStatus: number | null = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      });
    } catch {
      throw new OcrProviderError("gemini", "Không kết nối được Gemini. Kiểm tra mạng rồi thử lại.", null, true);
    }

    if (response.ok) {
      const payload = await response.json();
      const rawText: string | undefined = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text).filter(Boolean).join("\n");
      if (!rawText) {
        failures.push(`${model}: Gemini không trả nội dung có thể đọc được.`);
        continue;
      }
      try {
        return parseJson<T>(rawText);
      } catch (error) {
        failures.push(`${model}: ${error instanceof Error ? error.message : "Gemini trả JSON không hợp lệ."}`);
        continue;
      }
    }

    const details = (await response.text()).slice(0, 800);
    const unsupportedModel = response.status === 400 && /model.*not found|not supported for generateContent/i.test(details);
    const retryable = response.status === 403 || response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500 || unsupportedModel;
    lastStatus = response.status;
    if (!retryable) {
      throw new OcrProviderError("gemini", `Gemini lỗi HTTP ${response.status}: ${details}`, response.status, false);
    }
    failures.push(`${model}: HTTP ${response.status} — ${details}`);
  }

  throw new OcrProviderError(
    "gemini",
    `Không model Gemini nào khả dụng lúc này. Đã thử ${models.join(", ")}. ${failures.join(" | ")}`,
    lastStatus,
    true,
  );
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*|```\s*$/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new OcrProviderError("gemini", "Gemini trả dữ liệu không phải JSON hợp lệ.", null, true);
  }
}
