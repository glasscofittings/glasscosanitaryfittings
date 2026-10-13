"use client";

import { useId, useMemo, useRef, useState, useEffect } from "react";
import type { Account } from "@/lib/supabase/ledger";

interface Props {
  /** UUID of the currently selected account. */
  value: string;
  /** Called with the account UUID (or "" to clear). */
  onChange: (accountId: string) => void;
  accounts: Account[];
  placeholder?: string;
  /** Extra Tailwind classes forwarded to the trigger input. */
  className?: string;
  autoFocus?: boolean;
  /** Row index — used to wire Tab-to-next-field correctly inside a table. */
  rowIndex?: number;
}

/**
 * Searchable combobox for Chart of Accounts.
 *
 * - Click / focus → shows all accounts
 * - Type account code (e.g. "2001") or name (e.g. "payable") → filters in real-time
 * - Arrow Up / Down → keyboard navigation
 * - Enter → confirms highlighted option and closes
 * - Escape / click-outside → closes without changing value
 * - If the user clears the input, the selection is cleared too
 */
export default function AccountCombobox({
  value,
  onChange,
  accounts,
  placeholder = "Search account…",
  className = "",
  autoFocus,
}: Props) {
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  // Derive the display label for the currently-selected account
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === value) ?? null,
    [accounts, value]
  );

  const displayLabel = selectedAccount
    ? `${selectedAccount.account_code} — ${selectedAccount.account_name}`
    : "";

  // Filtered options
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.account_code.toLowerCase().includes(q) ||
        a.account_name.toLowerCase().includes(q)
    );
  }, [accounts, query]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function openDropdown() {
    setOpen(true);
    setQuery("");
    setActiveIndex(-1);
  }

  function closeDropdown() {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  function selectAccount(account: Account) {
    onChange(account.id);
    closeDropdown();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setActiveIndex(-1);
    if (!v.trim()) {
      // Clearing the text clears the selection
      onChange("");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        openDropdown();
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) {
        selectAccount(filtered[activeIndex]);
      } else if (filtered.length === 1) {
        selectAccount(filtered[0]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div ref={wrapperRef} className="relative w-full" style={{ position: "relative" }}>
      {/* Trigger input */}
      <div className="relative">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          // When closed, show the selected label; when open, show the search query
          value={open ? query : displayLabel}
          onFocus={openDropdown}
          onClick={openDropdown}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={open ? "Type code or name…" : placeholder}
          className={`${className} w-full pr-8`}
        />
        {/* Chevron toggle */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onMouseDown={(e) => {
            e.preventDefault(); // keep focus on input
            if (open) closeDropdown();
            else {
              inputRef.current?.focus();
              openDropdown();
            }
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
        >
          <svg
            className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Clear button — when a value is selected and not open */}
        {value && !open && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
            title="Clear selection"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{
            zIndex: 9999,
            background: "var(--surface, var(--background, #ffffff))",
            opacity: 1,
          }}
          className="absolute left-0 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-border-strong shadow-2xl ring-1 ring-black/20 backdrop-blur-none"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-caption text-muted text-center select-none">
              {accounts.length === 0
                ? "No accounts yet — add them in the Accounts tab"
                : `No accounts match "${query}"`}
            </li>
          ) : (
            filtered.map((account, idx) => {
              const isActive = idx === activeIndex;
              const isSelected = account.id === value;
              return (
                <li
                  key={account.id}
                  id={`${listId}-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectAccount(account);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none transition-colors ${
                    isActive
                      ? "bg-crimson-primary/20 text-foreground"
                      : isSelected
                      ? "bg-status-optimal/15 text-foreground"
                      : "text-secondary hover:bg-bg-active"
                  }`}
                >
                  {/* Account code badge */}
                  <span
                    className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                      isSelected
                        ? "bg-status-optimal/15 text-status-optimal"
                        : "bg-bg-muted text-muted"
                    }`}
                  >
                    {account.account_code}
                  </span>
                  <span className="text-body truncate">{account.account_name}</span>
                  {/* Check mark for selected */}
                  {isSelected && (
                    <svg
                      className="ml-auto h-3.5 w-3.5 text-status-optimal shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
