import type { ElementType } from "react";
import {
  LayoutDashboard,
  Users,
  Truck,
  ArrowRightLeft,
  BookOpen,
  Settings,
  Box,
  Receipt,
  Contact,
  Barcode,
  Wallet,
  FileText,
  Banknote,
} from "lucide-react";
import type { ModuleKey } from "@/types/settings";

/** Icons for every sidebar module — shared by the sidebar and Settings. */
export const MODULE_ICONS: Record<ModuleKey, ElementType> = {
  dashboard: LayoutDashboard,
  crm: Contact,
  invoicing: Truck,
  receipts: Receipt,
  payments: Receipt,
  ledger: BookOpen,
  gate: ArrowRightLeft,
  inventory: Box,
  catalog: Barcode,
  labour: Users,
  expenses: Wallet,
  payroll: Banknote,
  quotations: FileText,
  settings: Settings,
};
