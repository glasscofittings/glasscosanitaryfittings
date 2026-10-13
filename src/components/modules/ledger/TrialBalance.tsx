import { useState, useMemo } from "react";
import { type TrialBalanceRow } from "@/lib/supabase/ledger";
import { formatPKR } from "@/lib/utils/formatters";
import { accountUrdu, type UrduNameMap } from "@/lib/report-i18n";
import { UrduUnder, BiLabel } from "@/components/shared/UrduText";

interface Props {
  rows: TrialBalanceRow[];
  onViewLedger?: (row: TrialBalanceRow) => void;
  /** Pre-translated English → Urdu account names; empty until the page finishes one batch call. */
  urduMap?: UrduNameMap;
}

export default function TrialBalance({ rows, onViewLedger, urduMap = {} }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.account_code.toLowerCase().includes(q) ||
        r.account_name.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const totalDebit = filtered.reduce((a, r) => a + r.total_debit, 0);
  const totalCredit = filtered.reduce((a, r) => a + r.total_credit, 0);

  return (
    <div className="glass-card overflow-hidden h-full flex flex-col">
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-h2 font-semibold">Trial Balance</h3>
          <span className="text-caption text-muted">{filtered.length} Accounts</span>
        </div>
        <div className="relative mb-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search person, customer, supplier, or account name..."
            className="h-8 w-full pl-3 pr-7 rounded-lg bg-bg-muted border border-border-default text-foreground text-caption focus:border-crimson-primary focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground text-caption"
            >
              ✕
            </button>
          )}
        </div>
        <div className="glow-line mb-3" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="text-caption text-muted font-medium py-2 uppercase tracking-wider">Account</th>
              <th className="text-caption text-muted font-medium py-2 uppercase tracking-wider text-right w-24">Debit</th>
              <th className="text-caption text-muted font-medium py-2 uppercase tracking-wider text-right w-24">Credit</th>
              {onViewLedger && (
                <th className="text-caption text-muted font-medium py-2 uppercase tracking-wider text-right w-20">Action</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={onViewLedger ? 4 : 3} className="py-6 text-center text-sm text-muted">No accounts match search</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.account_code} className="border-b border-border-subtle hover:bg-bg-muted/30">
                  <td className="py-2">
                    <span className="text-caption text-secondary font-mono">{r.account_code}</span>
                    <span className="text-body text-foreground ml-2">{r.account_name}</span>
                    <UrduUnder ur={accountUrdu(r.account_name, urduMap, r.name_urdu)} />
                  </td>
                  <td className="py-2 text-right font-mono text-num-table text-foreground">
                    {r.total_debit > 0 ? formatPKR(r.total_debit) : "—"}
                  </td>
                  <td className="py-2 text-right font-mono text-num-table text-foreground">
                    {r.total_credit > 0 ? formatPKR(r.total_credit) : "—"}
                  </td>
                  {onViewLedger && (
                    <td className="py-2 text-right">
                      <button
                        onClick={() => onViewLedger(r)}
                        className="h-6 px-2 text-[10px] rounded bg-bg-muted hover:bg-crimson-primary text-secondary hover:text-white border border-border-default transition-colors"
                      >
                        Ledger
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-default font-semibold">
              <td className="py-2 text-body text-foreground"><BiLabel en="Total" /></td>
              <td className="py-2 text-right font-mono text-num-kpi text-foreground">{formatPKR(totalDebit)}</td>
              <td className="py-2 text-right font-mono text-num-kpi text-foreground">{formatPKR(totalCredit)}</td>
              {onViewLedger && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
