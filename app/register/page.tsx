"use client";

// =====================================================================
// Teacher self-registration. Parent/student accounts are NOT created
// here — those are shared per-class logins the teacher generates from
// inside the dashboard (via the service-role admin client), since they
// have no independent identity of their own to register with.
// =====================================================================
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role: "teacher", full_name: fullName } },
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setSuccessMessage("Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản trước khi đăng nhập.");
      }
    } catch {
      setErrorMessage("Đang có lỗi kết nối. Vui lòng thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-blue-50 px-4 py-8 text-slate-900">
      <section className="w-full max-w-sm rounded-xl border border-blue-100 bg-white p-6 shadow-sm sm:p-8">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-blue-800">PTA-hanhkiem</p>
        <h1 className="mb-1 text-2xl font-bold text-blue-950">Đăng ký giáo viên</h1>
        <p className="mb-6 text-sm text-slate-700">Tạo tài khoản để bắt đầu quản lý lớp học của bạn.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="register-name" className="text-sm font-semibold text-slate-800">Họ và tên</label>
            <Input id="register-name" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nguyễn Văn A" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="register-email" className="text-sm font-semibold text-slate-800">Email</label>
            <Input id="register-email" required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@truong.edu.vn" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="register-password" className="text-sm font-semibold text-slate-800">Mật khẩu</label>
            <Input
              id="register-password"
              required
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự"
            />
          </div>

          {errorMessage && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>}
          {successMessage && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{successMessage}</p>}

          <Button type="submit" size="lg" disabled={isSubmitting} className="mt-2 font-sans font-semibold">
            {isSubmitting ? "Đang đăng ký..." : "Đăng ký"}
          </Button>

          <a href="/login" className="mt-1 min-h-11 rounded-md py-3 text-center text-sm text-blue-800 underline hover:text-blue-950">
            Đã có tài khoản? Đăng nhập
          </a>
        </form>
      </section>
      <span className="fixed bottom-2 right-3 text-[10px] text-slate-500" aria-hidden="true">PTA-hanhkiem</span>
    </main>
  );
}
