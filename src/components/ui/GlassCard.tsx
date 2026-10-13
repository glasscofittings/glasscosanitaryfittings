import type { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export default function GlassCard({ children, className = "", hover = true }: GlassCardProps) {
  return (
    <div
      className={`glass-card p-5 bg-surface-card border border-border-subtle text-text-primary [data-theme=light]:shadow-[0_1px_3px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)] ${hover ? "[data-theme=light]:hover:border-black/12 [data-theme=light]:hover:shadow-[0_8px_24px_rgba(15,23,42,0.08),0_2px_6px_rgba(15,23,42,0.04)]" : "hover:border-border-subtle hover:shadow-none"} ${className}`}
    >
      {children}
    </div>
  );
}
