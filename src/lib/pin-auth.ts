"use client";

import { useEffect, useState } from "react";

const PIN_STORAGE_KEY = "glassco_web_pin_auth_token";
const PIN_TIMESTAMP_KEY = "glassco_web_pin_auth_time";
// Default to 12 hours before PIN re-entry is required
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

// The configured master PIN (defaults to 4829 if not overridden in .env)
export const MASTER_PIN = process.env.NEXT_PUBLIC_MASTER_APP_PIN || "4829";

/**
 * Checks whether the current runtime is a native desktop Tauri environment.
 * If in Tauri, we return true (desktop POS hardware node), which bypasses the web PIN gate.
 */
export function isTauriDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as { __TAURI__?: unknown };
  return Boolean(w.__TAURI__);
}

/**
 * Computes a simple SHA-256 hex digest using Web Crypto API.
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies if the user is already authenticated through the PIN gateway on the web.
 */
export async function isPinAuthenticated(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isTauriDesktop()) return true;

  try {
    const token = sessionStorage.getItem(PIN_STORAGE_KEY) || localStorage.getItem(PIN_STORAGE_KEY);
    const timeStr = sessionStorage.getItem(PIN_TIMESTAMP_KEY) || localStorage.getItem(PIN_TIMESTAMP_KEY);
    if (!token || !timeStr) return false;

    const time = parseInt(timeStr, 10);
    if (Number.isNaN(time) || Date.now() - time > SESSION_DURATION_MS) {
      clearPinSession();
      return false;
    }

    const expectedHash = await sha256(`glassco_pin_${MASTER_PIN}`);
    return token === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Validates the entered PIN and stores the cryptographic authorization token in storage.
 */
export async function verifyAndStorePin(pin: string, remember: boolean = true): Promise<boolean> {
  if (pin.trim() !== MASTER_PIN.trim()) {
    return false;
  }

  try {
    const hash = await sha256(`glassco_pin_${MASTER_PIN}`);
    const now = Date.now().toString();

    sessionStorage.setItem(PIN_STORAGE_KEY, hash);
    sessionStorage.setItem(PIN_TIMESTAMP_KEY, now);

    if (remember) {
      localStorage.setItem(PIN_STORAGE_KEY, hash);
      localStorage.setItem(PIN_TIMESTAMP_KEY, now);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears the PIN session tokens to lock the web terminal immediately.
 */
export function clearPinSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PIN_STORAGE_KEY);
    sessionStorage.removeItem(PIN_TIMESTAMP_KEY);
    localStorage.removeItem(PIN_STORAGE_KEY);
    localStorage.removeItem(PIN_TIMESTAMP_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * React hook to reactively check PIN status.
 */
export function useWebPinStatus() {
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    async function check() {
      const allowed = await isPinAuthenticated();
      if (mounted) setIsAllowed(allowed);
    }
    check();

    const handleStorage = () => {
      check();
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      mounted = false;
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return {
    isAllowed,
    isDesktop: isTauriDesktop(),
    checkPin: isPinAuthenticated,
  };
}
