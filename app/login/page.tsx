"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEffectiveRole, type EffectiveRole } from "@/lib/auth/roles";

interface RoleConfig {
  key: EffectiveRole;
  number: string;
  label: string;
  emailPlaceholder: string;
  icon: "teacher" | "parent" | "student";
}

const ROLES: RoleConfig[] = [
  { key: "teacher", number: "01", label: "GIÁO VIÊN", emailPlaceholder: "ten.giaovien@truong.edu.vn", icon: "teacher" },
  { key: "parent", number: "02", label: "PHỤ HUYNH HỌC SINH", emailPlaceholder: "Email tài khoản phụ huynh", icon: "parent" },
  { key: "student", number: "03", label: "HỌC SINH", emailPlaceholder: "Email tài khoản học sinh", icon: "student" },
  { key: "bcs", number: "04", label: "BAN CÁN SỰ", emailPlaceholder: "Email tài khoản ban cán sự", icon: "student" },
];
const ADMIN_ROLE: RoleConfig = { key: "admin", number: "", label: "QUẢN TRỊ VIÊN", emailPlaceholder: "Email tài khoản quản trị", icon: "teacher" };

const easePremium = [0.22, 1, 0.36, 1] as const;

function RoleIcon({ kind }: { kind: RoleConfig["icon"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      {kind === "parent" ? (
        <>
          <path {...common} d="M3.5 10.5 12 4l8.5 6.5" />
          <path {...common} d="M5.5 9.5v10h13v-10M9 19.5v-6h6v6" />
        </>
      ) : kind === "teacher" ? (
        <>
          <circle {...common} cx="12" cy="8" r="3.5" />
          <path {...common} d="M5 20c.6-3.5 3.1-5.5 7-5.5s6.4 2 7 5.5M18.5 4.5v5m-2.5-2.5h5" />
        </>
      ) : (
        <>
          <circle {...common} cx="12" cy="8" r="3.5" />
          <path {...common} d="M5 20c.6-3.5 3.1-5.5 7-5.5s6.4 2 7 5.5" />
        </>
      )}
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [activeRole, setActiveRole] = useState<RoleConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const motionDuration = reduceMotion ? 0 : 0.25;

  function openRole(role: RoleConfig) {
    setActiveRole(role);
    setErrorMessage(null);
  }

  function goBack() {
    setActiveRole(null);
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setErrorMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRole) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // In the teacher sign-in form, a value without "@" is checked as the
      // secret admin-entry code. It only reveals the admin form; it never logs in.
      if (activeRole.key === "teacher" && !email.trim().includes("@")) {
        const response = await fetch("/api/auth/admin-entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: email.trim() }),
        });

        if (response.ok) {
          setActiveRole(ADMIN_ROLE);
          setEmail("");
          setPassword("");
          setShowPassword(false);
          return;
        }

        setErrorMessage(response.status === 503
          ? "Chức năng đăng nhập quản trị chưa được cấu hình."
          : "Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.");
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (error || !data.user) {
        setErrorMessage("Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, access_role")
        .eq("id", data.user.id)
        .single();

      const profileRole = getEffectiveRole(profile);
      if (profileError || profileRole !== activeRole.key) {
        setErrorMessage(`Tài khoản này không thuộc mục ${activeRole.label.toLowerCase()}.`);
        await supabase.auth.signOut();
        return;
      }

      router.push(activeRole.key === "admin" ? "/admin" : "/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Đang có lỗi kết nối. Vui lòng thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh w-full items-center justify-center bg-blue-50 px-4 py-10 font-sans text-slate-900 sm:px-6">
      <div className="relative w-full max-w-lg pb-10">
        <AnimatePresence mode="wait" initial={false}>
          {!activeRole ? (
            <motion.section
              key="roles"
              aria-labelledby="login-heading"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
              transition={{ duration: motionDuration, ease: easePremium }}
              className="rounded-xl border border-blue-100 bg-white p-6 shadow-sm sm:p-9"
            >
              <div className="mb-8 sm:mb-9">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-blue-800">PTA-hanhkiem</p>
                <h1 id="login-heading" className="text-2xl font-semibold tracking-tight text-blue-950 sm:text-3xl">
                  Bạn đăng nhập với vai trò nào?
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Chọn tài khoản để tiếp tục vào không gian lớp học.
                </p>
              </div>

              <div className="divide-y divide-slate-200">
                {ROLES.map((role) => (
                  <button
                    key={role.key}
                    type="button"
                    onClick={() => openRole(role)}
                    className="group flex min-h-[76px] w-full items-center justify-between gap-4 rounded-xl px-2 py-4 text-left transition-colors duration-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.99]"
                    aria-label={`Đăng nhập với vai trò ${role.label.toLowerCase()}`}
                  >
                    <span className="flex min-w-0 items-center gap-4">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-800 transition-colors duration-200 group-hover:border-blue-300 group-hover:bg-blue-100">
                        <RoleIcon kind={role.icon} />
                      </span>
                      <span className="min-w-0">
                        <span className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-semibold tracking-[0.14em] text-blue-700">{role.number}</span>
                          <span className="h-px w-5 bg-slate-300" aria-hidden="true" />
                        </span>
                        <span className="block text-lg font-semibold tracking-wide text-blue-950 transition-colors duration-200 group-hover:text-blue-700 sm:text-xl">
                          {role.label}
                        </span>
                        <span className="mt-1 block text-xs font-medium text-slate-600 transition-colors duration-200 group-hover:text-slate-900">
                          Chạm để đăng nhập
                        </span>
                      </span>
                    </span>
                    <svg className="h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-blue-700" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ))}
              </div>
            </motion.section>
          ) : (
            <motion.section
              key={`form-${activeRole.key}`}
              aria-labelledby="role-heading"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
              transition={{ duration: motionDuration, ease: easePremium }}
              className="rounded-xl border border-blue-100 bg-white p-6 shadow-sm sm:p-9"
            >
              <button
                type="button"
                onClick={goBack}
                className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700 transition-colors duration-200 hover:bg-blue-50 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.98]"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M19 12H5m6 6-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Quay lại
              </button>

              <div className="mb-7 flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-800">
                  <RoleIcon kind={activeRole.icon} />
                </span>
                <div className="min-w-0">
                  <p className="mb-2 inline-flex max-w-full items-center rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold tracking-[0.14em] text-blue-800 sm:text-sm">
                    {activeRole.label}
                  </p>
                  <h1 id="role-heading" className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Đăng nhập</h1>
                </div>
              </div>
                <p className="mb-7 text-sm leading-6 text-slate-700">
                Dùng email và mật khẩu đã được cấp để vào không gian lớp học.
              </p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <label htmlFor="login-email" className="text-sm font-semibold text-slate-800">Tài khoản email</label>
                  <Input
                    id="login-email"
                    type={activeRole.key === "teacher" ? "text" : "email"}
                    inputMode="email"
                    autoComplete="username"
                    required
                    autoFocus
                    placeholder={activeRole.emailPlaceholder}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-500 focus-visible:border-blue-700 focus-visible:ring-2 focus-visible:ring-blue-700/30"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="login-password" className="text-sm font-semibold text-slate-800">Mật khẩu</label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required={!(
                        activeRole.key === "teacher" &&
                        !email.trim().includes("@")
                      )}
                      placeholder="Nhập mật khẩu"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 rounded-xl border border-slate-300 bg-white px-4 pr-14 text-base text-slate-900 placeholder:text-slate-500 focus-visible:border-blue-700 focus-visible:ring-2 focus-visible:ring-blue-700/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((shown) => !shown)}
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-1 inline-flex w-11 items-center justify-center rounded-lg text-slate-600 transition-colors duration-200 hover:bg-blue-50 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700 active:scale-95"
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.5 0 9 7 9 7a16 16 0 01-3.1 3.8M6.2 6.2C4.1 7.7 3 10 3 12c0 0 3.5 7 9 7 1.2 0 2.3-.3 3.3-.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true"><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {errorMessage && (
                    <motion.p
                      role="alert"
                      initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: motionDuration }}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium leading-5 text-red-800"
                    >
                      {errorMessage}
                    </motion.p>
                  )}
                </AnimatePresence>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-1 h-12 w-full rounded-xl bg-blue-800 text-base font-bold text-white transition duration-200 hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-blue-300 disabled:text-slate-800"
                >
                  {isSubmitting ? "Đang đăng nhập..." : "Vào lớp học"}
                </Button>

                {activeRole.key === "teacher" ? (
                  <a href="/register" className="rounded-md py-1 text-center text-sm font-medium text-slate-700 underline-offset-4 transition-colors duration-200 hover:text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
                    Chưa có tài khoản? <span className="font-semibold text-blue-900">Đăng ký giáo viên mới</span>
                  </a>
                ) : (
                  <p className="text-center text-sm leading-5 text-slate-700">
                    Chưa có tài khoản? Hãy liên hệ giáo viên chủ nhiệm.
                  </p>
                )}
              </form>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none fixed bottom-3 right-3 z-20 text-[10px] font-medium tracking-wide text-slate-500/70" aria-hidden="true">
        PTA-hanhkiem
      </div>
    </main>
  );
}
