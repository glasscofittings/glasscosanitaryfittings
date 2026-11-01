/** Urdu text components disabled/removed */
export function UrduUnder(_props: { ur?: string | null }) {
  return null;
}

export function BiLabel({ en, className = "" }: { en: string; className?: string }) {
  return <span className={className}>{en}</span>;
}
