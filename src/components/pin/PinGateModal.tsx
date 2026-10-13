"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ShieldCheck, Lock, Delete, ArrowRight, ShieldAlert, CheckCircle2 } from "lucide-react";
import { verifyAndStorePin } from "@/lib/pin-auth";

const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

interface PinGateModalProps {
  onSuccess: () => void;
}

export default function PinGateModal({ onSuccess }: PinGateModalProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [successAnim, setSuccessAnim] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [lockoutTimer, setLockoutTimer] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);

  // Handle countdown if locked out
  useEffect(() => {
    if (lockoutTimer <= 0) return;
    const interval = setInterval(() => {
      setLockoutTimer((prev) => {
        if (prev <= 1) {
          setAttemptsLeft(MAX_ATTEMPTS);
          setError("");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutTimer]);

  const handleValidation = useCallback(
    async (currentDigits: string[]) => {
      if (currentDigits.length !== PIN_LENGTH) return;
      setIsVerifying(true);
      setError("");

      const code = currentDigits.join("");
      const isValid = await verifyAndStorePin(code, rememberDevice);

      setIsVerifying(false);

      if (isValid) {
        setSuccessAnim(true);
        setTimeout(() => {
          onSuccess();
        }, 500);
      } else {
        const nextAttempts = attemptsLeft - 1;
        setAttemptsLeft(nextAttempts);

        if (nextAttempts <= 0) {
          setLockoutTimer(LOCKOUT_SECONDS);
          setError(`Too many invalid attempts. Terminal locked for ${LOCKOUT_SECONDS}s.`);
          setDigits([]);
        } else {
          setError(`Access Denied: Invalid Security PIN. (${nextAttempts} attempts remaining)`);
          setDigits([]);
        }
      }
    },
    [attemptsLeft, rememberDevice, onSuccess]
  );

  const handleKeyPress = useCallback(
    (key: string) => {
      if (lockoutTimer > 0 || isVerifying || successAnim) return;

      if (key === "BACKSPACE" || key === "⌫") {
        setDigits((prev) => prev.slice(0, -1));
        setError("");
        return;
      }

      if (/^[0-9]$/.test(key)) {
        if (digits.length >= PIN_LENGTH) return;
        const next = [...digits, key];
        setDigits(next);
        setError("");
        if (next.length === PIN_LENGTH) {
          handleValidation(next);
        }
      }
    },
    [digits, lockoutTimer, isVerifying, successAnim, handleValidation]
  );

  // Capture physical keyboard numbers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Backspace") {
        handleKeyPress("BACKSPACE");
      } else if (/^[0-9]$/.test(e.key)) {
        handleKeyPress(e.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKeyPress]);

  const numKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-[#06080c]/90 backdrop-blur-2xl selection:bg-red-500 selection:text-white">
      {/* Decorative ambient background glows */}
      <div className="absolute top-1/4 -left-20 w-80 h-80 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-[#004741]/20 rounded-full blur-3xl pointer-events-none" />

      <div
        ref={containerRef}
        className={`relative w-full max-w-sm rounded-3xl border transition-all duration-300 shadow-2xl p-6 sm:p-8 overflow-hidden ${
          successAnim
            ? "border-emerald-500/50 bg-emerald-950/20"
            : error
            ? "border-red-500/40 bg-neutral-900/90 shadow-red-950/20"
            : "border-neutral-800 bg-neutral-900/80 shadow-black/60"
        }`}
      >
        {/* Top Terminal Badge */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-xs font-mono tracking-wider uppercase text-neutral-400">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            WEB ACCESS GATEWAY
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700/60">
            E2E SECURED
          </span>
        </div>

        {/* Brand & Title */}
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-neutral-800/80 border border-neutral-700/60 shadow-inner mb-1">
            {successAnim ? (
              <CheckCircle2 className="h-7 w-7 text-emerald-400 animate-bounce" />
            ) : error ? (
              <ShieldAlert className="h-7 w-7 text-red-400" />
            ) : (
              <Lock className="h-7 w-7 text-red-500" />
            )}
          </div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-100">
            Glassco Security Gateway
          </h1>
          <p className="text-xs text-neutral-400">
            Enter 4-digit master access PIN to unlock cloud terminal
          </p>
        </div>

        {/* PIN Indicators */}
        <div className="flex justify-center items-center gap-4 my-6">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const isFilled = i < digits.length;
            return (
              <div
                key={i}
                className={`h-12 w-12 rounded-xl flex items-center justify-center border-2 transition-all duration-200 ${
                  successAnim
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                    : error
                    ? "border-red-500 bg-red-500/10"
                    : isFilled
                    ? "border-red-500 bg-red-500/10 shadow-lg shadow-red-950/50"
                    : "border-neutral-800 bg-neutral-950/60"
                }`}
              >
                {isFilled && (
                  <div
                    className={`h-3 w-3 rounded-full transition-transform ${
                      successAnim ? "bg-emerald-400 scale-125" : "bg-red-500 scale-100"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Error / Status Messages */}
        <div className="min-h-[28px] mb-4 text-center">
          {lockoutTimer > 0 ? (
            <p className="text-xs font-mono text-amber-400 flex items-center justify-center gap-1.5 animate-pulse">
              <ShieldAlert className="w-3.5 h-3.5" />
              Locked out: wait {lockoutTimer}s
            </p>
          ) : error ? (
            <p className="text-xs font-mono text-red-400 animate-shake">{error}</p>
          ) : isVerifying ? (
            <p className="text-xs font-mono text-neutral-400">Decrypting & verifying credentials...</p>
          ) : (
            <p className="text-[11px] font-mono text-neutral-500">
              Authorized personnel & POS terminals only
            </p>
          )}
        </div>

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2.5 mb-6">
          {numKeys.map((key, i) => {
            if (key === "") return <div key={i} />;
            const isBack = key === "⌫";

            return (
              <button
                key={i}
                type="button"
                onClick={() => handleKeyPress(key)}
                disabled={lockoutTimer > 0 || isVerifying || successAnim}
                className={`h-14 rounded-2xl font-mono text-lg font-bold flex items-center justify-center transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                  isBack
                    ? "bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300 border border-neutral-700/50"
                    : "bg-neutral-950/70 hover:bg-neutral-800 text-neutral-100 border border-neutral-800 hover:border-neutral-700 hover:text-white"
                }`}
              >
                {isBack ? <Delete className="h-5 w-5 text-neutral-400" /> : key}
              </button>
            );
          })}
        </div>

        {/* Remember device toggle */}
        <div className="flex items-center justify-between px-2 py-2 rounded-xl bg-neutral-950/40 border border-neutral-800/80 mb-4">
          <span className="text-[11px] text-neutral-400">Keep terminal unlocked for 12 hours</span>
          <button
            type="button"
            onClick={() => setRememberDevice(!rememberDevice)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              rememberDevice ? "bg-red-600" : "bg-neutral-700"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                rememberDevice ? "translate-x-4.5" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Security Notice */}
        <div className="text-center pt-2 border-t border-neutral-800/60">
          <p className="text-[10px] font-mono text-neutral-500">
            Protected with Client-Side SHA-256 Hash Verification
          </p>
        </div>
      </div>
    </div>
  );
}
