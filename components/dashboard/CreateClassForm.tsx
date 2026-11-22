"use client";

// =====================================================================
// Form tạo lớp học mới. Insert trực tiếp vào bảng `classes` với
// teacher_id = user hiện tại (RLS đã cho phép insert nếu
// current_role_name() = 'teacher' và teacher_id = auth.uid()).
// Dùng khi giáo viên mới đăng ký, chưa có lớp nào, hoặc muốn thêm lớp mới.
// =====================================================================
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClassRow } from "@/lib/types";

export type NewClassAccount = { email: string; password: string; role: "bcs" | "student"; className: string };
export type ClassAccountProvisionResult = { accounts: NewClassAccount[]; failures: string[]; className: string };

interface CreateClassFormProps {
  teacherId: string;
  onCreated: (newClass: ClassRow, accounts: ClassAccountProvisionResult) => void;
  /** Hiện dạng banner lớn khi giáo viên chưa có lớp nào, hoặc dạng gọn khi đã có. */
  variant?: "empty" | "compact";
}

export function CreateClassForm({ teacherId, onCreated, variant = "empty" }: CreateClassFormProps) {
  const supabase = createClient();
  const [isOpen, setIsOpen] = useState(variant === "empty");
  const [name, setName] = useState("");
  const [speakingPoint, setSpeakingPoint] = useState("0.5");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage("Vui lòng nhập tên lớp.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase
        .from("classes")
        .insert({
          teacher_id: teacherId,
          name: trimmedName,
          custom_speaking_point: Number(speakingPoint) || 0.5,
        })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("No class returned");

      // Provision both shared class accounts immediately after class creation.
      // Credentials are shown once in this teacher-only UI and are not stored.
      const provisioning = await Promise.all((["bcs", "student"] as const).map(async (role) => {
        try {
          const response = await fetch("/api/teacher/class-accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ classId: data.id, role }),
          });
          const result = await response.json() as NewClassAccount & { error?: string };
          return response.ok
            ? { account: result, failure: null }
            : { account: null, failure: `${role === "bcs" ? "Ban cán sự" : "Học sinh"}: ${result.error ?? "không tạo được"}` };
        } catch {
          return { account: null, failure: `${role === "bcs" ? "Ban cán sự" : "Học sinh"}: lỗi kết nối` };
        }
      }));
      const accounts = provisioning.flatMap(({ account }) => account ? [account] : []);
      const failures = provisioning.flatMap(({ failure }) => failure ? [failure] : []);

      setName("");
      setIsOpen(variant === "empty");
      onCreated(data as ClassRow, { accounts, failures, className: data.name });
    } catch {
      setErrorMessage("Không thể tạo lớp. Vui lòng thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button size="sm" variant="outline" onClick={() => setIsOpen(true)}>+ Tạo lớp mới</Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={
        variant === "empty"
          ? "flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-8 text-center md:backdrop-blur-md"
          : "flex flex-wrap items-end gap-2 rounded-lg bg-white/[0.03] p-3"
      }
    >
      {variant === "empty" && (
        <>
          <h3 className="font-serif text-xl text-white">Tạo lớp học đầu tiên của bạn</h3>
          <p className="font-sans text-sm text-white/60">
            Đặt tên lớp và mức điểm cho mỗi lần phát biểu — bạn có thể đổi lại bất kỳ lúc nào trong phần cài đặt lớp.
          </p>
        </>
      )}

      <div className="flex flex-wrap items-end justify-center gap-2">
        <div className="flex flex-col gap-1 text-left">
          <label className="font-sans text-xs uppercase tracking-wider text-white/50">Tên lớp</label>
          <Input
            required
            placeholder="Ví dụ: Lớp 10A1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="flex flex-col gap-1 text-left">
          <label className="font-sans text-xs uppercase tracking-wider text-white/50">Điểm / lần phát biểu</label>
          <Input
            type="number"
            step="0.1"
            value={speakingPoint}
            onChange={(e) => setSpeakingPoint(e.target.value)}
            className="w-28"
          />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Đang tạo..." : "Tạo lớp"}
        </Button>
        {variant === "compact" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
            Huỷ
          </Button>
        )}
      </div>

      {errorMessage && <p className="font-sans text-sm text-red-400">{errorMessage}</p>}
    </form>
  );
}

export function AccountResult({ result, onClose }: { result: ClassAccountProvisionResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const text = result.accounts.map((account) => `${account.role === "bcs" ? "Ban cán sự" : "Học sinh"} lớp ${result.className}\nTài khoản: ${account.email}\nMật khẩu: ${account.password}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return <div className="fixed inset-x-3 bottom-20 z-50 mx-auto max-h-[70dvh] w-auto max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-950 shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6">
    <div className="flex items-start justify-between gap-3"><p className="font-semibold text-emerald-900">Lớp {result.className} đã được tạo.</p><button type="button" className="rounded-lg p-1 text-slate-600 hover:bg-slate-100" onClick={onClose} aria-label="Đóng thông tin tài khoản">×</button></div>
    {result.accounts.map((account) => <div key={account.role} className="mt-3 border-t border-slate-200 pt-3">
      <p className="font-semibold">Tài khoản {account.role === "bcs" ? "Ban cán sự" : "học sinh"}</p>
      <p className="mt-1 break-all">Tài khoản: <span className="select-all">{account.email}</span></p>
      <p className="break-all">Mật khẩu: <span className="select-all">{account.password}</span></p>
    </div>)}
    {result.failures.length > 0 && <p role="alert" className="mt-3 text-amber-900">Một số tài khoản chưa tạo được: {result.failures.join(" · ")} Hãy mở Cá nhân → Tài khoản lớp để thử lại.</p>}
    <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void copy()} disabled={result.accounts.length === 0}>Sao chép thông tin đăng nhập</Button>
    {copied && <p className="mt-2 text-xs font-medium text-emerald-800">Đã sao chép. Lưu thông tin trước khi rời trang.</p>}
  </div>;
}
