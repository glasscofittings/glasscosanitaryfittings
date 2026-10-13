"use client";

import { useEffect, useId, useRef } from "react";

/** Stack of currently open overlays; Escape closes only the most recent one. */
const openOverlays: string[] = [];

/**
 * Closes the overlay when Escape is pressed, mirroring its backdrop click.
 * Nested popups close one at a time: only the topmost registered overlay reacts.
 *
 * @param open  Whether the overlay is currently shown (pass `true` for
 *              components that are conditionally mounted by their parent).
 * @param onClose Close handler — pass the exact same logic as the overlay's
 *                backdrop `onClick` (including any form resets).
 */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  const id = useId();
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    openOverlays.push(id);

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (openOverlays[openOverlays.length - 1] !== id) return;
      e.preventDefault();
      closeRef.current();
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const index = openOverlays.lastIndexOf(id);
      if (index >= 0) openOverlays.splice(index, 1);
    };
  }, [open, id]);
}
