"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/monitoring/report-client-error";

import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError(error, window.location.pathname); }, [error]);

  return (
    <html lang="vi">
      <body className="bg-blue-50 text-slate-900">
        <main className="grid min-h-screen place-items-center px-5">
          <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
            <h1 className="text-2xl font-semibold text-blue-950">Ứng dụng tạm thời gặp sự cố</h1>
            <p className="mt-3 text-sm leading-6 text-slate-700">Hãy tải lại trang để thử kết nối lại.</p>
            <button
              type="button"
              onClick={() => reset()}
              className="mt-5 min-h-11 rounded-lg bg-blue-800 px-5 text-sm font-semibold text-white"
            >
              Thử lại
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
