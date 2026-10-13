"use client";

import { useState } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { createCustomer, type Party } from "@/lib/supabase/invoicing";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Party) => void;
}

export default function AddCustomerModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [ntnStrn, setNtnStrn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(open, onClose);

  const inputCls = "w-full h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";
  const labelCls = "text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Customer name is required.");
      return;
    }
    setSaving(true);
    setError(null);

    const customer = await createCustomer({
      name: name.trim(),
      ntn_strn: ntnStrn.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
    });

    setSaving(false);
    if (customer) {
      onCreated(customer);
      resetForm();
      onClose();
    } else {
      setError("Failed to create customer. Check connection.");
    }
  }

  function resetForm() {
    setName("");
    setNtnStrn("");
    setPhone("");
    setEmail("");
    setAddress("");
    setCreditLimit("");
    setError(null);
  }

  if (!open) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="glass-card w-full max-w-lg p-6 border border-border-default shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-h2 font-semibold">Add New Customer</h2>
              <p className="text-caption text-muted mt-0.5">Register a new customer or vendor</p>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="glow-line mb-5" />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Business / Customer Name *</label>
              <input
                value={name}
                onChange={(e) => setName(capitalizeFirst(e.target.value))}
                placeholder="e.g. Karachi Hardware Stores"
                className={inputCls}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>STRN / NTN</label>
                <input
                  value={ntnStrn}
                  onChange={(e) => setNtnStrn(e.target.value)}
                  placeholder="1234567-8"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0300-1234567"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className={inputCls}
                type="email"
              />
            </div>

            <div>
              <label className={labelCls}>Billing / Shipping Address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(capitalizeFirst(e.target.value))}
                placeholder="Full address..."
                className={`${inputCls} h-16 px-3 py-2 resize-none`}
              />
            </div>

            <div>
              <label className={labelCls}>Initial Credit Limit (PKR)</label>
              <input
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="0"
                className={inputCls}
                type="number"
                min="0"
              />
              <p className="text-[10px] text-muted mt-1">Optional. Used for credit management in future updates.</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-caption text-status-error bg-status-error/10 px-3 py-2 rounded-lg border border-status-error/20">
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <div className="glow-line" />

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="flex-1 h-9 rounded-lg bg-crimson-primary text-white font-medium text-body hover:bg-crimson-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving..." : "Create Customer"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-5 rounded-lg bg-bg-muted text-secondary border border-border-default hover:bg-bg-muted transition-colors text-body"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
