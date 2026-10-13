Technical Architecture Document: Glassco Paints ERPProject Name: Glassco Paints ERP (Dual-Target Industrial Edition)Target Platforms: Windows Desktop Application (Tauri v2) & Cloud Web Application (Next.js 14 Web)Version: 2.0.01. System Overview & Architectural ApproachGlassco Paints ERP is a multi-target industrial resource planning system engineered specifically for paint manufacturing operations. The platform operates under a single Next.js 14 App Router codebase targeting two distinct operational deployments:  Factory Floor Terminals (Desktop App): Four shared factory terminals running a cross-compiled Tauri v2 Windows desktop application behind a single shared factory access password.  Owner Remote Management (Web App): Cloud web deployment hosted on Vercel providing full remote operational management for the business owner via owner credentials.  Architectural Principles & Policy DirectivesStrict Non-Offline Policy ("Loud Network Failure"): The system completely forbids offline transaction queueing or speculative local writes. If WebSocket network connectivity to Supabase Cloud drops during any operation, the application must immediately freeze user input, throw an un-dismissable full-screen crimson error alert, and fail loudly to prevent partial un-synced ledger or stock writes.Shared Terminal Attribution Engine: Because factory devices share a single application instance and password, all system mutations mandate selecting an operator identifier from a quick drop-down before writing. Every transaction writes an unalterable record to an append-only audit trail table containing timestamp, device node ID (PC-01 through PC-04 or REMOTE-WEB), module tag, operator identifier, and previous/new payload values.  FEFO Inventory & Non-Blocking Quality Control (QC): Finished paint goods are tracked by batch/lot numbers with strict First-Expired, First-Out (FEFO) dispatch rules. QC operates across three checkpoints (Intake, In-Process Mixing, Packaging) and logs failure badges without freezing physical inventory movement.  +-----------------------------------------------------------------------------------+
|                            Glassco Paints ERP Monorepo                            |
|                            (Next.js 14 App Router)                                |
+-----------------------------------------+-----------------------------------------+
                                          |
                     +--------------------+--------------------+
                     |                                         |
                     v                                         v
    +---------------------------------+       +---------------------------------+
    |   Tauri v2 Desktop App (Rust)   |       |    Owner Cloud Web App          |
    |   - Factory Floor (4 Terminals) |       |    - Deployed on Vercel         |
    |   - Shared Factory Password     |       |    - Owner Password Access      |
    |   - Device IDs: PC-01 to PC-04  |       |    - Device ID: REMOTE-WEB     |
    +----------------+----------------+       +----------------+----------------+
                     |                                         |
                     +--------------------+--------------------+
                                          |
                               (TLS 1.3 / WebSocket CDC)
                                          v
                     +-----------------------------------------+
                     |         Supabase Cloud Postgres         |
                     |  - Single Primary Database              |
                     |  - Strict Non-Offline Policy            |
                     |  - Auto Double-Entry Triggers           |
                     |  - Append-Only Audit Trail Log          |
                     +-----------------------------------------+
2. Tech Stack & Architectural Justification2.1 Core Stack SpecificationsLayerTechnology ChoiceEngineering JustificationDesktop RuntimeTauri v2 (Rust Wrapper)Binary footprint (<20MB) and memory overhead (~40MB RAM) compared to Electron (~150MB+ RAM). Native Rust OS integration provides hooks for GST invoice printing.  Frontend FrameworkNext.js 14+ (App Router)Provides client routing, typed Server Actions, and component isolation. Configured for static compilation (output: 'export') for Tauri, while seamlessly building as a server/cloud app on Vercel[cite: 2, 4, 6].  Language & SafetyTypeScript (v5+)Guarantees strict type-safety across financial models, formula ingredient weights (kg/L), chemical lot payloads, and ledger schemas.  Styling & ThemeTailwind CSS + CSS VariablesImplements a dual-theme system: Obsidian Dark Glassmorphism (#090B10 base, #DC2626 Crimson accents) by default, and Light Slate (#F8FAFC) for high-contrast environments.  Database & CloudSupabase Cloud (PostgreSQL 16)Enterprise-grade double-entry transactional security (ACID compliant). Built-in Change Data Capture (CDC) over WebSockets drives cross-terminal UI sync.  State & Data FetchingTanStack Query (v5) + ZustandOptimistic UI updates, automated background revalidation, and unified state management (PIN authentication, modal state, active operator, connection monitoring).  TypographyInter & JetBrains MonoInter handles standard UI text and navigation; JetBrains Mono provides tabular alignment for financial PKR values, batch chemical weights, timestamps, and lot codes[cite: 2, 4, 6].3. Monorepo Directory & Project File Structureglassco-paints-erp/
├── .github/                       # CI/CD Workflows for Tauri Windows Bundling & Vercel
│   └── workflows/
│       └── release.yml
├── src-tauri/                     # Native Rust Desktop Wrapper
│   ├── Cargo.toml                 # Rust dependencies & permissions
│   ├── tauri.conf.json            # Window settings, IPC permissions, security flags
│   └── src/
│       ├── commands/              # Native OS commands (e.g., local USB invoice printing)
│       ├── lib.rs
│       └── main.rs
├── src/                           # Next.js Application Source
│   ├── app/                       # App Router Pages (8 Core Operational Views)
│   │   ├── layout.tsx             # Root Layout with ThemeProvider & ConnectionGuard
│   │   ├── page.tsx               # Entry Shared PIN Lock Screen
│   │   └── dashboard/             # Main Workspace
│   │       ├── page.tsx           # Screen 1: System Executive Dashboard & Audit Feed
│   │       ├── procurement/       # Screen 2: Inward Gate Pass (IGP) & GRN Logistics
│   │       │   └── page.tsx
│   │       ├── inventory/         # Screen 3: Dual Warehouses (WH-01, WH-02) & FEFO Expiry
│   │       │   └── page.tsx
│   │       ├── formulas/          # Screen 4: Paint Formulas & Batch Production Engine
│   │       │   └── page.tsx
│   │       ├── qc/                # Screen 5: 3-Stage Non-Blocking Quality Control
│   │       │   └── page.tsx
│   │       ├── labour/            # Screen 6: Labour Register, Attendance & Loan Ledger
│   │       │   └── page.tsx
│   │       ├── invoicing/         # Screen 7: GST Sales Invoicing & Outward Gate Pass
│   │       │   └── page.tsx
│   │       └── ledger/            # Screen 8: General Ledger & 3-Column Financial Statements
│   │           └── page.tsx
│   ├── components/                # Reusable Component Architecture
│   │   ├── ui/                    # Atom UI Components
│   │   │   ├── GlassCard.tsx
│   │   │   ├── GlassInput.tsx
│   │   │   ├── CrimsonButton.tsx
│   │   │   ├── OperatorModal.tsx  # Mandatory Operator Selection Popup
│   │   │   └── ModalDrawer.tsx
│   │   ├── modules/               # Feature-Specific Widgets
│   │   │   ├── dashboard/         # KPI Cards, Chemical Depletion Chart & Audit Feed
│   │   │   ├── procurement/       # IGP Table, Intake QC Drawer & Conversion Bar
│   │   │   ├── inventory/         # FEFO Stock Registers & Composition Donut Chart
│   │   │   ├── formulas/          # Versioned Formula Editor & Batch Auto-Calculator
│   │   │   ├── qc/                # Inspection Log Forms & Warning Badges
│   │   │   ├── labour/            # Monthly Attendance Grid & Loan Deductions Table
│   │   │   ├── invoicing/         # FBR Tax Invoice Builder & Dispatch Drawer
│   │   │   └── ledger/            # 3-Column Financial View & Journal Entry Modal
│   │   └── shared/                # Layout Shell Controls
│   │       ├── Header.tsx
│   │       ├── Sidebar.tsx
│   │       ├── ThemeToggle.tsx    # Dark / Light Mode Switcher
│   │       └── NetworkGuard.tsx   # Un-dismissable Loud Failure Crimson Overlay
│   ├── lib/                       # Business Logic, Utilities & Hooks
│   │   ├── supabase/              # Supabase Client Initialization & Typed Enums
│   │   │   ├── client.ts
│   │   │   └── types.ts           # Generated DB Schema Types
│   │   ├── store/                 # Zustand Global Stores
│   │   │   ├── useAuthStore.ts    # PIN & Session Authentication State
│   │   │   ├── useDeviceStore.ts  # Node Identification (PC-01 to PC-04 / REMOTE-WEB)
│   │   │   ├── useOperatorStore.ts# Active Operator Identifier
│   │   │   └── useNetworkStore.ts # WebSocket Health Status
│   │   ├── utils/                 # Unit Math & Currency Helpers
│   │   │   ├── formatters.ts      # PKR Currency & Chemical Weight (kg/L) Formatters
│   │   │   ├── batchMath.ts       # Formula Auto-Consumption & Yield Calculations
│   │   │   └── gstCalculator.ts   # 18% Standard + 4% Further Tax Engine
│   │   └── hooks/                 # Custom Query & Realtime Hooks
│   │       ├── useNetworkMonitor.ts
│   │       ├── useInventory.ts
│   │       ├── useFormulas.ts
│   │       ├── useQC.ts
│   │       └── useLedger.ts
│   ├── styles/                    # Global CSS & Tailwind Directives
│   │   └── globals.css
├── supabase/                      # Local Supabase Suite & Migration History
│   ├── config.toml
│   ├── migrations/                # Versioned SQL Schemas & RLS Rules
│   │   └── 20260912000000_paints_erp_schema.sql
│   └── seed.sql                   # Initial Testing Seed Data
├── .env.example                   # Environment Template
├── next.config.js                 # Export Configuration
├── tailwind.config.js             # Theme Tokens
├── tsconfig.json                  # TypeScript Compiler Configuration
└── package.json
4. Database Schema & Entity RelationshipsThe PostgreSQL database enforces double-entry financial integrity, chemical batch history, FEFO inventory tracking, and append-only audit logging. All primary keys utilize UUIDv4. Financial numbers use NUMERIC(15, 2) and chemical weights/volumes use NUMERIC(15, 4) to eliminate floating-point rounding errors.  4.1 Schema Tables & Entity Mappings                              +-------------------------+
                              |     products_master     |
                              |  (Chemicals & Paints)   |
                              +------------+------------+
                                           |
                   +-----------------------+-----------------------+
                   |                                               |
                   v                                               v
     +---------------------------+                   +---------------------------+
     |     inventory_lots        |                   |      paint_formulas      |
     | (Batch #, Expiry, WH-01/2)|                   | (Versioned Ratios kg/L)   |
     +-------------+-------------+                   +-------------+-------------+
                   |                                               |
                   |               +---------------+               |
                   +-------------->| batch_orders  |<--------------+
                                   | (Production)  |
                                   +-------+-------+
                                           |
                                           v
                                   +---------------+
                                   |  qc_records   |
                                   | (Non-Blocking)|
                                   +---------------+
system_audit_logs: Append-only operational audit trail capturing device ID, operator name, module, action type, and JSON payloads before/after.  parties: Directory for suppliers (chemical vendors) and customers (paint distributors/dealers) with NTN/STRN tax registration flags.  products_master: Master catalog for raw material chemicals (resins, pigments, solvents, additives) and finished paint items (emulsions, enamels, primers, thinners).  inventory_lots: Lot/batch-level inventory ledger storing manufacture dates, expiration dates, original quantities, remaining quantities, and warehouse assignment (WH-01 Raw vs WH-02 Finished).  paint_formulas & formula_ingredients: Versioned master records mapping required chemical weights (kg) per unit volume (Liter) for finished paint products.batch_orders: Production orders executing paint formula batches, linking raw material chemical lot deductions in WH-01 to new finished paint lot creations in WH-02.qc_records: Non-blocking inspection records storing density, viscosity (cP), opacity (%), shade match, and bucket seal integrity logs linked to lots or batch orders.inward_gate_passes & goods_received_notes: Logistics intake tables receiving bulk chemical deliveries, recording vendor lot certificates, and converting verified IGPs into GRNs.  workers & worker_attendance: Worker profiles and daily monthly attendance grid (P Present, A Absent, L Leave).  worker_loans & loan_repayment_logs: Active worker advance loan tracking and repayment ledger.  accounts_chart, journal_entries, & journal_lines: Double-entry ledger core rendering Trial Balance, Profit & Loss, and Balance Sheet.  sales_invoices & sales_invoice_items: FBR-compliant GST sales invoices supporting 18% Standard Tax, 4% Further Tax, and Draft/Posted states.  5. Complete SQL Database Schema DDL ScriptSQL-- ENABLE EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. SYSTEM AUDIT LOGS (APPEND-ONLY)
CREATE TABLE system_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_node VARCHAR(32) NOT NULL, -- e.g., PC-01, PC-02, REMOTE-WEB
    operator_name VARCHAR(64) NOT NULL,
    module_tag VARCHAR(32) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    payload_before JSONB DEFAULT '{}'::jsonb,
    payload_after JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. PARTIES (Suppliers & Customers)
CREATE TABLE parties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    party_type VARCHAR(16) CHECK (party_type IN ('SUPPLIER', 'CUSTOMER', 'BOTH')),
    ntn_strn VARCHAR(64),
    is_registered BOOLEAN DEFAULT TRUE, -- False triggers 4% Further Tax
    phone VARCHAR(32),
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. PRODUCTS MASTER (Chemicals & Paints)
CREATE TABLE products_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL, -- Resin, Pigment, Solvent, Emulsion, Enamel
    item_type VARCHAR(16) CHECK (item_type IN ('RAW_MATERIAL', 'FINISHED_GOOD')),
    unit_of_measure VARCHAR(16) NOT NULL, -- kg, Liter, Bucket
    minimum_stock_alert NUMERIC(15, 4) DEFAULT 10.0000,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. WAREHOUSES
CREATE TABLE inventory_warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(16) UNIQUE NOT NULL, -- WH-01 (Raw Chemicals), WH-02 (Finished Paints)
    name VARCHAR(64) NOT NULL
);

-- 5. INVENTORY LOTS & BATCHES (FEFO TRACKING)
CREATE TABLE inventory_lots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lot_number VARCHAR(64) UNIQUE NOT NULL,
    product_id UUID REFERENCES products_master(id) ON DELETE RESTRICT,
    warehouse_id UUID REFERENCES inventory_warehouses(id) ON DELETE RESTRICT,
    vendor_lot_code VARCHAR(64),
    manufacture_date DATE NOT NULL,
    expiration_date DATE NOT NULL,
    initial_qty NUMERIC(15, 4) NOT NULL,
    remaining_qty NUMERIC(15, 4) NOT NULL,
    unit_cost_pkr NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    qc_status VARCHAR(16) DEFAULT 'PASSED' CHECK (qc_status IN ('PENDING', 'PASSED', 'FLAGGED_WARNING')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. PAINT FORMULAS & INGREDIENTS
CREATE TABLE paint_formulas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finished_good_id UUID REFERENCES products_master(id) ON DELETE RESTRICT,
    formula_code VARCHAR(32) UNIQUE NOT NULL,
    version VARCHAR(16) NOT NULL,
    batch_base_volume_liters NUMERIC(15, 4) NOT NULL DEFAULT 1000.0000,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE formula_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    formula_id UUID REFERENCES paint_formulas(id) ON DELETE CASCADE,
    raw_material_id UUID REFERENCES products_master(id) ON DELETE RESTRICT,
    required_weight_kg NUMERIC(15, 4) NOT NULL
);

-- 7. BATCH PRODUCTION ORDERS
CREATE TABLE batch_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_number VARCHAR(64) UNIQUE NOT NULL,
    formula_id UUID REFERENCES paint_formulas(id) ON DELETE RESTRICT,
    target_volume_liters NUMERIC(15, 4) NOT NULL,
    status VARCHAR(32) DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'QC_FLAGGED', 'CANCELLED')),
    operator_name VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

-- 8. QUALITY CONTROL LOGS (NON-BLOCKING)
CREATE TABLE qc_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    qc_stage VARCHAR(32) CHECK (qc_stage IN ('INTAKE', 'IN_PROCESS', 'PACKAGING')),
    lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL,
    batch_order_id UUID REFERENCES batch_orders(id) ON DELETE SET NULL,
    viscosity_cp NUMERIC(10, 2),
    specific_gravity NUMERIC(8, 4),
    opacity_percentage NUMERIC(5, 2),
    shade_match_pass BOOLEAN DEFAULT TRUE,
    seal_integrity_pass BOOLEAN DEFAULT TRUE,
    inspector_name VARCHAR(64) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. PROCUREMENT (IGP / GRN)
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
    unit_price_pkr NUMERIC(15, 2) NOT NULL,
    total_value_pkr NUMERIC(15, 2) NOT NULL,
    generated_lot_id UUID REFERENCES inventory_lots(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 10. WORKERS & PAYROLL
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

-- 11. ACCOUNTING & GENERAL LEDGER
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

-- 12. SALES & TAX INVOICING
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
6. Environment Configurations & Build Engine6.1 Configuration Blueprint (.env.example)Ini, TOML# APPLICATION DEPLOYMENT TARGET
NEXT_PUBLIC_APP_NAME="Glassco Paints ERP"
NEXT_PUBLIC_APP_ENV="production"

# SUPABASE CLOUD CONNECTION
NEXT_PUBLIC_SUPABASE_URL="https://your-supabase-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# SHARED MASTER ACCESS PINS
NEXT_PUBLIC_FACTORY_PIN="4829"
NEXT_PUBLIC_OWNER_PASSWORD="OwnerSecurePassword2026!"

# DEVICE TERMINAL IDENTIFICATION (Overridden per Client Terminal Installation)
# Factory Terminals: PC-01, PC-02, PC-03, PC-04 | Remote Web: REMOTE-WEB
NEXT_PUBLIC_DEVICE_NODE_ID="PC-01"
6.2 Build Pipelines & Deployment InstructionsTarget 1: Factory Floor Windows Desktop Executable (Tauri v2)Configure next.config.js to static export mode:JavaScript/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};
module.exports = nextConfig;
Build static frontend assets and compile Rust Windows bundle:Bashnpm run build
npm run tauri build
Target 2: Owner Remote Web App (Vercel Cloud)Deploy monorepo directly to Vercel without static output restrictions (output: 'export' commented or dynamically toggled via build env TARGET_ENV=web).Set NEXT_PUBLIC_DEVICE_NODE_ID="REMOTE-WEB" in the Vercel environment variables dashboard.