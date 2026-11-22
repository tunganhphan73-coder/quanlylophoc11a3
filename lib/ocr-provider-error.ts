export type OcrProviderName = "gemini" | "groq";

export class OcrProviderError extends Error {
  constructor(
    public readonly provider: OcrProviderName,
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OcrProviderError";
  }
}
