"use client";

import { toast } from "sonner";
import { RotateCcw, Eye, EyeOff, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useModuleVisibility } from "@/components/providers/ModuleVisibilityContext";
import { MODULE_ICONS } from "@/components/shared/module-icons";
import {
  MODULE_GROUP_LABELS,
  MODULE_GROUP_ORDER,
  SIDEBAR_MODULES,
  isModuleLocked,
  type SidebarModule,
} from "@/types/settings";

/**
 * Settings → Menu Visibility.
 *
 * Toggles only change what the sidebar renders. No route, page, table or
 * stored record is modified — Dashboard and Settings are pinned on.
 */
export default function ModuleVisibilitySettings() {
  const { visibility, hydrated, toggleModule, resetToDefaults } = useModuleVisibility();

  const toggleable = SIDEBAR_MODULES.filter((m) => !isModuleLocked(m.key));
  const lockedItems = SIDEBAR_MODULES.filter((m) => isModuleLocked(m.key));
  const visibleCount = SIDEBAR_MODULES.filter((m) => visibility[m.key] !== false).length;

  function handleToggle(module: SidebarModule, next: boolean) {
    toggleModule(module.key, next);
    toast.success(
      next
        ? `${module.label} menu shown in sidebar`
        : `${module.label} menu hidden from sidebar`
    );
  }

  function handleReset() {
    resetToDefaults();
    toast.success("Sidebar layout reset — all menus visible");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-h2 font-semibold">Menu Visibility</h3>
            <p className="text-caption text-secondary mt-1">
              Choose which modules appear in the left sidebar on this terminal.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-caption text-muted font-mono">
              {visibleCount}/{SIDEBAR_MODULES.length} visible
            </span>
            <button
              onClick={handleReset}
              disabled={!hydrated}
              className="h-8 px-3 rounded-lg bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to Default Layout
            </button>
          </div>
        </div>
        <div className="glow-line mt-3 mb-0" />
        <p className="text-caption text-muted mt-3 flex items-start gap-1.5">
          <Eye className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Hiding a menu only removes its shortcut — every module stays reachable by URL and
          <span className="text-secondary"> no invoices, ledger entries or contacts are affected</span>.
        </p>
      </div>

      {/* Always-on modules */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="h-3.5 w-3.5 text-muted" />
          <h4 className="text-caption text-muted uppercase tracking-wider font-medium">
            Always Visible
          </h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lockedItems.map((module) => (
            <div
              key={module.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-muted/50 px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {(() => {
                  const Icon = MODULE_ICONS[module.key];
                  return <Icon className="h-4 w-4 shrink-0 text-secondary" strokeWidth={1.5} />;
                })()}
                <div className="min-w-0">
                  <p className="text-body text-foreground truncate">{module.label}</p>
                  <p className="text-[10px] text-muted">Pinned — cannot be hidden</p>
                </div>
              </div>
              <Switch checked disabled aria-label={`${module.label} is always visible`} />
            </div>
          ))}
        </div>
      </div>

      {/* Toggleable modules by category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {MODULE_GROUP_ORDER.map((group) => {
          const items = toggleable.filter((m) => m.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-caption text-muted uppercase tracking-wider font-medium">
                  {MODULE_GROUP_LABELS[group]}
                </h4>
                <span className="text-[10px] text-muted font-mono">
                  {items.filter((m) => visibility[m.key] !== false).length}/{items.length}
                </span>
              </div>
              <div className="glow-line mb-2" />
              <div className="space-y-1">
                {items.map((module) => {
                  const Icon = MODULE_ICONS[module.key];
                  const isVisible = visibility[module.key] !== false;
                  return (
                    <div
                      key={module.key}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-colors ${isVisible ? "text-crimson-primary" : "text-muted"}`}
                          strokeWidth={1.5}
                        />
                        <div className="min-w-0">
                          <p
                            className={`text-body truncate transition-colors ${isVisible ? "text-foreground" : "text-muted line-through decoration-border-default"}`}
                          >
                            {module.label}
                          </p>
                          <p className="text-[10px] text-muted font-mono truncate">{module.href}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isVisible ? (
                          <Eye className="h-3.5 w-3.5 text-status-optimal" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-muted" />
                        )}
                        <Switch
                          checked={isVisible}
                          disabled={!hydrated}
                          onCheckedChange={(next) => handleToggle(module, next)}
                          aria-label={`Show ${module.label} in sidebar`}
                          className="data-[state=checked]:bg-crimson-primary data-[state=unchecked]:bg-slate-300 dark:data-[state=unchecked]:bg-slate-600"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
