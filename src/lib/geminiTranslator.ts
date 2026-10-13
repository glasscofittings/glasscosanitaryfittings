import { GoogleGenAI } from "@google/genai";

/**
 * English → Urdu translation for ERP invoice descriptions and accounting
 * narrations, powered by Google Gemini (`gemini-3.8-flash`).
 *
 * Every public helper is fail-open: when the API key is missing, the model
 * returns nothing, or the request throws, the original English text is
 * returned unchanged so document rendering never blocks on translation.
 *
 * Note on environment variables: `GEMINI_API_KEY` is read first (server/dev
 * runtime). This app ships as a static export (Tauri / browser), where only
 * `NEXT_PUBLIC_*` variables are inlined into the client bundle — so set
 * `NEXT_PUBLIC_GEMINI_API_KEY` to the same value for client-side calls.
 */

const MODEL = "gemini-3.8-flash";

/**
 * Model preference order: Google's current recommendation first, then
 * known-good fallbacks. Gemini rotates availability without notice (the 2.5
 * family now 404s for newer keys and fresh flash models intermittently 503),
 * so every call walks this list until one model answers — the session then
 * sticks with whichever one worked.
 */
const MODEL_FALLBACKS = [MODEL, "gemini-3.5-flash", "gemini-3.1-flash-lite"] as const;
let modelIndex = 0;

/** Availability churn (retired model / saturated capacity / quota) is worth a retry on the next model. */
function isModelUnavailable(err: unknown): boolean {
  const message = errorMessage(err);
  return (
    /"code":\s*(404|429|500|503)|\b(404|429|503)\b|NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|no longer available/i.test(
      message
    )
  );
}

/**
 * `generateContent` across `MODEL_FALLBACKS`. Auth/invalid-request errors are
 * rethrown immediately (another model would fail the same way); availability
 * errors advance to the next candidate and only surface once all are tried.
 */
async function generateWithFallback(
  ai: GoogleGenAI,
  contents: string,
  config: { systemInstruction?: string; responseMimeType?: string }
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MODEL_FALLBACKS.length; attempt++) {
    const index = (modelIndex + attempt) % MODEL_FALLBACKS.length;
    try {
      const response = await ai.models.generateContent({
        model: MODEL_FALLBACKS[index],
        contents,
        config,
      });
      modelIndex = index; // stick with the model that answered
      return response;
    } catch (err) {
      lastError = err;
      if (!isModelUnavailable(err)) throw err;
    }
  }
  throw lastError;
}

const SYSTEM_INSTRUCTION = [
  "You are a senior translator for a Pakistani ERP and accounting product.",
  "Translate English invoice, ledger and accounting text into professional Pakistani Urdu using standard accounting terminology as used in Pakistan (e.g. ڈیبٹ، کریڈٹ، بیلنس، انوائس، واؤچر، لیجر، کھاتہ، کل قابل ادائیگی).",
  "Rules:",
  "- Output only the translation. No preamble, explanations, apologies, conversational filler, markdown, code fences, bullet points or quotation marks.",
  "- Preserve numbers, currency codes (PKR), dates, invoice/voucher numbers, product codes, units (kg, pcs) and brand or proper nouns exactly as given.",
  "- Keep text that is already in Urdu unchanged.",
  "- Never leave English words untranslated unless they are brand names, product codes or unit abbreviations.",
].join("\n");

const BATCH_INSTRUCTION = [
  SYSTEM_INSTRUCTION,
  "Batch mode: the user message is a JSON array of strings.",
  "Translate every element and reply with a single JSON array of strings only — same length, same order as the input, no markdown and no commentary.",
].join("\n");

/* ─── Static accounting dictionary ───────────────────────────────────────── */

/** Standard Urdu terms for static invoice / statement headers (no API call needed). */
export const INVOICE_URDU_DICTIONARY = {
  INVOICE: "انوائس",
  CUSTOMER: "گاہک",
  DATE: "تاریخ",
  DEBIT: "ڈیبٹ",
  CREDIT: "کریڈٹ",
  BALANCE: "بیلنس",
  "TOTAL PAYABLE": "کل قابل ادائیگی",
  "STATEMENT OF ACCOUNT": "کھاتہ بیان",
  "INVOICE NUMBER": "انوائس نمبر",
  "BILL TO": "بنام",
  QUANTITY: "مقدار",
  "UNIT PRICE": "فی یونٹ قیمت",
  "LINE TOTAL": "سطری میزان",
  "TAXABLE VALUE": "قابلِ ٹیکس مالیت",
  "SALES TAX": "سیلز ٹیکس",
  "FURTHER TAX": "مزید ٹیکس",
  TOTAL: "کل رقم",
  AMOUNT: "رقم",
  NARRATION: "تفصیل",
  DESCRIPTION: "تفصیل",
  "OPENING BALANCE": "ابتدائی بیلنس",
  "CLOSING BALANCE": "اختتامی بیلنس",
  "CLOSING BALANCE B/F": "اختتامی بیلنس (سابقہ)",

  /* Financial statement sections, totals and footer rows */
  Assets: "اثاثے",
  Liabilities: "واجبات",
  Equity: "ایکویٹی",
  Revenue: "آمدن",
  Expenses: "اخراجات",
  "Total Assets": "کل اثاثے",
  "Total Liabilities": "کل واجبات",
  "Total Equity": "کل ایکویٹی",
  "Total Revenue": "کل آمدن",
  "Total Expenses": "کل اخراجات",
  "Net Profit": "خالص نفع",
  "Net Loss": "خالص نقصان",
  "Net Profit (P&L)": "خالص نفع (نفع و نقصان)",
  Difference: "فرق",
  "Liabilities + Equity": "واجبات اور ایکویٹی",
  "Balance Check": "توازن کی جانچ",
  "Grand Totals": "کل ارقام",
  "Filtered Totals": "فلٹر شدہ کل",
  "Trial Balance": "ٹرائل بیلنس",
  "Balance Sheet": "میزانیہ",
  "Profit & Loss": "نفع و نقصان",
  Journal: "جارنل",
  Accounts: "اکاؤنٹس",
  "Equity + Profit": "ایکویٹی + نفع",
  Account: "اکاؤنٹ",
  Code: "کوڈ",
  Type: "قسم",
  "No asset entries": "کوئی اثاثہ اندراج نہیں",
  "No liability entries": "کوئی واجب اندراج نہیں",
  "No equity entries": "کوئی ایکویٹی اندراج نہیں",
  "No revenue entries": "کوئی آمدن اندراج نہیں",
  "No expense entries": "کوئی اخراج اندراج نہیں",

  /* Trial balance account types */
  ASSET: "اثاثہ",
  LIABILITY: "واجبہ",
  EQUITY: "ایکویٹی",
  REVENUE: "آمدن",
  EXPENSE: "خرچہ",

  /* Default ERP chart of accounts (accounts_chart seed) */
  "Cash in Hand": "نقد رقم",
  "hand in cash": "نقد رقم",
  "Cash at Bank": "بینک میں نقد",
  "Bank Account": "بینک اکاؤنٹ",
  "Accounts Receivable": "قابل وصول رقم (صارفین)",
  "Accounts Payable": "قابل ادا رقم (سپلائرز)",
  "Accounts Payable (Suppliers)": "قابل ادا رقم (سپلائرز)",
  "Raw Material Inventory": "خام مال کا اسٹاک",
  "Finished Goods Inventory": "تیار مال کا اسٹاک",
  "Prepaid Expenses": "پیشگی ادائیگی شدہ اخراجات",
  "Trade Debts": "تجارتی وصولیاں",
  "FBR Sales Tax Payable": "ایف بی آر سیلز ٹیکس واجب الادا",
  "Accrued Expenses": "اجمع شدہ اخراجات",
  "Sales Tax Collected": "سیلز ٹیکس",
  "Further Tax Payable": "مزید ٹیکس",
  "Wages Payable": "مزدوری واجب الادا",
  "Owner Equity": "مالکیت (ایکویٹی)",
  "Retained Earnings": "محفوظ منافع",
  "Sales Revenue": "سیلز آمدن",
  "Other Income": "دیگر آمدن",
  "Service Revenue": "خدماتی آمدن",
  "Raw Material Consumption Expense": "خام مال استعمال اخراجات",
  "Salary & Wages Expense": "تنخواہ و مزدوری اخراجات",
  "Utilities Expense": "یوٹیلیٹی اخراجات",
  "Rent Expense": "کرائہ اخراجات",
  "Freight Expense": "نقل و حمل اخراجات",
  "Cost of Goods Sold": "فروخت شدہ مال کی لاگت",
  Sales: "فروخت",
  Purchases: "خریداری",
  "Factory Consumables": "فیکٹری مصرفی مواد",
  "Repair & Maintenance": "مرمت و دیکھ بھال",
  "Sales Tax Payable": "سیلز ٹیکس واجب الادا",
  Capital: "سرمایہ",
} as const;

export type InvoiceUrduTerm = keyof typeof INVOICE_URDU_DICTIONARY;

/** Uppercase index built once so lookup stays case-insensitive for any key style. */
let dictionaryIndex: Map<string, string> | null = null;

/**
 * Case-insensitive dictionary lookup (keys may be "TOTAL ASSETS" or "Total Assets").
 * Returns the original term when unknown.
 */
export function lookupInvoiceUrdu(term: string): string {
  const target = term.trim().toUpperCase();
  if (!target) return term;
  if (!dictionaryIndex) {
    dictionaryIndex = new Map(
      Object.entries(INVOICE_URDU_DICTIONARY).map(([key, value]) => [key.toUpperCase(), value])
    );
  }
  return dictionaryIndex.get(target) ?? term;
}

/* ─── Gemini client ──────────────────────────────────────────────────────── */

function getGeminiApiKey(): string | null {
  // `process` can be absent in plain browser bundles. Keep both accesses as
  // literal member expressions: Next.js only inlines statically referenced
  // `process.env.NEXT_PUBLIC_*` variables (computed lookups are not inlined).
  if (typeof process === "undefined") return null;
  const key = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  const trimmed = key?.trim();
  return trimmed ? trimmed : null;
}

let client: GoogleGenAI | null = null;
let clientApiKey: string | null = null;

function getClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  if (!client || clientApiKey !== apiKey) {
    client = new GoogleGenAI({ apiKey });
    clientApiKey = apiKey;
  }
  return client;
}

/* ─── In-memory translation cache (dedupes repeats within a session) ────── */

const translationCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 500;

function rememberTranslation(source: string, translated: string): void {
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(source, translated);
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ─── Fail-open logging (never floods the browser console) ──────────────── */

let missingKeyWarned = false;
let failureWarned = false;

/** Missing key: logged at most once per session, then silent. */
function warnMissingKeyOnce(): void {
  if (missingKeyWarned) return;
  missingKeyWarned = true;
  console.warn(
    "[geminiTranslator] No GEMINI_API_KEY or NEXT_PUBLIC_GEMINI_API_KEY available — " +
      "translation disabled, original text returned. (This warning is logged once.)"
  );
}

/**
 * Model/API failures: the first is logged with full detail, later ones are
 * suppressed until a translation succeeds again, so a broken key or rate limit
 * cannot print one line per invoice item.
 */
function warnFailureOnce(message: string): void {
  if (failureWarned) return;
  failureWarned = true;
  console.error(
    `[geminiTranslator] ${message} — further failures stay silent until a translation succeeds.`
  );
}

/** A successful translation re-arms failure logging for the next incident. */
function noteSuccess(): void {
  failureWarned = false;
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

/**
 * Translates one English ERP/invoice string into professional Pakistani Urdu.
 * Returns the original string whenever the key is missing or the API fails.
 */
export async function translateToUrdu(text: string): Promise<string> {
  if (!text || !text.trim()) return text;

  const cached = translationCache.get(text);
  if (cached !== undefined) return cached;

  const ai = getClient();
  if (!ai) {
    warnMissingKeyOnce();
    return text;
  }

  try {
    const response = await generateWithFallback(ai, text, {
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const translated = response.text?.trim();
    if (!translated) {
      warnFailureOnce("Empty model response — returning the original text.");
      return text;
    }

    rememberTranslation(text, translated);
    noteSuccess();
    return translated;
  } catch (err) {
    warnFailureOnce(`Translation failed: ${errorMessage(err)}`);
    return text;
  }
}

/**
 * Translates an array of English strings (invoice line items, narrations) in a
 * single Gemini call using `responseMimeType: 'application/json'`.
 * The returned array always matches the input length and order; entries the
 * model could not translate (or any API failure) fall back to the original text.
 */
export async function translateBatchToUrdu(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];

  const results = texts.slice();

  // Resolve cache hits / blank entries up front; send each unique string once.
  const uniquePending: string[] = [];
  const seen = new Set<string>();
  texts.forEach((text, index) => {
    if (!text || !text.trim()) return;
    const cached = translationCache.get(text);
    if (cached !== undefined) {
      results[index] = cached;
      return;
    }
    if (seen.has(text)) return;
    seen.add(text);
    uniquePending.push(text);
  });

  if (uniquePending.length === 0) return results;

  const ai = getClient();
  if (!ai) {
    warnMissingKeyOnce();
    return results;
  }

  try {
    const response = await generateWithFallback(ai, JSON.stringify(uniquePending), {
      systemInstruction: BATCH_INSTRUCTION,
      responseMimeType: "application/json",
    });

    const raw = response.text;
    if (!raw || !raw.trim()) throw new Error("empty model response");

    const parsed: unknown = JSON.parse(stripJsonFences(raw));
    if (!Array.isArray(parsed)) throw new Error("model response is not a JSON array");

    const translatedBySource = new Map<string, string>();
    uniquePending.forEach((source, index) => {
      const candidate = parsed[index];
      const translated = typeof candidate === "string" && candidate.trim() ? candidate.trim() : source;
      translatedBySource.set(source, translated);
      rememberTranslation(source, translated);
    });

    texts.forEach((text, index) => {
      const translated = translatedBySource.get(text);
      if (translated !== undefined) results[index] = translated;
    });

    noteSuccess();
    return results;
  } catch (err) {
    warnFailureOnce(`Batch translation failed: ${errorMessage(err)}`);
    return results;
  }
}
