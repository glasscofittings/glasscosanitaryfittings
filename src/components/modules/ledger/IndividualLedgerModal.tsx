"use client";

import { useState, useMemo, useEffect } from "react";
import { formatPKR } from "@/lib/utils/formatters";
import type { JournalEntryWithLines } from "@/lib/supabase/ledger";
import { getAccountLedger, type AccountLedgerLine } from "@/lib/supabase/ledger";
import { exportPartyLedgerPDF } from "@/lib/pdf-exporter";
import { translateBatchToUrdu } from "@/lib/geminiTranslator";
import { UR } from "@/lib/pdf-urdu";
import { getExportCompanyName } from "@/lib/company-settings";
import { COMPANY_HEADER, COMPANY_LEGAL_NAME } from "@/lib/branding";
import { formatStatementDate, generateStatementHTML } from "@/lib/statement-print";
import {
  balanceAmountLabel,
  balanceSide,
  pickPartyControlAccount,
  type StatementAccountRef,
} from "@/lib/party-statement";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

export interface IndividualLedgerTarget {
  type: "PARTY" | "ACCOUNT";
  /** accounts_chart.id UUID when known (ACCOUNT targets) */
  id?: string;
  name: string;
  account_code?: string;
  account_type?: string;
  party_type?: "SUPPLIER" | "CUSTOMER" | "BOTH" | "VENDOR";
  phone?: string;
  email?: string;
  address?: string;
  ntn_strn?: string;
  /** Absolute opening balance from parties (>= 0). Side is opening_balance_type. */
  opening_balance?: number;
  opening_balance_type?: "Dr" | "Cr";
}

/** Signed opening balance for a PARTY target: Dr positive, Cr negative. ACCOUNT targets start at 0. */
function targetSignedOpening(target: IndividualLedgerTarget | null): number {
  if (!target || target.type !== "PARTY") return 0;
  const amount = Math.abs(Number(target.opening_balance ?? 0)) || 0;
  return target.opening_balance_type === "Cr" ? -amount : amount;
}

interface Props {
  open: boolean;
  onClose: () => void;
  target: IndividualLedgerTarget | null;
  entries: JournalEntryWithLines[];
  operatorName?: string;
}

interface ComputedTx {
  id: string;
  entryId: string;
  date: string;
  voucherNo: string;
  status: "DRAFT" | "POSTED";
  narration: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  balance: number;
}

/** Same shape as ComputedTx before running balance is applied. */
interface FlatLedgerLine extends Omit<ComputedTx, "balance"> {
  createdAt: string;
}

function isUuid(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default function IndividualLedgerModal({
  open,
  onClose,
  target,
  entries,
  operatorName = "Accounts Dept",
}: Props) {
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [includeDrafts, setIncludeDrafts] = useState<boolean>(true);

  // Server-side ledger for ACCOUNT targets: WHERE journal_lines.account_id = :id only
  const [accountLines, setAccountLines] = useState<AccountLedgerLine[] | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const targetKey = target
    ? `${target.type}:${target.id ?? ""}:${target.account_code ?? ""}:${target.name}`
    : "";

  /**
   * The GL account a PARTY statement is read from, resolved by party type:
   * a supplier's statement is Accounts Payable (purchase invoices CREDIT it,
   * payments DEBIT it), a customer's statement is Accounts Receivable (sales
   * invoices DEBIT it, receipts CREDIT it). The caller's account_code is kept
   * whenever it already is a valid control account for that party, so opening
   * the statement from the AP/AR row keeps that account; otherwise the control
   * account actually referencing this party is used. ACCOUNT targets are
   * never re-pointed.
   */
  const partyControlCode = useMemo(() => {
    if (!target || target.type !== "PARTY") return target?.account_code;
    const nameNorm = target.name.toLowerCase().trim();
    const refs = new Map<string, StatementAccountRef>();

    if (nameNorm || target.id) {
      entries.forEach((entry) => {
        const custNorm = (entry.customer_name || "").toLowerCase().trim();
        const entryMatch =
          !!custNorm && (custNorm === nameNorm || custNorm.includes(nameNorm) || nameNorm.includes(custNorm));
        const narrationMatch = nameNorm ? (entry.narration || "").toLowerCase().includes(nameNorm) : false;

        (entry.journal_lines || []).forEach((line) => {
          const lineMatch =
            (!!target.id && (line.party_id === target.id || line.parties?.id === target.id)) ||
            (!!line.parties?.name && !!nameNorm && line.parties.name.toLowerCase().trim() === nameNorm);
          if (!entryMatch && !narrationMatch && !lineMatch) return;

          const acc = line.accounts_chart;
          if (!acc?.account_code || refs.has(acc.account_code)) return;
          refs.set(acc.account_code, {
            code: acc.account_code,
            name: acc.account_name,
            type: acc.account_type,
          });
        });
      });
    }

    const preferredCode = target.account_code?.trim();
    const preferred: StatementAccountRef | undefined = preferredCode
      ? refs.get(preferredCode) ?? { code: preferredCode }
      : undefined;
    return pickPartyControlAccount(target.party_type, Array.from(refs.values()), preferred);
  }, [target, entries]);

  useEffect(() => {
    if (!open || !target || target.type !== "ACCOUNT") {
      return;
    }

    const uuid = isUuid(target.id) ? target.id : undefined;
    const code = target.account_code;
    if (!uuid && !code) return;

    let cancelled = false;
    (async () => {
      setAccountLoading(true);
      try {
        const lines = await getAccountLedger({ accountId: uuid, accountCode: uuid ? undefined : code });
        if (!cancelled) setAccountLines(lines);
      } finally {
        if (!cancelled) setAccountLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetKey]);

  /**
   * Strict line filter:
   * - ACCOUNT: only lines on that account (server query already guarantees this;
   *   client path still enforces account_code / account_id match).
   * - PARTY: only lines ON target.account_code (control account) that also match
   *   the party — never the counter-account side of the same JE.
   */
  const allMatchedTransactions = useMemo(() => {
    if (!target) return [];

    // ACCOUNT path: data already account-scoped by getAccountLedger
    if (target.type === "ACCOUNT" && accountLines) {
      const filtered = includeDrafts ? accountLines : accountLines.filter((l) => l.status === "POSTED");
      return filtered.map((line) => ({
        id: line.id,
        entryId: line.journal_entry_id,
        date: line.entry_date,
        voucherNo: line.entry_number,
        status: line.status,
        narration: line.narration || (line.customer_name ? `Party: ${line.customer_name}` : "Journal Transaction"),
        accountCode: target.account_code || "—",
        accountName: target.name,
        debit: line.debit_pkr,
        credit: line.credit_pkr,
        createdAt: line.created_at,
      }));
    }

    if (target.type === "ACCOUNT") {
      // Fallback while loading / if query failed: client filter by account only
      const targetCode = target.account_code;
      const targetId = isUuid(target.id) ? target.id : undefined;
      const targetNameNorm = target.name.toLowerCase().trim();
      const lines: FlatLedgerLine[] = [];

      entries.forEach((entry) => {
        if (!includeDrafts && entry.status !== "POSTED") return;
        (entry.journal_lines || []).forEach((line) => {
          const onAccount =
            (targetCode && line.accounts_chart?.account_code === targetCode) ||
            (targetId && line.account_id === targetId) ||
            (!targetCode && !targetId &&
              line.accounts_chart?.account_name?.toLowerCase().trim() === targetNameNorm);
          if (!onAccount) return;
          lines.push({
            id: line.id,
            entryId: entry.id,
            date: entry.entry_date,
            voucherNo: entry.entry_number,
            status: entry.status,
            narration: entry.narration || (entry.customer_name ? `Party: ${entry.customer_name}` : "Journal Transaction"),
            accountCode: line.accounts_chart?.account_code || target.account_code || "—",
            accountName: line.accounts_chart?.account_name || target.name,
            debit: line.debit_pkr || 0,
            credit: line.credit_pkr || 0,
            createdAt: entry.created_at || entry.entry_date,
          });
        });
      });

      lines.sort((a, b) => {
        const cmpDate = a.date.localeCompare(b.date);
        if (cmpDate !== 0) return cmpDate;
        return a.createdAt.localeCompare(b.createdAt);
      });
      return lines;
    }

    // PARTY path: require the control-account line AND a party match.
    // The control account is party-type aware (AP for suppliers, AR for customers)
    // so the statement presents the party's own account, never the counter-account.
    const targetNameNorm = target.name.toLowerCase().trim();
    const targetId = target.id;
    const targetCode = partyControlCode ?? target.account_code;
    const lines: FlatLedgerLine[] = [];

    entries.forEach((entry) => {
      if (!includeDrafts && entry.status !== "POSTED") return;

      const entryCustNorm = (entry.customer_name || "").toLowerCase().trim();
      const entryNarrNorm = (entry.narration || "").toLowerCase().trim();

      (entry.journal_lines || []).forEach((line) => {
        // Strict: when an account context is set, only that account's lines qualify
        if (targetCode && line.accounts_chart?.account_code !== targetCode) {
          // Party match with customer_name: still require the control account line
          // so counter-account sides never appear. Skip non-control lines.
          return;
        }

        let isMatch = false;

        if (targetId && (line.party_id === targetId || line.parties?.id === targetId)) {
          isMatch = true;
        } else if (line.parties?.name && line.parties.name.toLowerCase().trim() === targetNameNorm) {
          isMatch = true;
        } else if (entryCustNorm && (entryCustNorm === targetNameNorm || entryCustNorm.includes(targetNameNorm) || targetNameNorm.includes(entryCustNorm))) {
          // Entry tagged with this customer — line must already be on target account
          isMatch = true;
        } else if (entryNarrNorm.includes(targetNameNorm)) {
          isMatch = true;
        }

        if (isMatch) {
          lines.push({
            id: line.id,
            entryId: entry.id,
            date: entry.entry_date,
            voucherNo: entry.entry_number,
            status: entry.status,
            narration: entry.narration || (entry.customer_name ? `Party: ${entry.customer_name}` : "Journal Transaction"),
            accountCode: line.accounts_chart?.account_code || target.account_code || "—",
            accountName: line.accounts_chart?.account_name || target.name,
            debit: line.debit_pkr || 0,
            credit: line.credit_pkr || 0,
            createdAt: entry.created_at || entry.entry_date,
          });
        }
      });

      // ── Fallback: voucher is tagged to this party but its lines are NOT on
      // the control account. Two cases:
      //   1. customer_name is set (PPV, BRV, CRV paths hit AP/AR → comes here
      //      when the control account differs from the party type, e.g. a BPV
      //      on a customer hits AP 2001 instead of AR 1100).
      //   2. customer_name is NULL but the narration contains the payee name —
      //      this is the CPV / BPV / SPV path: create_payment_voucher only sets
      //      customer_name when AP (2001) is involved; for ordinary expense
      //      vouchers only the narration "CPV CPV-2026-XXXXX — Tallhah" carries
      //      the party name. Without this branch those vouchers would be invisible
      //      in the party's ledger.
      // Cash / Bank lines are always excluded — only the meaningful leg is shown.
      const partyMatchesEntry =
        (entryCustNorm &&
          (entryCustNorm === targetNameNorm ||
            entryCustNorm.includes(targetNameNorm) ||
            targetNameNorm.includes(entryCustNorm))) ||
        (targetNameNorm.length > 2 && entryNarrNorm.includes(targetNameNorm));

      if (partyMatchesEntry) {
        const alreadyOnControl = (entry.journal_lines || []).some(
          (line) => targetCode && line.accounts_chart?.account_code === targetCode
        );
        if (!alreadyOnControl) {
          (entry.journal_lines || []).forEach((line) => {
            const accCode = line.accounts_chart?.account_code;
            if (
              accCode === "1000" ||
              accCode === "1002" ||
              line.accounts_chart?.is_liquid_funds ||
              line.accounts_chart?.is_default_cash
            ) {
              return;
            }
            if (!line.debit_pkr && !line.credit_pkr) return;
            lines.push({
              id: line.id,
              entryId: entry.id,
              date: entry.entry_date,
              voucherNo: entry.entry_number,
              status: entry.status,
              narration:
                entry.narration ||
                (entry.customer_name ? `Party: ${entry.customer_name}` : "Journal Transaction"),
              accountCode: line.accounts_chart?.account_code || "—",
              accountName: line.accounts_chart?.account_name || target.name,
              debit: line.debit_pkr || 0,
              credit: line.credit_pkr || 0,
              createdAt: entry.created_at || entry.entry_date,
            });
          });
        }
      }
    });

    lines.sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return lines;
  }, [target, entries, includeDrafts, accountLines, partyControlCode]);

  // Opening + running balance = stored party opening + opening-period txns + debit - credit
  const { openingBalance, periodTransactions, periodDebit, periodCredit, closingBalance } = useMemo(() => {
    let opening = targetSignedOpening(target);
    const periodList: ComputedTx[] = [];

    allMatchedTransactions.forEach((tx) => {
      if (startDate && tx.date < startDate) {
        opening += tx.debit - tx.credit;
      }
    });

    let running = opening;

    allMatchedTransactions.forEach((tx) => {
      const inRange = (!startDate || tx.date >= startDate) && (!endDate || tx.date <= endDate);
      if (inRange) {
        running += tx.debit - tx.credit;
        periodList.push({
          ...tx,
          balance: running,
        });
      }
    });

    const pDebit = periodList.reduce((sum, t) => sum + t.debit, 0);
    const pCredit = periodList.reduce((sum, t) => sum + t.credit, 0);
    const closing = opening + pDebit - pCredit;

    return {
      openingBalance: opening,
      periodTransactions: periodList,
      periodDebit: pDebit,
      periodCredit: pCredit,
      closingBalance: closing,
    };
  }, [target, allMatchedTransactions, startDate, endDate]);

  useEscapeToClose(open, onClose);

  if (!open || !target) return null;

  // Manager-facing balance label: party statements always say who owes whom,
  // generic account statements keep the neutral label.
  const isPartyTarget = target.type === "PARTY" && !!target.party_type;
  const closingLabel = isPartyTarget
    ? balanceAmountLabel(target.party_type, closingBalance)
    : "Net Closing Balance";
  const closingUrLabel =
    closingLabel === "Amount Payable" ? UR.amountPayable
    : closingLabel === "Amount Receivable" ? UR.amountReceivable
    : UR.netClosingBalance;
  /** Control account actually presented (AP for suppliers, AR for customers). */
  const effectiveAccountCode = partyControlCode || target.account_code || "—";
  const conventionNote =
    target.party_type === "SUPPLIER" || target.party_type === "VENDOR"
      ? "Supplier statement: purchase invoices are credited, payments are debited - balance is the amount payable."
      : target.party_type === "CUSTOMER"
      ? "Customer statement: sales invoices are debited, receipts are credited - balance is the amount receivable."
      : "Balance is shown Dr / Cr as recorded in the general ledger.";

  // Quick date presets
  function applyPreset(preset: "all" | "this_month" | "last_30" | "this_quarter" | "this_year") {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = (n: number) => String(n).padStart(2, "0");

    if (preset === "all") {
      setStartDate("");
      setEndDate("");
    } else if (preset === "this_month") {
      setStartDate(`${y}-${pad(m + 1)}-01`);
      setEndDate(now.toISOString().split("T")[0]);
    } else if (preset === "last_30") {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      setStartDate(past.toISOString().split("T")[0]);
      setEndDate(now.toISOString().split("T")[0]);
    } else if (preset === "this_quarter") {
      const qMonth = Math.floor(m / 3) * 3;
      setStartDate(`${y}-${pad(qMonth + 1)}-01`);
      setEndDate(now.toISOString().split("T")[0]);
    } else if (preset === "this_year") {
      setStartDate(`${y}-01-01`);
      setEndDate(now.toISOString().split("T")[0]);
    }
  }

  // Client-side Print Statement via clean isolated iframe
  async function handlePrintStatement() {
    if (!target || printing) return;

    // Batch-translate accounting narrations to Urdu before generating the document.
    // Falls back to the original English text when the Gemini key is missing or the call fails.
    setPrinting(true);
    let translatedNarrations: string[];
    try {
      translatedNarrations = await translateBatchToUrdu(periodTransactions.map((tx) => tx.narration));
    } finally {
      setPrinting(false);
    }

    const urduNarration = (index: number): string | undefined => {
      const source = periodTransactions[index]?.narration;
      const translated = translatedNarrations[index];
      return source && translated && translated !== source ? translated : undefined;
    };

    const periodLabel = startDate || endDate
      ? `${startDate ? formatStatementDate(startDate) : "Inception"} to ${endDate ? formatStatementDate(endDate) : "Present"}`
      : "All Recorded Transactions";

    const html = generateStatementHTML({
      target,
      startDate,
      periodLabel,
      rows: periodTransactions.map((tx, idx) => ({
        date: tx.date,
        voucherNo: tx.voucherNo,
        narration: tx.narration,
        debit: tx.debit,
        credit: tx.credit,
        balance: tx.balance,
        urduNarration: urduNarration(idx),
      })),
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance,
      closingLabel,
      closingUrLabel,
      conventionNote,
    });

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();
      iframe.contentWindow?.focus();
      setTimeout(() => {
        // Browsers stamp the page title into the print header; blank it while
        // the dialog is open so the header carries no company name, then restore.
        const previousTitle = document.title;
        const previousFrameTitle = frameDoc.title;
        document.title = " ";
        frameDoc.title = " ";
        try {
          iframe.contentWindow?.print();
        } finally {
          document.title = previousTitle;
          frameDoc.title = previousFrameTitle;
        }
        setTimeout(() => {
          if (iframe.parentNode) document.body.removeChild(iframe);
        }, 1500);
      }, 350);
    } else {
      document.body.removeChild(iframe);
    }
  }

  // Export PDF via jsPDF + autoTable
  async function handleExportPDF() {
    if (!target) return;

    await exportPartyLedgerPDF({
      targetName: target.name,
      accountCode: target.account_code,
      accountType: target.account_type,
      partyType: target.party_type,
      phone: target.phone,
      address: target.address,
      ntn: target.ntn_strn,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance,
      transactions: periodTransactions.map((t) => ({
        date: t.date,
        voucherNo: t.voucherNo,
        narration: t.narration,
        debit: t.debit,
        credit: t.credit,
        balance: t.balance,
      })),
      operatorName,
    });
  }

  const badgeColor =
    target.party_type === "CUSTOMER"
      ? "bg-status-optimal/15 text-status-optimal border-status-optimal/30"
      : target.party_type === "SUPPLIER"
      ? "bg-status-amber/15 text-status-amber border-status-amber/30"
      : "bg-crimson-primary/15 text-crimson-primary border-crimson-primary/30";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-border-default shadow-2xl overflow-hidden"
        style={{ background: "var(--surface, #1E1B2E)" }}
      >
        {/* Top Header Bar */}
        <div className="p-5 border-b border-border-default flex items-center justify-between shrink-0 bg-bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-crimson-primary/10 border border-crimson-primary/20 flex items-center justify-center text-crimson-primary font-bold">
              {target.type === "PARTY" ? "👤" : "📑"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-h2 font-bold text-foreground">{target.name}</h2>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                  {target.party_type || target.account_type || (target.type === "PARTY" ? "Party Ledger" : "Account Ledger")}
                </span>
              </div>
              <p className="text-caption text-secondary mt-0.5 flex items-center gap-3">
                <span>Account Code: <strong className="font-mono text-foreground">{effectiveAccountCode}</strong></span>
                {target.phone && <span>Phone: <span className="text-foreground">{target.phone}</span></span>}
                {target.ntn_strn && <span>NTN: <span className="text-foreground">{target.ntn_strn}</span></span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Print Statement Button */}
            <button
              onClick={handlePrintStatement}
              disabled={printing}
              className="h-9 px-3.5 rounded-lg bg-bg-muted text-foreground border border-border-default font-medium text-body hover:bg-bg-subtle disabled:opacity-60 disabled:cursor-wait transition-colors flex items-center gap-2 shadow-sm"
              title="Print clean A4 statement via client-side print dialog"
            >
              <svg className="h-4 w-4 text-crimson-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>{printing ? "Translating..." : "Print Statement"}</span>
            </button>

            {/* Export PDF Button */}
            <button
              onClick={handleExportPDF}
              className="h-9 px-3.5 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark transition-colors flex items-center gap-2 shadow-sm"
              title="Export statement as PDF document"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Export PDF</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors ml-1"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* KPI Balance Summary Cards */}
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-bg-primary/50 border-b border-border-default shrink-0">
          <div className="p-3 rounded-xl bg-bg-muted/60 border border-border-default">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold block">Opening Balance</span>
            <div className="text-body font-bold font-mono text-foreground mt-1">
              {formatPKR(Math.abs(openingBalance))} <span className="text-caption font-medium text-secondary">{openingBalance >= 0 ? "Dr" : "Cr"}</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-bg-muted/60 border border-border-default">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold block">Period Debit</span>
            <div className="text-body font-bold font-mono text-crimson-primary mt-1">
              {formatPKR(periodDebit)}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-bg-muted/60 border border-border-default">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold block">Period Credit</span>
            <div className="text-body font-bold font-mono text-crimson-primary mt-1">
              {formatPKR(periodCredit)}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-bg-muted/80 border border-border-strong">
            <span className="text-[11px] uppercase tracking-wider text-muted font-semibold block">{closingLabel}</span>
            <div className={`text-body font-bold font-mono mt-1 ${closingBalance >= 0 ? "text-status-optimal" : "text-status-error"}`}>
              {formatPKR(Math.abs(closingBalance))} <span className="text-caption font-medium">{balanceSide(closingBalance)}</span>
            </div>
          </div>
        </div>

        {/* Date Filter Toolbar */}
        <div className="px-5 py-3 border-b border-border-default bg-bg-muted/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-muted font-medium mr-1">Period:</span>
            <button
              onClick={() => applyPreset("all")}
              className={`h-7 px-2.5 rounded-md text-caption font-medium transition-colors ${
                !startDate && !endDate ? "bg-crimson-primary text-white" : "bg-bg-muted text-secondary hover:text-foreground"
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => applyPreset("this_month")}
              className="h-7 px-2.5 rounded-md text-caption font-medium bg-bg-muted text-secondary hover:text-foreground transition-colors"
            >
              This Month
            </button>
            <button
              onClick={() => applyPreset("last_30")}
              className="h-7 px-2.5 rounded-md text-caption font-medium bg-bg-muted text-secondary hover:text-foreground transition-colors"
            >
              Last 30 Days
            </button>
            <button
              onClick={() => applyPreset("this_quarter")}
              className="h-7 px-2.5 rounded-md text-caption font-medium bg-bg-muted text-secondary hover:text-foreground transition-colors"
            >
              This Quarter
            </button>
            <button
              onClick={() => applyPreset("this_year")}
              className="h-7 px-2.5 rounded-md text-caption font-medium bg-bg-muted text-secondary hover:text-foreground transition-colors"
            >
              This Year
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-caption">
              <span className="text-muted">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-7 px-2 rounded-md bg-obsidian-bg border border-border-default text-foreground text-caption font-mono focus:outline-none focus:border-crimson-primary"
              />
            </div>
            <div className="flex items-center gap-1.5 text-caption">
              <span className="text-muted">To</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-7 px-2 rounded-md bg-obsidian-bg border border-border-default text-foreground text-caption font-mono focus:outline-none focus:border-crimson-primary"
              />
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(""); setEndDate(""); }}
                className="h-7 px-2 rounded-md bg-bg-muted text-muted hover:text-foreground text-caption"
                title="Reset date filter"
              >
                Clear
              </button>
            )}
            <label className="flex items-center gap-1.5 ml-2 text-caption text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={includeDrafts}
                onChange={(e) => setIncludeDrafts(e.target.checked)}
                className="rounded border-border-default text-crimson-primary focus:ring-0"
              />
              <span>Include Drafts</span>
            </label>
          </div>
        </div>

        {/* Transaction Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-bg-subtle z-10 border-b border-border-subtle shadow-sm">
              <tr>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase font-semibold tracking-wider w-24">Date</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase font-semibold tracking-wider w-32">Voucher #</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase font-semibold tracking-wider">Narration / Description</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase font-semibold tracking-wider text-right w-28">Debit (PKR)</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase font-semibold tracking-wider text-right w-28">Credit (PKR)</th>
                <th className="px-4 py-2.5 text-[10px] text-muted uppercase font-semibold tracking-wider text-right w-32">Balance (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/50 text-body">
              {/* Opening Balance Row */}
              <tr className="bg-bg-muted/40 font-medium text-secondary">
                <td className="px-4 py-2 font-mono text-caption">{startDate ? formatStatementDate(startDate) : "—"}</td>
                <td className="px-4 py-2 font-mono text-caption text-muted">—</td>
                <td className="px-4 py-2 italic">
                  Opening Balance Brought Forward
                </td>
                <td className="px-4 py-2 text-right font-mono text-muted">—</td>
                <td className="px-4 py-2 text-right font-mono text-muted">—</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-foreground">
                  {formatPKR(Math.abs(openingBalance))} <span className="text-[10px] font-normal">{openingBalance >= 0 ? "Dr" : "Cr"}</span>
                </td>
              </tr>

              {/* Transactions */}
              {accountLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted text-caption">
                    Loading account ledger…
                  </td>
                </tr>
              ) : periodTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted text-caption">
                    No transactions recorded for this period.
                  </td>
                </tr>
              ) : (
                periodTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 text-secondary font-mono text-caption whitespace-nowrap">
                      {formatStatementDate(tx.date)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-caption font-semibold text-foreground">{tx.voucherNo}</span>
                        {tx.status === "DRAFT" && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-status-amber/20 text-status-amber">Draft</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      <div>{tx.narration}</div>
                      {target.type === "PARTY" && tx.accountName && (
                        <span className="text-[11px] text-muted">
                          Under: {tx.accountCode} — {tx.accountName}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap text-foreground">
                      {tx.debit > 0 ? formatPKR(tx.debit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap text-foreground">
                      {tx.credit > 0 ? formatPKR(tx.credit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap font-medium text-foreground">
                      {formatPKR(Math.abs(tx.balance))}{" "}
                      <span className={`text-[10px] ${tx.balance >= 0 ? "text-status-optimal" : "text-status-error"}`}>
                        {tx.balance >= 0 ? "Dr" : "Cr"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Table Footer Totals */}
            <tfoot className="sticky bottom-0 bg-bg-subtle border-t-2 border-border-default z-10 font-semibold text-body">
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-foreground uppercase tracking-wider text-caption">
                  Totals &amp; Period Summary:
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-foreground whitespace-nowrap">
                  {formatPKR(periodDebit)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-foreground whitespace-nowrap">
                  {formatPKR(periodCredit)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-foreground whitespace-nowrap font-bold">
                  {formatPKR(Math.abs(closingBalance))}{" "}
                  <span className={`text-caption ${closingBalance >= 0 ? "text-status-optimal" : "text-status-error"}`}>
                    {closingBalance >= 0 ? "Dr" : "Cr"}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-border-default flex items-center justify-between shrink-0 bg-bg-muted/30">
<div className="text-caption text-muted flex items-center gap-2">
              <span>Showing {periodTransactions.length} transactions</span>
              <span>&bull;</span>
              <span>Company: <strong>{COMPANY_HEADER}</strong></span>
              <div style={{marginTop: '8px', fontSize: '11px', color: '#555', textAlign: 'center'}}>{COMPANY_LEGAL_NAME}</div>
            </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintStatement}
              disabled={printing}
              className="h-8 px-3 rounded-lg bg-bg-muted text-foreground border border-border-default text-caption font-medium hover:bg-bg-subtle disabled:opacity-60 disabled:cursor-wait transition-colors flex items-center gap-1.5"
            >
              <svg className="h-3.5 w-3.5 text-crimson-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              {printing ? "Translating..." : "Print Statement"}
            </button>
            <button
              onClick={onClose}
              className="h-8 px-4 rounded-lg bg-crimson-primary text-white text-caption font-medium hover:bg-crimson-dark transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
