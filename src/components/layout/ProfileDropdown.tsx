"use client";

import { useEffect, useState, useRef, useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/providers/AuthProvider";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { useNetworkStore } from "@/lib/store/useNetworkStore";
import { getDeviceLabel } from "@/lib/supabase/auth";
import { clearPinSession, isTauriDesktop } from "@/lib/pin-auth";

const THEME_STORAGE_KEY = "theme";

function persistTheme(next: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch { /* noop */ }
}

function InitialsBadge({ email, isOwner }: { email: string; isOwner: boolean }) {
  const initials = email
    .split("@")[0]
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span
      className={`h-8 w-8 rounded-lg flex items-center justify-center text-caption font-mono font-bold border transition-colors ${
        isOwner
          ? "bg-red-500/15 border-red-500/30 text-red-400"
          : "bg-crimson-primary/15 border-crimson-primary/30 text-crimson-primary"
      }`}
    >
      {initials}
    </span>
  );
}

export default function ProfileDropdown() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, user, signOut } = useAuth();
  const nodeId = useDeviceStore((s) => s.nodeId);
  const isOnline = useNetworkStore((s) => s.isOnline);
  const { theme, resolvedTheme, setTheme } = useTheme();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const isDark = mounted && (theme === "dark" || (!theme && resolvedTheme === "dark"));
  const isOwner = profile?.role === "OWNER";
  const email = profile?.email ?? user?.email ?? "Signed-in user";
  const deviceLabel = profile ? getDeviceLabel(profile) : email.split("@")[0].toUpperCase();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleToggleTheme = useCallback(() => {
    const next = isDark ? "light" : "dark";
    persistTheme(next);
    setTheme(next);
  }, [isDark, setTheme]);

  const handleSignOut = useCallback(async () => {
    setOpen(false);
    queryClient.clear();
    await signOut();
    router.push("/login");
  }, [queryClient, signOut, router]);

  const handleLockTerminal = useCallback(() => {
    setOpen(false);
    clearPinSession();
    window.location.reload();
  }, []);

  if (!profile && !user) return null;

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${
          isOwner
            ? "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15"
            : "bg-[var(--badge-bg)] border-[var(--badge-border)] text-[var(--badge-text)] hover:bg-[var(--badge-bg)]/80"
        }`}
      >
        <InitialsBadge email={email} isOwner={isOwner} />
        <span className="text-caption font-mono font-medium hidden sm:inline">
          {isOwner ? "OWNER (REMOTE)" : `WEB-NODE: ${deviceLabel}`}
        </span>
        <span className="text-caption font-mono font-medium sm:hidden">
          {isOwner ? "OWNER" : deviceLabel.split(" ").pop()}
        </span>
        <svg
          className={`h-3 w-3 opacity-50 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 glass-card border border-border-default rounded-xl shadow-2xl w-64 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="text-body font-mono font-medium text-foreground truncate">
              {email}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  isOwner
                    ? "bg-red-500/15 text-red-400 border border-red-500/20"
                    : "bg-crimson-primary/15 text-crimson-primary border border-crimson-primary/20"
                }`}
              >
                {isOwner ? "OWNER" : profile ? "TERMINAL" : "SESSION"}
              </span>
              {isOwner && (
                <span className="text-[10px] font-mono text-muted">REMOTE ACCESS</span>
              )}
            </div>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={handleToggleTheme}
            className="w-full text-left px-4 py-2.5 text-body hover:bg-bg-subtle transition-colors flex items-center gap-3"
          >
            <span className="h-7 w-7 rounded-lg flex items-center justify-center bg-bg-muted border border-border-default">
              {isDark ? (
                <svg className="h-3.5 w-3.5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </span>
            <div className="flex-1">
              <p className="text-body text-foreground">Theme</p>
              <p className="text-[10px] text-muted font-mono">
                {isDark ? "Dark Mode" : "Light Mode"}
              </p>
            </div>
            <span className="text-[10px] font-mono text-muted px-1.5 py-0.5 rounded bg-bg-muted border border-border-default">
              {isDark ? "DARK" : "LIGHT"}
            </span>
          </button>

          {/* Device Info */}
          <div className="px-4 py-2.5 border-t border-border-subtle">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className="text-caption font-mono text-foreground">{nodeId}</p>
                  <p className="text-[10px] text-muted font-mono">
                    {profile?.device_name ?? "No device assigned"}
                  </p>
                </div>
              </div>
              <span
                className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
                  isOnline
                    ? "text-status-optimal border-status-optimal/30 bg-status-optimal/10"
                    : "text-status-alert border-status-alert/30 bg-status-alert/10"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isOnline ? "bg-status-optimal" : "bg-status-alert"
                  }`}
                />
                {isOnline ? "LIVE" : "OFFLINE"}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-border-subtle">
            {!isTauriDesktop() && (
              <button
                onClick={handleLockTerminal}
                className="w-full text-left px-4 py-2.5 text-body text-amber-500 hover:bg-amber-500/10 transition-colors flex items-center gap-3"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                Lock Terminal (PIN)
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2.5 text-body text-status-alert hover:bg-status-alert/10 transition-colors flex items-center gap-3"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
