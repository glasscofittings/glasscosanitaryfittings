"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useModuleVisibility } from "@/components/providers/ModuleVisibilityContext";
import { SIDEBAR_MODULES } from "@/types/settings";
import RouteLoadingSkeleton from "./RouteLoadingSkeleton";

/**
 * Client-side route guard — replacement for the old `src/middleware.ts`.
 *
 * Static exports (`output: "export"`, used for the Tauri desktop build) cannot
 * run middleware/proxy: there is no Node server in the shipped app, so the
 * request-time redirect never happens. This component reproduces the same rules
 * in the browser, where the auth state actually lives (`AuthProvider`).
 *
 * Rules:
 * - unauthenticated on a protected route → replace with `/login?redirect=<path>`
 * - never render protected children while signed out (skeleton instead)
 * - authenticated but visiting a disabled module route → replace with
 *   `/dashboard/?blocked=<label>` so a toast can explain why
 * - auth AND module visibility both hydrate before any protected page renders
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isModuleVisible, hydrated: modulesHydrated } = useModuleVisibility();
  const router = useRouter();
  const pathname = usePathname();

  /* ── 1. Auth check ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (authLoading || user) return;
    const from = pathname && pathname !== "/" ? pathname : "";
    router.replace(from ? `/login?redirect=${encodeURIComponent(from)}` : "/login");
  }, [authLoading, user, pathname, router]);

  /* ── 2. Module access check ─────────────────────────────────────────── */
  useEffect(() => {
    // Only run once auth and module hydration are both complete and user is logged in.
    if (authLoading || !user || !modulesHydrated) return;

    const normalized =
      pathname === "/" ? "/" : pathname.endsWith("/") ? pathname : pathname + "/";

    // Longest-match wins: /invoicing/receipts/ beats /invoicing/
    const matchedModule = SIDEBAR_MODULES.filter(
      (m) => m.key !== "settings" && m.key !== "dashboard" && normalized.startsWith(m.href)
    ).sort((a, b) => b.href.length - a.href.length)[0];

    if (matchedModule && !isModuleVisible(matchedModule.key)) {
      router.replace(
        `/dashboard/?blocked=${encodeURIComponent(matchedModule.label)}`
      );
    }
  }, [authLoading, user, modulesHydrated, pathname, isModuleVisible, router]);

  /* ── Skeleton while loading / unauthenticated ───────────────────────── */
  if (authLoading || !user) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <RouteLoadingSkeleton />
      </div>
    );
  }

  // Hold skeleton until module visibility has hydrated to prevent a flash of
  // a disabled module's content before the redirect fires.
  if (!modulesHydrated) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <RouteLoadingSkeleton />
      </div>
    );
  }

  return <>{children}</>;
}
