// =====================================================================
// /dashboard — Server Component entry point.
// Confirms the user is signed in and loads their profile, then hands off
// to <DashboardShell>, which does all the interactive data-fetching and
// rendering on the client (charts, live comments, OCR scanner).
// =====================================================================
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (!profile) {
    // Signed in with Supabase Auth but the profiles row hasn't been
    // created yet (trigger race, or a login created outside the normal
    // signup flow) — safest is to bounce back to login rather than
    // render a dashboard with no role.
    redirect("/login");
  }

  return <DashboardShell profile={profile} />;
}
