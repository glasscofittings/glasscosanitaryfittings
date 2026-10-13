"use client";

import { useEffect, useState } from "react";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { useNetworkStore } from "@/lib/store/useNetworkStore";
import { useAuth } from "@/components/providers/AuthProvider";
import ProfileDropdown from "@/components/layout/ProfileDropdown";

function LiveClock() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour12: true,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="badge">{time}</span>;
}

function StatusPill() {
  const isOnline = useNetworkStore((s) => s.isOnline);

  return (
    <span
      className={`flex items-center gap-1.5 text-caption font-mono px-2 py-0.5 rounded-full border ${
        isOnline
          ? "text-status-optimal border-status-optimal/30 bg-status-optimal/10"
          : "text-status-alert border-status-alert/30 bg-status-alert/10"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full animate-pulse ${
          isOnline ? "bg-status-optimal" : "bg-status-alert"
        }`}
      />
      {isOnline ? "LIVE" : "OFFLINE"}
    </span>
  );
}

import { Menu, X } from "lucide-react";
import { useSidebar } from "@/components/providers/SidebarContext";

export default function Header() {
  const fetchNodeId = useDeviceStore((s) => s.fetchNodeId);
  const nodeId = useDeviceStore((s) => s.nodeId);
  const { profile, user, loading } = useAuth();
  const { isMobileOpen, toggleMobile } = useSidebar();

  useEffect(() => {
    fetchNodeId();
  }, [fetchNodeId]);

  return (
    <header className="glass-header fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-3 sm:px-6">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Mobile menu toggle */}
        <button
          onClick={toggleMobile}
          aria-label={isMobileOpen ? "Close menu" : "Open menu"}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        >
          {isMobileOpen ? (
            <X className="w-5 h-5 text-crimson-light" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>

        <div className="h-2 w-2 rounded-full bg-crimson-primary animate-pulse" />
        <span className="font-mono text-xs tracking-widest uppercase text-muted truncate max-w-[130px] sm:max-w-none">
          Glassco Sanitary
        </span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3">
        {!loading && (profile || user) && <ProfileDropdown />}
        {loading && (
          <span className="badge font-mono text-[10px] animate-pulse">LOADING</span>
        )}
        <span className="badge hidden lg:inline">{nodeId}</span>
        <StatusPill />
        <div className="hidden sm:inline-flex">
          <LiveClock />
        </div>
      </div>
    </header>
  );
}
