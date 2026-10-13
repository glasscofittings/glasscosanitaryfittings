"use client";

import React from "react";
import GlassCard from "@/components/ui/GlassCard";
import { formatPKR } from "@/lib/utils/formatters";
import {
  type ExpenseSummary,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/supabase/expenses";
import { Calendar, TrendingUp, Clock, Wallet, CheckCircle2 } from "lucide-react";

interface ExpenseSummaryCardsProps {
  summary: ExpenseSummary;
  selectedCategory: ExpenseCategory | "ALL";
  onSelectCategory: (category: ExpenseCategory | "ALL") => void;
}

export default function ExpenseSummaryCards({
  summary,
  selectedCategory,
  onSelectCategory,
}: ExpenseSummaryCardsProps) {
  return (
    <div className="space-y-4">
      {/* 4 Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Expenses */}
        <GlassCard className="p-4 border-l-4 border-l-blue-500 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted font-medium">Today&apos;s Expenses</p>
            <p className="text-xl font-bold mt-1 text-foreground">{formatPKR(summary.todayTotal)}</p>
            <p className="text-[11px] text-muted mt-0.5">Recorded today</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
            <Calendar className="w-5 h-5" />
          </div>
        </GlassCard>

        {/* Monthly Total */}
        <GlassCard className="p-4 border-l-4 border-l-emerald-500 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted font-medium">This Month</p>
            <p className="text-xl font-bold mt-1 text-foreground">{formatPKR(summary.monthTotal)}</p>
            <p className="text-[11px] text-muted mt-0.5">Current calendar month</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <TrendingUp className="w-5 h-5" />
          </div>
        </GlassCard>

        {/* Unpaid Accruals */}
        <GlassCard className="p-4 border-l-4 border-l-amber-500 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted font-medium">Unpaid Payables</p>
            <p className="text-xl font-bold mt-1 text-amber-500">{formatPKR(summary.unpaidTotal)}</p>
            <p className="text-[11px] text-muted mt-0.5">Accrued, awaiting payment</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
            <Clock className="w-5 h-5" />
          </div>
        </GlassCard>

        {/* Paid / Total Settled */}
        <GlassCard className="p-4 border-l-4 border-l-crimson-primary flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted font-medium">Total Paid / Settled</p>
            <p className="text-xl font-bold mt-1 text-foreground">{formatPKR(summary.paidTotal)}</p>
            <p className="text-[11px] text-muted mt-0.5">Posted out of liquid funds</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-crimson-primary/10 flex items-center justify-center text-crimson-primary">
            <Wallet className="w-5 h-5" />
          </div>
        </GlassCard>
      </div>

      {/* Category Breakdown Chips / Bar */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Category Breakdown & Summaries
          </span>
          <button
            onClick={() => onSelectCategory("ALL")}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              selectedCategory === "ALL"
                ? "bg-crimson-primary text-white font-medium"
                : "text-muted hover:text-foreground hover:bg-bg-hover"
            }`}
          >
            Show All
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {EXPENSE_CATEGORIES.map((cat) => {
            const data = summary.categoryBreakdown[cat.value] || { amount: 0, count: 0, percentage: 0 };
            const isSelected = selectedCategory === cat.value;

            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => onSelectCategory(isSelected ? "ALL" : cat.value)}
                className={`p-2 rounded-lg text-left transition-all border ${
                  isSelected
                    ? "border-crimson-primary bg-crimson-primary/10 shadow-sm"
                    : "border-border-subtle bg-surface-card/60 hover:bg-bg-hover"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium truncate" title={cat.label}>
                    {cat.label.split(" ")[0]}
                  </span>
                  <span className="text-[10px] text-muted font-mono">{data.percentage}%</span>
                </div>
                <div className="text-xs font-bold mt-1 truncate" title={formatPKR(data.amount)}>
                  {formatPKR(data.amount)}
                </div>
                <div className="w-full bg-border-subtle h-1 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="bg-crimson-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, data.percentage)}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
