"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface TerminalPreset {
  label: string;
  email: string;
  password: string;
  icon: string;
}

const PRESETS: TerminalPreset[] = [
  { label: "Owner Remote Sign-In", email: "owner@glasscosanitary.com", password: "Owner@2026!", icon: "Crown" },
  { label: "Node 1 — Main Counter", email: "pos1@glasscosanitary.com", password: "node1-pass", icon: "Monitor" },
  { label: "Node 2 — Counter 2", email: "pos2@glasscosanitary.com", password: "node2-pass", icon: "Monitor" },
  { label: "Node 3 — Warehouse", email: "warehouse@glasscosanitary.com", password: "node3-pass", icon: "Warehouse" },
  { label: "Node 4 — Office", email: "office@glasscosanitary.com", password: "node4-pass", icon: "Laptop" },
];

const ICONS: Record<string, React.ReactNode> = {
  Crown: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 14h18M5 14l2-9 5 4 5-4 2 9M4 21V14" />
    </svg>
  ),
  Monitor: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 7.41A2.25 2.25 0 012.25 5.496V5.25" />
    </svg>
  ),
  Warehouse: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0H21m-3.75 0H21" />
    </svg>
  ),
  Laptop: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const supabase = createClient();

  useEffect(() => {
    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) router.replace(redirectTo);
    }
    checkSession();
  }, [supabase, router, redirectTo]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError("");

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError(
        authError.message === "Invalid login credentials"
          ? "Invalid email or password."
          : authError.message
      );
      setLoading(false);
      return;
    }

    router.replace(redirectTo);
  }

  function handlePresetSelect(preset: TerminalPreset) {
    setEmail(preset.email);
    setPassword(preset.password);
    setError("");
  }

  const inputCls =
    "w-full h-11 px-4 rounded-lg bg-white border border-[#004741]/30 text-[#004741] text-body font-mono focus:ring-2 focus:ring-[#004741] focus:border-[#004741] focus:outline-none transition-colors placeholder:text-[#004741]/40";

  return (
    <div className="relative z-10 w-full max-w-md">
      {/* Card */}
      <div className="rounded-xl border border-[#004741]/20 bg-white shadow-xl overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#004741]/10 bg-[#004741]">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#F0EDE4]/30" />
            <span className="h-3 w-3 rounded-full bg-[#F0EDE4]/50" />
            <span className="h-3 w-3 rounded-full bg-[#F0EDE4]/50" />
          </div>
          <span className="ml-2 text-[11px] font-mono text-[#F0EDE4]/70 tracking-wider">
            glasscosanitary@auth — login
          </span>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Brand */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-[#004741] border border-[#004741] mb-2">
              <svg className="h-7 w-7 text-[#F0EDE4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-[#004741] font-mono tracking-wider">
              GLASSCO SANITARY
            </h1>
            <p className="text-[11px] text-[#004741]/50 font-mono tracking-widest uppercase">
              Authentication Terminal v2.0
            </p>
          </div>

          {/* Quick Select Presets */}
          <div className="space-y-2">
            <p className="text-[10px] text-[#004741]/50 font-mono uppercase tracking-widest">
              Quick Select Terminal
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.email}
                  onClick={() => handlePresetSelect(preset)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left group ${
                    email === preset.email
                      ? "bg-[#004741] border-[#004741] text-[#F0EDE4]"
                      : "bg-white border-[#004741]/20 text-[#004741] hover:bg-[#004741]/5 hover:border-[#004741]/40"
                  }`}
                >
                  <span className={`shrink-0 transition-opacity ${email === preset.email ? "text-[#F0EDE4]" : "opacity-60 group-hover:opacity-100"}`}>
                    {ICONS[preset.icon]}
                  </span>
                  <span className="text-caption font-mono">{preset.label}</span>
                  {preset.email === "owner@glasscosanitary.com" && (
                    <span className={`ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                      email === preset.email
                        ? "bg-[#F0EDE4]/20 text-[#F0EDE4] border-[#F0EDE4]/30"
                        : "bg-[#004741]/10 text-[#004741] border-[#004741]/20"
                    }`}>
                      ADMIN
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#004741]/10" />
            <span className="text-[10px] text-[#004741]/40 font-mono">OR SIGN IN MANUALLY</span>
            <div className="flex-1 h-px bg-[#004741]/10" />
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="text-[10px] text-[#004741]/50 font-mono uppercase tracking-widest mb-1.5 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                className={inputCls}
                placeholder="node@glasscosanitary.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#004741]/50 font-mono uppercase tracking-widest mb-1.5 block">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                className={inputCls}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] font-mono text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !password.trim()}
              className="w-full h-11 rounded-lg bg-[#004741] text-[#F0EDE4] font-mono font-medium text-body hover:bg-[#00332e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-md"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Authenticating...
                </span>
              ) : (
                "AUTHENTICATE"
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="text-center">
            <p className="text-[10px] text-[#004741]/30 font-mono">
              Encrypted session · Secure sign-in · {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F0EDE4] flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="text-[#004741] font-mono text-xs">
          Loading authentication terminal...
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}