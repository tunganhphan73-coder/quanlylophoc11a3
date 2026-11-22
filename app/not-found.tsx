import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-blue-50 px-5 text-slate-900">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-5xl font-semibold text-blue-800">404</p>
        <h1 className="mt-3 text-2xl font-semibold text-blue-950">Không tìm thấy trang</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">Đường dẫn có thể đã thay đổi hoặc không tồn tại.</p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-800 px-5 text-sm font-semibold text-white transition hover:bg-blue-900"
        >
          Về trang đăng nhập
        </Link>
      </section>
    </main>
  );
}
