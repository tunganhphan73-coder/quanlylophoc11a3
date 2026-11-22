"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { EffectiveRole } from "@/lib/auth/roles";

export interface StudentChoice {
  id: string;
  full_name: string;
  student_number: number;
  match_score?: number;
}

interface StudentLookupProps {
  classId: string;
  role: EffectiveRole;
  value: StudentChoice | null;
  onChange: (student: StudentChoice | null) => void;
  label?: string;
  disabled?: boolean;
}

export function StudentLookup({ classId, role, value, onChange, label = "Tìm học sinh trong lớp", disabled = false }: StudentLookupProps) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState(value?.full_name ?? "");
  const [results, setResults] = useState<StudentChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value?.full_name ?? "");
  }, [value?.id, value?.full_name]);

  useEffect(() => {
    if (!classId || value) return;
    let active = true;
    try {
      const savedId = window.localStorage.getItem(`last-student:${classId}`);
      if (savedId) {
        void supabase.from("students")
          .select("id, full_name, student_number")
          .eq("class_id", classId)
          .eq("id", savedId)
          .maybeSingle()
          .then(({ data }) => {
            if (active && data) onChange(data as StudentChoice);
          });
      }
    } catch {
      // Search remains available when browser storage is blocked.
    }
    return () => { active = false; };
  }, [classId, onChange, supabase, value]);

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2 || value?.full_name === search) {
      setResults([]);
      setBusy(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      const { data, error: searchError } = await supabase.rpc("search_students_for_entry", {
        p_class_id: classId,
        p_query: search,
      });
      if (!active) return;
      setBusy(false);
      if (searchError) {
        setResults([]);
        setError("Không tìm được học sinh. Kiểm tra migration tìm kiếm và thử lại.");
        return;
      }
      const rows = (data ?? []) as Array<{ student_id: string; full_name: string; student_number: number; match_score?: number }>;
      setResults(rows.map((row) => ({ id: row.student_id, full_name: row.full_name, student_number: row.student_number, match_score: row.match_score })));
      setOpen(true);
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [classId, query, role, supabase, value?.full_name]);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function selectStudent(student: StudentChoice) {
    onChange(student);
    setQuery(student.full_name);
    setResults([]);
    setOpen(false);
    setError(null);
    try {
      window.localStorage.setItem(`last-student:${classId}`, student.id);
    } catch {
      // Selection still applies for this session.
    }
  }

  function clearSelection() {
    onChange(null);
    setQuery("");
    setResults([]);
    setOpen(false);
    try {
      window.localStorage.removeItem(`last-student:${classId}`);
    } catch {
      // The user can still select another student.
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label className="mb-1.5 block text-xs font-semibold text-slate-700" htmlFor={`student-search-${classId}`}>
        {label}
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 shadow-sm transition focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-200">
        <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <input
          id={`student-search-${classId}`}
          value={query}
          disabled={disabled}
          autoComplete="off"
          aria-expanded={open && results.length > 0}
          aria-controls={`student-results-${classId}`}
          onFocus={() => { if (results.length) setOpen(true); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          placeholder="Nhập tên, không cần dấu…"
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-900 outline-none placeholder:text-slate-500 disabled:opacity-60"
        />
        {busy && <span className="text-xs text-slate-500" role="status">Đang tìm…</span>}
        {value && !disabled && (
          <button type="button" onClick={clearSelection} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Bỏ chọn học sinh">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      {open && results.length > 0 && (
        <ul id={`student-results-${classId}`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {results.slice(0, 10).map((student) => (
            <li key={student.id}>
              <button
                type="button"
                role="option"
                aria-selected={student.id === value?.id}
                onClick={() => selectStudent(student)}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-700">{student.student_number}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{student.full_name}</span>
                {student.id === value?.id && <Check className="h-4 w-4 text-blue-700" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && !busy && !error && results.length === 0 && (
        <p className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 shadow-xl">Không tìm thấy học sinh trong lớp này.</p>
      )}
    </div>
  );
}
