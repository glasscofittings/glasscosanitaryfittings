Technical Architecture Document: Glassco ERPProject Name: Glassco ERP (Desktop Industrial Edition)Target Platform: Desktop (Windows cross-compiled)Architect: Senior SaaS ArchitectVersion: 1.1.01. System Overview & Architectural ApproachGlassco ERP is designed as an offline-resilient, high-performance desktop application serving multi-terminal factory setups. The application utilizes a hybrid desktop-cloud architecture: a local Rust native runtime (Tauri) rendering an optimized Next.js frontend, backed by a managed PostgreSQL cloud instance (Supabase) for realtime cross-terminal synchronization.  Architectural Blueprint+-----------------------------------------------------------------------+
|                         Desktop Client (Tauri)                        |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |                 Next.js Frontend (React / UI)                   |  |
|  |  - Industrial Glassmorphic Theme (Tailwind CSS)                 |  |
|  |  - Client-side State & Offline Queue (Zustand / TanStack Query)   |  |
|  +-----------------------------------------------------------------+  |
|                                 |                                     |
|                      Tauri IPC Bridge / SecEnv                        |
|                                 |                                     |
+---------------------------------|-------------------------------------+
| TLS 1.3 WebSocket / HTTPS
v
+-----------------------------------------------------------------------+
|                    Supabase Cloud Infrastructure                      |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |                   PostgreSQL Database Server                    |  |
|  |  - Auto-Balancing Ledgers, BOM Engine, Row-Level Security         |  |
|  |  - Realtime Change Data Capture (CDC) Subscriptions               |  |
|  +-----------------------------------------------------------------+  |
|                                                                       |
+-----------------------------------------------------------------------+
2. Tech Stack & Architectural Justification2.1 Core StackLayerTechnology ChoiceEngineering JustificationDesktop RuntimeTauri (v2)Drastically smaller binary footprint (<20MB) and lower RAM overhead compared to Electron (~150MB+). Native Rust OS integration ensures low latency and native printer interface hooks for GST invoices.  Frontend FrameworkNext.js 14+ (App Router)Provides fast client-side navigation, robust layout routing, typed Server Actions, and strict React component boundary isolation. Configured for Static Export (output: 'export') to embed directly into Tauri[cite: 2, 4].  Language & SafetyTypeScript (v5+)Strict type-safety across all accounting financial models, API payload interfaces, and local state schemas. Prevents runtime numeric/type coercion bugs.  Styling & ThemeTailwind CSS + Custom CSS VariablesEnables hardware-accelerated dark glassmorphism effects (backdrop-blur-md), strict color token isolation (#090B10 Obsidian base, #DC2626 Crimson accents), and high-density tabular CSS layouts[cite: 2, 4].Database & SyncSupabase (PostgreSQL 16)Enterprise-grade double-entry transactional security (ACID compliant)[cite: 2, 4]. Built-in Realtime WebSockets allow instant cross-terminal syncing (e.g., IGP converted on PC-01 immediately updates PC-02 inventory view)[cite: 2, 4].Data Fetching / StateTanStack Query (v5) + ZustandOptimistic UI updates, automated background revalidation, stale-while-revalidate data strategy, and unified global UI state management (modal drawers, pin validation, node identification).  FontsInter & JetBrains MonoInter handles UI density and typography hierarchy; JetBrains Mono forces tabular numeric alignment for monetary PKR values, stock weights, and ledger calculations[cite: 2, 4].3. Project File & Folder Structure (8-Screen Modular Routing)glassco-erp/
├── .github/                       # CI/CD Workflows for Tauri Windows Bundling
│   └── workflows/
│       └── release.yml
├── src-tauri/                     # Native Rust Desktop Wrapper
│   ├── Cargo.toml                 # Rust dependencies & permissions
│   ├── tauri.conf.json            # Window dimensions, security policy, IPC setup
│   └── src/
│       ├── commands/              # Native OS commands (e.g., local USB printing)
│       ├── lib.rs
│       └── main.rs
├── src/                           # Next.js Application Source
│   ├── app/                       # App Router Pages & Routing (Matches 8 Core Screens)
│   │   ├── layout.tsx             # Main Glassmorphic shell layout
│   │   ├── page.tsx               # Entry PIN Lock Screen
│   │   └── dashboard/             # Main Application Shell
│   │       ├── page.tsx           # Screen 1: Executive Dashboard (KPIs, Trends, Audit Feed)
│   │       ├── procurement/       # Screen 2: Inward Gate Pass (IGP), Inspection Form & GRN
│   │       │   └── page.tsx
│   │       ├── inventory/         # Screen 3: Dual Warehouses (WH-01, WH-02) & Share Donut Chart
│   │       │   └── page.tsx
│   │       ├── bom/               # Screen 4: Finished Goods Specs & BOM Composer
│   │       │   └── page.tsx
│   │       ├── labour/            # Screen 5: Labour Register & Monthly Attendance Matrix Grid
│   │       │   └── page.tsx
│   │       ├── loans/             # Screen 6: Advance Loan Register, Deductions & Manual Repayment
│   │       │   └── page.tsx
│   │       ├── invoicing/         # Screen 7: FBR GST Sales Invoicing (18% + 4% Further Tax)
│   │       │   └── page.tsx
│   │       └── ledger/            # Screen 8: General Ledger & 3-Column Financial Statements
│   │           └── page.tsx
│   ├── components/                # Reusable UI & Module Components
│   │   ├── ui/                    # Base Atom Glass Components (Buttons, Inputs, Cards, Modals)
│   │   │   ├── GlassCard.tsx
│   │   │   ├── GlassInput.tsx
│   │   │   ├── CrimsonButton.tsx
│   │   │   └── ModalDrawer.tsx
│   │   ├── modules/               # Domain-Specific Feature Widgets
│   │   │   ├── dashboard/         # Executive Overview Widgets & Live Audit Feed Table
│   │   │   ├── procurement/       # IGP Table, Inspection Form & Conversion Bar
│   │   │   ├── inventory/         # WH-01/WH-02 Stock Lists & Donut Visualization
│   │   │   ├── bom/               # Material Composition Drawer & Model Specs
│   │   │   ├── labour/            # Attendance Calendar Matrix Grid & Worker Profiles
│   │   │   ├── loans/             # Auto-Deductions Schedule & Repayment Modal
│   │   │   ├── invoicing/         # Tax Invoicing Table & Post & Print Drawer
│   │   │   └── ledger/            # 3-Column Comparative View & New Transaction Modal
│   │   └── shared/                # Top Header, Sidebar Navigation, Device Terminal Status Badge
│   │       ├── Header.tsx
│   │       ├── Sidebar.tsx
│   │       └── TrialBalanceBadge.tsx
│   ├── lib/                       # Core Business Logic & Configurations
│   │   ├── supabase/              # Supabase Client Initialization & Typed Enums
│   │   │   ├── client.ts
│   │   │   └── types.ts           # Auto-generated Database Schema Types
│   │   ├── store/                 # Zustand Global Stores
│   │   │   ├── useAuthStore.ts    # Single Shared PIN State
│   │   │   ├── useDeviceStore.ts  # Node Identification (e.g., PC-01)
│   │   │   └── useUIStore.ts      # Active Modals & Drawer State
│   │   ├── utils/                 # Financial, GST, & Unit Conversion Helpers
│   │   │   ├── formatters.ts      # PKR Currency & Weight Formatters
│   │   │   ├── gstCalculator.ts   # 18% Standard + 4% Further Tax Engine
│   │   │   └── ledgerMath.ts      # Auto-Balancing Debit = Credit Validator
│   │   └── hooks/                 # Custom TanStack React Query Hooks
│   │       ├── useProcurement.ts
│   │       ├── useInventory.ts
│   │       ├── useLabour.ts
│   │       ├── useLoans.ts
│   │       ├── useInvoicing.ts
│   │       └── useLedger.ts
│   ├── styles/                    # Global Stylesheets
│   │   └── globals.css            # Tailwind Directives & Custom Glassmorphism CSS
├── supabase/                      # Local Supabase Development & Migration Suite
│   ├── config.toml
│   ├── migrations/                # Versioned SQL Schemas & RLS Rules
│   │   └── 20260912000000_initial_schema.sql
│   └── seed.sql                   # Initial Testing Seed Data
├── .env.example                   # Environment Template
├── next.config.js                 # Next.js Static Export Configuration
├── tailwind.config.js             # Obsidian / Crimson Glass Theme Tokens
├── tsconfig.json                  # TypeScript Compiler Configuration
└── package.json
4. Database Schema & Entity RelationshipsThe relational database schema is structured around double-entry accounting guarantees and transactional auditability. All primary keys use UUIDv4. Money and weights use fixed-point NUMERIC(15, 2) or NUMERIC(15, 4) types to prevent floating-point rounding errors.  Entity Relationship Diagram (Mental Model)[Suppliers/Customers] <---> [General Ledger / Party Ledgers]
^                               ^
|                               |
[IGP -> GRN Entry]             [GST Tax Invoices]
|                               |
v                               v
[WH-01 Raw Stock] ----(BOM)----> [WH-02 Finished Stock]
^
|
[Workers] <---> [Loan Ledger] <---> [Monthly Attendance & Payroll]
4.1 Schema Tables Description1. system_audit_logsPurpose: Stores the append-only operational audit trail for every user action across terminals[cite: 2, 4].Fields: id (UUID), device_node (TEXT, e.g., PC-01), operator_name (TEXT), action_type (TEXT), module (TEXT), payload (JSONB), created_at (TIMESTAMPTZ).  2. partiesPurpose: Master directory for Suppliers (Procurement) and Customers (Sales).  Fields: id (UUID), name (TEXT), party_type (TEXT: 'SUPPLIER', 'CUSTOMER', or 'BOTH'), ntn_strn (TEXT), is_registered (BOOLEAN: determines 4% Further Tax applicability), phone (TEXT), address (TEXT), created_at (TIMESTAMPTZ)[cite: 2, 4].3. products_masterPurpose: Master catalog for finished goods and raw materials.  Fields: id (UUID), sku (TEXT, Unique), name (TEXT), category (TEXT), item_type (TEXT: 'RAW_MATERIAL' or 'FINISHED_GOOD'), unit_of_measure (TEXT), minimum_stock_alert (NUMERIC), created_at (TIMESTAMPTZ).  4. bill_of_materials & bom_itemsPurpose: Versioned component assembly mappings linking finished goods to required raw material compositions[cite: 2, 4].Fields (bill_of_materials): id (UUID), finished_good_id (UUID, FK -> products_master.id), version (TEXT), is_active (BOOLEAN), created_at (TIMESTAMPTZ).  Fields (bom_items): id (UUID), bom_id (UUID, FK -> bill_of_materials.id), raw_material_id (UUID, FK -> products_master.id), quantity_required (NUMERIC(15, 4)).  5. inventory_warehouses & inventory_balancesPurpose: Stock management for Raw Material Store (WH-01) and Finished Goods Store (WH-02)[cite: 2, 4].Fields (inventory_warehouses): id (UUID), code (TEXT, Unique: 'WH-01', 'WH-02'), name (TEXT).  Fields (inventory_balances): id (UUID), warehouse_id (UUID, FK), product_id (UUID, FK), current_qty (NUMERIC(15, 4)), updated_at (TIMESTAMPTZ).  6. inward_gate_passes & goods_received_notesPurpose: Tracks incoming goods, quality inspection forms, and GRN conversions[cite: 2, 4].Fields (inward_gate_passes): id (UUID), igp_code (TEXT, Unique), supplier_id (UUID, FK), material_description (TEXT), inward_qty (NUMERIC(15, 4)), status (TEXT: 'PENDING_INSPECTION', 'CONVERTED_TO_GRN', 'REJECTED'), created_at (TIMESTAMPTZ).  Fields (goods_received_notes): id (UUID), grn_code (TEXT, Unique), igp_id (UUID, FK), accepted_qty (NUMERIC(15, 4)), rejected_qty (NUMERIC(15, 4)), rejection_reason (TEXT), unit_price_pkr (NUMERIC(15, 2)), total_value_pkr (NUMERIC(15, 2)), created_at (TIMESTAMPTZ).  7. workers, worker_attendance, & worker_loansPurpose: Manages worker profiles, daily monthly matrix attendance (P/A/L), and loan registers[cite: 2, 4].Fields (workers): id (UUID), full_name (TEXT), role_designation (TEXT), base_salary_pkr (NUMERIC(15, 2)), joining_date (DATE), is_active (BOOLEAN).  Fields (worker_attendance): id (UUID), worker_id (UUID, FK), attendance_date (DATE), status (TEXT: 'P', 'A', 'L').  Fields (worker_loans & loan_repayment_logs): Stores original loan balances, auto-deduction rates, and manual repayment entries (Cash/Bank)[cite: 2, 4].8. sales_invoices, accounts_chart, journal_entries, & journal_linesPurpose: Double-entry ledger system, 3-column financial views, and FBR GST invoicing (18% Standard + 4% Further Tax)[cite: 2, 4].5. SQL Database Schema DDL ScriptSQL-- ENABLE EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. SYSTEM AUDIT LOGS
CREATE TABLE system_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_node VARCHAR(32) NOT NULL,
    operator_name VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    module VARCHAR(32) NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. PARTIES (Suppliers & Customers)
CREATE TABLE parties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    party_type VARCHAR(16) CHECK (party_type IN ('SUPPLIER', 'CUSTOMER', 'BOTH')),
    ntn_strn VARCHAR(64),
    is_registered BOOLEAN DEFAULT TRUE,
    phone VARCHAR(32),
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. PRODUCTS MASTER
CREATE TABLE products_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    item_type VARCHAR(16) CHECK (item_type IN ('RAW_MATERIAL', 'FINISHED_GOOD')),
    unit_of_measure VARCHAR(16) NOT NULL,
    minimum_stock_alert NUMERIC(15, 4) DEFAULT 10.0000,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. BILL OF MATERIALS (BOM)
CREATE TABLE bill_of_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finished_good_id UUID REFERENCES products_master(id) ON DELETE RESTRICT,
    version VARCHAR(16) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bom_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID REFERENCES bill_of_materials(id) ON DELETE CASCADE,
    raw_material_id UUID REFERENCES products_master(id) ON DELETE RESTRICT,
    quantity_required NUMERIC(15, 4) NOT NULL
);

-- 5. WAREHOUSES & BALANCES
CREATE TABLE inventory_warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(16) UNIQUE NOT NULL,
    name VARCHAR(64) NOT NULL
);

CREATE TABLE inventory_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID REFERENCES inventory_warehouses(id) ON DELETE RESTRICT,
    product_id UUID REFERENCES products_master(id) ON DELETE RESTRICT,
    current_qty NUMERIC(15, 4) DEFAULT 0.0000,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_product_per_wh UNIQUE (warehouse_id, product_id)
);

-- 6. PROCUREMENT (IGP / GRN)
CREATE TABLE inward_gate_passes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    igp_code VARCHAR(32) UNIQUE NOT NULL,
    supplier_id UUID REFERENCES parties(id) ON DELETE RESTRICT,
    material_description TEXT NOT NULL,
    inward_qty NUMERIC(15, 4) NOT NULL,
    status VARCHAR(32) DEFAULT 'PENDING_INSPECTION' CHECK (status IN ('PENDING_INSPECTION', 'CONVERTED_TO_GRN', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE goods_received_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grn_code VARCHAR(32) UNIQUE NOT NULL,
    igp_id UUID REFERENCES inward_gate_passes(id) ON DELETE RESTRICT,
    accepted_qty NUMERIC(15, 4) NOT NULL,
    rejected_qty NUMERIC(15, 4) DEFAULT 0.0000,
    rejection_reason TEXT,
    unit_price_pkr NUMERIC(15, 2) NOT NULL,
    total_value_pkr NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. WORKERS & PAYROLL
CREATE TABLE workers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(128) NOT NULL,
    role_designation VARCHAR(64) NOT NULL,
    base_salary_pkr NUMERIC(15, 2) NOT NULL,
    joining_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE worker_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    status VARCHAR(2) CHECK (status IN ('P', 'A', 'L')),
    CONSTRAINT unique_worker_daily_att UNIQUE (worker_id, attendance_date)
);

CREATE TABLE worker_loans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
    original_loan_amount NUMERIC(15, 2) NOT NULL,
    current_balance NUMERIC(15, 2) NOT NULL,
    monthly_deduction_rate NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE loan_repayment_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    loan_id UUID REFERENCES worker_loans(id) ON DELETE CASCADE,
    amount_paid NUMERIC(15, 2) NOT NULL,
    repayment_source VARCHAR(32) CHECK (repayment_source IN ('CASH', 'BANK_TRANSFER', 'SALARY_DEDUCTION')),
    payment_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. ACCOUNTING & GENERAL LEDGER
CREATE TABLE accounts_chart (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_code VARCHAR(32) UNIQUE NOT NULL,
    account_name VARCHAR(128) NOT NULL,
    account_type VARCHAR(16) CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'))
);

CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_number VARCHAR(32) UNIQUE NOT NULL,
    entry_date DATE NOT NULL,
    narration TEXT NOT NULL,
    is_balanced BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE journal_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts_chart(id) ON DELETE RESTRICT,
    party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    debit_pkr NUMERIC(15, 2) DEFAULT 0.00,
    credit_pkr NUMERIC(15, 2) DEFAULT 0.00
);

-- 9. SALES & TAX INVOICING
CREATE TABLE sales_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(32) UNIQUE NOT NULL,
    customer_id UUID REFERENCES parties(id) ON DELETE RESTRICT,
    taxable_value_pkr NUMERIC(15, 2) NOT NULL,
    sales_tax_rate NUMERIC(5, 2) DEFAULT 18.00,
    sales_tax_amount_pkr NUMERIC(15, 2) NOT NULL,
    further_tax_rate NUMERIC(5, 2) DEFAULT 0.00,
    further_tax_amount_pkr NUMERIC(15, 2) DEFAULT 0.00,
    total_invoice_value_pkr NUMERIC(15, 2) NOT NULL,
    is_posted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
6. Environment Configurations & Security Setup6.1 Configuration File (.env)Ini, TOML# NEXT.JS CORE CONFIGURATION
NEXT_PUBLIC_APP_NAME="Glassco ERP Desktop"
NEXT_PUBLIC_APP_ENV="production"

# SUPABASE CLOUD CONNECTIONS
NEXT_PUBLIC_SUPABASE_URL="https://your-supabase-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# APPLICATION SECURITY GATE
# Initial Shared Master Access PIN
NEXT_PUBLIC_MASTER_APP_PIN="4829"

# HARDWARE TERMINAL IDENTIFICATION (Overridden per Client PC Installation)
NEXT_PUBLIC_DEVICE_NODE_ID="PC-01"
7. Build & Compilation PipelineStatic Next.js Export Configuration: next.config.js sets output: 'export' and images: { unoptimized: true } so Tauri can serve static frontend assets natively without NodeJS runtime overhead.  Database Seed Insertion: Execute initial insertion queries for inventory_warehouses (WH-01 Raw Materials, WH-02 Finished Goods) and default accounts in accounts_chart before boot.  Rust Thermal Windows Target: Cross-compile with Tauri CLI:  Bashnpm run tauri build