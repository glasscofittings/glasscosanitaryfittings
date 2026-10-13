# Technical Architecture Document (TAD)
## Enterprise SAP-Style ERP Core Engine

**System:** Glassco ERP v3.0  
**Architect:** Senior Software Architect  
**Target Release:** Q4 2026  
**Document Status:** Final Architecture Specification  

---

## 1. Executive Overview & Architectural Principles

Glassco ERP v3.0 transitions the platform from a transactional CRUD application into a deterministic, rule-based Enterprise Resource Planning (ERP) engine modeled after core SAP operations (MM, FI/CO, QM, PP, and SD). 

### Core Architectural Guarantees
1. **Event-Driven Financial Isolation:** No general ledger entry or Accounts Payable liability is created until an explicit approval event occurs. Drafts, temporary gate passes, and pending inspections live in isolated operational state queues.
2. **Deterministic Double-Entry Integrity:** Financial postings adhere strictly to standard accounting equations. Single-entry adjustments or un-balanced ledger writes are rejected at the database level using atomic PostgreSQL functions and constraints.
3. **State-Driven Inventory Locks:** Material inventory moves through explicit state transitions (`quality_inspection` -> `unrestricted` -> `consumed` / `blocked`). Materials in inspection or blocked states cannot be allocated to production orders or sales dispatches.
4. **Automated 3-Way Procurement Matching:** Invoices are matched against original Purchase Orders (PO) and Goods Receipt Notes (GRN). Variances in price or quantity beyond set thresholds trigger system locks, preventing unauthorized payouts.

---

## 2. Recommended Tech Stack & Architectural Justification

| Layer | Technology | Operational Justification & SAP-Alignment |
| :--- | :--- | :--- |
| **Desktop Client** | **Tauri v2 + Rust** | Provides a lightweight, secure native desktop wrapper for manufacturing plant floor operators. Compiles to native binary with minimal resource footprint compared to Electron. |
| **Frontend Framework** | **Next.js 14+ (App Router)** | Delivers server-side rendering (SSR) for fast data tables and modern React Server Components (RSC) for dashboard aggregation. |
| **Type Safety** | **TypeScript (Strict Mode)** | Enforces structural typing across domain entities (GRNs, JEs, Lots, BOMs) to reduce runtime type errors. |
| **Styling & UI Components** | **Tailwind CSS + Shadcn UI** | Enables high-density enterprise UI components (data grids, modal drawers, status badges) optimized for dense data entry. |
| **Database & Auth** | **Supabase (PostgreSQL 16)** | Core relational engine providing Row-Level Security (RLS), real-time subscriptions, and transactional RPC functions. |
| **State & Cache** | **TanStack Query (React Query)** | Manages optimistic UI updates, cache invalidation, and background synchronization for local offline-first mutations. |
| **Validation** | **Zod** | Enforces runtime schema validation at server actions, API routes, and client forms. |

---

## 3. Project File & Folder Structure

glassco-erp/
├── src/
│   ├── app/                         # Next.js App Router (Pages & API Routes)
│   │   ├── (auth)/                  # Auth layout and login routes
│   │   ├── (dashboard)/             # Main ERP Application Layout
│   │   │   ├── procurement/         # MM: Inward Gate Passes, GRNs, POs
│   │   │   ├── inventory/           # MM/QM: Lot tracking, Warehouse Bins
│   │   │   ├── production/          # PP: Bill of Materials (BOM), MRP Engine
│   │   │   ├── finance/             # FI/CO: Chart of Accounts, General Ledger
│   │   │   └── invoicing/           # AP/AR: Pending Vendor Invoices, 3-Way Match
│   │   └── api/                     # Server Actions / Webhook Handlers
│   ├── components/                  # Reusable UI Components
│   │   ├── ui/                      # Base primitives (Buttons, Tables, Inputs)
│   │   ├── forms/                   # Complex multi-step enterprise drawers
│   │   └── data-tables/             # Advanced filters, paginated tables
│   ├── lib/                         # Core Business Logic & SAP Engine Drivers
│   │   ├── supabase/                # Client, Server & Admin Supabase clients
│   │   ├── ledger/                  # FI: Double-Entry posting transaction engine
│   │   ├── matching/                # AP: 3-Way Match validation logic
│   │   ├── mrp/                     # PP: Requirement calculation algorithm
│   │   └── validations/             # Zod schemas for all domain entities
│   ├── types/                       # TypeScript interfaces and auto-generated DB types
│   │   ├── database.types.ts        # Generated Supabase DB schema definition
│   │   └── erp.d.ts                 # Application domain models
│   └── store/                       # Client-side UI state management (Zustand)
├── src-tauri/                       # Native Tauri Desktop Configuration
│   ├── src/                         # Rust backend handlers
│   └── tauri.conf.json              # Tauri app configuration
├── supabase/
│   ├── migrations/                  # Versioned SQL migrations
│   └── seed.sql                     # Chart of Accounts and initial seed data
├── .env.example                     # Environment variables blueprint
├── next.config.mjs                  # Next.js runtime configuration
├── package.json                     # Root dependencies
└── tsconfig.json                    # TypeScript compiler config


---

## 4. Complete Database Schema (Supabase / PostgreSQL)

### Plain English Entity Relationships
1. **Suppliers & Purchase Orders (POs):** A `supplier` holds master records. Procurement issues `purchase_orders` linked to a supplier containing expected material details and price agreements.
2. **Inward Intake & Inventory Lots:** Upon arrival, materials generate an `inventory_lot` set to `quality_inspection` status and a `goods_receipt_note` (GRN) linked to the PO.
3. **3-Way Matching & Invoicing:** A `purchase_invoice` references both a PO and a GRN. The matching engine checks for quantity/price discrepancies before setting status to `pending_approval`.
4. **General Ledger & Double-Entry Accounting:** The `gl_accounts` table defines the Chart of Accounts. Approving a purchase invoice triggers an atomic write of debit and credit entries to `gl_ledger_entries`.
5. **Bill of Materials (BOM) & Production:** A `bill_of_materials` defines raw material recipes per unit of finished product. The MRP engine reads open sales orders and BOMs to derive net component deficiencies.

---

### SQL Migration Script

```sql
-- -----------------------------------------------------------------------------
-- GLASSCO ERP v3.0: SAP-STYLE CORE ENGINE SCHEMA
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Domain Enums
CREATE TYPE account_type_enum AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE lot_status_enum AS ENUM ('quality_inspection', 'unrestricted', 'blocked');
CREATE TYPE po_status_enum AS ENUM ('draft', 'approved', 'fulfilled', 'cancelled');
CREATE TYPE grn_status_enum AS ENUM ('draft', 'inspected', 'invoiced');
CREATE TYPE invoice_status_enum AS ENUM ('draft', 'pending_approval', 'posted', 'blocked_variance', 'cancelled');

-- 1. Chart of Accounts (FI Module)
CREATE TABLE public.gl_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(20) UNIQUE NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type account_type_enum NOT NULL,
    current_balance NUMERIC(15, 2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Vendors / Suppliers Master Data (MM Module)
CREATE TABLE public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(100),
    email VARCHAR(100),
    phone VARCHAR(50),
    payment_terms_days INT DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Purchase Orders (MM Module)
CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    total_amount_pkr NUMERIC(15, 2) NOT NULL,
    status po_status_enum DEFAULT 'approved',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Batch & Inventory Lots (QM / MM Module)
CREATE TABLE public.inventory_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number VARCHAR(50) UNIQUE NOT NULL,
    material_name VARCHAR(100) NOT NULL,
    initial_qty NUMERIC(12, 4) NOT NULL,
    current_qty NUMERIC(12, 4) NOT NULL,
    unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'KG',
    unit_price_pkr NUMERIC(15, 2) NOT NULL,
    status lot_status_enum DEFAULT 'quality_inspection',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Goods Receipt Notes / GRN (MM Module)
CREATE TABLE public.goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(50) UNIQUE NOT NULL,
    po_id UUID REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    lot_id UUID REFERENCES public.inventory_lots(id) ON DELETE RESTRICT,
    received_qty NUMERIC(12, 4) NOT NULL,
    accepted_qty NUMERIC(12, 4) NOT NULL,
    rejected_qty NUMERIC(12, 4) DEFAULT 0.00,
    unit_price_pkr NUMERIC(15, 2) NOT NULL,
    status grn_status_enum DEFAULT 'inspected',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Accounts Payable Purchase Invoices (AP Module)
CREATE TABLE public.purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    grn_id UUID REFERENCES public.goods_receipt_notes(id) ON DELETE RESTRICT,
    po_id UUID REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    taxable_amount NUMERIC(15, 2) NOT NULL,
    tax_amount NUMERIC(15, 2) NOT NULL,
    total_payable NUMERIC(15, 2) NOT NULL,
    status invoice_status_enum DEFAULT 'pending_approval',
    variance_flag BOOLEAN DEFAULT FALSE,
    variance_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Double-Entry General Ledger Entries (FI Engine)
CREATE TABLE public.gl_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_ref VARCHAR(100) NOT NULL,
    account_id UUID REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
    debit_pkr NUMERIC(15, 2) DEFAULT 0.00,
    credit_pkr NUMERIC(15, 2) DEFAULT 0.00,
    posted_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_debit_credit_positive CHECK (debit_pkr >= 0 AND credit_pkr >= 0)
);

-- 8. Bill of Materials / BOM (PP Module)
CREATE TABLE public.bill_of_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finished_product_name VARCHAR(150) NOT NULL,
    bom_code VARCHAR(50) UNIQUE NOT NULL,
    version INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID REFERENCES public.bill_of_materials(id) ON DELETE CASCADE,
    raw_material_name VARCHAR(150) NOT NULL,
    required_qty_per_unit NUMERIC(12, 4) NOT NULL,
    unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'KG'
);

-- Indexes for Query Performance
CREATE INDEX idx_grn_po ON public.goods_receipt_notes(po_id);
CREATE INDEX idx_invoice_grn ON public.purchase_invoices(grn_id);
CREATE INDEX idx_ledger_account ON public.gl_ledger_entries(account_id);
CREATE INDEX idx_lot_status ON public.inventory_lots(status);

5. Core Engine Logic Implementations
5.1 Deterministic Double-Entry Posting Driver (src/lib/ledger/poster.ts)
TypeScript

import { createClient } from '@supabase/supabase-js';

export interface LedgerPostingPayload {
  transactionRef: string;
  debitAccountCode: string;
  creditAccountCode: string;
  amountPKR: number;
  operatorName: string;
}

export async function executeLedgerPosting(
  supabase: ReturnType<typeof createClient>,
  payload: LedgerPostingPayload
): Promise<{ success: boolean; error?: string }> {
  const { transactionRef, debitAccountCode, creditAccountCode, amountPKR, operatorName } = payload;

  if (amountPKR <= 0) {
    return { success: false, error: 'Transaction amount must be greater than 0.' };
  }

  // Fetch account UUIDs by account codes
  const { data: accounts, error: accError } = await supabase
    .from('gl_accounts')
    .select('id, account_code')
    .in('account_code', [debitAccountCode, creditAccountCode]);

  if (accError || !accounts || accounts.length !== 2) {
    return { success: false, error: 'Failed to resolve valid Debit/Credit accounts.' };
  }

  const debitAcc = accounts.find((a) => a.account_code === debitAccountCode)!;
  const creditAcc = accounts.find((a) => a.account_code === creditAccountCode)!;

  // Insert balanced debit & credit rows atomically
  const { error: insertError } = await supabase.from('gl_ledger_entries').insert([
    {
      transaction_ref: transactionRef,
      account_id: debitAcc.id,
      debit_pkr: amountPKR,
      credit_pkr: 0.00,
      posted_by: operatorName,
    },
    {
      transaction_ref: transactionRef,
      account_id: creditAcc.id,
      debit_pkr: 0.00,
      credit_pkr: amountPKR,
      posted_by: operatorName,
    },
  ]);

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  return { success: true };
}

5.2 Automated 3-Way Match Verification (src/lib/matching/verifier.ts)
TypeScript

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

export function verifyThreeWayMatch(params: MatchingParams): MatchingResult {
  const tolerance = params.tolerancePercentage ?? 1.5; // Default 1.5% tolerance

  const priceVariance = Math.abs(params.invoiceUnitPrice - params.poUnitPrice) / params.poUnitPrice * 100;
  const qtyVariance = Math.abs(params.invoiceQty - params.grnAcceptedQty) / params.grnAcceptedQty * 100;

  if (priceVariance > tolerance) {
    return {
      isMatch: false,
      priceVariance,
      qtyVariance,
      reason: `Price variance (${priceVariance.toFixed(2)}%) exceeds threshold of ${tolerance}%.`,
    };
  }

  if (qtyVariance > tolerance) {
    return {
      isMatch: false,
      priceVariance,
      qtyVariance,
      reason: `Quantity variance (${qtyVariance.toFixed(2)}%) exceeds threshold of ${tolerance}%.`,
    };
  }

  return { isMatch: true, priceVariance, qtyVariance };
}

6. Environment Variables & Setup Blueprint

Copy the block below into your project root as .env.example:
Code snippet

# NEXT.JS CORE CONFIG
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_APP_ENV="development"

# SUPABASE INFRASTRUCTURE
NEXT_PUBLIC_SUPABASE_URL="[https://your-project.supabase.co](https://your-project.supabase.co)"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# ERP SYSTEM CONTROL RULES
NEXT_PUBLIC_THREE_WAY_MATCH_TOLERANCE_PERCENT="1.5"
NEXT_PUBLIC_DEFAULT_CURRENCY="PKR"
NEXT_PUBLIC_ENABLE_TAURI_IPC="true"