import type { InputHTMLAttributes } from "react";

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export default function GlassInput({ label, className = "", ...props }: GlassInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-caption font-medium text-muted uppercase tracking-wider">
          {label}
        </label>
      )}
      <input
        className={`glass-input h-9 px-3 rounded-lg bg-(--input-bg) border border-border-subtle text-text-primary font-mono text-body focus:border-(--input-focus-border) focus:outline-none focus:ring-2 focus:ring-[#DC2626]/20 [data-theme=light]:shadow-[0_1px_2px_rgba(15,23,42,0.04)] [data-theme=light]:focus:ring-[#B91C1C]/20 [data-theme=light]:focus:shadow-[0_0_0_3px_rgba(185,28,28,0.12),0_1px_2px_rgba(15,23,42,0.04)] transition-colors ${className}`}
        {...props}
      />
    </div>
  );
}
