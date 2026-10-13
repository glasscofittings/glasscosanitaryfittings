"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const PIN_LENGTH = 4;
const LOCKOUT_MS = 3000;

export default function PinKeypad() {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const validate = useCallback(
    (pin: string[]) => {
      const code = pin.join("");
      if (code.length < PIN_LENGTH) return;

      if (code === process.env.NEXT_PUBLIC_MASTER_APP_PIN) {
        // Authentication handled globally - no-op
      } else {
        setError(true);
        setLocked(true);
        timeoutRef.current = setTimeout(() => {
          setDigits([]);
          setError(false);
          setLocked(false);
        }, LOCKOUT_MS);
      }
    },
    []
  );

  const handleKey = (key: string) => {
    if (locked) return;
    if (digits.length >= PIN_LENGTH) return;

    const next = [...digits, key];
    setDigits(next);
    setError(false);
    validate(next);
  };

  const handleDelete = () => {
    if (locked) return;
    setDigits((d) => d.slice(0, -1));
    setError(false);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-display font-bold tracking-tight text-foreground">
          Node Station
        </h1>
        <p className="text-body text-secondary">Enter Master Access PIN</p>
      </div>

      <div className="flex gap-4">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`h-14 w-14 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
              error
                ? "border-status-alert bg-status-alert/10 animate-pulse"
                : i < digits.length
                  ? "border-crimson-primary bg-crimson-primary/10"
                  : "border-border-default bg-bg-muted"
            }`}
          >
            {i < digits.length && (
              <div className="h-3 w-3 rounded-full bg-crimson-primary" />
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="text-caption text-status-alert font-mono">
          Incorrect PIN. Try again.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 w-72">
        {keys.map((key, i) => {
          if (key === "") return <div key={i} />;

          const isDelete = key === "⌫";

          return (
            <button
              key={i}
              onClick={() => (isDelete ? handleDelete() : handleKey(key))}
              disabled={locked}
              className={`h-16 rounded-xl font-mono text-lg font-semibold transition-all duration-150 active:scale-95 disabled:opacity-40 ${
                isDelete
                  ? "bg-bg-muted text-secondary hover:bg-bg-muted border border-border-default"
                  : "bg-bg-muted text-foreground hover:bg-bg-muted border border-border-default hover:border-crimson-primary/30"
              }`}
            >
              {key}
            </button>
          );
        })}
      </div>

      <span className="badge mt-4">
        {process.env.NEXT_PUBLIC_DEVICE_NODE_ID ?? "NODE-01"}
      </span>
    </div>
  );
}
