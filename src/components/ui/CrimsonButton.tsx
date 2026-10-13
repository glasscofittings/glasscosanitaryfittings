import type { ButtonHTMLAttributes, ReactNode } from "react";

interface CrimsonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "ghost";
}

export default function CrimsonButton({ children, variant = "primary", className = "", ...props }: CrimsonButtonProps) {
  const base = "h-9 px-4 rounded-lg font-medium text-body transition-all inline-flex items-center justify-center gap-2";

  const variants = {
    primary:
      "crimson-btn-primary bg-[#DC2626] text-white hover:bg-[#B91C1C] active:bg-[#991B1B] [data-theme=light]:shadow-[0_1px_2px_rgba(185,28,28,0.28),0_1px_1px_rgba(15,23,42,0.06)] [data-theme=light]:hover:shadow-[0_4px_12px_rgba(185,28,28,0.22),0_1px_2px_rgba(15,23,42,0.06)]",
    ghost:
      "crimson-btn-ghost bg-transparent text-[#DC2626] border border-[#DC2626]/30 hover:bg-[#DC2626]/10 [data-theme=light]:border-[rgba(185,28,28,0.28)] [data-theme=light]:shadow-[0_1px_2px_rgba(15,23,42,0.04)] [data-theme=light]:hover:border-[rgba(185,28,28,0.4)]",
  };

  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
