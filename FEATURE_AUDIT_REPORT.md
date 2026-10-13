# Glassco Sanitary ERP — Feature Audit & System Overview Report

**Prepared for:** Client Review & Final Sign-Off  
**Date:** September 16, 2026  
**Version:** 1.0 — Production Release Candidate

---

## 1. Executive Summary

The Glassco Sanitary ERP is a fully functional, multi-module enterprise resource planning system purpose-built for sanitary product distribution, manufacturing, and retail operations. The system is deployed as a cross-platform desktop application (via Tauri) with a cloud-hosted Supabase backend, supporting real-time data synchronization, offline-aware architecture, and live audit logging across multiple terminal nodes. All core business workflows — from procurement and inventory through invoicing, accounting, and workforce management — are implemented and operationally ready for production use.

---

## 2. Implemented Features & Core Modules

### 2.1 Authentication & Access Control

- **PIN-based login system** with numeric keypad interface for terminal operators
- **Supabase Auth integration** with session management and automatic token refresh
- **Role-based access model** supporting `OWNER` and `TERMINAL` user roles
- **Profile management** with device-level assignment and role-specific UI adaptations
- **Automatic session persistence** across application restarts via secure cookie handling
- **Idle timeout protection** with configurable auto-lock after inactivity

### 2.2 Executive Dashboard & KPIs

- **Four real-time KPI cards:**
  - Total Inventory Stock Value (PKR) — calculated from GRN records and inventory lot valuations
  - Total Active Employees — live count from the workers database
  - Active Live Devices — node connectivity status with real-time WebSocket monitoring
  - Net Profit Balance — computed from posted journal entries (Revenue minus Expenses)
- **Net Profit Histogram** — bar chart with Day / Week / Month time-range toggle, displaying aggregated profit/loss across selected periods
- **Production vs Consumption Line Chart** — dual-line visualization comparing stock dispatched (raw materials consumed) against stock received (finished goods produced)
- **Live Audit Feed Table** — real-time device activity log with terminal node identification, operator attribution, module classification, and timestamp precision
- **Real-time CDC integration** — dashboard KPIs automatically refresh when procurement, invoicing, or ledger events are recorded on any connected terminal

### 2.3 Procurement — Inward Gate Pass (IGP) & GRN Flow

- **IGP creation** with supplier selection, material description, quantity, lot code, and COA reference
- **Material Intake Drawer** — streamlined IGP entry form with Zod-validated fields and React Hook Form integration
- **IGP Inspection Drawer** — accept or reject incoming materials with accepted/rejected quantity split and unit price entry
- **Automated GRN Conversion** — `convert_igp_to_grn` database RPC that:
  - Generates sequential GRN codes (`GRN-YYYY-NNNN`)
  - Calculates total value (`accepted_qty × unit_price_pkr`)
  - Updates IGP status to `CONVERTED_TO_GRN`
  - Creates inventory lot entries in `inventory_lots` with lot number, product linkage, and unit cost
  - Upserts warehouse inventory balances
  - Logs full audit trail to `system_audit_logs`
- **IGP Rejection** — reject materials with recorded rejection reason
- **Supplier/Party management** — create and query supplier records linked to gate passes
- **IGP Table** — color-coded status badges (Pending Inspection, Converted to GRN, Rejected) with inline conversion actions

### 2.4 Inventory & Warehouse Management

- **Dual warehouse architecture** — WH-01 (Raw Materials) and WH-02 (Finished Goods)
- **Inventory lot tracking** — lot number, vendor lot code, manufacture date, expiration date, initial quantity, remaining quantity, unit cost, QC status
- **Stock value calculation** — three-tier fallback valuation:
  1. `inventory_lots × unit_cost_pkr` (primary)
  2. `goods_received_notes × accepted_qty × unit_price_pkr` (GRN fallback)
  3. `inventory_balances × GRN unit price` (balance-level fallback)
- **Add Inventory Lot modal** — create new lots with product selection, quantity, cost, expiry, and QC status
- **Stock Adjustment modal** — record damaged, expired, or audit-correction adjustments with reason tracking
- **Warehouse Donut Chart** — visual stock distribution across product categories
- **Low stock alerts** — automatic flagging when available stock falls below configured reorder levels

### 2.5 Sanitary Product Catalog

- **Full CRUD operations** for sanitary products — name, SKU, category, subcategory, finish, material, unit price, reorder level
- **Category taxonomy** — Faucets & Mixers, Ceramics & Porcelain, Showers & Accessories, Piping & Valves with 14 subcategories
- **Product finish options** — Chrome, Matte Black, Brushed Nickel, Brass, Ceramic, White, Other
- **Product Delivery recording** — customer name, destination, chalan number, quantity delivered
- **Automatic stock deduction** — `deduct_product_stock` PostgreSQL RPC enforced at the database level with ACID guarantees
- **Stock alert computation** — `CRITICAL_LOW`, `REORDER_SOON`, `IN_STOCK` status per product
- **Search functionality** — trigram-indexed fuzzy search across product names and SKUs

### 2.6 GST Invoicing & Dispatch

- **Invoice generation** with customer selection, line items, and automatic tax calculation
- **GST tax engine** — Sales Tax and Further Tax computation with configurable rates per registration status
- **Invoice posting** — status transition from DRAFT to POSTED with ledger integration
- **Duplicate invoice detection** — prevents duplicate invoices for same customer/date/value combination
- **Invoice Preview Drawer** — HTML-rendered invoice preview with post-and-ledger functionality
- **Post & Print Drawer** — thermal printer integration via Tauri IPC with step-by-step workflow indicator
- **Outward Gate Pass** — dispatch document generation for shipped goods
- **Customer management** — create new customer parties with NTN/STRN, phone, email, address
- **Invoice listing** — sortable table with post/view actions and PKR formatting

### 2.7 General Ledger & Double-Entry Accounting

- **Chart of Accounts** — full account hierarchy (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE) with seeded standard accounts:
  - Cash in Hand, Bank Account, Accounts Receivable, Inventory accounts
  - Accounts Payable, Sales Tax Payable, Further Tax Payable
  - Owner's Equity, Retained Earnings
  - Sales Revenue, Other Income, COGS, Salaries, Utilities, Rent, Freight
- **Journal Entry creation** — balanced debit/credit lines with narration, account selection, and draft/posted status
- **Journal Voucher** — quick-entry voucher format for common transactions
- **Transaction Entry Modal** — multi-line journal entry with real-time balance validation
- **Trial Balance** — aggregated account totals with debit/credit verification
- **Profit & Loss Statement** — revenue vs expenses breakdown with net profit calculation
- **Balance Sheet** — assets, liabilities, and equity presentation
- **Financial Statements** — complete `fetchFinancialStatements()` RPC combining trial balance, P&L, and balance sheet
- **Audit logging** — every journal entry creation and posting is logged to `system_audit_logs`

### 2.8 Labour & Workforce Management

- **Worker Roster** — list all active workers with role designation, salary, and attendance summary badges
- **Create/Edit Worker** — full worker profile management with name, role, salary, joining date
- **Attendance Calendar Grid** — monthly grid with Present/Absent/Leave toggle per day per worker
- **Weekly Timesheet** — consolidated weekly attendance view across all workers
- **Attendance Map Builder** — `buildAttendanceMap()` utility for fast lookup of attendance records
- **Task Assignment Panel** — assign tasks to selected workers with status tracking (PENDING / IN_PROGRESS / COMPLETED)
- **Loan Tracking Panel** — per-worker loan balance display with repayment history
- **Loan Issuance** — issue new loans with amount, monthly deduction rate, and reason
- **Loan Ledger Modal** — complete loan history with repayment recording

### 2.9 Loan Management (Dedicated Module)

- **Loan listing** — all active worker loans with original amount, current balance, and monthly deduction
- **Repayment Modal** — record repayments with source tracking (CASH, BANK_TRANSFER, SALARY_DEDUCTION)
- **Repayment Log** — timestamped repayment history per loan

### 2.10 Bill of Materials (BOM) & Production Formulas

- **Product Catalog Table** — list all products with BOM status indicator
- **BOM Composer Drawer** — compose bill of materials by selecting raw materials and specifying quantities required per finished good
- **BOM versioning** — support for multiple BOM versions per finished good with active/inactive status
- **Formula creation** — `NewFormulaModal` for creating production formulas linked to BOMs
- **Batch Calculator** — volume-based batch calculation with Zod-validated inputs
- **Batch Order Execution** — `executeBatchOrder()` RPC that:
  - Deducts raw material lots according to formula specifications
  - Generates batch order records
  - Logs production activity to audit trail
- **WH-01 Lot selection** — choose specific raw material lots for batch execution with FIFO/lot tracking

### 2.11 Quality Control (QC)

- **Three-stage QC inspection** — Intake, In-Process, and Packaging stages
- **QC Parameter Form** — record viscosity (cP), specific gravity, opacity (%), shade match (pass/fail), seal integrity (pass/fail), net weight (kg)
- **Inspector attribution** — every QC record linked to named inspector
- **Lot status flagging** — `flagLotStatus()` RPC to mark lots as PASSED, PENDING, or FLAGGED_WARNING
- **QC Record listing** — filterable table with lot and batch order references

### 2.12 Real-Time Audit & Device Activity

- **`system_audit_logs` table** — every mutation across all modules writes a structured audit entry with:
  - Terminal Node ID (`node_id`)
  - Operator Name
  - Action Type (e.g., `CONVERTED_IGP_TO_GRN`, `CREATED_JOURNAL_ENTRY`, `POSTED_INVOICE`)
  - Module classification
  - Structured JSON payload with operation details
  - Timestamp
- **Supabase Realtime CDC** — raw WebSocket connection for live INSERT events on `system_audit_logs`
- **Dashboard Audit Feed** — real-time table with flash-highlighting for new entries (5-second fade)
- **Offline-aware architecture** — `NetworkGuard` monitors both REST API and WebSocket connectivity, presenting offline lock screen when Supabase is unreachable

### 2.13 Settings & Backup Management

- **Database backup export** — full data snapshot export via Tauri native file dialog or browser download fallback
- **PDF Report Generation** — `jsPDF` + `autoTable` for generating formatted ERP reports (Trial Balance, P&L, Balance Sheet, etc.)
- **Format bytes utility** — human-readable file size display

---

## 3. Tech Stack & Infrastructure Summary

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend Framework** | Next.js 16.3.5 (App Router) | React-based SSR/SSG framework with route groups and static export |
| **UI Library** | React 19.2.8 | Component rendering and state management |
| **Styling** | Tailwind CSS v4 | Utility-first CSS with custom glassmorphic theme tokens |
| **Desktop Wrapper** | Tauri 2.x | Cross-platform desktop application packaging (Windows/macOS/Linux) |
| **Database** | Supabase (PostgreSQL) | Cloud-hosted relational database with row-level security |
| **Authentication** | Supabase Auth + SSR | Session-based auth with cookie handling and role-based access |
| **Real-Time** | Supabase Realtime (WebSocket) | Change Data Capture (CDC) for live audit log streaming |
| **State Management** | Zustand 5.x | Lightweight global stores (device, network, operator) |
| **Server State** | TanStack React Query 5.x | Server state caching and invalidation |
| **Charts** | Chart.js 4.x + react-chartjs-2 | Bar, line, and doughnut chart visualizations |
| **Forms** | React Hook Form 7.x + Zod 4.x | Schema-validated form handling with resolver integration |
| **PDF Generation** | jsPDF + jspdf-autotable | Client-side PDF report and invoice generation |
| **Notifications** | Sonner | Toast notification system |
| **Theme** | next-themes | Dark/light mode with CSS custom properties |
| **Icons** | Lucide React | Consistent icon library |
| **Language** | TypeScript 5.x | Full type safety across the codebase |

---

## 4. Database Schema Summary

The system operates on **20+ interconnected PostgreSQL tables** managed through Supabase:

| Table | Purpose |
|---|---|
| `inward_gate_passes` | Inward Gate Passes — material receipts from suppliers |
| `goods_received_notes` | GRN records — accepted/rejected quantities with unit pricing |
| `inventory_warehouses` | Warehouse definitions (WH-01, WH-02) |
| `inventory_balances` | Warehouse-level product quantity balances |
| `inventory_lots` | Lot-level tracking — qty, cost, expiry, QC status |
| `products_master` | Product catalog with categories and item types |
| `sanitary_products` | Sanitary product catalog with SKU, pricing, stock levels |
| `product_deliveries` | Dispatch/delivery records |
| `parties` | Suppliers, customers, and vendors |
| `workers` | Employee roster with roles, salaries, status |
| `worker_attendance` | Daily attendance records (P/A/L) |
| `worker_loans` | Worker loan balances and deduction rates |
| `loan_repayment_logs` | Loan repayment transaction history |
| `accounts_chart` | Chart of Accounts — ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE |
| `journal_entries` | Double-entry journal headers with status |
| `journal_lines` | Journal entry line items (debit/credit) |
| `sales_invoices` | GST sales invoices with tax calculations |
| `sales_invoice_items` | Invoice line items |
| `batch_orders` | Production batch execution records |
| `system_audit_logs` | Real-time audit trail for all mutations |
| `dashboard_kpis` | Dashboard KPI snapshot cache |

---

## 5. Recommended Enhancements & Future Scope

The following are optional enhancements that can be prioritized based on business requirements. The current system is fully operational without these additions.

### 5.1 Advanced Reporting & Analytics

| # | Feature | Description |
|---|---|---|
| 1 | **Monthly/Quarterly P&L Reports** | Automated generation of periodic profit & loss statements with comparative analysis |
| 2 | **Inventory Aging Reports** | Lot-level aging analysis to identify slow-moving or expiring stock |
| 3 | **Sales Trend Dashboard** | Revenue analytics by customer, product category, and time period |
| 4 | **Worker Productivity Metrics** | Attendance consistency scores, task completion rates, output per worker |
| 5 | **GRN Cost Analysis** | Unit price trend tracking across suppliers and material categories |

### 5.2 Automated PDF Exports & Printing

| # | Feature | Description |
|---|---|---|
| 6 | **Invoice PDF Auto-Generation** | One-click GST-compliant PDF invoice generation with company branding |
| 7 | **GRN/IGP Document Export** | Print-ready gate pass and GRN documents |
| 8 | **Attendance Sheets** | Monthly attendance summary PDFs for payroll processing |
| 9 | **BOM Printouts** | Production formula sheets for factory floor use |
| 10 | **Custom Report Builder** | User-configurable report templates with selectable data fields |

### 5.3 Granular RBAC & Permissions

| # | Feature | Description |
|---|---|---|
| 11 | **Module-Level Access Control** | Restrict specific modules (e.g., Ledger, Invoicing) to authorized roles only |
| 12 | **Action-Level Permissions** | Control who can POST invoices, CREATE journal entries, or ADJUST stock |
| 13 | **Audit Log Viewer** | Dedicated admin interface for reviewing complete audit history with filters |
| 14 | **Session Management** | View and terminate active sessions across all terminal nodes |

### 5.4 External Integrations

| # | Feature | Description |
|---|---|---|
| 15 | **FBR Integration** | Integration with Pakistan's Federal Board of Revenue for digital invoicing |
| 16 | **Bank Reconciliation** | Import bank statements and auto-match with journal entries |
| 17 | **SMS/Email Notifications** | Automated alerts for low stock, overdue invoices, or loan payment reminders |
| 18 | **WhatsApp Business API** | Send invoice PDFs and delivery confirmations via WhatsApp |
| 19 | **Supplier Portal** | Web-based portal for suppliers to view IGP status and submit quotations |

### 5.5 Operational Enhancements

| # | Feature | Description |
|---|---|---|
| 20 | **Multi-Currency Support** | PKR base with USD/EUR conversion for international procurement |
| 21 | **Barcode/QR Scanning** | Scan lot numbers and product SKUs for faster data entry |
| 22 | **Batch Label Printing** | Generate and print lot/product labels with barcode |
| 23 | **Expiry Alerts** | Automated notifications for lots approaching expiration date |
| 24 | **Formula Version History** | Track and compare changes to production formulas over time |

---

## 6. System Health & Production Readiness

| Metric | Status |
|---|---|
| **TypeScript Compilation** | Zero errors — full type safety verified |
| **Build Status** | Compiles successfully (webpack mode) |
| **Module Coverage** | 12 functional modules implemented |
| **Database Tables** | 20+ tables with proper indexing and RLS policies |
| **Real-Time Features** | CDC WebSocket for live audit + KPI refresh |
| **Offline Support** | NetworkGuard with connectivity monitoring and retry |
| **Theme System** | Dark/Light mode with glassmorphic design system |
| **Desktop Deployment** | Tauri packaging configured for Windows/macOS/Linux |

---

*Report generated from codebase analysis of Glassco Sanitary ERP v1.0 — September 2026*
