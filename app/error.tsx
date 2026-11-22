"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { reportClientError } from "@/lib/monitoring/report-client-error";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  useEffect(() => { reportClientError(error, pathname || window.location.pathname); }, [error, pathname]);

  return (
    <main className="grid min-h-screen place-items-center bg-blue-50 px-5 text-slate-900">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Có lỗi xảy ra</p>
        <h1 className="mt-3 text-2xl font-semibold text-blue-950">Trang chưa tải được</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          Dữ liệu chưa bị thay đổi. Bạn có thể thử tải lại phần này.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-slate-500">Mã lỗi: {error.digest}</p>}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 min-h-11 rounded-lg bg-blue-800 px-5 text-sm font-semibold text-white transition hover:bg-blue-900"
        >
          Thử lại
        </button>
      </section>
    </main>
  );
}
