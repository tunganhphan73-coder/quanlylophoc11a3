import "server-only";
import { callGeminiForJson } from "@/lib/gemini";
import { OcrProviderError, type OcrProviderName } from "@/lib/ocr-provider-error";
import { callGroqForJson } from "@/lib/groq-vision";

export type OcrProvider = "auto" | OcrProviderName;

interface OcrRequest {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  provider: OcrProvider;
}

export async function callOcrForJson<T>({ prompt, imageBase64, mimeType, provider }: OcrRequest): Promise<T> {
  if (provider !== "auto") return callProvider<T>(provider, { prompt, imageBase64, mimeType });

  const preferred = process.env.OCR_DEFAULT_PROVIDER === "gemini" ? "gemini" : "groq";
  const configured = [preferred, preferred === "gemini" ? "groq" : "gemini"]
    .filter((candidate) => candidate === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.GROQ_API_KEY));

  if (configured.length === 0) {
    throw new Error("Chưa cấu hình AI. Hãy thêm GROQ_API_KEY hoặc GEMINI_API_KEY vào .env.local.");
  }

  const failures: string[] = [];
  for (let index = 0; index < configured.length; index += 1) {
    const candidate = configured[index] as OcrProviderName;
    try {
      return await callProvider<T>(candidate, { prompt, imageBase64, mimeType });
    } catch (error) {
      // Any provider-side failure (bad model id, oversized image, bad key, quota...) still
      // lets the next configured provider try instead of aborting the whole scan.
      const canTryNext = index < configured.length - 1 && error instanceof OcrProviderError;
      failures.push(`${candidate}: ${error instanceof Error ? error.message : "Lỗi không xác định."}`);
      if (!canTryNext) break;
    }
  }

  const fallbackHint = process.env.GROQ_API_KEY
    ? ""
    : " Chưa có GROQ_API_KEY trên máy chủ nên chưa thể dùng Groq hoặc tự chuyển sang Groq khi Gemini bận. Tạo khóa Groq và thêm vào Vercel > Settings > Environment Variables (Production), rồi redeploy.";
  throw new Error(`Không quét được ảnh bằng AI đã cấu hình. ${failures.join(" | ")}${fallbackHint}`);
}

function callProvider<T>(provider: OcrProviderName, args: Omit<OcrRequest, "provider">): Promise<T> {
  return provider === "gemini" ? callGeminiForJson<T>(args) : callGroqForJson<T>(args);
}
