/**
 * Sidebar module registry + visibility types.
 *
 * Single source of truth consumed by:
 *   - src/components/sidebar.tsx                     (nav rendering)
 *   - src/app/(dashboard)/settings/page.tsx          (Module Visibility tab)
 *   - src/components/providers/ModuleVisibilityContext.tsx (state + persistence)
 *
 * SAFETY: hiding a module only removes the navigation link. Routes, pages,
 * database tables and every stored record (invoices, ledger entries, CRM
 * contacts…) are never touched.
 */

/** localStorage key — read before paint so the sidebar never flashes extra items. */
export const MODULE_VISIBILITY_STORAGE_KEY = "glassco_sidebar_modules";

/** Sidebar sections, used as category labels in Settings. */
export type ModuleGroup = "core" | "finance" | "procurement" | "warehouse" | "hr";

/** Every sidebar key: 11 modules + settings = 12. */
export type ModuleKey =
  | "dashboard"
  | "crm"
  | "invoicing"
  | "quotations"
  | "receipts"
  | "payments"
  | "ledger"
  | "gate"
  | "inventory"
  | "catalog"
  | "labour"
  | "expenses"
  | "settings";

/** `true` = menu item visible in the sidebar. */
export type ModuleVisibility = Record<ModuleKey, boolean>;

export interface SidebarModule {
  key: ModuleKey;
  /** Route path — trailing slash matches Next's `trailingSlash: true` export. */
  href: string;
  label: string;
  group?: ModuleGroup;
  /** Dashboard + Settings can never be hidden (no lock-out). */
  locked?: boolean;
}

export const MODULE_KEYS: readonly ModuleKey[] = [
  "dashboard",
  "crm",
  "invoicing",
  "quotations",
  "receipts",
  "payments",
  "ledger",
  "gate",
  "inventory",
  "catalog",
  "labour",
  "expenses",
  "settings",
];

/** Everything visible unless the user explicitly turned it off. */
export const DEFAULT_MODULE_VISIBILITY: ModuleVisibility = {
  dashboard: true,
  crm: true,
  invoicing: true,
  quotations: true,
  receipts: true,
  payments: true,
  ledger: true,
  gate: true,
  inventory: true,
  catalog: true,
  labour: true,
  expenses: true,
  settings: true,
};

/** Forced visible — never toggleable, so the user cannot lock themselves out. */
export const LOCKED_MODULE_KEYS = ["dashboard", "settings"] as const;

/**
 * The nav registry, in render order. `href` / `label` / `group` are the only
 * place these strings exist — the sidebar and Settings both read from here.
 */
export const SIDEBAR_MODULES: readonly SidebarModule[] = [
  // ── Core
  { key: "dashboard", href: "/dashboard/", label: "Dashboard", group: "core", locked: true },
  { key: "crm", href: "/crm/", label: "CRM", group: "core" },

  // ── Sales & Accounting
  { key: "invoicing", href: "/invoicing/", label: "Dispatch / Sales", group: "finance" },
  { key: "quotations", href: "/quotations/", label: "Quotations", group: "finance" },
  { key: "receipts", href: "/invoicing/receipts/", label: "Customer Receipts (AR)", group: "finance" },
  { key: "payments", href: "/payment-vouchers/", label: "Payment Vouchers", group: "finance" },
  { key: "ledger", href: "/ledger/", label: "Ledger / Accounts", group: "finance" },
  { key: "expenses", href: "/expenses/", label: "Expenses", group: "finance" },

  // ── Procurement
  { key: "gate", href: "/procurement/", label: "In / Out Gate", group: "procurement" },

  // ── Inventory & Warehouse
  { key: "inventory", href: "/inventory/", label: "Inventory", group: "warehouse" },
  { key: "catalog", href: "/catalog/", label: "Product Catalog", group: "warehouse" },

  // ── Human Resources
  { key: "labour", href: "/labour/", label: "Labour / HR", group: "hr" },

  // ── Pinned to the sidebar footer
  { key: "settings", href: "/settings/", label: "Settings", locked: true },
];

/** Category headings shown in Settings → Menu Visibility. */
export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  core: "Core",
  finance: "Sales & Accounting",
  procurement: "Procurement",
  warehouse: "Inventory & Warehouse",
  hr: "Human Resources",
};

export const MODULE_GROUP_ORDER: readonly ModuleGroup[] = [
  "core",
  "finance",
  "procurement",
  "warehouse",
  "hr",
];

export function isModuleLocked(key: ModuleKey): boolean {
  return (LOCKED_MODULE_KEYS as readonly ModuleKey[]).includes(key);
}

/**
 * Sanitizes anything read from storage/Supabase into a full visibility map:
 * unknown keys dropped, missing keys default to `true`, locked keys forced `true`.
 */
export function mergeModuleVisibility(input: unknown): ModuleVisibility {
  const next: ModuleVisibility = { ...DEFAULT_MODULE_VISIBILITY };
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of MODULE_KEYS) {
      const value = record[key];
      if (typeof value === "boolean") next[key] = value;
    }
  }
  for (const key of LOCKED_MODULE_KEYS) next[key] = true;
  return next;
}
