"use client";

import { useState, useEffect, useRef } from "react";
import {
  createPaymentVoucher,
  updatePaymentVoucher,
  fetchAccounts,
  numberToWords,
  type Account,
  type PaymentVoucher,
} from "@/lib/supabase/payment-vouchers";
import { formatPKR } from "@/lib/utils/formatters";
import PartyNameCombobox from "@/components/ui/PartyNameCombobox";
import { fetchParties, type Party } from "@/lib/supabase/crm";
import { useAuth } from "@/components/providers/AuthProvider";
import { ACCOUNT_CODES } from "@/lib/ledger/account-codes";
import {
  isLiquidFundsAccount as isLiquidAccount,
  isPaymentDebitAllowed,
  isReceivableAccount,
} from "@/lib/ledger/voucher-rules";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  open: boolean;
  voucherType: "CASH_PAYMENT" | "PARTY_PAYMENT" | "BANK_PAYMENT";
  onClose: () => void;
  onCreated?: (voucher: PaymentVoucher) => void;
  /** When provided, the form operates in edit mode with pre-filled data. */
  editVoucher?: PaymentVoucher | null;
  onUpdated?: (voucher: PaymentVoucher) => void;
}

export default function PaymentVoucherForm({ open, voucherType, onClose, onCreated, editVoucher, onUpdated }: Props) {
  const isEdit = !!editVoucher;
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [payeeName, setPayeeName] = useState("");
  const [payeeNameUr, setPayeeNameUr] = useState("");
  const [payeeParty, setPayeeParty] = useState<Party | null>(null);
  // Last value we wrote into the Urdu field ourselves; lets a new pick replace it without
  // clobbering an Urdu name the operator typed by hand.
  const autoUrduRef = useRef("");
  const [payeeAddress, setPayeeAddress] = useState("");
  const [cnicNtn, setCnicNtn] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeUr, setPurposeUr] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [debitAccountId, setDebitAccountId] = useState("");
  const [creditAccountId, setCreditAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [createdBy, setCreatedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous submission lock. React state updates are async, so a rapid
  // double-click (or Enter pressed twice) could re-enter handleSubmit before
  // `isSubmitting` re-renders the button as disabled. The ref flips instantly.
  const submitLockRef = useRef(false);
  const [error, setError] = useState("");

  const isCash = voucherType === "CASH_PAYMENT";
  const isBank = voucherType === "BANK_PAYMENT";
  const isParty = voucherType === "PARTY_PAYMENT";
  const title = isEdit
    ? `Edit ${editVoucher?.voucher_no || "Voucher"}`
    : isCash
      ? "Cash Payment Voucher"
      : isBank
        ? "Bank Payment Voucher"
        : "Party Payment Voucher";
  const prefix = isCash ? "CPV" : isBank ? "BPV" : "PPV";

  function findCashAccount(all: Account[]): Account | undefined {
    return (
      all.find((a) => a.is_default_cash) ||
      all.find((a) => a.account_code === ACCOUNT_CODES.CASH) ||
      all.find((a) => a.account_name.toLowerCase().includes("cash in hand"))
    );
  }

  function findBankAccount(all: Account[]): Account | undefined {
    return (
      all.find((a) => a.account_code === ACCOUNT_CODES.BANK) ||
      all.find((a) => a.account_name.toLowerCase().includes("bank"))
    );
  }

  useEffect(() => {
    if (open) {
      fetchAccounts().then((all) => {
        setAccounts(all);
        // Default the credit (money-out) side by voucher type: BPV → Bank, everything else → Cash
        const fallback = isBank ? findBankAccount(all) : findCashAccount(all);
        if (fallback) setCreditAccountId(fallback.id);
      });
    }
  }, [open, isBank]);

  // Party Payments auto-route their ledger sides from the payee's party type:
  //   CUSTOMER payee → BLOCKED: must use Receipt Voucher (Mode B) — this form
  //                    cannot record money-in without corrupting the AR balance.
  //   SUPPLIER/VENDOR → Case B: Dr Accounts Payable (2001), Cr Cash/Bank
  // Skipped while the contact is unresolved ("edit" stub) so the voucher keeps
  // whatever sides were saved on it.
  useEffect(() => {
    if (!open || !isParty || accounts.length === 0) return;
    if (!payeeParty || payeeParty.id === "edit") return;
    const t = setTimeout(() => {
      // Case A (CUSTOMER) is intentionally NOT auto-routed here — the form
      // blocks those payees with a redirect banner below.
      if (payeeParty.party_type !== "CUSTOMER") {
        // Case B: Dr AP (2001), Cr Cash/Bank
        const cashOrBank = isBank ? findBankAccount(accounts) : findCashAccount(accounts);
        const ap = accounts.find((a) => a.account_code === ACCOUNT_CODES.AP);
        if (ap) setDebitAccountId(ap.id);
        if (cashOrBank) setCreditAccountId(cashOrBank.id);
      } else {
        // Clear any stale sides so the blocking banner is unambiguous.
        setDebitAccountId("");
        setCreditAccountId("");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, isParty, accounts, payeeParty, isBank]);

  // Auto-fill "Created By" from logged-in user profile (async — no sync setState in effect)
  useEffect(() => {
    if (!open || !profile?.email) return;
    const t = setTimeout(() => {
      setCreatedBy((prev) => prev || profile.email);
    }, 0);
    return () => clearTimeout(t);
  }, [open, profile?.email]);

  // Pre-fill form when editing an existing voucher (async — no sync setState in effect)
  useEffect(() => {
    if (!open || !editVoucher || accounts.length === 0) return;
    const t = setTimeout(async () => {
      setPayeeName(editVoucher.payee_name);
      setPayeeNameUr(editVoucher.payee_name_ur || editVoucher.payee_name);
      autoUrduRef.current = editVoucher.payee_name_ur || editVoucher.payee_name;
      setPayeeAddress(editVoucher.payee_address || "");
      setCnicNtn(editVoucher.cnic_ntn || "");
      setPurpose(editVoucher.purpose || "");
      setPurposeUr(editVoucher.purpose_ur || "");
      setReferenceNo(editVoucher.reference_no || "");
      setDebitAccountId(editVoucher.debit_account_id || "");
      setCreditAccountId(editVoucher.credit_account_id || "");
      setAmount(editVoucher.amount.toString());
      setRemarks(editVoucher.remarks || "");
      setVoucherDate(editVoucher.voucher_date);
      // Resolve the payee's REAL party type (drives Case A/B routing + validation).
      // Falls back to an "edit" stub when the payee is not a CRM contact — the
      // voucher then keeps its saved sides instead of being re-routed.
      if (editVoucher.payee_name) {
        const stub: Party = {
          id: "edit",
          name: editVoucher.payee_name,
          party_type: "CUSTOMER",
          is_registered: true,
        };
        try {
          const all = await fetchParties("ALL");
          const hit = all.find(
            (p) => p.name.trim().toLowerCase() === editVoucher.payee_name.trim().toLowerCase()
          );
          setPayeeParty(hit ?? stub);
        } catch {
          setPayeeParty(stub);
        }
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, editVoucher, accounts]);

  useEscapeToClose(open, onClose);

  if (!open) return null;

  const amountNum = parseFloat(amount) || 0;
  const amountWords = amountNum > 0 ? numberToWords(amountNum) : "";

  // Mode A posting rules (shared with the receipt flow — voucher-rules.ts):
  //   DEBIT  → expense / payable / non-receivable asset. Cash/Bank and the
  //            receivable control accounts (1100 AR, 1201 Trade Debts) are
  //            excluded — customer receipts must go through the Receipt form.
  //   CREDIT → Cash in Hand (1000) / Bank (1002) only (money out).
  const debitAccounts = accounts.filter((a) => isPaymentDebitAllowed(a));
  const creditAccounts = accounts.filter((a) => isLiquidAccount(a));

  // Case routing state for Party Payments: null when the payee is unresolved
  // ("edit" stub = not a CRM contact) — then the voucher keeps its saved sides.
  const partyType = isParty && payeeParty && payeeParty.id !== "edit" ? payeeParty.party_type : null;
  const routedDebit = accounts.find((a) => a.id === debitAccountId);
  const routedCredit = accounts.find((a) => a.id === creditAccountId);

  function accountLabel(a: Account): string {
    return `${a.account_code} — ${a.account_name}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      await submitVoucher();
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function submitVoucher() {
    setError("");

    if (!payeeName.trim()) {
      setError("Payee name is required.");
      return;
    }
    if (!payeeParty) {
      setError(`"${payeeName.trim()}" is not a CRM contact. Pick one from the list, or add it in CRM first.`);
      return;
    }
    if (amountNum <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    // Double-entry requires BOTH sides — a single-sided voucher corrupts ledgers.
    if (!debitAccountId) {
      setError(
        isParty
          ? "The debit side is not routed yet — pick the payee from the CRM list."
          : "Debit account is required — pick the expense, AP, or asset account being paid."
      );
      return;
    }
    if (!creditAccountId) {
      setError(
        isParty
          ? "The credit side is not routed yet — pick the payee from the CRM list."
          : "Credit account is required — pick Cash or Bank (the money out)."
      );
      return;
    }
    const valDebit = accounts.find((a) => a.id === debitAccountId);
    const valCredit = accounts.find((a) => a.id === creditAccountId);

    // Receivable control accounts can never be debited on a Payment Voucher —
    // that books a customer receipt backwards (balance UP instead of DOWN).
    // The dropdown already excludes them; this catches legacy rows on edit.
    if (valDebit && isReceivableAccount(valDebit)) {
      setError(
        `${valDebit.account_code} — ${valDebit.account_name} cannot be debited on a Payment Voucher. Record customer receipts in the Receipt Voucher form instead (delete this voucher and re-record it there).`
      );
      return;
    }

    if (isParty) {
      if (partyType === "CUSTOMER") {
        // Customer receipts are Mode B — they MUST go through the Receipt Voucher
        // form (/invoicing/receipts) so cash/bank is DEBITED and AR is CREDITED.
        // Posting a customer receipt as a Payment Voucher would debit AR (wrong
        // direction) and drive the customer's balance UP instead of DOWN.
        setError(
          `${payeeName.trim()} is a Customer — money received from a customer must be recorded as a Receipt Voucher (CRV / BRV) in the Receipts screen, not as a Payment Voucher. Payment Vouchers are for money OUT only (expenses, supplier payments).`
        );
        setSaving(false);
        return;
      } else if (partyType) {
        // Case B: Dr AP (2001), Cr Cash/Bank
        if (!valDebit || isLiquidAccount(valDebit)) {
          setError("Party payment must debit Accounts Payable (2001) — pick the payee again to re-route.");
          return;
        }
        if (!valCredit || !isLiquidAccount(valCredit)) {
          setError("Party payment must credit Cash or Bank (the money out).");
          return;
        }
      }
      // Unresolved CRM contact (edit of a payee not in CRM): both-set is required;
      // the sides saved on the voucher are trusted and rebuilt by the sync path.
    } else {
      // Cash/Bank expense payment — debit is never Cash/Bank, credit always is.
      if (valDebit && isLiquidAccount(valDebit)) {
        setError("Debit cannot be Cash/Bank — that books a payment as an inflow. Select the expense/AP/asset account.");
        return;
      }
      if (valCredit && !isLiquidAccount(valCredit)) {
        setError("Credit must be Cash or Bank (the money out).");
        return;
      }
    }

    setSaving(true);

    if (isEdit && editVoucher) {
      // ── Edit mode ──
      const { data: updated, error: updateError } = await updatePaymentVoucher(
        editVoucher.id,
        {
          voucher_date: voucherDate,
          payee_name: payeeName.trim(),
          payee_name_ur: payeeNameUr.trim() || payeeName.trim(),
          payee_address: payeeAddress.trim() || undefined,
          cnic_ntn: cnicNtn.trim() || undefined,
          purpose: purpose.trim() || undefined,
          purpose_ur: purposeUr.trim() || undefined,
          reference_no: referenceNo.trim() || undefined,
          // Both sides always set (validation above); null kept as a defensive fallback
          debit_account_id: debitAccountId || null,
          credit_account_id: creditAccountId || null,
          amount: amountNum,
          amount_in_words: numberToWords(amountNum),
          remarks: remarks.trim() || undefined,
        },
        editVoucher
      );
      setSaving(false);

      if (updated) {
        // Augment with account objects for the list (clear name when side is empty)
        const debitAcc = accounts.find((a) => a.id === debitAccountId);
        const creditAcc = accounts.find((a) => a.id === creditAccountId);
        const augmented: PaymentVoucher = {
          ...updated,
          debit_account: debitAcc,
          credit_account: creditAcc,
          debit_account_name: debitAcc ? accountLabel(debitAcc) : null,
          credit_account_name: creditAcc ? accountLabel(creditAcc) : null,
        };
        onUpdated?.(augmented);
        onClose();
      } else {
        setError(updateError || "Failed to update voucher. Please try again.");
      }
    } else {
      // ── Create mode ──
      const { data: voucher, error: createError } = await createPaymentVoucher({
        voucher_type: voucherType,
        voucher_date: voucherDate,
        payee_name: payeeName.trim(),
        payee_name_ur: payeeNameUr.trim() || payeeName.trim(),
        payee_address: payeeAddress.trim() || undefined,
        cnic_ntn: cnicNtn.trim() || undefined,
        purpose: purpose.trim() || undefined,
        purpose_ur: purposeUr.trim() || undefined,
        reference_no: referenceNo.trim() || undefined,
        debit_account_id: debitAccountId || undefined,
        credit_account_id: creditAccountId || undefined,
        amount: amountNum,
        amount_in_words: amountNum > 0 ? numberToWords(amountNum) : undefined,
        remarks: remarks.trim() || undefined,
      });
      setSaving(false);

      if (voucher) {
        const debitAcc = accounts.find((a) => a.id === debitAccountId);
        const creditAcc = accounts.find((a) => a.id === creditAccountId);
        const augmented: PaymentVoucher = {
          ...voucher,
          debit_account: debitAcc,
          credit_account: creditAcc,
          debit_account_name: debitAcc ? accountLabel(debitAcc) : null,
          credit_account_name: creditAcc ? accountLabel(creditAcc) : null,
        };
        onCreated?.(augmented);
        resetForm();
        onClose();
      } else {
        setError(createError || "Failed to create voucher. Please try again.");
      }
    }
  }

  function resetForm() {
    setPayeeName("");
    setPayeeNameUr("");
    autoUrduRef.current = "";
    setPayeeParty(null);
    setPayeeAddress("");
    setCnicNtn("");
    setPurpose("");
    setPurposeUr("");
    setReferenceNo("");
    setDebitAccountId("");
    setCreditAccountId("");
    setAmount("");
    setRemarks("");
    setVoucherDate(new Date().toISOString().slice(0, 10));
    setCreatedBy(profile?.email || "");
    // Re-default credit account by voucher type (CPV/PPV → Cash, BPV → Bank).
    // For PPV this is only the interim value — the routing effect replaces both
    // sides once a payee is picked.
    const fallback = isBank ? findBankAccount(accounts) : findCashAccount(accounts);
    if (fallback) setCreditAccountId(fallback.id);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg glass-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-h2 font-semibold">{title}</h2>
            <p className="text-caption text-muted font-mono mt-0.5">
              {isEdit ? editVoucher?.voucher_no : `${prefix}-YYYY-NNNNN`}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="glow-line mb-4" />

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Payee Name */}
          <div>
            <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
              Payee Name *
            </label>
            <PartyNameCombobox
              value={payeeName}
              onChange={setPayeeName}
              onMatchChange={setPayeeParty}
              onSelect={(party) => {
                // CRM contacts carry no Urdu name; mirror the English name unless the operator typed one.
                if (!payeeNameUr.trim() || payeeNameUr === autoUrduRef.current) {
                  setPayeeNameUr(party.name);
                  autoUrduRef.current = party.name;
                }
                if (!payeeAddress.trim() && party.address) setPayeeAddress(party.address);
                if (!cnicNtn.trim() && party.ntn_strn) setCnicNtn(party.ntn_strn);
              }}
              placeholder="Start typing a CRM contact, or enter a new name"
              autoFocus
            />
            <input
              type="text"
              value={payeeNameUr}
              onChange={(e) => setPayeeNameUr(capitalizeFirst(e.target.value))}
              className="glass-input w-full mt-2 text-right"
              dir="rtl"
              lang="ur"
              placeholder="وصول کنندہ کا نام (اردو) — اختیاری"
              title="Payee name in Urdu (optional) — printed under the English name on the PDF"
            />
          </div>

          {/* Voucher Date + Prepared By */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                Voucher Date *
              </label>
              <input
                type="date"
                value={voucherDate}
                onChange={(e) => setVoucherDate(e.target.value)}
                className="glass-input w-full font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                Prepared By
              </label>
              <input
                type="text"
                value={createdBy}
                onChange={(e) => setCreatedBy(capitalizeFirst(e.target.value))}
                className="glass-input w-full"
                placeholder="e.g. Accounts Dept"
              />
            </div>
          </div>

          {/* Address + CNIC */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                Address
              </label>
              <input
                type="text"
                value={payeeAddress}
                onChange={(e) => setPayeeAddress(capitalizeFirst(e.target.value))}
                className="glass-input w-full"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                CNIC / NTN
              </label>
              <input
                type="text"
                value={cnicNtn}
                onChange={(e) => setCnicNtn(e.target.value)}
                className="glass-input w-full font-mono"
                placeholder="Optional"
              />
            </div>
          </div>

          {/* Purpose + Reference */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                Purpose
              </label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(capitalizeFirst(e.target.value))}
                className="glass-input w-full"
                placeholder="e.g. Raw material purchase"
              />
              <input
                type="text"
                value={purposeUr}
                onChange={(e) => setPurposeUr(capitalizeFirst(e.target.value))}
                className="glass-input w-full mt-2 text-right"
                dir="rtl"
                lang="ur"
                placeholder="مقصد (اردو) — اختیاری"
                title="Purpose in Urdu (optional) — printed under the English purpose on the PDF"
              />
            </div>
            <div>
              <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                Reference No
              </label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="glass-input w-full font-mono"
                placeholder="e.g. PO-2026-001"
              />
            </div>
          </div>

          {/* Accounts — CPV/BPV: operator picks both sides (Debit = expense /
              non-liquid, Credit = Cash/Bank). PPV: Case B supplier auto-route only.
              CUSTOMER payees are blocked — they must use the Receipt Voucher screen. */}
          <div>
            {isParty ? (
              <div className="p-3 rounded border border-[var(--input-border)] bg-[var(--input-bg)] space-y-2">
                {partyType === "CUSTOMER" ? (
                  /* ── Customer guard: Receipt Vouchers only ───────────────── */
                  <div className="p-3 rounded-lg border border-status-amber/50 bg-status-amber/10 space-y-2">
                    <div className="flex items-start gap-2">
                      <svg className="h-4 w-4 text-status-amber mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <div>
                        <p className="text-caption font-semibold text-status-amber">Customer receipt — use the Receipt Voucher form</p>
                        <p className="text-[11px] text-muted mt-0.5">
                          <strong>{payeeName || "This payee"}</strong> is a Customer. Money received from a customer must be
                          recorded as a <strong>CRV / BRV Receipt Voucher</strong> (Dr Cash/Bank · Cr AR 1100 with party_id)
                          so their account balance reduces correctly. Recording it here as a Payment Voucher would post the
                          wrong direction and drive their balance UP.
                        </p>
                        <a
                          href="/invoicing/receipts"
                          className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold text-crimson-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m13.5 4.5 6 6m0 0-6 6m6-6H3" /></svg>
                          Open Customer Receipts screen (CRV / BRV)
                        </a>
                      </div>
                    </div>
                  </div>
                ) : partyType ? (
                  /* ── Case B: supplier / vendor ───────────────────────────── */
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-caption text-muted uppercase tracking-wider font-medium mb-1">
                          Debit (auto)
                        </p>
                        <p className="text-body font-mono">
                          {routedDebit ? accountLabel(routedDebit) : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-caption text-muted uppercase tracking-wider font-medium mb-1">
                          Credit (auto)
                        </p>
                        <p className="text-body font-mono">
                          {routedCredit ? accountLabel(routedCredit) : "—"}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted">
                      Case B — paid towards a supplier: Dr Accounts Payable (2001) · Cr Cash/Bank.
                    </p>
                  </>
                ) : (
                  <p className="text-caption text-muted">
                    {payeeParty
                      ? "Payee is not a CRM contact — the ledger sides saved on this voucher are kept."
                      : "Pick a supplier / vendor from the CRM list. Customer receipts must use the Receipt Voucher screen."}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                      Debit Account *
                    </label>
                    <select
                      value={debitAccountId}
                      onChange={(e) => setDebitAccountId(e.target.value)}
                      className="glass-input w-full"
                      required
                    >
                      <option value="">— Select —</option>
                      {debitAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {accountLabel(a)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
                      Credit Account *
                    </label>
                    <select
                      value={creditAccountId}
                      onChange={(e) => setCreditAccountId(e.target.value)}
                      className="glass-input w-full"
                      required
                    >
                      <option value="">— Select —</option>
                      {creditAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {accountLabel(a)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-[10px] text-muted mt-1.5">
                  Both sides required — Debit: expense / AP / asset (never Cash/Bank, never 1100
                  Receivable / 1201 Trade Debts). Credit: Cash or Bank (money out).
                </p>
              </>
            )}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
              Amount (PKR) *
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="glass-input w-full font-mono text-lg"
              placeholder="0.00"
              min="0.01"
              step="0.01"
            />
            {amountNum > 0 && (
              <div className="mt-2 p-2 rounded bg-[var(--input-bg)] border border-[var(--input-border)]">
                <p className="text-caption text-muted font-medium">Amount in Words</p>
                <p className="text-body text-foreground font-mono mt-0.5">{amountWords}</p>
                <p className="text-caption text-muted mt-1">{formatPKR(amountNum)}</p>
              </div>
            )}
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-caption text-muted uppercase tracking-wider font-medium mb-1.5">
              Remarks
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(capitalizeFirst(e.target.value))}
              className="glass-input w-full resize-none"
              rows={2}
              placeholder="Optional notes..."
            />
          </div>

          {error && (
            <p className="text-caption text-status-alert">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="crimson-btn flex-1"
              style={{ backgroundColor: "transparent", border: "1px solid var(--border-default)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || isSubmitting}
              className="crimson-btn flex-1"
            >
              {saving || isSubmitting
                ? isEdit
                  ? "Updating..."
                  : "Saving..."
                : isEdit
                  ? "Update Voucher"
                  : `Create ${prefix}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
