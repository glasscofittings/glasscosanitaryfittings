# Product Requirements Document (PRD): Enterprise SAP-Style Core Engine

**System:** Glassco ERP  
**Version:** 3.0 (Enterprise Architectural Overhaul)  
**Target Stack:** Next.js, Tauri, Supabase (PostgreSQL), TypeScript, Tailwind CSS  
**Target Release:** Q4 2026  

---

## 1. Executive Summary & Objective

The goal of this initiative is to transition **Glassco ERP** from a transaction-recording interface into an automated, rule-based **SAP-style Enterprise Resource Planning (ERP)** system. 

By enforcing strict controls such as **Automated Double-Entry Ledger Posting**, **3-Way Matching**, **State-Driven Batch/Lot Inventory Locking**, and an **MRP II Engine**, Glassco ERP will eliminate manual data entry errors, prevent unauthorized financial posting, and provide real-time material requirements planning.

---

## 2. Core Functional Modules

                    +---------------------------------+
                    |   Purchase Order (PO) Engine    |
                    +---------------------------------+
                                     |
                                     v
+-----------------------+     +---------------------------+| Material Intake (IGP) | --> | Goods Receipt Note (GRN)  |+-----------------------+     +---------------------------+|v+---------------------------+| 3-Way Matching Validation |+---------------------------+|v+---------------------------+| Pending Vendor Invoices   |+---------------------------+|v+---------------------------+| Double-Entry GL Posting   |+---------------------------+
### Module 1: Automated 3-Way Matching Procurement (MM / AP)

#### 1.1 Requirements
1. **Purchase Order Creation:** All raw material intakes must reference an active, approved Purchase Order (PO).
2. **Tolerance Checking:** When a GRN is created, the system must validate the received quantity and unit price against the PO.
3. **Automated Invoice Clearing:** Invoices cannot transition to `posted` status unless 3-way matching conditions pass:
   $$\text{PO Price} = \text{GRN Unit Price} = \text{Vendor Invoice Unit Price}$$
   $$\text{PO Quantity} \ge \text{GRN Accepted Quantity} = \text{Vendor Invoiced Quantity}$$
4. **Variance Handling:** If price or quantity variances exceed a configurable threshold (e.g., $\pm 1.5\%$), the system locks the invoice into `blocked_price_variance` or `blocked_qty_variance` status, requiring Manager Override.

#### 1.2 User Flow
1. Procurement creates Purchase Order (`PO-2026-XXXX`).
2. Gate operator issues Inward Gate Pass (IGP) linked to `PO-2026-XXXX`.
3. Quality Inspector submits GRN; system compares `Accepted Qty` against `PO Qty`.
4. System automatically generates a **Pending Vendor Invoice** with variance flags evaluated.

---

### Module 2: State-Driven Batch & Lot Inventory Control (QM / MM)

#### 2.1 Requirements
1. **Automated Lot Assignment:** Every incoming material entry automatically generates a system-wide unique Lot/Batch ID (`LOT-YYYY-XXXX`).
2. **Inventory Status States:**
   * `quality_inspection`: Material received but locked from production or sale.
   * `unrestricted`: Material cleared by QC and available for consumption.
   * `blocked`: Material rejected by QC or expired.
3. **Production Lock:** The Production and Dispatch modules must strictly reject any raw material lot that is not in `unrestricted` status.

---

### Module 3: Double-Entry General Ledger (GL) Engine (FI / CO)

#### 3.1 Requirements
1. **Chart of Accounts (COA) Integration:** Maintain standard account categories: Asset, Liability, Equity, Revenue, Expense.
2. **Event-Driven Automatic Postings:** No financial ledger entries are created manually for standard operations. The engine listens for system events:

| Trigger Event | Debit Account | Credit Account | Execution Trigger |
| :--- | :--- | :--- | :--- |
| **GRN Approval** | `Raw Material Inventory` | `GRN Clearing / AP Accrual` | Automated on QC Approval |
| **Vendor Invoice Approval** | `GRN Clearing / AP Accrual` | `Accounts Payable (Vendor)` | Manual `[ Approve & Post ]` |
| **Payment Voucher Executed** | `Accounts Payable (Vendor)` | `Cash / Bank Account` | Voucher Confirmation |
| **Sales Invoice Posted** | `Accounts Receivable (Customer)` | `GST Sales Revenue` & `Tax Payable` | Manual `[ Post Invoice ]` |

3. **Strict Isolation:** Pending or draft documents MUST NOT alter ledger balances until explicitly posted.

---

### Module 4: Bill of Materials (BOM) & Material Requirements Planning (MRP II)

#### 4.1 Requirements
1. **Multi-Level BOM:** Define raw material formulations per unit of finished product (e.g., Paints, Primers, Coatings).
2. **MRP Calculation Engine:**
   * **Input:** Sales Orders + Current Finished Goods Stock + Work-In-Progress (WIP).
   * **Formula:**
     $$\text{Gross Requirement} = (\text{Sales Order Qty} + \text{Safety Stock}) - \text{On-Hand Stock}$$
     $$\text{Net Component Requirement} = \text{Gross Requirement} \times \text{BOM Recipe Ratio}$$
   * **Output:** Auto-draft Purchase Requisitions for missing raw components.

---

## 3. Database Schema (Supabase / PostgreSQL)

Run the following SQL migration script in Supabase to create the base tables, constraints, and audit logs:

```sql
-- Enums for strict status handling
CREATE TYPE lot_status_enum AS ENUM ('quality_inspection', 'unrestricted', 'blocked');
CREATE TYPE invoice_status_enum AS ENUM ('draft', 'pending_approval', 'posted', 'blocked_variance', 'cancelled');
CREATE TYPE account_type_enum AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- 1. Chart of Accounts Table
CREATE TABLE public.gl_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(50) UNIQUE NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type account_type_enum NOT NULL,
    balance NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Purchase Orders Table
CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(50) UNIQUE NOT NULL,
    vendor_id UUID NOT NULL,
    total_amount_pkr NUMERIC(15, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'approved',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Batch / Lot Inventory Table
CREATE TABLE public.inventory_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number VARCHAR(50) UNIQUE NOT NULL,
    product_id VARCHAR(50) NOT NULL,
    initial_qty NUMERIC(12, 4) NOT NULL,
    current_qty NUMERIC(12, 4) NOT NULL,
    unit_price_pkr NUMERIC(15, 2) NOT NULL,
    status lot_status_enum DEFAULT 'quality_inspection',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Goods Receipt Notes (GRN) Table
CREATE TABLE public.goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(50) UNIQUE NOT NULL,
    po_id UUID REFERENCES public.purchase_orders(id),
    vendor_id UUID NOT NULL,
    lot_id UUID REFERENCES public.inventory_lots(id),
    received_qty NUMERIC(12, 4) NOT NULL,
    accepted_qty NUMERIC(12, 4) NOT NULL,
    rejected_qty NUMERIC(12, 4) DEFAULT 0.00,
    unit_price_pkr NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Vendor Purchase Invoices Table
CREATE TABLE public.purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    grn_id UUID REFERENCES public.goods_receipt_notes(id),
    po_id UUID REFERENCES public.purchase_orders(id),
    vendor_id UUID NOT NULL,
    taxable_amount NUMERIC(15, 2) NOT NULL,
    tax_amount NUMERIC(15, 2) NOT NULL,
    total_payable NUMERIC(15, 2) NOT NULL,
    status invoice_status_enum DEFAULT 'pending_approval',
    variance_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Immutable General Ledger Entries Table
CREATE TABLE public.gl_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_ref VARCHAR(100) NOT NULL,
    account_id UUID REFERENCES public.gl_accounts(id),
    debit_pkr NUMERIC(15, 2) DEFAULT 0.00,
    credit_pkr NUMERIC(15, 2) DEFAULT 0.00,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
4. Double-Entry Posting Engine ImplementationAdd this helper function inside src/lib/supabase/ledger.ts to execute balanced double-entry transactions inside PostgreSQL:TypeScriptimport { supabase } from '@/lib/supabase/client';

interface LedgerEntryPayload {
  transactionRef: string;
  debitAccountId: string;
  creditAccountId: string;
  amountPKR: number;
  operatorName: string;
}

export async function postDoubleEntryTransaction({
  transactionRef,
  debitAccountId,
  creditAccountId,
  amountPKR,
  operatorName,
}: LedgerEntryPayload): Promise<{ success: boolean; error?: string }> {
  if (amountPKR <= 0) {
    return { success: false, error: 'Transaction amount must be greater than zero.' };
  }

  // Execute double-entry batch insertion
  const { error } = await supabase.from('gl_ledger_entries').insert([
    {
      transaction_ref: transactionRef,
      account_id: debitAccountId,
      debit_pkr: amountPKR,
      credit_pkr: 0.00,
      created_by: operatorName,
    },
    {
      transaction_ref: transactionRef,
      account_id: creditAccountId,
      debit_pkr: 0.00,
      credit_pkr: amountPKR,
      created_by: operatorName,
    },
  ]);

  if (error) {
    console.error('Ledger Posting Error:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}
5. Implementation Milestones & RoadmapSprintObjectiveDeliverablesSprint 1Database & COA EngineSchema migrations, Chart of Accounts setup, postDoubleEntryTransaction utility.Sprint 2Unified 1-Step Intake & GRNMerge IGP and Quality Inspection drawers; auto-populate lot locks.Sprint 3AP Pending Queue & 3-Way MatchBuild /invoicing/pending queue with tolerance variance checking and selective [ Approve & Post ].Sprint 4MRP II & BOM IntegrationBuild recipe formulation UI and missing material requirement calculator.Sprint 5Role Access & Immutable AuditLock financial routes by role; enforce change logging across all tables.