"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_INPUT_CLS =
  "w-full h-9 pl-3 pr-9 rounded-lg bg-obsidian-bg border border-border-default text-foreground text-body focus:border-crimson-primary focus:outline-none focus:ring-1 focus:ring-crimson-primary/50 transition-colors";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Predefined options, e.g. SANITARY_CATEGORY_OPTIONS. */
  options: readonly string[];
  placeholder?: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  /** Set false to lock the field to the predefined options (default true). */
  allowCustom?: boolean;
  "aria-label"?: string;
}

/**
 * Searchable dropdown backed by a fixed option list (categories, subcategories,
 * finishes). Opening the field (or clicking the chevron) lists every option;
 * typing narrows it to options that start with the text, whose words start with
 * it, or that contain it. Picking one commits the exact predefined spelling so
 * products group cleanly in reports.
 *
 * The last row is always "+ Add Custom": picking it switches the field into
 * custom mode so any value can be typed and saved. A value that is already not
 * in the list (e.g. a legacy DB value when editing) is treated as custom too,
 * with a "Choose from list" link to clear it and pick a predefined option.
 */
export default function ProductOptionCombobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  id,
  autoFocus,
  allowCustom = true,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [customMode, setCustomMode] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const query = value.trim().toLowerCase();
  const isKnownOption = query !== "" && options.some((o) => o.toLowerCase() === query);
  const isCustomValue = value.trim() !== "" && !isKnownOption;
  const inCustomMode = customMode || isCustomValue;

  const matches = useMemo(() => {
    if (!query) return [...options];
    const startsWith = options.filter((o) => o.toLowerCase().startsWith(query));
    const wordStarts = options.filter(
      (o) => !o.toLowerCase().startsWith(query) && o.toLowerCase().split(/\s+/).some((w) => w.startsWith(query))
    );
    const contains = options.filter(
      (o) => !startsWith.includes(o) && !wordStarts.includes(o) && o.toLowerCase().includes(query)
    );
    return [...startsWith, ...wordStarts, ...contains];
  }, [options, query]);

  // "+ Add Custom" is the final row; -1 when custom values are not allowed.
  const customRowIndex = allowCustom ? matches.length : -1;
  const rowCount = matches.length + (allowCustom ? 1 : 0);
  const showList = open && !inCustomMode && rowCount > 0;

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!showList || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showList]);

  function pick(option: string) {
    onChange(option);
    setCustomMode(false);
    setOpen(false);
    setActiveIndex(-1);
  }

  function startCustom() {
    setCustomMode(true);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function chooseFromList() {
    setCustomMode(false);
    // A value that is not predefined cannot stay once back in list mode.
    if (isCustomValue) onChange("");
    inputRef.current?.focus();
  }

  function toggleList() {
    if (inCustomMode) {
      inputRef.current?.focus();
      return;
    }
    setOpen((o) => !o);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Swallow Escape so the surrounding modal stays open while the dropdown
      // (or custom mode) is the topmost thing on screen.
      if (showList) {
        setOpen(false);
        setActiveIndex(-1);
        e.preventDefault();
        e.stopPropagation();
      } else if (customMode) {
        chooseFromList();
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (inCustomMode) return; // free typing: let Enter bubble to the form

    if (!showList) {
      if (e.key === "ArrowDown" && rowCount > 0) {
        setOpen(true);
        setActiveIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? rowCount - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex === customRowIndex && allowCustom) {
        startCustom();
      } else if (activeIndex >= 0) {
        pick(matches[activeIndex]);
      } else {
        setOpen(false);
      }
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!customMode) {
              setOpen(true);
              setActiveIndex(-1);
            }
          }}
          onFocus={() => { if (!inCustomMode) setOpen(true); }}
          onKeyDown={onKeyDown}
          className={cn(DEFAULT_INPUT_CLS, className)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); toggleList(); }}
          aria-label={open ? "Hide options" : "Show all options"}
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
          {matches.length === 0 && (
            <li className="px-3 py-2 text-body text-muted italic">No matching option — type your own below.</li>
          )}
          {matches.map((option, i) => (
            <li
              key={option}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); pick(option); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-3 py-2 cursor-pointer text-body ${
                i === activeIndex ? "bg-bg-muted text-foreground" : "text-secondary hover:bg-bg-subtle"
              } ${option.toLowerCase() === query ? "text-crimson-primary" : ""}`}
            >
              {query ? highlight(option, query) : option}
            </li>
          ))}
          {allowCustom && (
            <li
              id={`${listId}-${customRowIndex}`}
              role="option"
              aria-selected={activeIndex === customRowIndex}
              onMouseDown={(e) => { e.preventDefault(); startCustom(); }}
              onMouseEnter={() => setActiveIndex(customRowIndex)}
              className={`px-3 py-2 cursor-pointer text-body font-medium border-t border-border-subtle ${
                activeIndex === customRowIndex
                  ? "bg-bg-muted text-crimson-primary"
                  : "text-crimson-primary hover:bg-bg-subtle"
              }`}
            >
              + Add Custom
            </li>
          )}
        </ul>
      )}

      {inCustomMode && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-caption text-status-amber">Custom value &mdash; saved as typed</span>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); chooseFromList(); }}
            className="text-caption text-crimson-primary hover:underline shrink-0"
          >
            Choose from list
          </button>
        </div>
      )}
    </div>
  );
}

/** Bold the matched prefix (of the option or of a word) so the hit is visible at a glance. */
function highlight(option: string, query: string) {
  if (!query) return option;
  const lower = option.toLowerCase();
  let start = lower.startsWith(query) ? 0 : -1;
  if (start < 0) {
    const idx = lower.indexOf(` ${query}`);
    if (idx >= 0) start = idx + 1;
  }
  if (start < 0) {
    const idx = lower.indexOf(query);
    if (idx >= 0) start = idx;
  }
  if (start < 0) return option;
  const end = start + query.length;
  return (
    <>
      {option.slice(0, start)}
      <span className="text-foreground font-semibold">{option.slice(start, end)}</span>
      {option.slice(end)}
    </>
  );
}
