"use client";

import React, { useEffect, useState } from "react";
import { isPinAuthenticated, isTauriDesktop } from "@/lib/pin-auth";
import PinGateModal from "@/components/pin/PinGateModal";

export default function WebPinGuard({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      // If running inside desktop Tauri POS, instantly allow without prompting
      if (isTauriDesktop()) {
        if (mounted) setAuthorized(true);
        return;
      }

      const isAuthed = await isPinAuthenticated();
      if (mounted) {
        setAuthorized(isAuthed);
      }
    }

    checkAuth();

    // Listen for storage events (e.g. if unlocked in another tab or logged out)
    const onStorageChange = () => {
      checkAuth();
    };

    window.addEventListener("storage", onStorageChange);
    return () => {
      mounted = false;
      window.removeEventListener("storage", onStorageChange);
    };
  }, []);

  // During initial mount hydration tick, render children or empty to avoid layout flash
  if (authorized === null) {
    return (
      <div className="min-h-screen bg-[#06080c] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
          <span className="text-xs font-mono text-neutral-400">Verifying Hardware & Security Gate...</span>
        </div>
      </div>
    );
  }

  // If on web and not PIN-authorized, display full-screen PIN Gate blocking login and records
  if (!authorized) {
    return (
      <>
        <PinGateModal
          onSuccess={() => {
            setAuthorized(true);
          }}
        />
        {/* Render placeholder behind blur to avoid content leakage */}
        <div className="min-h-screen bg-[#06080c] filter blur-xl pointer-events-none select-none" />
      </>
    );
  }

  // Authorized: render the app normally
  return <>{children}</>;
}
