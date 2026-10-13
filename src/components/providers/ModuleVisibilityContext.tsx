"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  DEFAULT_MODULE_VISIBILITY,
  MODULE_VISIBILITY_STORAGE_KEY,
  isModuleLocked,
  mergeModuleVisibility,
  type ModuleKey,
  type ModuleVisibility,
} from "@/types/settings";
import { fetchModuleVisibility, saveModuleVisibility } from "@/lib/supabase/user-settings";

/**
 * Global sidebar visibility state.
 *
 * Persistence order:
 *   1. localStorage (`glassco_sidebar_modules`) — synchronous, so the stored
 *      layout applies right after mount with no round-trip and no flash.
 *   2. Supabase `user_settings` — async mirror/fallback: fetched once per
 *      session when this terminal has no local value yet, and written back on
 *      every change. Failures are silent; the local copy always wins.
 *
 * Hydration: the provider renders the defaults on the server AND on the client's
 * first pass (identical markup → no hydration mismatch), then swaps in the
 * stored layout inside an effect.
 *
 * Hiding a module only hides the nav link — it never touches routes, tables
 * or data.
 */
interface ModuleVisibilityContextValue {
  /** Effective layout; locked keys (dashboard, settings) are always `true`. */
  visibility: ModuleVisibility;
  /** False until the stored layout has been applied (guards the Settings switches). */
  hydrated: boolean;
  isModuleVisible: (key: ModuleKey) => boolean;
  toggleModule: (key: ModuleKey, isVisible: boolean) => void;
  resetToDefaults: () => void;
}

const ModuleVisibilityContext = createContext<ModuleVisibilityContextValue>({
  visibility: DEFAULT_MODULE_VISIBILITY,
  hydrated: false,
  isModuleVisible: () => true,
  toggleModule: () => {},
  resetToDefaults: () => {},
});

export function ModuleVisibilityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [visibility, setVisibility] = useState<ModuleVisibility>(DEFAULT_MODULE_VISIBILITY);
  const [hydrated, setHydrated] = useState(false);

  const userRef = useRef(user);
  const visibilityRef = useRef(visibility);
  /** True once this terminal has its own stored layout (local or remote). */
  const localHasValueRef = useRef(false);
  const remoteTriedRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);

  /* ── 1. localStorage: applied synchronously right after mount ─────────── */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MODULE_VISIBILITY_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        visibilityRef.current = mergeModuleVisibility(parsed);
        setVisibility(visibilityRef.current);
        localHasValueRef.current = true;
      }
    } catch {
      // Corrupt/unavailable storage → fall back to defaults, never crash.
      localHasValueRef.current = false;
    }
    setHydrated(true);
  }, []);

  /* ── 2. Supabase fallback: only when this terminal has no stored layout ─ */
  useEffect(() => {
    if (!hydrated || !user || localHasValueRef.current || remoteTriedRef.current) return;
    remoteTriedRef.current = true;
    let cancelled = false;

    fetchModuleVisibility(user.id)
      .then((remote) => {
        if (cancelled || !remote) return;
        const next = mergeModuleVisibility(remote);
        visibilityRef.current = next;
        setVisibility(next);
        localHasValueRef.current = true;
        try {
          window.localStorage.setItem(MODULE_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* storage full — remote copy is enough */
        }
      })
      .catch(() => {
        /* fail-open: defaults/localStorage keep the UI working */
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, user]);

  /* ── Write-through: local first (instant), remote mirror afterwards ───── */
  const persist = useCallback((next: ModuleVisibility) => {
    try {
      window.localStorage.setItem(MODULE_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      localHasValueRef.current = true;
    } catch {
      /* quota exceeded — state still applies for this session */
    }
    const uid = userRef.current?.id;
    if (uid) void saveModuleVisibility(uid, next);
  }, []);

  const apply = useCallback(
    (next: ModuleVisibility) => {
      visibilityRef.current = next;
      setVisibility(next);
      persist(next);
    },
    [persist]
  );

  const toggleModule = useCallback(
    (key: ModuleKey, isVisible: boolean) => {
      if (isModuleLocked(key)) return;
      apply(mergeModuleVisibility({ ...visibilityRef.current, [key]: isVisible }));
    },
    [apply]
  );

  const resetToDefaults = useCallback(() => {
    apply(mergeModuleVisibility(DEFAULT_MODULE_VISIBILITY));
  }, [apply]);

  const isModuleVisible = useCallback(
    (key: ModuleKey) => isModuleLocked(key) || visibility[key] !== false,
    [visibility]
  );

  const value = useMemo<ModuleVisibilityContextValue>(
    () => ({
      visibility,
      hydrated,
      isModuleVisible,
      toggleModule,
      resetToDefaults,
    }),
    [visibility, hydrated, isModuleVisible, toggleModule, resetToDefaults]
  );

  return (
    <ModuleVisibilityContext.Provider value={value}>{children}</ModuleVisibilityContext.Provider>
  );
}

export function useModuleVisibility() {
  return useContext(ModuleVisibilityContext);
}
