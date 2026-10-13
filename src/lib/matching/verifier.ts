export interface MatchingParams {
  poUnitPrice: number;
  poQty: number;
  grnUnitPrice: number;
  grnAcceptedQty: number;
  invoiceUnitPrice: number;
  invoiceQty: number;
  tolerancePercentage?: number;
}

export interface MatchingResult {
  isMatch: boolean;
  priceVariance: number;
  qtyVariance: number;
  reason?: string;
}

/**
 * Performs Automated 3-Way Match Verification.
 *
 * Validates that the Purchase Order, Goods Receipt Note, and Vendor Invoice
 * agree within a configurable tolerance threshold (default 1.5%).
 *
 * SAP-style rules:
 *   - PO Price ≈ GRN Unit Price ≈ Invoice Unit Price (within tolerance)
 *   - PO Qty ≥ GRN Accepted Qty = Invoice Qty (within tolerance)
 *
 * @param params - The three sets of values to compare
 * @returns A MatchingResult indicating pass/fail with variance details
 */
export function verifyThreeWayMatch(params: MatchingParams): MatchingResult {
  const tolerance = params.tolerancePercentage ?? 1.5;

  if (params.poUnitPrice <= 0) {
    return {
      isMatch: false,
      priceVariance: 0,
      qtyVariance: 0,
      reason: "PO unit price must be greater than zero.",
    };
  }

  if (params.grnAcceptedQty <= 0) {
    return {
      isMatch: false,
      priceVariance: 0,
      qtyVariance: 0,
      reason: "GRN accepted quantity must be greater than zero.",
    };
  }

  // Bug #8 fix: Guard against zero invoice values to prevent Infinity
  if (params.invoiceUnitPrice <= 0) {
    return {
      isMatch: false,
      priceVariance: 100,
      qtyVariance: 0,
      reason: "Invoice unit price must be greater than zero.",
    };
  }

  if (params.invoiceQty <= 0) {
    return {
      isMatch: false,
      priceVariance: 0,
      qtyVariance: 100,
      reason: "Invoice quantity must be greater than zero.",
    };
  }

  const priceVariance =
    (Math.abs(params.invoiceUnitPrice - params.poUnitPrice) / params.poUnitPrice) * 100;

  const qtyVariance =
    (Math.abs(params.invoiceQty - params.grnAcceptedQty) / params.grnAcceptedQty) * 100;

  if (priceVariance > tolerance) {
    return {
      isMatch: false,
      priceVariance,
      qtyVariance,
      reason: `Price variance (${priceVariance.toFixed(2)}%) exceeds threshold of ${tolerance}%. Invoice: PKR ${params.invoiceUnitPrice}, PO: PKR ${params.poUnitPrice}.`,
    };
  }

  if (qtyVariance > tolerance) {
    return {
      isMatch: false,
      priceVariance,
      qtyVariance,
      reason: `Quantity variance (${qtyVariance.toFixed(2)}%) exceeds threshold of ${tolerance}%. Invoice: ${params.invoiceQty}, GRN: ${params.grnAcceptedQty}.`,
    };
  }

  return { isMatch: true, priceVariance, qtyVariance };
}

/**
 * Evaluates whether an invoice should be blocked based on 3-way match results.
 *
 * Returns the appropriate `invoice_status_enum` value:
 * - `"blocked_variance"` when the match fails
 * - `"pending_approval"` when the match passes (ready for AP accountant to post)
 */
export function resolveInvoiceStatus(match: MatchingResult): "blocked_variance" | "pending_approval" {
  return match.isMatch ? "pending_approval" : "blocked_variance";
}
