"use client";

import React, { memo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebar } from "@/components/providers/SidebarContext";
import { useModuleVisibility } from "@/components/providers/ModuleVisibilityContext";
import { SIDEBAR_MODULES, type ModuleKey, type SidebarModule } from "@/types/settings";
import { MODULE_ICONS } from "@/components/shared/module-icons";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

interface RouteItem {
  key: ModuleKey;
  href: string;
  label: string;
  Icon: React.ElementType;
  group?: string;
}

/** Registry first, icons attached here — href/label live only in src/types/settings.ts. */
function toRoute(module: SidebarModule): RouteItem {
  return {
    key: module.key,
    href: module.href,
    label: module.label,
    group: module.group,
    Icon: MODULE_ICONS[module.key],
  };
}

const routes: RouteItem[] = SIDEBAR_MODULES.filter((m) => m.key !== "settings").map(toRoute);
const bottomRoutes: RouteItem[] = SIDEBAR_MODULES.filter((m) => m.key === "settings").map(toRoute);

function useActivePath(): string {
  const pathname = usePathname();
  return pathname === "/" ? "/" : pathname.endsWith("/") ? pathname : pathname + "/";
}

// ─── Individual Nav Item ─────────────────────────────────────────────────────

const SidebarNavItem = memo(function SidebarNavItem({
  route,
  isActive,
  isCollapsed,
}: {
  route: RouteItem;
  isActive: boolean;
  isCollapsed: boolean;
}) {
  if (isCollapsed) {
    return (
      <Link
        href={route.href}
        title={route.label}
        className={[
          "flex items-center justify-center w-10 h-10 rounded-full transition-all duration-150",
          isActive
            ? "bg-crimson-primary text-white shadow-md"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-200 dark:hover:text-slate-700",
        ].join(" ")}
      >
        <route.Icon className="w-5 h-5 mx-auto" strokeWidth={1.5} />
      </Link>
    );
  }

  return (
    <Link
      href={route.href}
      className={[
        "nav-item sidebar-nav-item transition-all duration-150",
        isActive ? "active font-bold" : "hover:bg-neutral-800/40",
      ].join(" ")}
    >
      <route.Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} />
      <span className="truncate transition-all duration-200">{route.label}</span>
    </Link>
  );
});

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const activePath = useActivePath();
  const { isCollapsed, toggle, isMobileOpen, closeMobile } = useSidebar();
  const { isModuleVisible } = useModuleVisibility();

  useEscapeToClose(isMobileOpen, closeMobile);

  // Visibility is a UI filter only — hidden routes keep working on direct URL access.
  const visibleRoutes = routes.filter((item) => isModuleVisible(item.key));
  const visibleBottomRoutes = bottomRoutes.filter((item) => isModuleVisible(item.key));

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity duration-300"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          "fixed top-14 bottom-0 z-40",
          "flex flex-col overflow-y-auto overflow-x-hidden",
          "transition-all duration-300 ease-in-out",
          // Mobile: drawer that slides in from left
          isMobileOpen
            ? "left-0 w-[240px] glass-sidebar py-4 px-3 shadow-2xl md:shadow-none"
            : "-left-full md:left-0",
          // Desktop: responsive collapsed / expanded widths
          isCollapsed
            ? "md:w-[72px] md:items-center md:py-4 md:gap-3 md:rounded-2xl md:ml-1 md:mt-2 md:mb-2 md:border md:border-[var(--glass-border)] md:shadow-lg md:bg-white/80 md:dark:bg-slate-200/80 md:backdrop-blur-md"
            : "md:w-[220px] md:glass-sidebar md:py-4 md:px-3",
        ].join(" ")}
      >
        {/* Navigation Links */}
        <nav
          className={`flex flex-col flex-1 ${
            isCollapsed ? "md:gap-3 md:items-center gap-1" : "gap-1"
          }`}
          onClick={() => {
            // Auto close mobile drawer when navigating
            if (isMobileOpen) closeMobile();
          }}
        >
          {visibleRoutes.map((item) => (
            <SidebarNavItem
              key={item.key}
              route={item}
              isActive={activePath === item.href}
              isCollapsed={isCollapsed}
            />
          ))}
        </nav>

        {/* Footer: Bottom routes + Version + Toggle */}
        <div
          className={`mt-auto flex flex-col ${
            isCollapsed
              ? "md:items-center md:gap-3 md:pt-3 md:border-t md:border-[var(--glass-border)] md:w-full gap-1 pt-4"
              : "gap-1 pt-4"
          }`}
          style={isCollapsed ? undefined : { borderTop: "1px solid var(--glass-border)" }}
          onClick={() => {
            if (isMobileOpen) closeMobile();
          }}
        >
          {visibleBottomRoutes.map((item) => (
            <SidebarNavItem
              key={item.key}
              route={item}
              isActive={activePath === item.href}
              isCollapsed={isCollapsed}
            />
          ))}

          {(!isCollapsed || isMobileOpen) && (
            <div className="badge w-full text-center mt-1">v2.0.0</div>
          )}

          {/* Desktop collapse toggle */}
          <div className="hidden md:block">
            {isCollapsed ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                title="Expand sidebar"
                className="flex items-center justify-center w-10 h-10 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-200 dark:hover:text-slate-700 transition-all duration-150"
              >
                <PanelLeftOpen className="w-5 h-5 mx-auto" strokeWidth={1.5} />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                title="Collapse sidebar"
                className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--nav-hover-bg)] transition-all duration-150"
              >
                <PanelLeftClose className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>Collapse</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export default memo(Sidebar);
