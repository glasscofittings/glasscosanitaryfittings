"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  filterProductOptions,
  isKnownProductOption,
  normalizeProductOption,
  resolveOptionCommit,
} from "@/lib/product-options";

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
 * The typed query lives in its own `search` state and is only used to filter
 * while the list is open; the committed `value` is never touched by searching.
 * (Binding the filter to `value` was the original bug: any partial query such
 * as "Lever" was an unknown value, which flipped the field into custom mode and
 * hid the list — so typing appeared to return no results.)
 *
 * The last row is always "+ Add Custom": picking it carries the typed query into
 * the field (if any) and switches to custom mode so any value can be typed and
 * saved. A value that is already not in the list (e.g. a legacy DB value when
 * editing) is flagged as custom too, with a "Choose from list" link to clear it
 * and pick a predefined option.
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
  /** Filter text while the list is open — deliberately separate from `value`. */
  const [search, setSearch] = useState("");
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

  const query = normalizeProductOption(search);
  const normalizedValue = normalizeProductOption(value);
  const isKnownOption = isKnownProductOption(value, options);
  const isCustomValue = value.trim() !== "" && !isKnownOption;
  const showCustomHint = customMode || (isCustomValue && !open);

  // Ranked, normalised label search (see src/lib/product-options.ts).
  const matches = useMemo(() => filterProductOptions(options, query), [options, query]);

  // "+ Add Custom" is the final row; -1 when custom values are not allowed.
  const customRowIndex = allowCustom ? matches.length : -1;
  const rowCount = matches.length + (allowCustom ? 1 : 0);
  const showList = open && !customMode && rowCount > 0;

  // Show the committed value when closed (or while editing a custom value);
  // show the live query only while the list is open for browsing.
  const inputText = customMode || !open ? value : search;

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!showList || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, showList]);

  function openList() {
    if (customMode) return;
    setSearch(""); // a fresh browse always starts from the full list
    setActiveIndex(-1);
    setOpen(true);
  }

  function pick(option: string) {
    onChange(option);
    setCustomMode(false);
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
  }

  function startCustom() {
    // Carry what was typed into the value so the query becomes the custom entry.
    // An exact match on a predefined option snaps to its canonical spelling.
    const commit = resolveOptionCommit(search, options);
    if (commit) {
      if (!commit.isCustom) {
        pick(commit.value);
        return;
      }
      onChange(commit.value);
    }
    setCustomMode(true);
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  /**
   * Commit whatever was typed in list mode without dropping it.
   *
   * Runs on blur (the user clicks "Add Product" or another field) and on Enter
   * with no row highlighted. An exact option match is stored with the
   * predefined spelling; any other text becomes the custom value in the parent
   * form state. Escape remains the explicit cancel path (list-mode Escape
   * clears the query without committing).
   */
  function commitTypedSearch() {
    const commit = resolveOptionCommit(search, options);
    if (commit && !commit.isCustom) {
      pick(commit.value);
      return;
    }
    if (commit) onChange(commit.value);
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
  }

  function chooseFromList() {
    setCustomMode(false);
    // A value that is not predefined cannot stay once back in list mode.
    if (isCustomValue) onChange("");
    setSearch("");
    setActiveIndex(-1);
    setOpen(true); // show the options straight away so picking is one step
    inputRef.current?.focus();
  }

  function toggleList() {
    if (customMode) {
      inputRef.current?.focus();
      return;
    }
    if (open) {
      setOpen(false);
      setActiveIndex(-1);
    } else {
      openList();
    }
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Swallow Escape so the surrounding modal stays open while the dropdown
      // (or custom mode) is the topmost thing on screen.
      if (showList) {
        setOpen(false);
        setActiveIndex(-1);
        setSearch("");
        e.preventDefault();
        e.stopPropagation();
      } else if (customMode) {
        chooseFromList();
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (customMode) return; // free typing: let Enter bubble to the form

    if (!showList) {
      if (e.key === "ArrowDown" && rowCount > 0) {
        openList();
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
        // No row highlighted: keep what was typed instead of discarding it
        commitTypedSearch();
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
          value={inputText}
          onChange={(e) => {
            if (customMode) {
              onChange(e.target.value); // editing the committed value directly
              return;
            }
            setSearch(e.target.value);
            if (!open) setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => { if (!customMode) openList(); }}
          onBlur={() => {
            if (customMode) return;
            // Keep what was typed: blur fires when the user clicks "Add Product"
            // or moves to another field, so a typed custom entry must reach the
            // parent form state (previously it was cleared here and never saved).
            commitTypedSearch();
          }}
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
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-[200px] overflow-y-auto rounded-lg border border-border-default bg-obsidian-bg shadow-xl py-1"
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
              } ${normalizeProductOption(option) === normalizedValue && normalizedValue !== "" ? "text-crimson-primary" : ""}`}
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

      {showCustomHint && (
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
