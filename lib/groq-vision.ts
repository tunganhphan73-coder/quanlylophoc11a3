// Server-only Groq vision wrapper for OCR. Never import this module in client code.
import "server-only";
import { OcrProviderError } from "@/lib/ocr-provider-error";

interface GroqCallArgs {
  prompt: string;
  imageBase64: string;
  mimeType: string;
}

const GROQ_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

export async function callGroqForJson<T>({ prompt, imageBase64, mimeType }: GroqCallArgs): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Thiếu GROQ_API_KEY trong cấu hình server.");

  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `${prompt}\n\nChỉ trả về một JSON object hợp lệ, không dùng markdown.` },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        }],
        temperature: 0.1,
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        // qwen3.x thinks by default; OCR needs no reasoning and it would eat the token budget.
        ...(GROQ_MODEL.startsWith("qwen/qwen3") ? { reasoning_effort: "none" } : {}),
      }),
    });
  } catch {
    throw new OcrProviderError("groq", "Không kết nối được Groq. Kiểm tra mạng rồi thử lại.", null, true);
  }

  if (!response.ok) {
    const details = (await response.text()).slice(0, 800);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new OcrProviderError("groq", `Groq lỗi HTTP ${response.status}: ${details}`, response.status, retryable);
  }

  const payload = await response.json();
  const rawText: string | undefined = payload?.choices?.[0]?.message?.content;
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new OcrProviderError("groq", "Groq không trả nội dung có thể đọc được.", null, true);
  }

  try {
    return JSON.parse(rawText.replace(/^```(?:json)?\s*|```\s*$/g, "").trim()) as T;
  } catch {
    throw new OcrProviderError("groq", "Groq trả dữ liệu không phải JSON hợp lệ.", null, true);
  }
}
