"use client";

// =====================================================================
// AI Smart Scanner. Teachers/admins have two modes; BCS can scan logbooks only:
//   1. "roster"  — photo of a printed class list -> bulk-insert students
//   2. "logbook" — photo of a handwritten logbook page -> point_logs,
//                  using the class's custom_speaking_point multiplier
//
// Flow for both modes: pick photo -> call /api/ocr -> show an EDITABLE
// review table (OCR on handwriting is never perfect) -> the user confirms
// -> we write to Supabase. Nothing is saved before the teacher reviews it.
// =====================================================================
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EffectiveRole } from "@/lib/auth/roles";
import {
  buildPointLogsFromLogbook,
  calculateLogbookPoints,
  findBestStudentNameMatch,
  normalizeName,
} from "@/lib/score-calculator";
import type { ClassRow, Gender, OcrLogbookEntry, Student } from "@/lib/types";

type Mode = "roster" | "logbook";
type OcrProvider = "auto" | "gemini" | "groq";

interface ScannerPanelProps {
  classRow: ClassRow;
  students: Student[];
  role: EffectiveRole;
  onDataChanged: (backgroundRefresh?: boolean) => void;
}

interface RosterDraftRow {
  full_name: string;
  gender: Gender;
  team_number: number;
}

export function ScannerPanel({ classRow, students, role, onDataChanged }: ScannerPanelProps) {
  const supabase = createClient();
  const isBcs = role === "bcs";
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("logbook");
  const [provider, setProvider] = useState<OcrProvider>("auto");
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [enteredByName, setEnteredByName] = useState("");

  const [rosterDraft, setRosterDraft] = useState<RosterDraftRow[] | null>(null);
  const [logbookDraft, setLogbookDraft] = useState<OcrLogbookEntry[] | null>(null);

  const nameToStudentId = Object.fromEntries(students.map((s) => [normalizeName(s.full_name), s.id]));

  function resetDrafts() {
    setRosterDraft(null);
    setLogbookDraft(null);
    setErrorMessage(null);
  }

  async function handleFileSelected(file: File) {
    resetDrafts();
    setIsScanning(true);

    try {
      const { base64, mimeType } = await fileToBase64(file);
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, provider, imageBase64: base64, mimeType }),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.error ?? "Quét ảnh thất bại.");

      if (mode === "roster") {
        setRosterDraft((result.students ?? []).map((student: { full_name: string; gender: Gender }) => ({ ...student, team_number: 1 })));
      } else {
        setLogbookDraft(result.entries ?? []);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Có lỗi xảy ra khi quét ảnh.");
    } finally {
      setIsScanning(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (libraryInputRef.current) libraryInputRef.current.value = "";
    }
  }

  async function saveRoster() {
    if (!rosterDraft || rosterDraft.length === 0) return;
    setIsSaving(true);

    const rows = rosterDraft
      .filter((r) => r.full_name.trim().length > 0)
      .map((r) => ({ class_id: classRow.id, full_name: r.full_name.trim(), gender: r.gender, team_number: r.team_number }));

    try {
      const { error } = await supabase.from("students").insert(rows);
      if (error) throw error;
      resetDrafts();
      onDataChanged(true);
    } catch {
      setErrorMessage("Không thể lưu danh sách học sinh.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveLogbook() {
    if (!logbookDraft || logbookDraft.length === 0) return;
    if (isBcs && !enteredByName.trim()) {
      setErrorMessage("Ban cán sự cần nhập tên người đang ghi.");
      return;
    }
    setIsSaving(true);

    const unresolvedNames = logbookDraft
      .filter((entry) => !findBestStudentNameMatch(entry.student_name, students))
      .map((entry) => entry.student_name);
    if (unresolvedNames.length > 0) {
      setErrorMessage(`Chưa ghép được tên: ${unresolvedNames.join(", ")}. Hãy sửa các tên này trước khi lưu.`);
      setIsSaving(false);
      return;
    }

    const matchedEntries = logbookDraft.map((entry) => {
      const match = findBestStudentNameMatch(entry.student_name, students);
      return match ? { ...entry, student_name: match.student.full_name } : entry;
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setErrorMessage("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      setIsSaving(false);
      return;
    }

    const rows = buildPointLogsFromLogbook(matchedEntries, classRow.custom_speaking_point, nameToStudentId, user.id)
      .map((row) => isBcs ? { ...row, reason: `${row.reason} · BCS ghi: ${enteredByName.trim()}` } : row);

    if (rows.length === 0) {
      setErrorMessage("Không khớp được tên nào với danh sách học sinh hiện có. Hãy kiểm tra lại tên.");
      setIsSaving(false);
      return;
    }

    try {
      const { error } = await supabase.from("point_logs").insert(rows);
      if (error) throw error;
      resetDrafts();
      onDataChanged(true);
    } catch {
      setErrorMessage("Không thể lưu điểm.");
    } finally {
      setIsSaving(false);
    }
  }

  const unmatchedNames =
    logbookDraft
      ?.filter((entry) => !findBestStudentNameMatch(entry.student_name, students))
      .map((entry) => entry.student_name) ?? [];

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-5 md:backdrop-blur-md">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-serif text-lg text-white">Công cụ quét ảnh bằng AI</h3>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Chọn AI quét ảnh"
            value={provider}
            onChange={(event) => setProvider(event.target.value as OcrProvider)}
            className="min-h-10 rounded-lg border border-[#E7B93F]/25 bg-[#111714] px-3 font-sans text-xs text-white outline-none focus:border-[#E7B93F]/60"
          >
            <option value="auto">Tự động (Groq ↔ Gemini)</option>
            <option value="groq">Groq (gói miễn phí)</option>
            <option value="gemini">Gemini</option>
          </select>
          {!isBcs && <div className="flex gap-1 rounded-lg bg-white/[0.05] p-1">
            {(["logbook", "roster"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  resetDrafts();
                }}
                className={`min-h-9 rounded-md px-2.5 py-1.5 font-sans text-[11px] transition sm:px-3 sm:text-xs ${
                  mode === m ? "bg-[#E3B23C] text-[#0D1512]" : "text-white/60 hover:text-white"
                }`}
              >
                {m === "logbook" ? "Sổ liên lạc" : "Danh sách lớp"}
              </button>
            ))}
          </div>}
        </div>
      </div>

      <p className="mb-4 font-sans text-sm text-white/60">
        {mode === "logbook"
          ? "Chụp ảnh trang sổ liên lạc hoặc sổ ghi điểm phát biểu viết tay. AI sẽ đếm số lần phát biểu và tự tính điểm theo hệ số của lớp."
          : "Chụp ảnh danh sách lớp in sẵn. AI sẽ trích xuất họ tên để thêm nhanh vào lớp."}
      </p>

      {isBcs && <label className="mb-3 block max-w-sm font-sans text-sm font-medium text-white">
        Tên thành viên BCS đang nhập
        <Input value={enteredByName} onChange={(event) => setEnteredByName(event.target.value)} maxLength={80} className="mt-1 min-h-11" placeholder="Nhập họ tên của bạn" />
      </label>}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => event.target.files?.[0] && handleFileSelected(event.target.files[0])}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => event.target.files?.[0] && handleFileSelected(event.target.files[0])}
      />
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button
          className="min-h-12 w-full sm:w-auto"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isScanning}
        >
          {isScanning ? "Đang quét ảnh..." : "📷 Chụp ảnh"}
        </Button>
        <Button
          variant="outline"
          className="min-h-12 w-full sm:w-auto"
          onClick={() => libraryInputRef.current?.click()}
          disabled={isScanning}
        >
          🖼️ Chọn từ thư viện
        </Button>
      </div>

      {errorMessage && <p className="mt-3 font-sans text-sm text-red-400">{errorMessage}</p>}

      {/* --- Roster review table ------------------------------------------------ */}
      {rosterDraft && (
        <div className="mt-5">
          <h4 className="mb-2 font-sans text-sm font-semibold text-white">
            Kiểm tra trước khi lưu ({rosterDraft.length} học sinh)
          </h4>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {rosterDraft.map((row, i) => (
              <div key={i} className="ocr-roster-row grid gap-2 sm:flex sm:flex-row">
                <Input
                  value={row.full_name}
                  onChange={(e) =>
                    setRosterDraft((prev) =>
                      prev ? prev.map((r, idx) => (idx === i ? { ...r, full_name: e.target.value } : r)) : prev
                    )
                  }
                  className="min-h-11 w-full flex-1"
                />
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <select
                    aria-label={`Giới tính của ${row.full_name || `học sinh ${i + 1}`}`}
                    value={row.gender ?? ""}
                    onChange={(e) =>
                      setRosterDraft((prev) =>
                        prev
                          ? prev.map((r, idx) =>
                              idx === i ? { ...r, gender: (e.target.value || null) as Gender } : r
                            )
                          : prev
                      )
                    }
                    className="min-h-11 w-full rounded-md border border-white/15 bg-[#111714] px-3 text-sm text-white sm:w-auto"
                  >
                    <option value="">Giới tính</option>
                    <option value="male">Nam</option>
                    <option value="female">Nữ</option>
                    <option value="other">Khác</option>
                  </select>
                  <select
                    aria-label={`Tổ của ${row.full_name || `học sinh ${i + 1}`}`}
                    value={row.team_number}
                    onChange={(e) =>
                      setRosterDraft((prev) =>
                        prev ? prev.map((r, idx) => idx === i ? { ...r, team_number: Number(e.target.value) } : r) : prev
                      )
                    }
                    className="min-h-11 w-full rounded-md border border-[#E7B93F]/20 bg-[#111714] px-3 text-sm text-[#F3D783] sm:w-auto"
                  >
                    {Array.from({ length: 12 }, (_, teamIndex) => teamIndex + 1).map((teamNumber) => (
                      <option key={teamNumber} value={teamNumber} className="bg-[#111714] text-white">Tổ {teamNumber}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <Button className="mt-3" disabled={isSaving} onClick={saveRoster}>
            {isSaving ? "Đang lưu..." : `Lưu ${rosterDraft.length} học sinh vào lớp`}
          </Button>
        </div>
      )}

      {/* --- Logbook review table ------------------------------------------------ */}
      {logbookDraft && (
        <div className="mt-5">
          <h4 className="mb-2 font-sans text-sm font-semibold text-white">
            Kiểm tra trước khi lưu ({logbookDraft.length} dòng)
          </h4>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {logbookDraft.map((entry, i) => {
              const match = findBestStudentNameMatch(entry.student_name, students);
              const isUnmatched = !match;
              const computed = calculateLogbookPoints(entry, classRow.custom_speaking_point);
              return (
                <div
                  key={i}
                  className={`ocr-logbook-row grid grid-cols-1 items-center gap-2 rounded-md p-2 sm:grid-cols-[1.5fr_1fr_1fr_1fr] ${
                    isUnmatched ? "bg-red-500/10" : "bg-white/[0.03]"
                  }`}
                >
                  <div className="min-w-0">
                    <Input
                      value={entry.student_name}
                      onChange={(e) =>
                        setLogbookDraft((prev) =>
                          prev ? prev.map((r, idx) => (idx === i ? { ...r, student_name: e.target.value } : r)) : prev
                        )
                      }
                    />
                    {match && (
                      <p className="mt-1 truncate font-sans text-xs text-emerald-400">
                        Ghép với: {match.student.full_name}
                      </p>
                    )}
                  </div>
                  <Input
                    type="number"
                    value={entry.times_spoken}
                    onChange={(e) =>
                      setLogbookDraft((prev) =>
                        prev
                          ? prev.map((r, idx) =>
                              idx === i ? { ...r, times_spoken: Number(e.target.value) } : r
                            )
                          : prev
                      )
                    }
                  />
                  <Input
                    type="number"
                    step="0.5"
                    value={entry.bonus_points}
                    onChange={(e) =>
                      setLogbookDraft((prev) =>
                        prev
                          ? prev.map((r, idx) =>
                              idx === i ? { ...r, bonus_points: Number(e.target.value) } : r
                            )
                          : prev
                      )
                    }
                  />
                  <span className="text-center font-serif text-sm text-[#E3B23C]">= {computed} đ</span>
                </div>
              );
            })}
          </div>

          {unmatchedNames.length > 0 && (
            <p className="mt-2 font-sans text-xs text-red-400">
              ⚠ Chưa tìm được học sinh đủ giống với tên: {unmatchedNames.join(", ")} — hãy sửa tên để ghép với danh sách lớp.
            </p>
          )}

          <Button className="mt-3" disabled={isSaving} onClick={saveLogbook}>
            {isSaving ? "Đang lưu..." : "Lưu điểm vào hệ thống"}
          </Button>
        </div>
      )}
    </div>
  );
}

const MAX_OCR_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Resize/compress phone photos below Vercel's request-body limit. */
async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  if (file.size > 25 * 1024 * 1024) throw new Error("Ảnh vượt quá 25 MB. Hãy chọn ảnh nhỏ hơn.");

  let uploadFile = file;
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      let maxSide = 2200;
      let quality = 0.86;
      let compressed: Blob | null = null;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Trình duyệt không thể xử lý ảnh này.");

        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (compressed && compressed.size <= MAX_OCR_UPLOAD_BYTES) break;

        if (attempt % 3 === 2) {
          maxSide = Math.round(maxSide * 0.82);
          quality = 0.82;
        } else {
          quality = Math.max(0.55, quality - 0.1);
        }
      }
      if (!compressed || compressed.size > MAX_OCR_UPLOAD_BYTES) {
        throw new Error("Ảnh vẫn quá lớn sau khi nén. Hãy cắt ảnh gọn hơn rồi thử lại.");
      }
      uploadFile = new File([compressed], "scan.jpg", { type: "image/jpeg" });
    } catch {
      // If decoding is unavailable, small supported images may still upload as-is.
      if (file.size > MAX_OCR_UPLOAD_BYTES) {
        throw new Error("Không thể nén ảnh này trên trình duyệt. Hãy chọn ảnh JPEG/PNG nhỏ hơn 3 MB.");
      }
    } finally {
      bitmap?.close();
    }
  }

  if (uploadFile.size > MAX_OCR_UPLOAD_BYTES) {
    throw new Error("Ảnh sau khi nén vẫn vượt giới hạn 3 MB. Hãy cắt ảnh gọn hơn rồi thử lại.");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? result;
      resolve({ base64, mimeType: uploadFile.type || "image/jpeg" });
    };
    reader.onerror = () => reject(new Error("Không đọc được ảnh. Hãy thử chọn ảnh khác."));
    reader.readAsDataURL(uploadFile);
  });
}
