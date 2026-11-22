"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export interface TeachingWeek {
  id: string;
  number: number;
  startAt: string;
  endAt: string;
  isCurrent: boolean;
  locked: boolean;
}

/** Starter schedule through the current week: Week 4 is current; teachers decide when to close weeks. */
export function createTeachingWeeks(referenceDate = new Date()): TeachingWeek[] {
  const currentMonday = new Date(referenceDate);
  currentMonday.setHours(0, 0, 0, 0);
  currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7));

  // The current school week is Week 4 in this starter data. Only show the
  // weeks that have happened so far; a new week can be added as the term moves on.
  return Array.from({ length: 4 }, (_, index) => {
    const offset = index - 3;
    const start = new Date(currentMonday);
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const weekNumber = index + 1;
    return {
      id: `mock-week-${weekNumber}-${start.toISOString().slice(0, 10)}`,
      number: weekNumber,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      isCurrent: index === 3,
      locked: false,
    };
  });
}

export function formatWeekRange(week: TeachingWeek) {
  const start = new Date(week.startAt);
  const end = new Date(new Date(week.endAt).getTime() - 1);
  const format = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" });
  return `${format.format(start)} – ${format.format(end)}`;
}

export function WeekSelector({
  weeks,
  selectedWeek,
  onSelect,
  onReturnToCurrent,
}: {
  weeks: TeachingWeek[];
  selectedWeek: TeachingWeek;
  onSelect: (week: TeachingWeek) => void;
  onReturnToCurrent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentWeek = weeks.find((week) => week.isCurrent) ?? weeks[0];

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      // The mobile sheet is rendered in a portal outside selectorRef; its own
      // backdrop handler closes it, so don't treat taps inside the sheet as outside.
      if (window.matchMedia("(max-width: 767px)").matches) return;
      if (event.target instanceof Node && !selectorRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      if (isMobile) document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  function choose(week: TeachingWeek) {
    onSelect(week);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const weekChoices = () => (
    <>
      <div className="space-y-1">
        {weeks.map((week) => {
          const active = selectedWeek.id === week.id;
          return (
            <button
              key={week.id}
              type="button"
              onClick={() => choose(week)}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-left transition ${active ? "bg-[#E7B93F]/[0.09] text-[#F3D783]" : "text-white/70 hover:bg-white/[0.05] hover:text-white"}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border font-mono text-[10px] ${active ? "border-[#E7B93F]/30 bg-[#E7B93F]/[0.08] text-[#E7B93F]" : "border-white/10 bg-white/[0.03] text-white/40"}`}>{String(week.number).padStart(2, "0")}</span>
                <span>
                  <span className={`block font-sans text-sm ${active ? "font-semibold" : "font-medium"}`}>Tuần {week.number}{week.isCurrent ? <span className="ml-2 text-[10px] font-normal text-emerald-200/70">Hiện tại</span> : null}</span>
                  <span className="mt-0.5 block font-sans text-[10px] text-white/35">{formatWeekRange(week)}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {week.locked && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 font-sans text-[9px] uppercase tracking-wider text-white/40">Đã khóa</span>}
                {active && <span className="font-sans text-base font-bold text-[#E7B93F]" aria-label="Tuần đang chọn">✓</span>}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={!currentWeek}
        onClick={() => { onReturnToCurrent(); setOpen(false); }}
        className="mt-3 min-h-11 w-full rounded-lg border border-[#E7B93F]/20 bg-[#E7B93F]/[0.06] px-3 font-sans text-xs font-medium text-[#E7B93F] transition hover:bg-[#E7B93F]/[0.12]"
      >
        ↩ Trở về tuần hiện tại
      </button>
    </>
  );

  return (
    <>
      <div ref={selectorRef} className="relative z-30">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="teaching-week-desktop-menu"
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-[54px] w-full items-center justify-between gap-4 rounded-xl border border-[#E7B93F]/25 bg-black/35 px-4 text-left shadow-lg md:backdrop-blur-xl transition hover:border-[#E7B93F]/45 hover:bg-black/45"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#E7B93F]/20 bg-[#E7B93F]/[0.07] text-base text-[#E7B93F]" aria-hidden="true">📅</span>
            <span className="min-w-0">
              <span className="block font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Đang chấm điểm</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 font-sans text-sm font-semibold text-white">
                Tuần {selectedWeek.number}
                <span className="text-[10px] font-normal text-white/35">{formatWeekRange(selectedWeek)}</span>
                {selectedWeek.locked && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-normal uppercase tracking-wider text-white/40">Đã khóa</span>}
              </span>
            </span>
          </span>
          <svg className={`h-4 w-4 shrink-0 text-[#E7B93F]/70 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              id="teaching-week-desktop-menu"
              role="dialog"
              aria-label="Chọn tuần giảng dạy"
              initial={{ opacity: 0, y: -8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ duration: 0.18 }}
              className="absolute left-0 right-0 top-[calc(100%+8px)] hidden max-h-[min(70vh,520px)] overflow-y-auto rounded-xl border border-white/10 bg-[#111411]/95 p-2 shadow-2xl backdrop-blur-2xl md:block"
            >
              {weekChoices()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[100] bg-black/60 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Chọn tuần giảng dạy"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="simple-week-dialog absolute bottom-0 left-0 right-0 max-h-[82dvh] touch-pan-y overscroll-contain overflow-y-auto rounded-t-2xl border border-slate-200 bg-white px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 shadow-sm"
              >
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-sans text-base font-semibold text-white">Chọn tuần giảng dạy</h3>
                  <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-lg text-xl text-white/50 hover:bg-white/[0.06]" aria-label="Đóng">×</button>
                </div>
                {weekChoices()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
