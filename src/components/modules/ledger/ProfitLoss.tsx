import { type PLRow } from "@/lib/supabase/ledger";
import { formatPKR } from "@/lib/utils/formatters";
import { accountUrdu, staticUrdu, type UrduNameMap } from "@/lib/report-i18n";
import { UrduUnder, BiLabel } from "@/components/shared/UrduText";

interface Props {
  revenue: PLRow[];
  expenses: PLRow[];
  cogs?: PLRow[];
  operatingExpenses?: PLRow[];
  grossProfit?: number;
  totalCOGS?: number;
  totalOperatingExpenses?: number;
  netProfit: number;
  /** Pre-translated English → Urdu account names. */
  urduMap?: UrduNameMap;
}

export default function ProfitLoss({
  revenue,
  expenses,
  cogs: cogsProp,
  operatingExpenses: opexProp,
  grossProfit: grossProfitProp,
  totalCOGS: totalCOGSProp,
  netProfit,
  urduMap = {},
}: Props) {
  // If cogs or opex were not explicitly passed, partition expenses by report_group or code
  const cogs = cogsProp ?? expenses.filter((e) => e.report_group === "COGS" || ["5001", "5006", "5010", "5011"].includes(e.account_code));
  const operatingExpenses = opexProp ?? expenses.filter((e) => !cogs.some((c) => c.account_code === e.account_code));

  const totalRev = revenue.reduce((a, r) => a + r.amount, 0);
  const totalCogsCalc = totalCOGSProp ?? cogs.reduce((a, r) => a + r.amount, 0);
  const grossProfitCalc = grossProfitProp ?? (totalRev - totalCogsCalc);
  const totalOpexCalc = operatingExpenses.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="glass-card overflow-hidden h-full flex flex-col">
      <div className="p-4 pb-0">
        <h3 className="text-h2 font-semibold mb-3"><BiLabel en="Profit & Loss" /></h3>
        <div className="glow-line mb-3" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        {/* REVENUE */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-caption text-status-optimal uppercase tracking-wider font-medium"><BiLabel en="Revenue" /></p>
            <span className="font-mono text-caption font-bold text-status-optimal">{formatPKR(totalRev)}</span>
          </div>
          {revenue.length === 0 ? (
            <p className="text-caption text-muted py-2">
              No revenue entries
              <UrduUnder ur={staticUrdu("No revenue entries")} />
            </p>
          ) : (
            <div className="space-y-1">
              {revenue.map((r) => (
                <div key={r.account_code} className="flex justify-between py-1 border-b border-border-subtle">
                  <div className="min-w-0 flex-1">
                    <span className="text-body text-foreground truncate block">{r.account_name}</span>
                    <UrduUnder ur={accountUrdu(r.account_name, urduMap, r.name_urdu)} />
                  </div>
                  <span className="font-mono text-num-table text-status-optimal shrink-0 ml-2">{formatPKR(r.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COST OF GOODS SOLD (COGS) */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-caption text-amber-500 uppercase tracking-wider font-medium"><BiLabel en="Cost of Goods Sold (COGS)" /></p>
            <span className="font-mono text-caption font-bold text-amber-500">− {formatPKR(totalCogsCalc)}</span>
          </div>
          {cogs.length === 0 ? (
            <p className="text-caption text-muted py-1">No direct COGS entries</p>
          ) : (
            <div className="space-y-1">
              {cogs.map((r) => (
                <div key={r.account_code} className="flex justify-between py-1 border-b border-border-subtle">
                  <div className="min-w-0 flex-1">
                    <span className="text-body text-foreground truncate block">{r.account_name}</span>
                    <UrduUnder ur={accountUrdu(r.account_name, urduMap, r.name_urdu)} />
                  </div>
                  <span className="font-mono text-num-table text-amber-500 shrink-0 ml-2">{formatPKR(r.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* GROSS PROFIT SUB-TOTAL */}
        <div className="p-2.5 rounded-lg bg-bg-subtle border border-border-subtle flex justify-between items-center">
          <div>
            <span className="text-caption font-bold uppercase tracking-wider text-foreground">Gross Profit</span>
            <p className="text-[10px] text-muted">Revenue − Direct Materials & Factory Payroll</p>
          </div>
          <span className={`font-mono text-num-kpi font-bold ${grossProfitCalc >= 0 ? "text-status-optimal" : "text-status-alert"}`}>
            {formatPKR(grossProfitCalc)}
          </span>
        </div>

        {/* OPERATING EXPENSES (OPEX) */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-caption text-status-alert uppercase tracking-wider font-medium"><BiLabel en="Operating Expenses (OPEX)" /></p>
            <span className="font-mono text-caption font-bold text-status-alert">− {formatPKR(totalOpexCalc)}</span>
          </div>
          {operatingExpenses.length === 0 ? (
            <p className="text-caption text-muted py-2">
              No operating expense entries
              <UrduUnder ur={staticUrdu("No expense entries")} />
            </p>
          ) : (
            <div className="space-y-1">
              {operatingExpenses.map((r) => (
                <div key={r.account_code} className="flex justify-between py-1 border-b border-border-subtle">
                  <div className="min-w-0 flex-1">
                    <span className="text-body text-foreground truncate block">{r.account_name}</span>
                    <UrduUnder ur={accountUrdu(r.account_name, urduMap, r.name_urdu)} />
                  </div>
                  <span className="font-mono text-num-table text-status-alert shrink-0 ml-2">{formatPKR(r.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glow-line" />

        {/* NET PROFIT */}
        <div className="flex justify-between items-center pt-1">
          <span className="text-body font-semibold text-foreground"><BiLabel en={netProfit >= 0 ? "Net Profit" : "Net Loss"} /></span>
          <span className={`font-mono text-num-kpi font-bold ${netProfit >= 0 ? "text-status-optimal" : "text-status-alert"}`}>
            {formatPKR(netProfit)}
          </span>
        </div>
      </div>
    </div>
  );
}
