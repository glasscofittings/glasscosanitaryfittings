PRD: Glassco Paints ERP (Industrial Dark Edition)
1. Problem Statement

What problem does this solve?

Glassco Paints currently manages raw material batching, formula blending, quality control checks, batch expiration tracking, gate logistics, GST sales tax invoicing, and double-entry accounting through fragmented paper registers and spreadsheets. This leads to untracked raw material usage, chemical formula inconsistencies, unmonitored lot expirations, and financial reconciliation delays.

Who experiences this problem?

Warehouse/store staff receiving chemicals, batch operators mixing paint formulas, quality control technicians logging tests, gate clerks issuing passes, accounts staff running GST invoices, and the business owner attempting to monitor operations remotely.

Why does this problem matter now?

Paint production relies on high-value chemical components (resins, pigments, solvents) with strict shelf lives and precise weight ratios. Mistakes in batching or lot dispatching cause expensive product spoilage, customer returns, and untraceable financial losses.
2. Target Users, System Architecture & Deployment
2.1 User Roles & Deployment Targets

The system uses a single Next.js 14 monorepo codebase deployed to two targets:

    Factory Floor Terminals (Desktop App): 4 shared factory terminals running a cross-compiled Tauri v2 Windows desktop app behind a single shared factory password.

    Owner Remote Access (Web App): Web build hosted on cloud infrastructure (e.g., Vercel) allowing the owner full remote operational visibility via owner credentials.

2.2 No-Offline Policy & Audit Trail

    Strict Loud Network Failure: There is no offline queueing or local offline syncing. If network connectivity to Supabase Cloud drops during any operation, the application must immediately halt input, throw a full-screen alert, and fail loudly to prevent partial un-synced ledger writes.

    Shared Access Accountability: Because factory devices share a single password, all system mutations mandate selecting an operator identifier from a quick drop-down. Every transaction writes an unalterable record to an append-only system_audit_logs table containing timestamp, device node ID (PC-01 through PC-04 or REMOTE-WEB), module tag, operator identifier, and previous/new payload values.

2.3 UI/UX Design System Guidelines

    Theme & Canvas: Dual-theme engine supporting an Obsidian Industrial Dark base (#090B10) with deep crimson active highlights (#DC2626) by default, alongside a high-contrast Light Slate mode (#F8FAFC).

    Glassmorphism: Translucent frosted-glass panels (backdrop-blur-md), faint white borders (rgba(255, 255, 255, 0.08)), and high-contrast status pills.

    Typography: Inter for standard labels and navigation; JetBrains Mono for numeric financial values (PKR), batch numbers, chemical weights, timestamps, and document codes.

3. Core Operational Modules (8-Screen Architecture)
3.1 Executive Dashboard & System Monitor (Screen 1)

    Real-time KPI Stat Cards: Aggregate values for Raw Material Chemical Stock (PKR), Finished Paint Goods Value (PKR), Total Outstanding Worker Loans (PKR), and Trial Balance Auto-Check Status (BALANCED / UNBALANCED).

    Production vs Stock Analytics: Dual-line chart tracking raw material chemical depletion against finished goods paint volume over time.

    Live Network & Audit Feed: Real-time WebSocket connection status indicator (Green Active / Crimson Interrupted) alongside the append-only audit feed.

3.2 Inward Gate Pass (IGP) & GRN Logistics (Screen 2)

    Bulk Material Inward Register: Logging incoming chemical resins, pigments, solvents, and packaging drums. Captures vendor lot numbers and manufacturer certificate codes.

    Conversion to Goods Received Note (GRN): 1-click conversion engine transferring inspected goods into Raw Materials Store (WH-01) while auto-generating internal lot/batch identifiers.

    Inline Material Intake Inspection: Slide-over inspection drawer for physical check logging (container integrity, seals, density checks).

3.3 Dual-Warehouse & FEFO Inventory Engine (Screen 3)

    Separated Registers:

        WH-01 Raw Materials: Bulk resins, titanium dioxide pigments, solvents, thinners, binders, and additives. Tracks lot numbers, received dates, and expiry dates.

        WH-02 Finished Goods: Emulsions, enamels, primers, and thinners organized by tint base, container size (1L, 4L, 16L buckets), and batch lot code.

    FEFO Dispatch Intelligence: First-Expired, First-Out alerts highlighting older finished goods lots to dispatch first.

    Chemical Stock Composition Chart: Visual breakdown of raw material categories and low-stock threshold badges.

3.4 Formula Master & Batch Production Engine (Screen 4)

    Versioned Paint Formulas: Formula editor defining exact raw material consumption ratios by weight (kg/L) for standard batch volumes (e.g., 1,000L of Super Gloss White v2.1).

    Auto-Consumption Calculation: Inputting a target production volume automatically calculates required raw materials, checks current WH-01 lot balances, and flags chemical shortages before batch creation.

    Batch Production Execution: Creating a batch deducts raw materials from WH-01 and generates a pending finished goods lot in WH-02.

3.5 Non-Blocking Quality Control (QC) System (Screen 5)

The QC system logs quality parameters across three production checkpoints without freezing operational throughput:

    Raw Material Intake QC: Viscosity and specific gravity logs upon arrival.

    In-Process Batch QC: Grind gauge, opacity/hiding power, and shade-matching logs during mixing.

    Packaging QC: Net weight check and bucket seal integrity verification.

    Non-Blocking Rule: QC failures generate amber/red warning badges on batches, tag records with detailed failure reasons, and log audit entries, but never block inventory movement, batch processing, or gate pass issuance.

3.6 Labour Register, Attendance & Advance Loans (Screen 6)

    Worker Roster & Monthly Grid: Worker profiles, designations, and a monthly matrix grid to toggle daily status (P Present, A Absent, L Leave).

    Advance Loan & Auto-Deductions Ledger: Outstanding worker loan tracking, monthly salary recovery schedules, and a manual cash/bank repayment modal.

3.7 GST Sales Tax Invoicing & Outward Dispatch (Screen 7)

    FBR-Compliant Sales Tax Invoicing: Tax invoice builder supporting Standard Sales Tax (18%) and Further Tax (4% for unregistered buyers).

    Draft / Posted Lifecycle: Invoices start as Draft (editable, no stock or ledger impact). Transitioning to Posted locks the invoice, decrements finished goods stock from WH-02 using FEFO rules, and posts double-entry ledger entries.

    Outward Gate Pass (OGP): Generates dispatch passes linked to posted invoices and delivery vehicles.

3.8 General Ledger & Financial Statements (Screen 8)

    3-Column Comparative View: Real-time side-by-side rendering of Trial Balance, Profit & Loss Statement, and Balance Sheet.

    Auto-Balancing Engine: Real-time validation badges verifying Total Debits = Total Credits.

    Double-Entry Journal Posting: Slide-over modal for manual journal vouchers, expense entries, and credit/debit adjustments.

4. Technical Stack & Architecture Guidelines

    Frontend Framework: Next.js 14+ (App Router) with static compilation compatibility (output: 'export' for Tauri).

    Desktop Runtime: Tauri v2 (Rust wrapper executing Next.js static assets for Windows).

    Database & Cloud: Supabase Cloud (PostgreSQL 16) with row-level triggers for double-entry financial posting and real-time CDC (Change Data Capture).

    Styling & Visualization: Tailwind CSS + Custom CSS Glassmorphism Rules + Chart.js.

    Network Fail-Safe: Global Axios/Fetch interceptor monitoring WebSocket health. Displays an un-dismissable modal error if ping to Supabase fails, halting UI interactions.