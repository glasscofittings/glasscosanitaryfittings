import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Auto-capitalizes ONLY the first character of the whole string
 * ("karachi traders" → "Karachi traders"). Shared by every field that
 * needs first-letter capitalization — do not reimplement per component.
 */
export function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
