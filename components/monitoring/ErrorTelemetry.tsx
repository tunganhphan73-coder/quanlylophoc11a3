"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/monitoring/report-client-error";

export function ErrorTelemetry() {
  useEffect(() => {
    const recent = new Map<string, number>();
    const record = (error: Error, route = window.location.pathname) => {
      const signature = `${route}:${error.name}:${error.message}`;
      const now = Date.now();
      if (now - (recent.get(signature) ?? 0) < 60_000) return;
      recent.set(signature, now);
      reportClientError(error, route);
    };
    const onError = (event: ErrorEvent) => record(event.error instanceof Error ? event.error : new Error(event.message || "Lỗi JavaScript"));
    const onRejection = (event: PromiseRejectionEvent) => record(event.reason instanceof Error ? event.reason : new Error("Promise bị từ chối"));

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
