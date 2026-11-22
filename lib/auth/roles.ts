import type { UserRole } from "@/lib/types";

export type AccessRole = "bcs" | "admin";
export type EffectiveRole = UserRole | AccessRole;

export interface RoleFields {
  role: UserRole | null | undefined;
  access_role?: AccessRole | null;
}

/** Resolve additive elevated roles without changing the legacy profiles.role value. */
export function getEffectiveRole(profile: RoleFields | null | undefined): EffectiveRole | null {
  if (!profile) return null;
  if (profile.access_role === "bcs" || profile.access_role === "admin") {
    return profile.access_role;
  }
  if (profile.role === "teacher" || profile.role === "parent" || profile.role === "student") {
    return profile.role;
  }
  return null;
}
