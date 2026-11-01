// Disabled / removed Urdu translation helper
export const INVOICE_URDU_DICTIONARY: Record<string, string> = {};
export type InvoiceUrduTerm = string;

export function lookupInvoiceUrdu(term: string): string {
  return term;
}

export async function translateToUrdu(text: string): Promise<string> {
  return text;
}

export async function translateBatchToUrdu(texts: string[]): Promise<string[]> {
  return texts;
}
