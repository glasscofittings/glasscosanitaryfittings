import { type PLRow } from "@/lib/supabase/ledger";
import { formatPKR } from "@/lib/utils/formatters";
import { accountUrdu, staticUrdu, type UrduNameMap } from "@/lib/report-i18n";
import { UrduUnder, BiLabel } from "@/components/shared/UrduText";

interface Props {
  revenue: PLRow[];
  expenses: PLRow[];
  netProfit: number;
  /** Pre-translated English → Urdu account names. */
  urduMap?: UrduNameMap;
}

export default function ProfitLoss({ revenue, expenses, netProfit, urduMap = {} }: Props) {
  return (
    <div className="glass-card overflow-hidden h-full flex flex-col">
      <div className="p-4 pb-0">
        <h3 className="text-h2 font-semibold mb-3"><BiLabel en="Profit & Loss" /></h3>
        <div className="glow-line mb-3" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        <div>
          <p className="text-caption text-status-optimal uppercase tracking-wider font-medium mb-2"><BiLabel en="Revenue" /></p>
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

        <div>
          <p className="text-caption text-status-alert uppercase tracking-wider font-medium mb-2"><BiLabel en="Expenses" /></p>
          {expenses.length === 0 ? (
            <p className="text-caption text-muted py-2">
              No expense entries
              <UrduUnder ur={staticUrdu("No expense entries")} />
            </p>
          ) : (
            <div className="space-y-1">
              {expenses.map((r) => (
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

        <div className="flex justify-between items-center">
          <span className="text-body font-semibold text-foreground"><BiLabel en={netProfit >= 0 ? "Net Profit" : "Net Loss"} /></span>
          <span className={`font-mono text-num-kpi font-bold ${netProfit >= 0 ? "text-status-optimal" : "text-status-alert"}`}>
            {formatPKR(netProfit)}
          </span>
        </div>
      </div>
    </div>
  );
}
