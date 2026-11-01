"use client";

/**
 * Editable date & time field for a document (invoice / journal entry /
 * quotation), plus a required reason field shown only once the value changes.
 *
 * The `value` is a `datetime-local` string ('YYYY-MM-DDTHH:mm', Asia/Karachi
 * wall time) — see toLocalInputValue / fromLocalInputValue in
 * src/lib/supabase/document-datetime.ts.
 */

interface Props {
  /** Current value as a 'YYYY-MM-DDTHH:mm' string. */
  value: string;
  onChange: (v: string) => void;
  /** Reason for changing the date/time (required once `changed` is true). */
  reason: string;
  onReasonChange: (v: string) => void;
  /** True when the value differs from the original — reveals the reason UI. */
  changed: boolean;
}

// Same classes as the date input in
// src/components/modules/ledger/EditJournalEntryModal.tsx (line ~171).
const inputCls =
  "h-9 px-3 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";

export default function DateTimeEditField({
  value,
  onChange,
  reason,
  onReasonChange,
  changed,
}: Props) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
          Date &amp; Time
        </label>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      </div>

      {changed && (
        <div className="space-y-2">
          <div>
            <label className="text-caption text-secondary uppercase tracking-wider font-medium block mb-1.5">
              Reason for changing date/time *
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="e.g. Corrected posting date per accountant"
              className={inputCls}
              required
            />
          </div>
          <p className="text-caption text-status-amber">
            This change is recorded in the audit log.
          </p>
        </div>
      )}
    </div>
  );
}
