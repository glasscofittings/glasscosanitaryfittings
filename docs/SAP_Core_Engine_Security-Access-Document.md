# Security, Access Control, and Error Handling Architecture
## Glassco ERP v3.0 (SAP-Style Engine)

**System:** Glassco ERP v3.0  
**Role:** Senior Security Engineer  
**Target Release:** Q4 2026  
**Document Status:** Final Security Specification  

---

## 1. Executive Summary & Core Security Architecture

In a SAP-style ERP system, security is not just about keeping bad actors out—it is about enforcing strict operational controls inside the business. The primary threat vector for an ERP system is internal non-compliance: unauthorized financial postings, unverified inventory releases, and silent data tampering.

### Guarantees
1. **Zero Client-Side Trust:** The UI components in Next.js and Tauri are purely presentational. Every business rule, tolerance check, and ledger posting is re-validated on the server/database layer.
2. **Immutable Financial Audit Trail:** Financial records, journal entries, and inventory receipts cannot be modified or deleted once posted. Adjustments must be executed as separate reversing entries.
3. **Least-Privilege Authorization:** Users are granted access strictly according to their functional role in the manufacturing and financial pipeline.

---

## 2. Authentication Strategy

For Glassco ERP, we utilize **Supabase Auth with JSON Web Tokens (JWTs)** integrated into standard **HTTP-Only, Secure, SameSite Cookies** (for web access) and **Native Secure Storage** (for Tauri desktop client execution).

### How Authentication Works (Plain English)
* **Single Source of Identity:** When an employee logs in with their email/username and password, the system verifies their identity and returns a short-lived, encrypted digital key (JWT) valid for 1 hour.
* **Role Embedding:** The user's assigned organizational role is embedded directly inside this encrypted key (`app_metadata.user_role`). 
* **Automatic Session Refresh:** A secure refresh token operates in the background to keep active operators logged in throughout their shift without requiring constant password re-entry.
* **Session Termination:** Logging out or changing password instantly invalidates the session across all desktop and web clients.

---

## 3. Role-Based Access Control (RBAC) Matrix

To prevent fraud and operational errors, job duties are separated across 5 distinct system roles:

+-----------------------------------------------------------------------------------+|                                  USER ROLES                                       |+---------------------+--------------------+-------------------+--------------------+| 1. Gate Keeper      | 2. Quality Inspector| 3. AP Accountant  | 4. Plant Manager   || (Inward Material)   | (Inspection/Lots)  | (Invoices/Ledger) | (Approvals/BOM)    |+---------------------+--------------------+-------------------+--------------------+|v+---------------------------+| 5. System Administrator   || (Full System Access)      |+---------------------------+
### Detailed Permissions Breakdown

| Role | Operational Scope | What They CAN Do | What They CANNOT Do |
| :--- | :--- | :--- | :--- |
| **`gate_keeper`** | Plant Entrance / Inward Logistics | • Log Inward Gate Passes (IGP)<br>• Record gross/net weight<br>• View active Purchase Orders | • Inspect quality or clear lots<br>• View financial costs or ledger<br>• Approve vendor invoices |
| **`qc_inspector`** | Quality Assurance Lab | • Inspect raw materials<br>• Accept or Reject lot quantities<br>• Transition lot from `quality_inspection` to `unrestricted` or `blocked` | • Edit Purchase Order quantities<br>• Post financial transactions<br>• Modify Chart of Accounts |
| **`ap_accountant`** | Accounts Payable & Finance | • Review pending vendor invoices<br>• Perform 3-Way Match validation<br>• Trigger double-entry GL ledger postings<br>• Issue payment vouchers | • Receive physical material at gate<br>• Force-override price variances<br>• Change BOM formulations |
| **`plant_manager`** | Operations & Administration | • Override price/qty matching variances<br>• Create & edit Bills of Materials (BOM)<br>• View all financial and inventory reports<br>• Approve purchase requisitions | • Delete historical GL ledger logs<br>• Bypass QC inspection requirements |
| **`admin`** | System & IT Operations | • Manage user accounts & roles<br>• Configure matching tolerances<br>• View audit logs & system health | • Execute manual un-balanced ledger overrides |

---

## 4. Supabase Row-Level Security (RLS) Rules

Database security is enforced at the database layer using PostgreSQL Row-Level Security (RLS). Even if an attacker bypasses the Next.js frontend, Supabase blocks unauthorized database queries.

```sql
-- Enable Row Level Security on all core ERP tables
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_ledger_entries ENABLE ROW LEVEL SECURITY;

-- Helper function to extract user role from JWT token
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'user_role', '')::text;
$$ LANGUAGE sql STABLE;

-- -----------------------------------------------------------------------------
-- RLS POLICIES
-- -----------------------------------------------------------------------------

-- 1. General Ledger Entries (FI Engine): Read by Accountant/Manager, Insert by Accountant/System Only
CREATE POLICY "Ledger entries readable by Finance and Managers"
ON public.gl_ledger_entries FOR SELECT
USING (public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin'));

CREATE POLICY "Ledger entries insertable only by AP Accountants"
ON public.gl_ledger_entries FOR INSERT
WITH CHECK (public.get_auth_role() IN ('ap_accountant', 'admin'));

-- Block UPDATE and DELETE on Ledger Entries to ensure strict immutability
CREATE POLICY "Prevent updates to Ledger Entries"
ON public.gl_ledger_entries FOR UPDATE USING (false);

CREATE POLICY "Prevent deletes to Ledger Entries"
ON public.gl_ledger_entries FOR DELETE USING (false);

-- 2. Inventory Lots (QM Engine): QC Inspectors and Managers update status
CREATE POLICY "Inventory lots readable by all authenticated staff"
ON public.inventory_lots FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Inventory lot status updateable by QC Inspector or Manager"
ON public.inventory_lots FOR UPDATE
USING (public.get_auth_role() IN ('qc_inspector', 'plant_manager', 'admin'))
WITH CHECK (public.get_auth_role() IN ('qc_inspector', 'plant_manager', 'admin'));

-- 3. Invoices (AP Engine): Variance overrides restricted to Plant Managers
CREATE POLICY "Invoices updateable by Accountants and Managers"
ON public.purchase_invoices FOR UPDATE
USING (public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin'))
WITH CHECK (
  -- If invoice has variance flag set, only plant_manager or admin can approve it
  CASE 
    WHEN variance_flag = true THEN public.get_auth_role() IN ('plant_manager', 'admin')
    ELSE public.get_auth_role() IN ('ap_accountant', 'plant_manager', 'admin')
  END
);
5. Complete Error Handling GuideClear error handling prevents invalid state changes and gives operational staff understandable guidance when an action is blocked.Failure PointFailure ScenarioSystem Handling & User MessageTechnical PreventionProcurement IntakeOperator attempts material intake without active Purchase OrderError: "Invalid PO Number. Material intake cannot proceed without an approved Purchase Order."Foreign key constraint on po_id + server validation before GRN creation.Quality ControlProduction attempts to consume a lot in quality_inspection or blocked statusError: "Lot [LOT-XXXX] is locked in Quality Inspection. Material cannot be issued to production."Database check constraint / RLS condition verifying status = 'unrestricted'.3-Way MatchingInvoice price differs from PO price by more than configured thresholdWarning: "Price Variance Exceeded (+3.2%). Invoice placed in 'Blocked Variance' queue. Manager approval required."Automated verification function evaluates math during invoice draft creation.Financial LedgerAttempting to submit a ledger entry where Total Debits $\neq$ Total CreditsError: "Unbalanced Transaction Error. Total Debits (PKR X) must equal Total Credits (PKR Y)."PostgreSQL transaction function verifies balance equality before committing row inserts.Database Network LossOffline desktop client running inside plant loses internet connectionNotification: "Connection Lost. Retrying operation in offline queue... Data will sync automatically when back online."Optimistic state caching via TanStack Query + retry queue in Tauri client.6. Pre-Launch Edge Case ChecklistCheck off these operational scenarios before deploying to production:[ ] Unbalanced Ledger Attempt: Test submitting a transaction with unequal debits and credits. Verify the database rejects it atomically.[ ] Bypassing Quality Lock: Attempt to dispatch or consume raw materials from a batch currently set to quality_inspection. Ensure the system blocks allocation.[ ] Invoice Double-Posting: Test submitting two vendor invoices pointing to the exact same Goods Receipt Note (GRN). Verify unique database index prevents duplicate entry.[ ] Price Variance Threshold: Generate an invoice with a 5% price markup over the approved PO price. Confirm it moves to blocked_variance and alerts the Plant Manager.[ ] Privilege Escalation: Log in as a gate_keeper and attempt to trigger an API route for General Ledger posting. Verify access is denied (403 Forbidden).[ ] Session Expiry During Heavy Entry: Let an operator's JWT expire while filling out a long GRN form. Verify background token refresh submits the form cleanly without data loss.[ ] Audit Trail Tampering: Attempt an UPDATE or DELETE query directly against gl_ledger_entries using the Supabase client. Verify RLS rules reject the SQL command