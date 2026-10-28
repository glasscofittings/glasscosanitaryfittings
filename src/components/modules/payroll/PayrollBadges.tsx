"use client";

import React from "react";
import { type EmployeeMonthStatus, type PayrollCostClass } from "@/lib/supabase/payroll";

const STATUS_STYLES: Record<EmployeeMonthStatus, { label: string; className: string }> = {
  PAID: {
    label: "Paid",
    className: "bg-status-optimal/10 text-status-optimal border-status-optimal/30",
  },
  PARTIALLY_PAID: {
    label: "Partially Paid",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  },
  PENDING: {
    label: "Pending",
    className: "bg-status-alert/10 text-status-alert border-status-alert/30",
  },
};

const HEAD_STYLES: Record<PayrollCostClass, { label: string; className: string }> = {
  PRODUCTION: {
    label: "Production · COGS",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  },
  ADMIN: {
    label: "Admin · OPEX",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  },
};

export function PayrollStatusBadge({ status }: { status: EmployeeMonthStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return (
    <span
      className={`inline-flex items-center text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${s.className}`}
    >
      {s.label}
    </span>
  );
}

export function PayrollHeadBadge({ costClass }: { costClass: PayrollCostClass }) {
  const s = HEAD_STYLES[costClass] ?? HEAD_STYLES.ADMIN;
  return (
    <span
      className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider border ${s.className}`}
    >
      {s.label}
    </span>
  );
}
