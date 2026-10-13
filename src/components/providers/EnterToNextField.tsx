"use client";

import { useEffect } from "react";

/**
 * Enter in a text field commits the typed value (blur fires) and moves focus to
 * the next field. Text areas keep their default behaviour: Enter starts a new line.
 */
const NON_TEXT_INPUTS = ["hidden", "checkbox", "radio", "file", "submit", "button", "reset", "image"];
const INPUT_SELECTOR = "input" + NON_TEXT_INPUTS.map((type) => `:not([type="${type}"])`).join("");
const FIELD_SELECTOR = [INPUT_SELECTOR, "select:not([disabled])", "textarea:not([disabled])"].join(",");

/** Nearest container that should hold a field group: scoped wrapper, form, drawer or modal. */
const SCOPE_SELECTOR = "[data-enter-scope], form, .drawer-body, .fixed";

export default function EnterToNextField() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // A component already handled Enter (combobox pick, "add row", submit, ...).
      if (event.defaultPrevented) return;

      const target = event.target;
      const isInput = target instanceof HTMLInputElement;
      const isSelect = target instanceof HTMLSelectElement;
      if (!isInput && !isSelect) return;
      if (isInput) {
        if (target.disabled || target.readOnly) return;
        if (NON_TEXT_INPUTS.includes(target.type)) return;
        if (target.dataset.enterIgnore !== undefined) return;
        if (target.getAttribute("role") === "combobox" && target.getAttribute("aria-expanded") === "true") return;
      } else if (target.disabled) {
        return;
      }

      const scope = (target.closest(SCOPE_SELECTOR) as ParentNode | null) ?? document.body;
      const fields = Array.from(
        scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(FIELD_SELECTOR)
      ).filter(
        (el) =>
          !el.disabled &&
          !(el instanceof HTMLInputElement && el.readOnly) &&
          el.getClientRects().length > 0 &&
          el.dataset.enterIgnore === undefined
      );

      const index = fields.indexOf(target as HTMLInputElement | HTMLSelectElement);
      if (index === -1) return;

      const next = fields.slice(index + 1).find((el) => el.getClientRects().length > 0);
      if (!next) return;

      event.preventDefault();
      next.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
