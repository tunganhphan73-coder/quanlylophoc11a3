import type { NextRequest } from "next/server";

/** These browser-only JSON endpoints must be called from this app's origin. */
export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}
