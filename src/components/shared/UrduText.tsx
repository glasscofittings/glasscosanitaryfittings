import { staticUrdu } from "@/lib/report-i18n";

/** Secondary Urdu line under an English account name (hidden when untranslated). */
export function UrduUnder({ ur }: { ur?: string | null }) {
  if (!ur) return null;
  return (
    <span className="ur mt-0.5 text-caption text-muted" lang="ur" dir="rtl">
      {ur}
    </span>
  );
}

/** English label with its Urdu translation side by side (dictionary-backed). */
export function BiLabel({ en, className = "" }: { en: string; className?: string }) {
  const ur = staticUrdu(en);
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span>{en}</span>
      {ur && (
        <span className="ur text-caption text-muted" lang="ur" dir="rtl">
          {ur}
        </span>
      )}
    </span>
  );
}
