"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchParties, type Party } from "@/lib/supabase/crm";
import { capitalizeFirst } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Fired when a CRM contact is picked from the list (not on free typing). */
  onSelect?: (party: Party) => void;
  /**
   * Fired whenever the typed value starts or stops matching a CRM contact exactly (case-insensitive).
   * Forms use it to refuse saving a name that is not in CRM.
   */
  onMatchChange?: (party: Party | null) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Limit suggestions to buyers, suppliers, or everyone (default). */
  partyType?: "SUPPLIER" | "BUYER" | "ALL";
}

/**
 * Free-text name input backed by CRM contacts. Opening the field (or clicking the chevron) lists
 * every contact in a scrollable dropdown; typing narrows it to names that start with the text
 * (or whose any word starts with it). Picking one fills the field with the exact CRM spelling so
 * vouchers line up with the contact's ledger. A name that matches no contact is flagged in red and
 * reported through `onMatchChange` so the owning form can block the save.
 */
export default function PartyNameCombobox({
  value,
  onChange,
  onSelect,
  onMatchChange,
  placeholder,
  className = "glass-input w-full",
  autoFocus,
  partyType = "ALL",
}: Props) {
  const [parties, setParties] = useState<Party[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchParties(partyType).then((rows) => {
      if (cancelled) return;
      setParties(rows);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [partyType]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const query = value.trim().toLowerCase();
  const exactMatch = useMemo(
    () => (query ? parties.find((p) => p.name.toLowerCase() === query) ?? null : null),
    [parties, query]
  );

  const items = useMemo(() => {
    if (!query || exactMatch) return parties;
    const startsWith = parties.filter((p) => p.name.toLowerCase().startsWith(query));
    const wordStarts = parties.filter(
      (p) => !p.name.toLowerCase().startsWith(query) && p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(query))
    );
    return [...startsWith, ...wordStarts];
  }, [parties, query, exactMatch]);

  const showList = open && items.length > 0;
  const unknownName = loaded && query.length > 0 && !exactMatch;
  const showWarning = unknownName && !showList;

  useEffect(() => {
    onMatchChange?.(exactMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parents pass inline callbacks; re-run on match only
  }, [exactMatch]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!showList || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showList]);

  function pick(party: Party) {
    onChange(party.name);
    onSelect?.(party);
    setOpen(false);
    setActiveIndex(-1);
  }

  function toggleList() {
    setOpen((o) => !o);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (e.key === "ArrowDown" && items.length > 0) { setOpen(true); setActiveIndex(0); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        pick(items[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function typeLabel(type: Party["party_type"]) {
    if (type === "CUSTOMER") return "Buyer";
    if (type === "BOTH") return "Both";
    return "Supplier";
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { onChange(capitalizeFirst(e.target.value)); setOpen(true); setActiveIndex(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`${className} pr-9 ${unknownName ? "border-status-alert focus:border-status-alert focus:ring-status-alert/50" : ""}`}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); toggleList(); }}
          aria-label={open ? "Hide contacts" : "Show all contacts"}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-bg-muted transition-colors"
        >
          <svg
            className={`h-4 w-4 transition-transform ${showList ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {showList && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-60 overflow-y-auto rounded-lg border border-border-default bg-obsidian-bg shadow-xl py-1"
        >
          {items.map((p, i) => {
            const isCurrent = exactMatch?.id === p.id;
            return (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`px-3 py-2 cursor-pointer flex items-center justify-between gap-3 text-body ${
                  i === activeIndex ? "bg-bg-muted text-foreground" : "text-secondary hover:bg-bg-subtle"
                } ${isCurrent ? "text-crimson-primary" : ""}`}
              >
                <span className="truncate">{exactMatch ? p.name : highlight(p.name, query)}</span>
                <span className="text-caption text-muted shrink-0">{typeLabel(p.party_type)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {showWarning && (
        <p className="mt-1.5 text-caption text-status-alert flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
          <span>
            &ldquo;{value.trim()}&rdquo; is not a CRM contact. Pick one from the list, or add it in CRM first.
          </span>
        </p>
      )}
    </div>
  );
}

/** Bold the matched prefix (of the name or of a word) so the hit is visible at a glance. */
function highlight(name: string, query: string) {
  if (!query) return name;
  const lower = name.toLowerCase();
  let start = lower.startsWith(query) ? 0 : -1;
  if (start < 0) {
    const idx = lower.indexOf(` ${query}`);
    if (idx >= 0) start = idx + 1;
  }
  if (start < 0) return name;
  const end = start + query.length;
  return (
    <>
      {name.slice(0, start)}
      <span className="text-foreground font-semibold">{name.slice(start, end)}</span>
      {name.slice(end)}
    </>
  );
}
