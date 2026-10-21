"use client";

import React from "react";
import { TrendingDown, Factory, Building2, Users, UserCheck, Banknote, Landmark } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { formatPKR } from "@/lib/utils/formatters";
import { type PayrollSummary } from "@/lib/supabase/payroll";

interface PayrollSummaryCardsProps {
  summary: PayrollSummary;
}

export default function PayrollSummaryCards({ summary }: PayrollSummaryCardsProps) {
  const cards = [
    {
      label: "Total Payroll (All)",
      value: summary.total,
      sub: `${summary.count} entries`,
      icon: TrendingDown,
      color: "text-crimson-primary",
      bg: "bg-crimson-primary/10",
      border: "border-crimson-primary/30",
    },
    {
      label: "Production / COGS",
      value: summary.totalCogs,
      sub: "Impacts Gross Profit",
      icon: Factory,
      color: "text-amber-400",
      bg: "bg-amber-400/10",
      border: "border-amber-400/30",
    },
    {
      label: "Admin / Fixed Overhead",
      value: summary.totalAdmin,
      sub: "Below Gross Profit line",
      icon: Building2,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
      border: "border-blue-400/30",
    },
    {
      label: "Permanent Salaries",
      value: summary.totalSalaries,
      sub: "Fixed monthly cost",
      icon: UserCheck,
      color: "text-purple-400",
      bg: "bg-purple-400/10",
      border: "border-purple-400/30",
    },
    {
      label: "Part-Time / Wages",
      value: summary.totalWages,
      sub: "Variable worker cost",
      icon: Users,
      color: "text-teal-400",
      bg: "bg-teal-400/10",
      border: "border-teal-400/30",
    },
    {
      label: "Cash Paid Out",
      value: summary.totalCash,
      sub: "Deducted from Cash",
      icon: Banknote,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/30",
    },
    {
      label: "Bank Transferred",
      value: summary.totalBank,
      sub: "Deducted from Bank",
      icon: Landmark,
      color: "text-sky-400",
      bg: "bg-sky-400/10",
      border: "border-sky-400/30",
    },
    {
      label: "This Month",
      value: summary.monthTotal,
      sub: "Current calendar month",
      icon: TrendingDown,
      color: "text-orange-400",
      bg: "bg-orange-400/10",
      border: "border-orange-400/30",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card) => (
        <GlassCard key={card.label} className={`p-4 border ${card.border}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-muted font-medium uppercase tracking-wider truncate">
                {card.label}
              </p>
              <p className={`text-lg font-bold font-mono mt-1 ${card.color} truncate`}>
                {formatPKR(card.value)}
              </p>
              <p className="text-[10px] text-muted mt-0.5 truncate">{card.sub}</p>
            </div>
            <div className={`${card.bg} p-2 rounded-lg shrink-0`}>
              <card.icon className={`w-4 h-4 ${card.color}`} />
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
