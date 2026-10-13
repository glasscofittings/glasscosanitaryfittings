"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const STORAGE_KEY = "glassco-sidebar-collapsed";

interface SidebarContextValue {
  isCollapsed: boolean;
  toggle: () => void;
  isMobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
  toggleMobile: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  isCollapsed: false,
  toggle: () => {},
  isMobileOpen: false,
  openMobile: () => {},
  closeMobile: () => {},
  toggleMobile: () => {},
});

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setIsCollapsed(stored === "true");
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const openMobile = useCallback(() => setIsMobileOpen(true), []);
  const closeMobile = useCallback(() => setIsMobileOpen(false), []);
  const toggleMobile = useCallback(() => setIsMobileOpen((prev) => !prev), []);

  // Expose collapsed state as CSS custom property on <html> for layout use
  useEffect(() => {
    if (!hydrated) return;

    const updateCSSVariables = () => {
      const isMobile = window.innerWidth < 768; // Tailwind md breakpoint
      document.documentElement.style.setProperty(
        "--sidebar-w",
        isCollapsed ? "72px" : "220px"
      );
      document.documentElement.style.setProperty(
        "--main-margin-left",
        isMobile ? "0px" : isCollapsed ? "72px" : "220px"
      );
    };

    updateCSSVariables();
    window.addEventListener("resize", updateCSSVariables);
    return () => window.removeEventListener("resize", updateCSSVariables);
  }, [isCollapsed, hydrated]);

  return (
    <SidebarContext.Provider
      value={{
        isCollapsed,
        toggle,
        isMobileOpen,
        openMobile,
        closeMobile,
        toggleMobile,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
