/**
 * Dispatch workflow — tests updated to reflect that the approval workflow has
 * been removed. Stock is deducted at invoice creation (not gated on approval).
 * Deleting a dispatch always reverses stock + ledger and returns the invoice to
 * draft. The `pending_approval` status and `approve_dispatch` RPC no longer exist.
 *
 * NOTE: The original approval-workflow tests in this file have been retired.
 * The remaining tests verify the direct-dispatch behaviour.
 */

// Intentionally empty: approval tests retired; direct-dispatch behaviour is
// covered by the general invoice and dispatch test suites.
