"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import RouteLoadingSkeleton from "./RouteLoadingSkeleton";

/**
 * Client-side route guard — replacement for the old `src/middleware.ts`.
 *
 * Static exports (`output: "export"`, used for the Tauri desktop build) cannot
 * run middleware/proxy: there is no Node server in the shipped app, so the
 * request-time redirect never happens. This component reproduces the same rules
 * in the browser, where the auth state actually lives (`AuthProvider`).
 *
 * Rules (same as the deleted middleware):
 * - unauthenticated on a protected route → replace with `/login?redirect=<path>`
 * - never render protected children while signed out (skeleton instead)
 * - authenticated state is resolved before rendering, so there is no flash of
 *   the login page for users who already have a session
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    const from = pathname && pathname !== "/" ? pathname : "";
    router.replace(from ? `/login?redirect=${encodeURIComponent(from)}` : "/login");
  }, [loading, user, pathname, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <RouteLoadingSkeleton />
      </div>
    );
  }

  return <>{children}</>;
}
