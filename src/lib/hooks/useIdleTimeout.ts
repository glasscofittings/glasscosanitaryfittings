"use client";

import { useEffect, useRef } from "react";
import { useIdleTimer } from "react-idle-timer";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export function useIdleTimeout() {
  const lastAuthed = useRef(false);

  useEffect(() => {
    lastAuthed.current = false;
  }, []);

  useIdleTimer({
    timeout: IDLE_TIMEOUT_MS,
    onIdle: () => {
      // Idle timeout disabled - no auth action
    },
    debounce: 500,
  });
}
