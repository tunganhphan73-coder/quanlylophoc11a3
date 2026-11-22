"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ClassRow } from "@/lib/types";

type AccountRole = "parent" | "student" | "bcs";
const ROLE_LABEL: Record<AccountRole, string> = { parent: "phụ huynh", student: "học sinh", bcs: "ban cán sự" };
interface Credentials {
  email: string;
  password: string;
  role: AccountRole;
  className: string;
  action?: "create" | "reset";
}

export function ClassAccountsManager({ classRow }: { classRow: ClassRow }) {
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function manageAccount(role: AccountRole, action: "create" | "reset") {
    const key = `${action}:${role}`;
    setBusyRole(key);
    setCredentials(null);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/teacher/class-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: classRow.id, role, action }),
      });
      const result = (await response.json()) as Credentials & { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể tạo tài khoản.");
      setCredentials({ ...result, action });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo tài khoản.");
    } finally {
      setBusyRole(null);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(`Tài khoản: ${credentials.email}\nMật khẩu: ${credentials.password}`);
      setMessage("Đã sao chép thông tin đăng nhập.");
    } catch {
      setMessage("Không sao chép tự động được. Bạn hãy chọn và chép thông tin bên trên.");
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/40 p-5 md:backdrop-blur-md md:p-6">
      <h2 className="font-serif text-xl text-white">Tài khoản dùng chung của lớp</h2>
      <p className="mt-2 max-w-3xl font-sans text-sm text-white/75">
        Lớp mới tự tạo tài khoản Ban cán sự và học sinh. Tại đây giáo viên có thể tạo tài khoản phụ huynh, tạo lại tài khoản lớp nếu chưa có, hoặc đặt lại mật khẩu. Mật khẩu chỉ hiện một lần sau thao tác; hãy lưu lại.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {(["bcs", "student", "parent"] as AccountRole[]).map((role) => <div key={role} className="flex flex-wrap gap-2">
          <Button disabled={busyRole !== null} onClick={() => manageAccount(role, "create")}>
            {busyRole === `create:${role}` ? "Đang tạo…" : `Tạo tài khoản ${ROLE_LABEL[role]}`}
          </Button>
          <Button variant="outline" disabled={busyRole !== null} onClick={() => manageAccount(role, "reset")}>
            {busyRole === `reset:${role}` ? "Đang đặt lại…" : `Đặt lại mật khẩu ${ROLE_LABEL[role]}`}
          </Button>
        </div>)}
      </div>
      {credentials && (
        <div className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-4 text-sm text-white">
          <p className="mb-2 font-semibold text-emerald-300">
            {credentials.action === "reset" ? "Đã đặt lại mật khẩu" : "Đã tạo tài khoản"} {ROLE_LABEL[credentials.role]} cho {credentials.className}.
          </p>
          <p>Tài khoản: <span className="select-all break-all">{credentials.email}</span></p>
          <p>Mật khẩu: <span className="select-all break-all">{credentials.password}</span></p>
          <p className="mt-2 text-xs text-white/75">Đăng nhập tại trang Đăng nhập, chọn đúng mục {ROLE_LABEL[credentials.role]}.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={copyCredentials}>Sao chép thông tin</Button>
          {message && <p className="mt-2 text-xs text-emerald-200">{message}</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
