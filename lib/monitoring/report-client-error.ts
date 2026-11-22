export function reportClientError(error: Error & { digest?: string }, route: string) {
  if (typeof window === "undefined") return;
  const payload = {
    digest: error.digest ?? "",
    message: `${error.name || "Error"}: ${error.message || "Lỗi ứng dụng"}`.slice(0, 500),
    route: route.slice(0, 300),
  };
  void fetch("/api/admin/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}
