Frontend Specification & Integration Architecture DocumentProject Name: Glassco Paints ERP (Dual-Target Industrial Edition)Target Runtimes: Tauri v2 Desktop Client (Windows) & Vercel Web Client (Next.js 14 Web)  Frontend Framework: Next.js 14+ (App Router, Static Export for Tauri / Server Web for Vercel)[cite: 2, 4, 6, 8]Design System Standard: Industrial Dark / Light Glassmorphic Theme (Pixel-Perfect Grid)[cite: 1, 4, 6, 8]1. Design System & Visual FoundationVisual elements adhere strictly to a 4px baseline and 8px layout grid to ensure a consistent, industrial UI density. All layouts, margins, contrast ratios, and typography hierarchies are mathematically constrained.  1.1 Dual Theme Tokens (Dark Glassmorphic & Light Slate)The system implements a theme switcher providing both an Obsidian Dark Glassmorphic theme (factory floor standard) and a high-contrast Light Slate theme (bright management offices).  +-----------------------------------------------------------------------------------+
| Dark Canvas Base: Obsidian Black (#090B10)                                       |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Card Glass Base: rgba(18, 22, 31, 0.65) | Border: rgba(255, 255, 255, 0.08)  |  |
|  | Active Accent:   Crimson Red (#DC2626)  | Hover:  rgba(28, 34, 48, 0.75)    |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
Token NameDark ValueLight ValueUsage & Context--bg-canvas#090B10#F8FAFCMain application canvas background[cite: 1, 4, 8].--surface-cardrgba(18, 22, 31, 0.65)rgba(255, 255, 255, 0.90)Base fill for container panels[cite: 1, 4, 8].--surface-hoverrgba(28, 34, 48, 0.75)rgba(241, 245, 249, 0.95)Interactive state for cards and data table rows.  --border-subtlergba(255, 255, 255, 0.08)rgba(0, 0, 0, 0.08)Standard 1px structural container border[cite: 1, 4, 8].--border-focus#DC2626#DC2626Active input outline and selected tab indicators[cite: 1, 4, 8].--primary-crimson#DC2626#DC2626Primary action buttons, active toggles, accents[cite: 1, 4, 8].--primary-hover#B91C1C#B91C1CPressed state for primary actions.  --text-primary#F9FAFB#0F172APrimary body text, labels, headers.  --text-secondary#9CA3AF#475569Form labels, secondary column text, metadata tags.  --text-muted#6B7280#94A3B8Disabled inputs, background grid lines, placeholders.  --status-optimal#10B981#059669Positive statuses (Passed QC, Optimal Stock, Balanced, P)[cite: 1, 4, 8].--status-alert#F43F5E#E11D48Negative statuses (QC Failed, Expired, Stock Alert, Unbalanced, A)[cite: 1, 4, 8].--status-amber#F59E0B#D97706Pending statuses (Draft, QC Warning, Pending Inspection, L)[cite: 1, 4, 8].1.2 Dual-Font Typography SystemInter governs functional UI labels and headers, while JetBrains Mono is enforced across all numeric values, financial PKR values, batch chemical weights (kg/L), document IDs, lot numbers, and timestamps to maintain tabular alignment[cite: 1, 4, 6, 8].Scale TokenFont FamilySize / Line HeightWeightUsagetext-displayInter24px / 32px700 (Bold)Dashboard KPI totals, PIN Auth screen title[cite: 1, 4, 8].text-h1Inter18px / 24px600 (SemiBold)Module headers, screen titles[cite: 1, 4, 8].text-h2Inter14px / 20px600 (SemiBold)Card titles, modal headers, section labels[cite: 1, 4, 8].text-bodyInter13px / 18px400 (Regular)Table labels, form inputs, general UI text.  text-captionInter11px / 14px500 (Medium)Status pills, badge indicators, table headers.  num-kpiJetBrains Mono22px / 28px700 (Bold)High-level financial totals (PKR) and batch volumes[cite: 1, 4, 6, 8].num-tableJetBrains Mono13px / 18px500 (Medium)Table numeric cells, quantities, rates, viscosity (cP)[cite: 1, 4, 6, 8].num-codeJetBrains Mono11px / 14px400 (Regular)Document serials, lot numbers (IGP-001, LOT-2026-X)[cite: 1, 4, 6, 8].1.3 Core Component SpecificationsGlass Containers (GlassCard):Background: rgba(18, 22, 31, 0.65) (Dark) / rgba(255, 255, 255, 0.90) (Light)[cite: 1, 4, 8]Backdrop Filter: blur(12px) (backdrop-blur-md)[cite: 1, 4, 8]Border: 1px solid rgba(255, 255, 255, 0.08) (Dark) / 1px solid rgba(0, 0, 0, 0.08) (Light)[cite: 1, 4, 8]Radius: 8px  Action Buttons (CrimsonButton):Height: 36px fixed; horizontal padding 16px.  Primary Style: #DC2626 background, #F9FAFB text, semi-bold 13px[cite: 1, 4, 8].Hover / Focus: #B91C1C background with 0px 0px 12px rgba(220, 38, 38, 0.35) box-shadow.  Scale Transform: 0.98 on active click.  Form Controls (GlassInput):Height: 36px fixed; horizontal padding 12px.  Background: rgba(9, 11, 16, 0.75).  Focus State: Border transitions to #DC2626 with 0 0 0 1px #DC2626 inset ring[cite: 1, 4, 8].Mandatory Operator Selection Modal (OperatorModal):Triggered on every data mutation.  Features a prominent dropdown listing active workers, requiring confirmation before sending the payload.  Loud Network Failure Overlay (NetworkGuard):Triggered when Supabase WebSocket connection is interrupted.  Displays a crimson full-screen overlay locking input until connectivity is re-established.  1.4 Spacing & Grid Rules+-----------------------------------------------------------------------+
| App Shell Header (Height: 56px, Fixed)                                |
+--------------+--------------------------------------------------------+
| Sidebar Nav  | Page Content Canvas (Padding: 24px)                    |
| (Width:      | +-------------------+ +------------------------------+ |
|  220px,      | | Card Grid (Gap:   | | Card Grid                  | |
|  Fixed)      | | 16px)             | |                            | |
|              | +-------------------+ +------------------------------+ |
+--------------+--------------------------------------------------------+
Baseline Unit: 4px. All margins, paddings, and heights must be exact multiples of 4 (4, 8, 12, 16, 24, 32).  Grid Layout System: 12-column CSS Grid with 16px gaps for dashboard matrices.  Data Table Alignment Constraints (table-layout: fixed):Text Columns: Left-aligned (text-left).  Status Pills / Badges: Center-aligned (text-center).  Financials / Weights (kg/L) / Dates: Right-aligned (text-right) using JetBrains Mono[cite: 1, 4, 6, 8].2. UI Screen Layout Specifications (8 Dedicated Core Views)+-----------------------------------------------------------------------------------+
|                                  App Layout Shell                                 |
+-----------------------------------------------------------------------------------+
| [Logo] Glassco Paints | Node: PC-01 | Status: [LIVE] | 10:57 AM | [Theme] [Lock]   |
+--------------+--------------------------------------------------------------------+
| NAVIGATION   | MAIN WORKSPACE CONTENT AREA                                        |
|              |                                                                    |
| - Dashboard  |  +-------------------+  +-------------------+  +-------------------+ |
| - Procurement|  | KPI Card 1        |  | KPI Card 2        |  | KPI Card 3        | |
| - Inventory  |  +-------------------+  +-------------------+  +-------------------+ |
| - Formulas   |                                                                    |
| - Quality QC |  +---------------------------------------------------------------+ |
| - Labour     |  | Operational Data Table / Chart Canvas                         | |
| - Invoicing  |  +---------------------------------------------------------------+ |
| - Ledger     |                                                                    |
+--------------+--------------------------------------------------------------------+
Screen 1: System Executive Dashboard (/dashboard)Header KPI Bar: 4 cards showing Raw Chemical Stock (PKR), Finished Paint Value (PKR), Outstanding Worker Loans (PKR), and Trial Balance Status (BALANCED green / UNBALANCED crimson).Charts Area: Dual-line Chart.js component comparing monthly Raw Material Chemical Consumption (kg) vs Finished Paint Production Volume (Liters).Live Audit Log Table: Real-time table streaming rows from system_audit_logs using Supabase CDC.Screen 2: Inward Gate Pass & GRN Logistics (/procurement)IGP Table: Lists incoming shipments (Resins, Pigments, Solvents, Packaging) with status tags (Pending Inspection, Converted to GRN).Material Intake Drawer: Slide-over panel capturing vendor lot numbers, supplier chemical analysis certificate numbers, and gross vs net weights.Conversion Action: "Convert to GRN" button that automatically creates lot records in WH-01 and posts inventory balance updates.Screen 3: Dual-Warehouse FEFO Inventory (/inventory)Tab Switcher: Toggle between WH-01 Raw Material Chemicals and WH-02 Finished Paint Goods.FEFO Expiry Highlights: Rows display days-until-expiration. Lots expiring within 30 days display amber warnings; expired lots display crimson badges.Stock Composition Chart: Donut chart breaking down current raw material holdings by category (Resins, Pigments, Solvents, Additives).Screen 4: Formula Master & Batch Production (/formulas)Formula Editor: Interface to select a finished product SKU and manage its versioned chemical composition (e.g., Titanium Dioxide 25%, Acrylic Resin 40%, Solvent 35%).Batch Auto-Calculator: Entering target batch size (e.g., 2,500 Liters) automatically calculates required raw material weights, compares them against WH-01 stock, and highlights shortages.Batch Execution Button: Deducts calculated raw materials from WH-01 and creates a pending batch lot in WH-02.Screen 5: Non-Blocking Quality Control (/qc)3-Stage QC Dashboard: View logs split across Raw Material Intake, In-Process Mixing, and Packaging.Parameter Form: Fields capturing Specific Gravity, Viscosity (cP), Opacity (%), Shade Match Pass/Fail, and Net Weight per bucket.Non-Blocking Indicator: Submitting a failed test tags the batch with a crimson "QC-Flagged" badge and notifies management via audit logs, but leaves the batch movable through inventory.Screen 6: Labour Register & Worker Loans (/labour)Monthly Attendance Matrix: Table displaying workers alongside a 31-day calendar grid. Clicking a date cell toggles between P (Present - Green), A (Absent - Red), and L (Leave - Amber).Loan Ledger Modal: Slide-over showing active worker loan balances, monthly salary auto-deduction schedules, and cash repayment entry fields.Screen 7: GST Sales Invoicing & Dispatch (/invoicing)FBR Tax Invoice Generator: Form supporting customer lookup, line-item entry, and automated tax calculations (18% Sales Tax + 4% Further Tax for unregistered buyers).Draft / Posted Toggle:Draft: Editable invoice state with no ledger or inventory impact.Posted: Locks invoice, decrements finished goods from WH-02 using FEFO priority, and posts double-entry accounting lines.Print & Dispatch Drawer: Triggers local printing via Tauri IPC and generates an Outward Gate Pass (OGP).Screen 8: General Ledger & Financials (/ledger)3-Column Comparative View: Side-by-side rendering of Trial Balance, Profit & Loss, and Balance Sheet.Auto-Balance Header Badge: Live validation tag displaying BALANCED (Total Debits = Total Credits) or UNBALANCED.Journal Voucher Modal: Slide-over for posting manual double-entry financial lines. Verifies SUM(Debits) = SUM(Credits) before enabling submission.3. Integration Architecture & API Payload Specifications+-----------------------------------------------------------------------+
|                         Next.js Frontend Client                       |
+----------------------------------+------------------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v (WebSockets / HTTPS)                              v (Tauri IPC Bridge)
+----------------------------------+               +--------------------+
|  Supabase Cloud (PostgreSQL 16)  |               |  Native Rust OS    |
|  - Data Queries (PostgREST)      |               |  - USB Printing    |
|  - Realtime CDC Subscriptions    |               |  - Node ID Retrieval|
+----------------------------------+               +--------------------+
3.1 Supabase Cloud Services IntegrationA. Fetch Executive Dashboard KPIs (Screen 1)Endpoint: GET /rest/v1/rpc/get_paints_dashboard_kpis  Headers: {"apikey": "YOUR_SUPABASE_ANON_KEY", "Content-Type": "application/json"}  Expected Response (200 OK):JSON{
  "raw_chemical_value_pkr": 5420000.50,
  "finished_paint_value_pkr": 11250800.00,
  "active_batch_orders_count": 3,
  "qc_warning_lots_count": 1,
  "trial_balance_status": "BALANCED",
  "last_updated": "2026-09-12T11:00:00Z"
}
B. Submit New Chemical Inward Gate Pass (Screen 2)Endpoint: POST /rest/v1/inward_gate_passes  Request Payload:JSON{
  "supplier_id": "c6a1b2c3-8491-4d92-b601-e9a0f1234567",
  "material_description": "Titanium Dioxide Pigment Grade-A",
  "inward_qty": 2500.0000,
  "device_node": "PC-01",
  "operator_name": "Talha Ijaz"
}
Expected Response (201 Created):JSON{
  "id": "f83d9a12-092b-4e12-a89c-82910fa98211",
  "igp_code": "IGP-2026-0891",
  "status": "PENDING_INSPECTION",
  "created_at": "2026-09-12T11:02:15Z"
}
C. Execute Batch Production Order & FEFO Deduction (Screen 4)Endpoint: POST /rest/v1/rpc/execute_paint_batch_orderRequest Payload:JSON{
  "formula_id": "b9876543-210a-bcde-f012-3456789abcde",
  "target_volume_liters": 1000.0000,
  "operator_name": "Talha Ijaz",
  "device_node": "PC-02",
  "lot_deductions": [
    { "lot_id": "l1111111-2222-3333-4444-555555555555", "deduct_qty_kg": 450.0000 },
    { "lot_id": "l6666666-7777-8888-9999-000000000000", "deduct_qty_kg": 120.0000 }
  ]
}
Expected Response (200 OK):JSON{
  "batch_number": "BT-2026-0042",
  "generated_finished_lot_number": "LOT-2026-P09",
  "status": "IN_PROGRESS",
  "created_at": "2026-09-12T11:05:00Z"
}
D. Post GST Sales Invoice with FEFO Lot Dispatch (Screen 7)Endpoint: POST /rest/v1/rpc/post_gst_paints_invoice  Request Payload:JSON{
  "customer_id": "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
  "taxable_value_pkr": 250000.00,
  "apply_further_tax": false,
  "operator_name": "Talha Ijaz",
  "line_items": [
    { 
      "product_id": "p9876543-210a-bcde-f012-3456789abcde", 
      "lot_id": "l9999999-8888-7777-6666-555555555555",
      "qty_buckets": 50, 
      "unit_price_pkr": 5000.00 
    }
  ]
}
Expected Response (200 OK):JSON{
  "invoice_number": "INV-2026-0812",
  "taxable_value": 250000.00,
  "sales_tax_amount": 45000.00,
  "further_tax_amount": 0.00,
  "total_payable": 295000.00,
  "is_posted": true
}
3.2 Realtime CDC WebSocket IntegrationProtocol: wss://YOUR_SUPABASE_PROJECT.supabase.co/realtime/v1/websocket  Channel Subscription Event:JSON{
  "topic": "realtime:public:system_audit_logs",
  "event": "phx_join",
  "payload": {},
  "ref": "1"
}
Incoming CDC Packet (New Batch Executed Broadcast):JSON{
  "event": "INSERT",
  "schema": "public",
  "table": "system_audit_logs",
  "record": {
    "id": "e4b3a210-9876-5432-10fe-dcba98765432",
    "device_node": "PC-02",
    "operator_name": "Talha Ijaz",
    "action_type": "EXECUTED_PAINT_BATCH",
    "module_tag": "FORMULAS",
    "created_at": "2026-09-12T11:05:01Z"
  }
}
3.3 Tauri v2 Native Desktop InteropService 1: Hardware USB Invoice Thermal PrintingIPC Command: invoke('plugin:printer|print_pdf')  Request Payload:JSON{
  "printer_name": "POS-80-Thermal",
  "document_data_base64": "JVBERi0xLjQKJ..."
}
Expected Response: {"success": true, "job_id": 8102, "message": "Dispatched to POS-80-Thermal"}  Service 2: Hardware Environment Identifier RetrievalIPC Command: invoke('get_hardware_node_id')  Expected Response: {"node_id": "PC-01", "os_version": "Windows 11 Enterprise"}  3.4 Chart.js VisualizationsService 1: Raw Chemical Depletion vs Finished Paint Production Chart (Screen 1)JavaScriptconst trendChartConfig = {
  type: 'line',
  data: {
    labels: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'],
    datasets: [
      {
        label: 'Raw Chemicals (WH-01 kg)',
        borderColor: '#DC2626',
        backgroundColor: 'rgba(220, 38, 38, 0.1)',
        fill: true,
        tension: 0.3,
        data: [12500, 11800, 10200, 9800, 14200, 13900]
      },
      {
        label: 'Finished Paints (WH-02 L)',
        borderColor: '#10B981',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        data: [45000, 46200, 48000, 48000, 52000, 53500]
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9CA3AF', font: { family: 'Inter', size: 11 } } } },
    scales: {
      x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9CA3AF', font: { family: 'JetBrains Mono' } } },
      y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9CA3AF', font: { family: 'JetBrains Mono' } } }
    }
  }
};
Service 2: Chemical Category Donut Share Chart (Screen 3)JavaScriptconst chemicalDonutConfig = {
  type: 'doughnut',
  data: {
    labels: ['Resins & Polymers', 'Titanium Dioxide', 'Solvents & Thinners', 'Additives'],
    datasets: [{
      data: [45, 25, 20, 10],
      backgroundColor: ['#DC2626', '#991B1B', '#F59E0B', '#374151'],
      borderWidth: 1,
      borderColor: '#090B10'
    }]
  },
  options: {
    cutout: '75%',
    plugins: { legend: { position: 'right', labels: { color: '#F9FAFB', font: { family: 'Inter', size: 12 } } } }
  }
};