import { type BalanceSheetRow } from "@/lib/supabase/ledger";
import { formatPKR } from "@/lib/utils/formatters";
import { accountUrdu, staticUrdu, type UrduNameMap } from "@/lib/report-i18n";
import { UrduUnder, BiLabel } from "@/components/shared/UrduText";

interface Props {
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  /** Pre-translated English → Urdu account names. */
  urduMap?: UrduNameMap;
}

export default function BalanceSheet({ assets, liabilities, equity, urduMap = {} }: Props) {
  const totalAssets = assets.reduce((a, r) => a + r.amount, 0);
  const totalLiabilities = liabilities.reduce((a, r) => a + r.amount, 0);
  const totalEquity = equity.reduce((a, r) => a + r.amount, 0);
  const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

  return (
    <div className="glass-card overflow-hidden h-full flex flex-col">
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-h2 font-semibold"><BiLabel en="Balance Sheet" /></h3>
          {isBalanced ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-status-optimal/15 text-status-optimal border border-status-optimal/20">
              BALANCED
            </span>
          ) : (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-status-alert/15 text-status-alert border border-status-alert/20">
              UNBALANCED
            </span>
          )}
        </div>
        <div className="glow-line mb-3" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        <div>
          <p className="text-caption text-crimson-primary uppercase tracking-wider font-medium mb-2"><BiLabel en="Assets" /></p>
          {assets.length === 0 ? (
            <p className="text-caption text-muted py-2">
              No asset entries
              <UrduUnder ur={staticUrdu("No asset entries")} />
            </p>
          ) : (
            <div className="space-y-1">
              {assets.map((r) => (
                <div key={r.account_code} className="flex justify-between py-1 border-b border-border-subtle">
                  <div className="min-w-0 flex-1">
                    <span className="text-body text-foreground truncate block">{r.account_name}</span>
                    <UrduUnder ur={accountUrdu(r.account_name, urduMap, r.name_urdu)} />
                  </div>
                  <span className="font-mono text-num-table text-foreground shrink-0 ml-2">{formatPKR(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between py-1 font-semibold">
                <span className="text-body text-foreground"><BiLabel en="Total Assets" /></span>
                <span className="font-mono text-num-kpi text-crimson-primary">{formatPKR(totalAssets)}</span>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="text-caption text-status-amber uppercase tracking-wider font-medium mb-2"><BiLabel en="Liabilities" /></p>
          {liabilities.length === 0 ? (
            <p className="text-caption text-muted py-2">
              No liability entries
              <UrduUnder ur={staticUrdu("No liability entries")} />
            </p>
          ) : (
            <div className="space-y-1">
              {liabilities.map((r) => (
                <div key={r.account_code} className="flex justify-between py-1 border-b border-border-subtle">
                  <div className="min-w-0 flex-1">
                    <span className="text-body text-foreground truncate block">{r.account_name}</span>
                    <UrduUnder ur={accountUrdu(r.account_name, urduMap, r.name_urdu)} />
                  </div>
                  <span className="font-mono text-num-table text-foreground shrink-0 ml-2">{formatPKR(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between py-1 font-semibold">
                <span className="text-body text-foreground"><BiLabel en="Total Liabilities" /></span>
                <span className="font-mono text-num-kpi text-foreground">{formatPKR(totalLiabilities)}</span>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="text-caption text-secondary uppercase tracking-wider font-medium mb-2"><BiLabel en="Equity" /></p>
          {equity.length === 0 ? (
            <p className="text-caption text-muted py-2">
              No equity entries
              <UrduUnder ur={staticUrdu("No equity entries")} />
            </p>
          ) : (
            <div className="space-y-1">
              {equity.map((r) => (
                <div key={r.account_code} className="flex justify-between py-1 border-b border-border-subtle">
                  <div className="min-w-0 flex-1">
                    <span className="text-body text-foreground truncate block">{r.account_name}</span>
                    <UrduUnder ur={accountUrdu(r.account_name, urduMap, r.name_urdu)} />
                  </div>
                  <span className="font-mono text-num-table text-foreground shrink-0 ml-2">{formatPKR(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between py-1 font-semibold">
                <span className="text-body text-foreground"><BiLabel en="Total Equity" /></span>
                <span className="font-mono text-num-kpi text-foreground">{formatPKR(totalEquity)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="glow-line" />

        <div className="flex justify-between items-center">
          <span className="text-body font-semibold text-foreground"><BiLabel en="Liabilities + Equity" /></span>
          <span className="font-mono text-num-kpi font-bold text-foreground">{formatPKR(totalLiabilities + totalEquity)}</span>
        </div>
      </div>
    </div>
  );
}
