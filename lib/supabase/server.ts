// =====================================================================
// Supabase client for use inside Server Components, Route Handlers and
// Server Actions. Reads/writes the auth cookie so `auth.uid()` resolves
// correctly inside RLS policies on the server too.
// =====================================================================
import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component with no request context to
            // write to — safe to ignore because middleware refreshes
            // the session cookie on every request anyway.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // See note above.
          }
        },
      },
    }
  );
}

/**
 * Service-role client — ONLY for trusted server code that must bypass RLS,
 * e.g. the teacher's "create shared parent/student login" admin action.
 * NEVER import this into a Client Component or expose the key to the browser.
 */
export function createAdminClient() {
  // Deliberately import lazily so the service key never even loads unless
  // this function is actually called from server-only code.
  const { createClient: createSupabaseClient } = require("@supabase/supabase-js");
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
