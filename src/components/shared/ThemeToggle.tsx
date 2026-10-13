"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

const THEME_STORAGE_KEY = "theme";

function persistTheme(next: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* storage may be unavailable in restricted runtimes */
  }
}

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const isDark = mounted && (theme === "dark" || (!theme && resolvedTheme === "dark"));

  const toggleTheme = useCallback(() => {
    const next = isDark ? "light" : "dark";
    persistTheme(next);
    setTheme(next);
  }, [isDark, setTheme]);

  if (!mounted) {
    return (
      <button
        className="h-8 w-8 rounded-lg flex items-center justify-center text-muted bg-bg-muted border border-border-default transition-colors"
        aria-label="Toggle theme"
        type="button"
      >
        <div className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="relative h-8 w-8 rounded-lg flex items-center justify-center text-secondary hover:text-foreground hover:bg-bg-muted border border-border-default transition-all duration-200 group"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span className="relative h-4 w-4">
        <Sun
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
          }`}
          strokeWidth={1.5}
        />
        <Moon
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
          }`}
          strokeWidth={1.5}
        />
      </span>
    </button>
  );
}
