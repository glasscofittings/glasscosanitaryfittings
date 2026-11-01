// Client for the `set_document_datetime` Postgres function
// (supabase/migrations/20261125010000_set_document_datetime.sql).
//
// Pattern copied from src/lib/supabase/labour.ts (env + headers + fetch).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

function extractSupabaseError(body: unknown): string {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (typeof b.message === "string" && b.message) return b.message;
    if (typeof b.msg === "string" && b.msg) return b.msg;
    try {
      return JSON.stringify(body);
    } catch {
      return "Unknown error";
    }
  }
  if (typeof body === "string") {
    try {
      return extractSupabaseError(JSON.parse(body));
    } catch {
      return body || "Unknown error";
    }
  }
  return "Unknown error";
}

export type DocumentType = "INVOICE" | "JOURNAL" | "QUOTATION";

/**
 * Move a document's date/time (created_at + business date) via the
 * `set_document_datetime` SECURITY DEFINER function. Also records an audit-log
 * entry; for invoices it moves the matching ledger posting as well.
 *
 * @param input.at  ISO timestamp (e.g. "2026-11-05T14:30:00+05:00").
 * @param input.reason  Minimum 5 characters — enforced by the database.
 */
export async function setDocumentDateTime(input: {
  docType: DocumentType;
  id: string;
  at: string; // ISO
  reason: string;
  operator?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL) return { ok: false, error: "Supabase URL not configured." };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_document_datetime`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_doc_type: input.docType,
        p_id: input.id,
        p_at: input.at,
        p_reason: input.reason,
        p_operator: input.operator ?? "System Operator",
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: extractSupabaseError(body) };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/** Fixed Pakistan Standard Time offset (UTC+05:00, no DST). */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * ISO timestamp -> 'YYYY-MM-DDTHH:mm' wall-clock time in Asia/Karachi,
 * for `<input type="datetime-local">`.
 */
export function toLocalInputValue(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  // Shift so the UTC getters read the PKT wall clock.
  const pk = new Date(d.getTime() + PKT_OFFSET_MS);
  const y = String(pk.getUTCFullYear()).padStart(4, "0");
  const mo = String(pk.getUTCMonth() + 1).padStart(2, "0");
  const day = String(pk.getUTCDate()).padStart(2, "0");
  const hh = String(pk.getUTCHours()).padStart(2, "0");
  const mm = String(pk.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day}T${hh}:${mm}`;
}

/**
 * 'YYYY-MM-DDTHH:mm' (from a datetime-local input, read as Asia/Karachi wall
 * time) -> ISO string with an explicit +05:00 offset.
 *
 * Deliberately does NOT use `new Date(v)`, so the result is identical on any
 * PC timezone.
 */
export function fromLocalInputValue(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v ?? "");
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  return `${y}-${mo}-${d}T${hh}:${mm}:00+05:00`;
}

/** ISO timestamp -> '05 Nov 2026, 02:30 PM' (Asia/Karachi). */
export function formatDateTimePKT(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const pk = new Date(d.getTime() + PKT_OFFSET_MS);
  const day = String(pk.getUTCDate()).padStart(2, "0");
  const mon = MONTHS_SHORT[pk.getUTCMonth()];
  const yr = pk.getUTCFullYear();

  let h = pk.getUTCHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const hh = String(h).padStart(2, "0");
  const mm = String(pk.getUTCMinutes()).padStart(2, "0");

  return `${day} ${mon} ${yr}, ${hh}:${mm} ${ampm}`;
}
