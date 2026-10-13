import { createClient } from "@/lib/supabase/client";

export type UserRole = "OWNER" | "TERMINAL";

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  device_name: string | null;
  created_at: string;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error || !data) {
    console.error("Supabase Error [profiles]:", error?.message ?? "no row returned", { userId });
    return null;
  }
  return data as Profile;
}

/**
 * Creates the caller's missing profiles row server-side (SECURITY DEFINER RPC;
 * role is derived from auth.users, never from the client) and returns it.
 * See supabase/fix_profiles_owner.sql.
 */
export async function ensureMyProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("ensure_my_profile");
  if (error) {
    console.error("Supabase Error [ensure_my_profile]:", error.message);
    return null;
  }
  return (data as Profile | null) ?? null;
}

export async function upsertProfile(profile: {
  id: string;
  email: string;
  role?: UserRole;
  device_name?: string;
}): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: profile.id,
        email: profile.email,
        role: profile.role ?? "TERMINAL",
        device_name: profile.device_name ?? null,
      },
      { onConflict: "id" }
    )
    .select()
    .single();
  if (error) {
    console.error("Supabase Error [upsertProfile]:", error);
    return null;
  }
  return data as Profile;
}

export function isOwner(profile: Profile | null): boolean {
  return profile?.role === "OWNER";
}

export function isTerminal(profile: Profile | null): boolean {
  return profile?.role === "TERMINAL";
}

export function getDeviceLabel(profile: Profile | null): string {
  if (!profile) return "UNKNOWN";
  if (profile.role === "OWNER") return "OWNER (REMOTE)";
  return profile.device_name ?? "WEB-NODE";
}
