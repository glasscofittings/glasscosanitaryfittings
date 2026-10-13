import { createClient } from "@/lib/supabase/client";
import type { ModuleVisibility } from "@/types/settings";

/**
 * Remote mirror of the sidebar layout (Supabase `user_settings` table).
 *
 * localStorage stays the primary store — it loads synchronously before paint.
 * This module is best-effort: if the table has not been migrated yet, or the
 * call fails for any reason, remote sync disables itself for the session and
 * the feature keeps working from localStorage alone.
 *
 * See supabase/migrations/*_create_user_settings.sql for the schema.
 */

/** Session-level triage: stop hitting a table that does not exist yet. */
let remoteAvailable = true;
let missingTableWarned = false;

interface UserSettingsRow {
  user_id: string;
  sidebar_modules: Partial<ModuleVisibility> | null;
  updated_at?: string;
}

function noteMissingTable(): void {
  remoteAvailable = false;
  if (missingTableWarned) return;
  missingTableWarned = true;
  console.info(
    "[user-settings] public.user_settings is not migrated yet — sidebar layout stays in localStorage only. " +
      "Run supabase/migrations/*_create_user_settings.sql to enable cross-device sync."
  );
}

function handleQueryError(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "PGRST205" || /could not find the table/i.test(error.message ?? "")) {
    noteMissingTable();
    return;
  }
  // RLS denial / network / anything else: fail silently, localStorage still holds the truth.
  console.debug("[user-settings] remote sync skipped:", error.message ?? error.code ?? "unknown");
}

/** Reads the stored sidebar layout for a user. `null` = nothing stored / unreachable. */
export async function fetchModuleVisibility(
  userId: string
): Promise<Partial<ModuleVisibility> | null> {
  if (!remoteAvailable || !userId) return null;
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_settings")
      .select("sidebar_modules")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      handleQueryError(error);
      return null;
    }
    const modules = (data as Pick<UserSettingsRow, "sidebar_modules"> | null)?.sidebar_modules;
    return modules && typeof modules === "object" && !Array.isArray(modules) ? modules : null;
  } catch (err) {
    console.debug("[user-settings] fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fire-and-forget mirror of the layout. Returns `false` when remote sync is unavailable. */
export async function saveModuleVisibility(
  userId: string,
  visibility: ModuleVisibility
): Promise<boolean> {
  if (!remoteAvailable || !userId) return false;
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: userId, sidebar_modules: visibility, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) {
      handleQueryError(error);
      return false;
    }
    return true;
  } catch (err) {
    console.debug("[user-settings] save failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
