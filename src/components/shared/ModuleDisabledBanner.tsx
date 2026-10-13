"use client";

import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { PanelLeftOpen, TriangleAlert } from "lucide-react";
import { useModuleVisibility } from "@/components/providers/ModuleVisibilityContext";
import { SIDEBAR_MODULES, type SidebarModule } from "@/types/settings";

/**
 * Shown when someone lands on a module whose sidebar link is switched off.
 * The route keeps working — this only explains the missing menu entry and
 * offers a one-click way to bring it back.
 */
export default function ModuleDisabledBanner() {
  const pathname = usePathname();
  const { hydrated, isModuleVisible, toggleModule } = useModuleVisibility();

  if (!hydrated) return null;

  const normalized = pathname === "/" ? "/" : pathname.endsWith("/") ? pathname : pathname + "/";
  // Longest matching href wins, so /invoicing/receipts/ reports "receipts"
  // even when its parent "/invoicing/" is also hidden.
  const target: SidebarModule | undefined = SIDEBAR_MODULES.filter(
    (m) => m.key !== "settings" && normalized.startsWith(m.href)
  ).sort((a, b) => b.href.length - a.href.length)[0];

  if (!target || isModuleVisible(target.key)) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-amber/40 bg-status-amber/10 px-4 py-3">
      <div className="flex items-start gap-2 min-w-0">
        <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5 text-status-amber" />
        <p className="text-body text-foreground">
          <span className="font-semibold">{target.label}</span> is hidden from the sidebar in
          Module Settings. The module still works — all of its data is untouched.
        </p>
      </div>
      <button
        onClick={() => {
          toggleModule(target.key, true);
          toast.success(`${target.label} menu shown in sidebar`);
        }}
        className="h-8 px-3 shrink-0 rounded-lg bg-status-amber/15 border border-status-amber/40 text-status-amber text-caption font-semibold hover:bg-status-amber hover:text-white transition-colors flex items-center gap-1.5"
      >
        <PanelLeftOpen className="h-3.5 w-3.5" />
        Show in sidebar
      </button>
    </div>
  );
}
