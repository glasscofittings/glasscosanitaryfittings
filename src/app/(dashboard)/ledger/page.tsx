"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchAccounts,
  fetchJournalEntries,
  fetchFinancialStatements,
  postJournalEntry,
  type Account,
  type JournalEntryWithLines,
  type FinancialStatements,
  type TrialBalanceRow,
} from "@/lib/supabase/ledger";
import NewJournalEntryModal from "@/components/modules/ledger/NewJournalEntryModal";
import EditJournalEntryModal from "@/components/modules/ledger/EditJournalEntryModal";
import { formatPKR } from "@/lib/utils/formatters";
import {
  exportLedgerReportPDF,
  exportJournalPDF,
  exportJournalEntryPDF,
  exportTrialBalancePDF,
  exportProfitLossPDF,
  exportBalanceSheetPDF,
} from "@/lib/pdf-exporter";
import {
  accountUrdu,
  buildTranslatedAccountMap,
  collectJournalAccountNames,
  collectStatementNames,
  staticUrdu,
  type UrduNameMap,
} from "@/lib/report-i18n";
import { UrduUnder, BiLabel } from "@/components/shared/UrduText";
import { fetchParties, type Party } from "@/lib/supabase/crm";
import {
  balanceAmountLabel,
  balanceSide,
  isPayableControlAccount,
  isReceivableControlAccount,
  partySignedOpeningBalance,
  pickPartyControlAccount,
} from "@/lib/party-statement";
import IndividualLedgerModal, { type IndividualLedgerTarget } from "@/components/modules/ledger/IndividualLedgerModal";
import AvailableFundsCard from "@/components/modules/ledger/AvailableFundsCard";
import AccountManager from "@/components/modules/ledger/AccountManager";

type Tab = "journal" | "trial" | "pl" | "bs" | "accounts";

interface SubPartyItem {
  name: string;
  partyId?: string;
  partyType?: string;
  opening_balance?: number;
  opening_balance_type?: "Dr" | "Cr";
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalanceRowWithSubParties extends TrialBalanceRow {
  subParties: SubPartyItem[];
}

interface PartyAccountTotal {
  code: string;
  name: string;
  type?: string;
  debit: number;
  credit: number;
}

interface PartyLedgerSummaryItem {
  key: string;
  id?: string;
  name: string;
  party_type?: "SUPPLIER" | "CUSTOMER" | "BOTH" | "VENDOR";
  phone?: string;
  email?: string;
  address?: string;
  ntn_strn?: string;
  opening_balance?: number;
  opening_balance_type?: "Dr" | "Cr";
  /** Every account that references this party, with its debit/credit totals. */
  matchedAccounts: PartyAccountTotal[];
  /** The account this party's statement is read from: AP for suppliers, AR for customers. */
  controlAccountCode?: string;
  total_debit: number;
  total_credit: number;
  /** Signed control-account balance: positive = Dr, negative = Cr. */
  net_balance: number;
}

export default function LedgerPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("journal");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [entries, setEntries] = useState<JournalEntryWithLines[]>([]);
  const [statements, setStatements] = useState<FinancialStatements | null>(null);
  /** English → Urdu account names, pre-translated once so rows/PDFs render bilingual. */
  const [accountUrduMap, setAccountUrduMap] = useState<UrduNameMap>({});
  const [isLive, setIsLive] = useState(false);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [trialSearchQuery, setTrialSearchQuery] = useState("");
  const [editEntry, setEditEntry] = useState<JournalEntryWithLines | null>(null);
  const [selectedLedgerTarget, setSelectedLedgerTarget] = useState<IndividualLedgerTarget | null>(null);
  /** Bumped after save/post so Available Funds re-SUMs journal_lines. */
  const [fundsRefreshKey, setFundsRefreshKey] = useState(0);

  const fetchAll = useCallback(
    () => Promise.all([fetchAccounts(), fetchJournalEntries(), fetchFinancialStatements(), fetchParties("ALL")]),
    []
  );

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(([acc, ent, stmt, pts]) => {
      if (cancelled) return;
      setAccounts(acc);
      setEntries(ent);
      setStatements(stmt);
      setParties(pts);
      if (acc.length > 0) setIsLive(true);
    });
    return () => { cancelled = true; };
  }, [fetchAll]);

  // One translation batch for every account name / statement label on this page.
  useEffect(() => {
    if (!statements) return;
    let cancelled = false;
    buildTranslatedAccountMap([
      ...collectStatementNames(statements),
      ...collectJournalAccountNames(entries),
    ])
      .then((map) => { if (!cancelled) setAccountUrduMap(map); })
      .catch((err) => console.warn("[ledger] account translation failed:", err));
    return () => { cancelled = true; };
  }, [statements, entries]);

  async function loadData() {
    const [acc, ent, stmt, pts] = await fetchAll();
    setAccounts(acc);
    setEntries(ent);
    setStatements(stmt);
    setParties(pts);
    if (acc.length > 0) setIsLive(true);
    setFundsRefreshKey((k) => k + 1);
  }

  async function handleRefresh(headerOnly?: boolean) {
    await loadData();
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
    if (headerOnly === true) {
      toast.info("Draft saved without lines.");
    } else if (headerOnly === false) {
      toast.success("Journal entry saved.");
    }
  }

  const OPERATOR = "Accounts Dept";

  async function handleExportPDF() {
    if (!statements) return;
    await exportLedgerReportPDF({ entries, statements, operatorName: OPERATOR, urduMap: accountUrduMap });
  }

  /** Per-tab export, so a single statement can be filed without the rest of the ledger. */
  async function handleExportSection() {
    if (tab === "journal") {
      await exportJournalPDF({ entries, operatorName: OPERATOR, urduMap: accountUrduMap });
      return;
    }
    if (!statements) return;
    if (tab === "trial") await exportTrialBalancePDF({ statements, operatorName: OPERATOR, urduMap: accountUrduMap });
    else if (tab === "pl") await exportProfitLossPDF({ statements, operatorName: OPERATOR, urduMap: accountUrduMap });
    else await exportBalanceSheetPDF({ statements, operatorName: OPERATOR, urduMap: accountUrduMap });
  }

  async function handlePost(entryId: string) {
    const ok = await postJournalEntry(entryId);
    if (ok) {
      toast.success("Journal entry posted.");
      handleRefresh();
    } else {
      toast.error("Failed to post journal entry.");
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "journal", label: "Journal" },
    { key: "trial", label: "Trial Balance" },
    { key: "pl", label: "P&L" },
    { key: "bs", label: "Balance Sheet" },
    { key: "accounts", label: "Accounts" },
  ];

  // Matched Person / Party Summaries across CRM parties and journal entries
  const partyLedgerSummaries = useMemo<PartyLedgerSummaryItem[]>(() => {
    const q = trialSearchQuery.toLowerCase().trim();
    if (!q) return [];

    const summaryMap = new Map<string, PartyLedgerSummaryItem>();

    // Check CRM parties matching query
    parties.forEach((p) => {
      const pName = p.name.toLowerCase();
      const pId = p.id.toLowerCase();
      const pPhone = (p.phone || "").toLowerCase();
      if (pName.includes(q) || pId.includes(q) || pPhone.includes(q)) {
        summaryMap.set(p.name.toLowerCase().trim(), {
          key: p.id,
          id: p.id,
          name: p.name,
          party_type: p.party_type,
          phone: p.phone,
          email: p.email,
          address: p.address,
          ntn_strn: p.ntn_strn,
          opening_balance: p.opening_balance,
          opening_balance_type: p.opening_balance_type,
          matchedAccounts: [],
          total_debit: 0,
          total_credit: 0,
          net_balance: 0,
        });
      }
    });

    // Populate balances and find customer_name matches from entries
    entries.forEach((entry) => {
      const custName = (entry.customer_name || "").trim();
      const custNorm = custName.toLowerCase();

      (entry.journal_lines || []).forEach((line) => {
        const linePartyName = line.parties?.name || custName;
        const linePartyNorm = linePartyName.toLowerCase().trim();

        const isPartyMatch =
          (linePartyNorm && linePartyNorm.includes(q)) ||
          (custNorm && custNorm.includes(q)) ||
          (line.party_id && line.party_id.toLowerCase().includes(q));

        if (linePartyName && (isPartyMatch || summaryMap.has(linePartyNorm))) {
          const key = linePartyNorm;
          if (!summaryMap.has(key)) {
            const matchedCrmParty = parties.find((p) => p.name.toLowerCase().trim() === key);
            const account = line.accounts_chart;
            // Type comes from CRM / the joined party first; otherwise infer from the
            // control account (payable -> supplier, receivable -> customer) so a
            // supplier's inventory debit is never mistaken for a customer.
            const inferredType =
              account && isPayableControlAccount({ code: account.account_code, name: account.account_name, type: account.account_type })
                ? "SUPPLIER"
                : account && isReceivableControlAccount({ code: account.account_code, name: account.account_name })
                ? "CUSTOMER"
                : line.debit_pkr > 0
                ? "CUSTOMER"
                : "SUPPLIER";
            summaryMap.set(key, {
              key: line.party_id || key,
              id: line.party_id || matchedCrmParty?.id,
              name: matchedCrmParty?.name || linePartyName,
              party_type:
                matchedCrmParty?.party_type ||
                (line.parties?.party_type as PartyLedgerSummaryItem["party_type"]) ||
                (inferredType as PartyLedgerSummaryItem["party_type"]),
              phone: matchedCrmParty?.phone,
              email: matchedCrmParty?.email,
              address: matchedCrmParty?.address,
              ntn_strn: matchedCrmParty?.ntn_strn,
              opening_balance: matchedCrmParty?.opening_balance,
              opening_balance_type: matchedCrmParty?.opening_balance_type,
              matchedAccounts: [],
              total_debit: 0,
              total_credit: 0,
              net_balance: 0,
            });
          }

          const partySummary = summaryMap.get(key)!;

          // Track debit/credit PER ACCOUNT: a purchase posts DR inventory / CR AP
          // and both lines carry the party, so summing every line would cancel out.
          if (line.accounts_chart?.account_code) {
            const accCode = line.accounts_chart.account_code;
            let acc = partySummary.matchedAccounts.find((a) => a.code === accCode);
            if (!acc) {
              acc = {
                code: accCode,
                name: line.accounts_chart.account_name,
                type: line.accounts_chart.account_type,
                debit: 0,
                credit: 0,
              };
              partySummary.matchedAccounts.push(acc);
            }
            acc.debit += line.debit_pkr || 0;
            acc.credit += line.credit_pkr || 0;
          }
        }
      });
    });

    // Read each party from ITS control account: AP for suppliers (purchases credit
    // it, payments debit it), AR for customers (invoices debit it, receipts credit
    // it) - so supplier balances come out Cr and customer balances Dr.
    const summaries = Array.from(summaryMap.values());
    summaries.forEach((p) => {
      const controlCode = pickPartyControlAccount(p.party_type, p.matchedAccounts, p.matchedAccounts[0]);
      const control = p.matchedAccounts.find((a) => a.code === controlCode);
      p.controlAccountCode = controlCode;
      p.total_debit = control?.debit ?? 0;
      p.total_credit = control?.credit ?? 0;
      p.net_balance = Math.round((partySignedOpeningBalance(p) + p.total_debit - p.total_credit) * 100) / 100;
    });

    return summaries;
  }, [trialSearchQuery, parties, entries]);

  // Filtered Trial Balance rows with matching sub-accounts / parties
  const filteredTrialBalance = useMemo<TrialBalanceRowWithSubParties[]>(() => {
    if (!statements?.trialBalance) return [];
    const q = trialSearchQuery.toLowerCase().trim();
    if (!q) {
      return statements.trialBalance.map((r) => ({ ...r, subParties: [] }));
    }

    return statements.trialBalance
      .map((row) => {
        const codeMatches = row.account_code.toLowerCase().includes(q);
        const nameMatches = row.account_name.toLowerCase().includes(q);

        const subPartyMap = new Map<string, SubPartyItem>();

        entries.forEach((entry) => {
          (entry.journal_lines || []).forEach((line) => {
            if (line.accounts_chart?.account_code === row.account_code) {
              const pName = line.parties?.name || (entry.customer_name || "").trim();
              const pId = line.party_id || line.parties?.id;
              if (pName) {
                const pNorm = pName.toLowerCase().trim();
                if (pNorm.includes(q) || (pId && pId.toLowerCase().includes(q)) || codeMatches || nameMatches) {
                  if (!subPartyMap.has(pNorm)) {
                    const crmP = parties.find((p) => p.name.toLowerCase().trim() === pNorm);
                    subPartyMap.set(pNorm, {
                      name: crmP?.name || pName,
                      partyId: pId || crmP?.id,
                      partyType: crmP?.party_type,
                      opening_balance: crmP?.opening_balance,
                      opening_balance_type: crmP?.opening_balance_type,
                      debit: 0,
                      credit: 0,
                      balance: 0,
                    });
                  }
                  const sub = subPartyMap.get(pNorm)!;
                  sub.debit += line.debit_pkr || 0;
                  sub.credit += line.credit_pkr || 0;
                  sub.balance = sub.debit - sub.credit;
                }
              }
            }
          });
        });

        const subParties = Array.from(subPartyMap.values());
        const hasMatchingSubParties = subParties.some((s) => s.name.toLowerCase().includes(q) || (s.partyId && s.partyId.toLowerCase().includes(q)));

        if (codeMatches || nameMatches || hasMatchingSubParties) {
          return {
            ...row,
            subParties,
          };
        }
        return null;
      })
      .filter((r): r is TrialBalanceRowWithSubParties => r !== null);
  }, [statements, trialSearchQuery, entries, parties]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display font-bold tracking-tight">General Ledger</h1>
          <p className="text-body text-secondary mt-1">Double-Entry Accounting &amp; Financial Statements</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isLive && (
            <span className="flex items-center gap-1.5 text-caption text-status-optimal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-optimal animate-pulse" />
              LIVE
            </span>
          )}
          <button
            onClick={handleExportPDF}
            disabled={!statements || (entries.length === 0 && statements.trialBalance.length === 0)}
            title={!statements ? "Loading ledger..." : "Export journal, trial balance, P&L and balance sheet as a PDF"}
            className="h-9 px-3 sm:px-4 rounded-lg bg-bg-muted text-secondary border border-border-default font-medium text-body hover:bg-bg-muted hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden xs:inline">Export PDF</span>
          </button>
          <button
            onClick={() => setNewEntryOpen(true)}
            className="h-9 px-4 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors"
          >
            + New Entry
          </button>
        </div>
      </div>

      <div className="glow-line" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <AvailableFundsCard refreshKey={fundsRefreshKey} variant="ledger" />
        {statements && (
          <>
            <KPICard label="Total Debit" value={formatPKR(statements.totalDebit)} accent="crimson" />
            <KPICard label="Total Credit" value={formatPKR(statements.totalCredit)} accent="crimson" />
            <KPICard label="Net Profit" value={formatPKR(statements.pl.netProfit)} accent="green" />
            <KPICard label="Assets" value={formatPKR(statements.totalAssets)} accent="amber" />
          </>
        )}
      </div>

      <div className="flex gap-1 bg-bg-muted rounded-lg p-1 overflow-x-auto no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-[90px] h-8 rounded-md text-caption sm:text-body font-medium transition-colors whitespace-nowrap px-2 ${
              tab === t.key
                ? "bg-bg-primary text-foreground shadow-sm"
                : "text-secondary hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "journal" && (
        <div className="space-y-3">
          <SectionExportBar
            label="Journal"
            onExport={handleExportSection}
            disabled={entries.length === 0}
          />

          <div className="relative max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by entry #, remarks, or account..."
              className="h-9 w-full pl-10 pr-8 rounded-lg bg-bg-muted border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded flex items-center justify-center text-muted hover:text-foreground transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {(() => {
            const q = searchQuery.toLowerCase().trim();
            const filtered = q
              ? entries.filter((e) => {
                  if (e.entry_number?.toLowerCase().includes(q)) return true;
                  if (e.narration?.toLowerCase().includes(q)) return true;
                  if (e.customer_name?.toLowerCase().includes(q)) return true;
                  return e.journal_lines?.some(
                    (l) =>
                      l.accounts_chart?.account_code?.toLowerCase().includes(q) ||
                      l.accounts_chart?.account_name?.toLowerCase().includes(q)
                  );
                })
              : entries;

            if (filtered.length === 0) {
              return (
                <div className="glass-card p-12 text-center">
                  <p className="text-body text-muted">
                    {q ? "No entries match your search." : 'No journal entries yet. Click "+ New Entry" to create your first transaction.'}
                  </p>
                </div>
              );
            }

            return filtered.map((entry) => (
              <div key={entry.id} className="glass-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-body text-foreground">{entry.entry_number}</span>
                    <span className="text-caption text-muted">
                      {new Date(entry.entry_date).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${entry.status === "POSTED" ? "bg-status-optimal/15 text-status-optimal" : "bg-status-amber/15 text-status-amber"}`}>
                      {entry.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ExportPdfButton
                      compact
                      label="PDF"
                      title={`Export entry ${entry.entry_number} as a PDF`}
                      onClick={() => void exportJournalEntryPDF({ entry, operatorName: OPERATOR, urduMap: accountUrduMap })}
                    />
                    {entry.status === "DRAFT" && (
                      <>
                        <button
                          onClick={() => setEditEntry(entry)}
                          className="h-7 px-2.5 rounded-md bg-bg-muted text-secondary border border-border-default text-caption font-medium hover:text-foreground hover:bg-bg-subtle transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handlePost(entry.id)}
                          className="h-7 px-3 rounded-md bg-crimson-primary text-white text-caption font-medium hover:bg-crimson-dark transition-colors"
                        >
                          Post
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-caption text-secondary">{entry.narration}</p>
                {entry.customer_name && (
                  <p className="text-caption text-muted">Customer: <span className="text-foreground">{entry.customer_name}</span></p>
                )}
                {entry.journal_lines && entry.journal_lines.length > 0 && (
                  <div className="glass-card overflow-hidden">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-border-subtle">
                          <th className="px-4 py-1.5 text-[10px] text-muted uppercase tracking-wider">Account</th>
                          <th className="px-4 py-1.5 text-[10px] text-muted uppercase tracking-wider text-right">Debit</th>
                          <th className="px-4 py-1.5 text-[10px] text-muted uppercase tracking-wider text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.journal_lines.map((line) => (
                          <tr key={line.id} className="border-b border-border-subtle last:border-0">
                            <td className="px-4 py-1.5 text-body text-foreground">
                              {line.accounts_chart?.account_code} — {line.accounts_chart?.account_name}
                            </td>
                            <td className="px-4 py-1.5 text-body font-mono text-right whitespace-nowrap">
                              {line.debit_pkr > 0 ? formatPKR(line.debit_pkr) : "—"}
                            </td>
                            <td className="px-4 py-1.5 text-body font-mono text-right whitespace-nowrap">
                              {line.credit_pkr > 0 ? formatPKR(line.credit_pkr) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ));
          })()}
        </div>
      )}

      {tab === "trial" && statements && (
        <div className="space-y-4">
          <SectionExportBar
            label="Trial Balance"
            onExport={handleExportSection}
            disabled={statements.trialBalance.length === 0}
          />

          {/* Trial Balance Search Bar */}
          <div className="relative max-w-xl">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={trialSearchQuery}
              onChange={(e) => setTrialSearchQuery(e.target.value)}
              placeholder="Search person, customer, supplier, or account name..."
              className="h-10 w-full pl-10 pr-9 rounded-xl bg-bg-muted border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors shadow-sm"
            />
            {trialSearchQuery && (
              <button
                onClick={() => setTrialSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-subtle transition-colors"
                title="Clear search"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Matched Person / Party Ledgers Card */}
          {trialSearchQuery && partyLedgerSummaries.length > 0 && (
            <div className="glass-card p-4 space-y-3 border-l-4 border-l-crimson-primary animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">👤</span>
                  <h3 className="text-body font-bold text-foreground">
                    Matched Person &amp; Party Ledgers ({partyLedgerSummaries.length})
                  </h3>
                </div>
                <span className="text-caption text-muted">Click &quot;View Ledger&quot; for complete transaction sheet</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {partyLedgerSummaries.map((p: PartyLedgerSummaryItem) => (
                  <div
                    key={p.key}
                    className="p-3 rounded-xl bg-bg-muted/70 border border-border-default hover:border-border-strong transition-all flex flex-col justify-between gap-3 shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-foreground text-body line-clamp-1">{p.name}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                          p.party_type === "CUSTOMER"
                            ? "bg-status-optimal/15 text-status-optimal"
                            : p.party_type === "SUPPLIER"
                            ? "bg-status-amber/15 text-status-amber"
                            : "bg-crimson-primary/15 text-crimson-primary"
                        }`}>
                          {p.party_type || "PARTY"}
                        </span>
                      </div>
                      {p.matchedAccounts.length > 0 && (
                        <p className="text-[11px] text-secondary mt-1">
                          Statement account:{" "}
                          <span className="font-semibold text-foreground">
                            {p.matchedAccounts.find((a) => a.code === p.controlAccountCode)?.code ?? p.matchedAccounts[0].code} —{" "}
                            {p.matchedAccounts.find((a) => a.code === p.controlAccountCode)?.name ?? p.matchedAccounts[0].name}
                          </span>
                          {(() => {
                            const others = p.matchedAccounts.filter((a) => a.code !== p.controlAccountCode);
                            return others.length > 0 ? ` · also: ${others.map((a) => a.code).join(", ")}` : "";
                          })()}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between text-caption font-mono">
                        <span className="text-secondary">Dr: {formatPKR(p.total_debit)}</span>
                        <span className="text-secondary">Cr: {formatPKR(p.total_credit)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-caption text-muted uppercase tracking-wider">
                          {balanceAmountLabel(p.party_type, p.net_balance)}:
                        </span>
                        <span className={`text-body font-bold font-mono ${p.net_balance >= 0 ? "text-status-optimal" : "text-status-error"}`}>
                          {formatPKR(Math.abs(p.net_balance))} {balanceSide(p.net_balance)}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        setSelectedLedgerTarget({
                          type: "PARTY",
                          id: p.id,
                          name: p.name,
                          account_code: p.controlAccountCode || p.matchedAccounts[0]?.code || "PARTY",
                          party_type: p.party_type,
                          phone: p.phone,
                          email: p.email,
                          address: p.address,
                          ntn_strn: p.ntn_strn,
                          opening_balance: p.opening_balance,
                          opening_balance_type: p.opening_balance_type,
                        })
                      }
                      className="w-full h-8 rounded-lg bg-crimson-primary/10 border border-crimson-primary/30 text-crimson-primary text-caption font-semibold hover:bg-crimson-primary hover:text-white transition-colors flex items-center justify-center gap-1.5"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      View Ledger
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trial Balance Table */}
          <div className="glass-card overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider w-24">Code</th>
                  <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider">Account / Sub-Account</th>
                  <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider w-28">Type</th>
                  <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right w-32">Debit</th>
                  <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right w-32">Credit</th>
                  <th className="px-4 py-2.5 text-[10px] text-muted uppercase tracking-wider text-right w-32">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrialBalance.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-caption text-muted">
                      {trialSearchQuery ? (
                        <div>
                          <p>No accounts or persons match &quot;{trialSearchQuery}&quot;.</p>
                          <button
                            onClick={() => setTrialSearchQuery("")}
                            className="mt-2 text-crimson-primary font-medium text-caption hover:underline"
                          >
                            Clear Search
                          </button>
                        </div>
                      ) : (
                        "No posted entries in the trial balance yet."
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredTrialBalance.map((row: TrialBalanceRowWithSubParties) => (
                    <tr
                      key={row.account_code}
                      className="border-b border-border-subtle last:border-0 hover:bg-bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono text-body text-secondary">{row.account_code}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-body font-medium text-foreground">{row.account_name}</div>
                        <UrduUnder ur={accountUrdu(row.account_name, accountUrduMap, row.name_urdu)} />
                        {row.subParties && row.subParties.length > 0 && (
                          <div className="mt-1 space-y-1">
                            {row.subParties.map((sub: SubPartyItem) => (
                              <div
                                key={sub.name}
                                className="flex items-center justify-between text-caption pl-3 py-1 rounded bg-bg-muted/40 border border-border-subtle/50"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="text-muted">↳</span>
                                  <span className="font-semibold text-foreground">{sub.name}</span>
                                  <span className="text-[10px] text-muted">({sub.partyType || "Party"})</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-[11px] text-secondary">
                                    Dr: {formatPKR(sub.debit)} | Cr: {formatPKR(sub.credit)}
                                  </span>
                                  <button
                                    onClick={() =>
                                      setSelectedLedgerTarget({
                                        type: "PARTY",
                                        id: sub.partyId,
                                        name: sub.name,
                                        account_code: row.account_code,
                                        party_type: (sub.partyType as IndividualLedgerTarget["party_type"]) ?? undefined,
                                        opening_balance: sub.opening_balance,
                                        opening_balance_type: sub.opening_balance_type,
                                      })
                                    }
                                    className="h-6 px-2 rounded bg-crimson-primary/15 hover:bg-crimson-primary text-crimson-primary hover:text-white text-[10px] font-semibold transition-colors"
                                  >
                                    View Ledger
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${typeColor(row.account_type)}`}>
                          {row.account_type}
                        </span>
                        <UrduUnder ur={staticUrdu(row.account_type)} />
                      </td>
                      <td className="px-4 py-2.5 text-body font-mono text-right whitespace-nowrap text-foreground">
                        {row.total_debit > 0 ? formatPKR(row.total_debit) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-body font-mono text-right whitespace-nowrap text-foreground">
                        {row.total_credit > 0 ? formatPKR(row.total_credit) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() =>
                            setSelectedLedgerTarget({
                              type: "ACCOUNT",
                              id: accounts.find((a) => a.account_code === row.account_code)?.id,
                              name: row.account_name,
                              account_code: row.account_code,
                              account_type: row.account_type,
                            })
                          }
                          className="h-7 px-2.5 rounded-md bg-bg-muted hover:bg-crimson-primary text-secondary hover:text-white border border-border-default hover:border-crimson-primary text-caption font-medium transition-colors"
                          title={`View ledger sheet for ${row.account_name}`}
                        >
                          View Ledger
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredTrialBalance.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border-default bg-bg-subtle">
                    <td colSpan={3} className="px-4 py-2.5 text-body font-semibold text-foreground">
                      <BiLabel en={trialSearchQuery ? "Filtered Totals" : "Grand Totals"} />
                    </td>
                    <td className="px-4 py-2.5 text-body font-mono font-semibold text-right whitespace-nowrap text-foreground">
                      {formatPKR(filteredTrialBalance.reduce((a: number, r: TrialBalanceRowWithSubParties) => a + r.total_debit, 0))}
                    </td>
                    <td className="px-4 py-2.5 text-body font-mono font-semibold text-right whitespace-nowrap text-foreground">
                      {formatPKR(filteredTrialBalance.reduce((a: number, r: TrialBalanceRowWithSubParties) => a + r.total_credit, 0))}
                    </td>
                    <td className="px-4 py-2.5" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {tab === "pl" && statements && (
        <div className="space-y-3">
          <SectionExportBar label="Profit & Loss" onExport={handleExportSection} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card p-5 space-y-3">
              <h3 className="text-h2 font-semibold text-status-optimal"><BiLabel en="Revenue" /></h3>
              <div className="glow-line" />
              {statements.pl.revenue.length === 0 ? (
                <p className="text-caption text-muted py-4 text-center">
                  No revenue entries
                  <UrduUnder ur={staticUrdu("No revenue entries")} />
                </p>
              ) : (
                statements.pl.revenue.map((r) => (
                  <div key={r.account_code} className="flex justify-between text-body">
                    <span className="text-secondary">
                      {r.account_name}
                      <UrduUnder ur={accountUrdu(r.account_name, accountUrduMap, r.name_urdu)} />
                    </span>
                    <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(r.amount)}</span>
                  </div>
                ))
              )}
              <div className="glow-line" />
              <div className="flex justify-between text-body font-semibold">
                <span><BiLabel en="Total Revenue" /></span>
                <span className="font-mono text-num-kpi text-status-optimal whitespace-nowrap">
                  {formatPKR(statements.pl.revenue.reduce((a, r) => a + r.amount, 0))}
                </span>
              </div>
            </div>

            <div className="glass-card p-5 space-y-3">
              <h3 className="text-h2 font-semibold text-status-error"><BiLabel en="Expenses" /></h3>
              <div className="glow-line" />
              {statements.pl.expenses.length === 0 ? (
                <p className="text-caption text-muted py-4 text-center">
                  No expense entries
                  <UrduUnder ur={staticUrdu("No expense entries")} />
                </p>
              ) : (
                statements.pl.expenses.map((r) => (
                  <div key={r.account_code} className="flex justify-between text-body">
                    <span className="text-secondary">
                      {r.account_name}
                      <UrduUnder ur={accountUrdu(r.account_name, accountUrduMap, r.name_urdu)} />
                    </span>
                    <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(r.amount)}</span>
                  </div>
                ))
              )}
              <div className="glow-line" />
              <div className="flex justify-between text-body font-semibold">
                <span><BiLabel en="Total Expenses" /></span>
                <span className="font-mono text-num-kpi text-status-error whitespace-nowrap">
                  {formatPKR(statements.pl.expenses.reduce((a, r) => a + r.amount, 0))}
                </span>
              </div>
            </div>

            <div className="md:col-span-2 glass-card p-5">
              <div className="flex justify-between items-center">
                <span className="text-h2 font-semibold"><BiLabel en={statements.pl.netProfit >= 0 ? "Net Profit" : "Net Loss"} /></span>
                <span className={`font-mono font-bold ${statements.pl.netProfit >= 0 ? "text-status-optimal" : "text-status-error"}`} style={{ fontSize: "1.5rem", lineHeight: "2rem" }}>
                  {formatPKR(statements.pl.netProfit)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "bs" && statements && (
        <div className="space-y-3">
          <SectionExportBar label="Balance Sheet" onExport={handleExportSection} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-card p-5 space-y-3">
              <h3 className="text-h2 font-semibold"><BiLabel en="Assets" /></h3>
              <div className="glow-line" />
              {statements.balanceSheet.assets.length === 0 ? (
                <p className="text-caption text-muted py-4 text-center">
                  No asset entries
                  <UrduUnder ur={staticUrdu("No asset entries")} />
                </p>
              ) : (
                statements.balanceSheet.assets.map((r) => (
                  <div key={r.account_code} className="flex justify-between text-body">
                    <span className="text-secondary">
                      {r.account_name}
                      <UrduUnder ur={accountUrdu(r.account_name, accountUrduMap, r.name_urdu)} />
                    </span>
                    <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(r.amount)}</span>
                  </div>
                ))
              )}
              <div className="glow-line" />
              <div className="flex justify-between text-body font-semibold">
                <span><BiLabel en="Total Assets" /></span>
                <span className="font-mono text-num-kpi text-foreground whitespace-nowrap">{formatPKR(statements.totalAssets)}</span>
              </div>
            </div>

            <div className="glass-card p-5 space-y-3">
              <h3 className="text-h2 font-semibold"><BiLabel en="Liabilities" /></h3>
              <div className="glow-line" />
              {statements.balanceSheet.liabilities.length === 0 ? (
                <p className="text-caption text-muted py-4 text-center">
                  No liability entries
                  <UrduUnder ur={staticUrdu("No liability entries")} />
                </p>
              ) : (
                statements.balanceSheet.liabilities.map((r) => (
                  <div key={r.account_code} className="flex justify-between text-body">
                    <span className="text-secondary">
                      {r.account_name}
                      <UrduUnder ur={accountUrdu(r.account_name, accountUrduMap, r.name_urdu)} />
                    </span>
                    <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(r.amount)}</span>
                  </div>
                ))
              )}
              <div className="glow-line" />
              <div className="flex justify-between text-body font-semibold">
                <span><BiLabel en="Total Liabilities" /></span>
                <span className="font-mono text-num-kpi text-foreground whitespace-nowrap">{formatPKR(statements.totalLiabilities)}</span>
              </div>
            </div>

            <div className="glass-card p-5 space-y-3">
              <h3 className="text-h2 font-semibold"><BiLabel en="Equity + Profit" /></h3>
              <div className="glow-line" />
              {statements.balanceSheet.equity.map((r) => (
                <div key={r.account_code} className="flex justify-between text-body">
                  <span className="text-secondary">
                    {r.account_name}
                    <UrduUnder ur={accountUrdu(r.account_name, accountUrduMap, r.name_urdu)} />
                  </span>
                  <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between text-body">
                <span className="text-secondary">
                  Net Profit (P&amp;L)
                  <UrduUnder ur={staticUrdu("Net Profit (P&L)")} />
                </span>
                <span className="font-mono text-num-table text-foreground whitespace-nowrap">{formatPKR(statements.pl.netProfit)}</span>
              </div>
              <div className="glow-line" />
              <div className="flex justify-between text-body font-semibold">
                <span><BiLabel en="Total Equity" /></span>
                <span className="font-mono text-num-kpi text-foreground whitespace-nowrap">{formatPKR(statements.totalEquity)}</span>
              </div>
            </div>

            <div className="md:col-span-3 glass-card p-5">
              <div className="flex justify-between items-center">
                <span className="text-h2 font-semibold"><BiLabel en="Balance Check" /></span>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-caption text-muted">Assets</p>
                    <p className="font-mono text-body font-semibold">{formatPKR(statements.totalAssets)}</p>
                  </div>
                  <span className="text-h2 font-bold text-muted">=</span>
                  <div className="text-right">
                    <p className="text-caption text-muted">
                      Liabilities + Equity
                      <UrduUnder ur={staticUrdu("Liabilities + Equity")} />
                    </p>
                    <p className="font-mono text-body font-semibold">{formatPKR(statements.totalLiabilities + statements.totalEquity)}</p>
                  </div>
                  <span className={`ml-2 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    Math.abs(statements.totalAssets - (statements.totalLiabilities + statements.totalEquity)) < 0.01
                      ? "bg-status-optimal/15 text-status-optimal"
                      : "bg-status-error/15 text-status-error"
                  }`}>
                    {Math.abs(statements.totalAssets - (statements.totalLiabilities + statements.totalEquity)) < 0.01 ? "BALANCED" : "OUT OF BALANCE"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "accounts" && (
        <AccountManager
          accounts={accounts}
          onRefresh={() => handleRefresh()}
          onViewLedger={(acc) =>
            setSelectedLedgerTarget({
              type: "ACCOUNT",
              id: acc.id,
              name: acc.account_name,
              account_code: acc.account_code,
              account_type: acc.account_type,
            })
          }
        />
      )}

      <NewJournalEntryModal
        accounts={accounts}
        open={newEntryOpen}
        onClose={() => setNewEntryOpen(false)}
        onSaved={handleRefresh}
      />

      <EditJournalEntryModal
        key={editEntry?.id ?? "edit-je"}
        entry={editEntry}
        accounts={accounts}
        open={editEntry !== null}
        onClose={() => setEditEntry(null)}
        onSaved={handleRefresh}
      />

      <IndividualLedgerModal
        open={selectedLedgerTarget !== null}
        onClose={() => setSelectedLedgerTarget(null)}
        target={selectedLedgerTarget}
        entries={entries}
        operatorName={OPERATOR}
      />
    </div>
  );
}

/** Download glyph shared by every export button on this page. */
function ExportIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function ExportPdfButton({
  label,
  title,
  onClick,
  disabled,
  compact,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${compact ? "h-7 px-2.5 text-caption gap-1" : "h-8 px-3 text-body gap-1.5"} rounded-lg bg-bg-muted text-secondary border border-border-default font-medium hover:text-foreground disabled:text-disabled disabled:cursor-not-allowed transition-colors flex items-center`}
    >
      <ExportIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {label}
    </button>
  );
}

/** Heading + its own export button, one per ledger tab. */
function SectionExportBar({
  label,
  onExport,
  disabled,
}: {
  label: string;
  onExport: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-h2 font-semibold">{label}</h2>
      <ExportPdfButton
        label={`Export ${label} PDF`}
        title={disabled ? `Nothing to export in ${label} yet` : `Export ${label} on its own as a PDF`}
        onClick={onExport}
        disabled={disabled}
      />
    </div>
  );
}

function KPICard({ label, value, accent }: { label: string; value: string; accent: "crimson" | "green" | "amber" }) {
  const accentMap = {
    crimson: { dot: "bg-crimson-primary", text: "text-crimson-primary" },
    green: { dot: "bg-status-optimal", text: "text-status-optimal" },
    amber: { dot: "bg-status-amber", text: "text-status-amber" },
  };
  return (
    <div className="glass-card p-4 flex items-center justify-between min-w-0 overflow-hidden">
      <div className="min-w-0">
        <p className="text-caption text-muted uppercase tracking-wider font-medium">{label}</p>
        <p
          className={`font-bold mt-1 font-mono whitespace-nowrap overflow-hidden text-ellipsis ${accentMap[accent].text}`}
          style={{ fontSize: "1.1rem", lineHeight: "1.5rem" }}
          title={value}
        >
          {value}
        </p>
      </div>
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${accentMap[accent].dot}`} />
    </div>
  );
}

function typeColor(type: string): string {
  switch (type) {
    case "ASSET": return "bg-crimson-primary/15 text-crimson-primary";
    case "LIABILITY": return "bg-status-amber/15 text-status-amber";
    case "EQUITY": return "bg-status-optimal/15 text-status-optimal";
    case "REVENUE": return "bg-status-optimal/15 text-status-optimal";
    case "EXPENSE": return "bg-status-error/15 text-status-error";
    default: return "bg-bg-muted text-muted";
  }
}
