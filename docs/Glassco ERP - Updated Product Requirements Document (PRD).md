# **PRD: Glassco ERP Desktop Application (Industrial Dark Edition)**

## **1\. Problem Statement**

**What problem does this solve?**  
Glassco Sanitary Fittings Industries currently runs procurement, inventory, payroll/loans, and accounting entirely on paper — no real-time visibility into stock, no audit trail on gate passes/GRNs, manual and error-prone payroll/loan tracking, and manual GST-compliant invoicing with no ledger automation.  
**Who experiences this problem?**  
Gate/store staff logging inward/outward goods, management tracking raw material vs finished goods stock, payroll administrators managing worker loans and daily attendance, and accounts staff maintaining GST invoices and financial statements.  
**Why does this problem matter now?**  
Paper-based processes scale poorly with volume and create reconciliation errors that compound and are expensive to untangle after the fact.

## ---

**2\. Target User & Visual Design**

**Primary user:** Internal staff across functional roles — gate/store clerk, warehouse/inventory handler, payroll administrator, accounts/finance staff — currently operating on paper registers.  
**UI/UX Aesthetic Guidelines (Strict Visual Parity with Reference Design):**

> * **Theme:** Dark Glassmorphism aesthetic. Obsidian base background (\#090B10) paired with deep crimson/red active highlights (\#DC2626 / \#991B1B).  
> * **Layout Structure:** Grid-capable multi-screen dashboard structure matching the 8 dedicated operational core views.  
> * **Components:** Translucent frosted-glass cards (backdrop-blur-md), subtle white borders (rgba(255,255,255,0.08)), and high-contrast status pills (Optimal green, Alert rose, Draft amber).  
> * **Typography:** Inter font for UI headings and table labels; JetBrains Mono for all numeric financial data, PKR values, timestamps, and document codes.

**Authentication & Security Note:**  
Access is gated by a single shared app-level initial PIN/Password screen at startup. There are no individual user roles/accounts in v1. Any user can access modules, but all edits to sensitive records log device attribution (PC-01, PC-02, etc.), timestamp, prior value, and an operator identifier.

## ---

**3\. Core Features & Module Breakdown (8 Screen Layout Standard)**

### **3.1 System Executive Dashboard (Screen 1\)**

> * **High-Level KPI Stat Cards:** Real-time overview cards displaying Raw Material Stock Value, Finished Goods Value, Active Loan Balances, and Auto-Balancing Trial Balance Status.  
> * **Stock Trends Line Chart:** Visual tracking comparing Raw Material Stock Trends against Finished Goods value over time.  
> * **Real-time Audit Trail Table:** Live activity feed logging timestamp, module tag, description, operator identifier, and node station (e.g., PC-01, PC-02).

### **3.2 Inward Gate Pass (IGP) & GRN (Screen 2\)**

> * **Inward Passes Table:** Logging of incoming raw materials, fittings, or components with status indicators (Pending Inspection, Converted to GRN, Rejected).  
> * **Conversion Flow Trigger:** Visual conversion engine from verified IGP to Store Goods Received Note (GRN).  
> * **Inline Inspection Form:** Dedicated inspection drawer capturing accepted vs. rejected quantities alongside structured rejection reason logs and inspector signature tags.

### **3.3 Dual-Warehouse Inventory Control (Screen 3\)**

> * **Separated Warehouse Registers:** Strictly separated Raw Materials (WH-01: Brass, Zinc Scrap, Plating Salts) and Finished Goods (WH-02: Taps, Angle Valves, Mixers) stores.  
> * **Material Dominance Donut Chart:** Donut chart visualizer detailing raw material composition and stock distribution percentage.  
> * **Finished Goods Valuation List:** Real-time list of finished goods SKUs with unit prices and stock status warnings.

### **3.4 Product and Model Management / BOM (Screen 4\)**

> * **Finished Goods Specifications:** Master catalog for product specs, variants, model materials, and categories.  
> * **Bill of Materials (BOM) Editor:** Component composition tool detailing exact raw material consumption (e.g., Brass Ingot \+ Zinc Alloy per finished unit) with active versioning control.

### **3.5 Labour Register & Attendance (Screen 5\)**

> * **Worker Profile Header:** Selected worker summary with quick profile metadata, designation, and status indicators.  
> * **Interactive Attendance Calendar Grid:** Monthly grid calendar for fast daily attendance logging (P Present, A Absent, L Leave).  
> * **Active Worker List:** Comprehensive worker roster featuring name, designation, status pill, and action triggers.

### **3.6 Advance Loan Register (Screen 6\)**

> * **Worker Loan Disbursements Summary:** Dedicated overview of total outstanding worker loans, active loan balances, and auto-deduction tallies.  
> * **Monthly Auto-Deductions Table:** Automated salary deduction ledger displaying worker loan breakdown and monthly recovery amounts.  
> * **Manual Repayment Modal:** Dedicated pop-up modal for recording cash or bank loan repayments directly.

### **3.7 GST Sales Invoicing (Screen 7\)**

> * **FBR-Compliant Invoicing Table:** Sales tax invoice generator supporting Standard Sales Tax (18%) and Further Tax (4%) for unregistered buyers.  
> * **Recent Invoicing Register:** Filterable table showing invoice numbers, customer titles, taxable values, tax amounts, and posting status pills (Draft vs Posted).

### **3.8 General Ledger & Financial Statements (Screen 8\)**

> * **3-Column Comparative Financial View:** Integrated side-by-side display rendering the **Trial Balance**, **Profit & Loss (P\&L) Statement**, and **Balance Sheet** simultaneously.  
> * **Auto-Balancing Indicators:** Real-time validation badges verifying Debits \= Credits across all ledgers.  
> * **New Transaction Entry Modal:** Slide-over/pop-up transaction posting drawer for manual journal entries, invoice posting, and debit/credit assignments.

## ---

**4\. Technical Stack & Configuration**

> * **Frontend:** Next.js 14+ (App Router) with Static Export (output: 'export').  
> * **Desktop Runtime:** Tauri v2 (Rust cross-compiled for Windows desktop).  
> * **Database & Realtime:** Supabase Cloud (PostgreSQL 16\) with ACID-compliant double-entry ledger triggers and WebSocket Change Data Capture (CDC).  
> * **Styling & Charts:** Tailwind CSS \+ Custom CSS Glassmorphism Rules \+ Chart.js.