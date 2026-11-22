"use client";

// =====================================================================
// Supabase client for use inside Client Components ("use client").
// Reads the public anon key — safe to ship to the browser because all
// data access is gated by the RLS policies in supabase/schema.sql.
// =====================================================================
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
