Frontend Specification & Integration Architecture DocumentProject Name: Glassco ERP (Desktop Industrial Edition)  Target Runtime: Tauri v2 Desktop Client (Windows)[cite: 2, 4]Frontend Framework: Next.js 14+ (App Router, Static Export target)[cite: 2, 4]Design System Standard: Industrial Dark Glassmorphism (Pixel-Perfect Alignment Grid)[cite: 1, 4]1. Design System & Visual FoundationTo avoid a "vibe coded" or unpolished layout, all visual elements strictly adhere to a 4px baseline and 8px layout grid. Alignment, margins, contrast ratios, and typography hierarchies are mathematically constrained.1.1 Color Palette & Token Definitions+-----------------------------------------------------------------------+
| Surface Background: Obsidian Black (#090B10)                         |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  | Card Glass Base: rgba(18, 22, 31, 0.65)                       |  |
|  | Border Overlay:  rgba(255, 255, 255, 0.08)                     |  |
|  | Active Highlight: Crimson Red (#DC2626)                         |  |
|  +-----------------------------------------------------------------+  |
+-----------------------------------------------------------------------+
Token NameHex / ValueUsage & Context--bg-obsidian#090B10Primary application canvas background[cite: 1, 4].--surface-glassrgba(18, 22, 31, 0.65)Base fill for frosted glass panel containers[cite: 1, 4].--surface-glass-hoverrgba(28, 34, 48, 0.75)Interactive state for clickable cards and table rows.--border-subtlergba(255, 255, 255, 0.08)Standard 1px structural container border[cite: 1, 4].--border-focus#DC2626Active input outline and selected tab indicators[cite: 1, 4].--primary-crimson#DC2626Primary action buttons, active toggles, key visual accents[cite: 1, 4].--primary-crimson-hover#B91C1CHover/Pressed state for primary actions.--primary-crimson-glowrgba(220, 38, 38, 0.25)Backdrop drop-shadow glow for active elements.--text-primary#F9FAFBHigh-contrast body text, primary values, and headers.--text-secondary#9CA3AFForm labels, secondary column text, metadata tags.--text-muted#6B7280Disabled inputs, background grid lines, placeholder text.--status-optimal#10B981Positive statuses (Passed, Optimal Stock, Balanced, P)[cite: 1, 4].--status-alert#F43F5ENegative statuses (Rejected, Stock Alert, Unbalanced, A)[cite: 1, 4].--status-amber#F59E0BPending statuses (Draft, Pending Inspection, L)[cite: 1, 4].1.2 Typography SystemThe application uses a strict dual-font setup[cite: 1, 4]. Inter governs functional UI labels and body text, while JetBrains Mono is enforced on all numeric values, financial PKR figures, stock weights, document IDs, and timestamps to preserve column-level tabular alignment[cite: 1, 4].Font Pairings:
- UI Hierarchy: Inter (-0.02em letter spacing for headers)
- Tabular / Financial: JetBrains Mono (tnum feature-settings enabled)
Scale TokenFont FamilySize / Line HeightWeightUsagetext-displayInter24px / 32px700 (Bold)Main Dashboard KPI totals, Auth Title[cite: 1, 4].text-h1Inter18px / 24px600 (SemiBold)Section headers, Module Titles[cite: 1, 4].text-h2Inter14px / 20px600 (SemiBold)Glass Card Titles, Modal Headers[cite: 1, 4].text-bodyInter13px / 18px400 (Regular)Table labels, form inputs, general UI text.text-captionInter11px / 14px500 (Medium)Status pills, badge indicators, column headers.num-kpiJetBrains Mono22px / 28px700 (Bold)High-level financial totals (PKR)[cite: 1, 4].num-tableJetBrains Mono13px / 18px500 (Medium)Table numeric cells, quantities, rates[cite: 1, 4].num-codeJetBrains Mono11px / 14px400 (Regular)Document serials (IGP-001, INV-902)[cite: 1, 4].1.3 Core Component Design SpecsGlass Containers (GlassCard)Background: rgba(18, 22, 31, 0.65)[cite: 1, 4]Backdrop Filter: blur(12px) (backdrop-blur-md)[cite: 1, 4]Border: 1px solid rgba(255, 255, 255, 0.08)[cite: 1, 4]Border Radius: 8px (Strict geometry)Shadow: 0px 4px 20px rgba(0, 0, 0, 0.45)Action Buttons (CrimsonButton)Primary State: Solid #DC2626 background, #F9FAFB text, semi-bold 13px[cite: 1, 4].Height: 36px fixed height; internal padding 0px 16px.Border Radius: 6px.Hover State: #B91C1C background with 0px 0px 12px rgba(220, 38, 38, 0.35) box-shadow.Active State: Scale transform 0.98.Disabled State: Background #374151, text #6B7280, cursor not-allowed.Form Controls (GlassInput)Height: 36px fixed; horizontal padding 12px.Background: rgba(9, 11, 16, 0.75).Border: 1px solid rgba(255, 255, 255, 0.12).Typography: JetBrains Mono 13px for numeric fields, Inter 13px for text[cite: 1, 4].Focus State: Border transitions to #DC2626 with 0 0 0 1px #DC2626 inset focus ring[cite: 1, 4].Overlay Drawers & Modals (ModalDrawer)Backdrop Overlay: rgba(0, 0, 0, 0.75) with backdrop-blur-sm.Drawer Panel Position: Right-aligned slide-over; width 480px fixed.Header Bar: Height 56px, bottom border 1px solid rgba(255, 255, 255, 0.08)[cite: 1, 4].1.4 Spacing, Alignment, & Layout Grid Rules+-----------------------------------------------------------------------+
| App Shell Header (Height: 56px, Fixed)                                |
+--------------+--------------------------------------------------------+
| Sidebar Nav  | Page Content Canvas                                    |
| (Width:      | (Padding: 24px)                                        |
|  220px,      | +-------------------+ +------------------------------+ |
|  Fixed)      | | Card Grid (Gap:   | | Card Grid                  | |
|              | | 16px)             | |                            | |
|              | +-------------------+ +------------------------------+ |
+--------------+--------------------------------------------------------+
Baseline Unit: 4px. All margins, paddings, and heights must be exact multiples of 4 (e.g., 4, 8, 12, 16, 24, 32).Grid Layout System: 12-column CSS Grid with 16px column gaps for dashboard matrices.  Table Layout Constraints: All data tables utilize table-layout: fixed. Header and cell contents must maintain strict vertical alignment:Text columns: Left-aligned (text-left).Status / Pills: Center-aligned (text-center).Financials / Quantities / Dates: Right-aligned (text-right) using JetBrains Mono[cite: 1, 4].2. Integration & Third-Party API ArchitectureGlassco ERP relies on three key external integrations: Supabase Cloud Infrastructure (Database, Auth, CDC WebSockets), Tauri Native Desktop IPC Bridge (OS level hooks, USB printing), and Chart.js (Industrial visualization engine)[cite: 2, 4].+-----------------------------------------------------------------------+
|                          Next.js UI Frontend                          |
+----------------------------------+------------------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v (WebSockets / HTTPS)                              v (Tauri IPC Bridge)
+----------------------------------+               +--------------------+
|  Supabase Cloud (PostgreSQL 16)  |               |  Native Rust OS    |
|  - Data Queries (PostgREST)      |               |  - USB Printing    |
|  - Realtime CDC Subscriptions    |               |  - Device Node ID  |
+----------------------------------+               +--------------------+
2.1 Supabase Cloud Services IntegrationService 1: Realtime Data Fetching & Mutations (PostgREST)Purpose: Primary database operations for all 8 application modules[cite: 1, 4].Authentication: Headers pass apikey: NEXT_PUBLIC_SUPABASE_ANON_KEY and client-side bearer token.  Payload & Endpoint SpecificationsA. Fetch Executive Dashboard KPIs (Screen 1)[cite: 1, 4]Endpoint: GET /rest/v1/rpc/get_executive_dashboard_kpisRequest Headers:JSON{
  "Content-Type": "application/json",
  "apikey": "YOUR_SUPABASE_ANON_KEY"
}
Expected Response (200 OK):JSON{
  "raw_material_value_pkr": 4250000.50,
  "finished_goods_value_pkr": 8910200.00,
  "active_loans_total_pkr": 340000.00,
  "trial_balance_status": "BALANCED",
  "last_updated": "2026-09-12T07:07:52Z"
}
B. Submit New Inward Gate Pass (Screen 2)[cite: 1, 4]Endpoint: POST /rest/v1/inward_gate_passesRequest Payload:JSON{
  "supplier_id": "c6a1b2c3-8491-4d92-b601-e9a0f1234567",
  "material_description": "Brass Ingots Grade-A",
  "inward_qty": 1500.0000,
  "device_node": "PC-01",
  "operator_name": "Talha Ijaz"
}
Expected Response (201 Created):JSON{
  "id": "f83d9a12-092b-4e12-a89c-82910fa98211",
  "igp_code": "IGP-2026-0891",
  "status": "PENDING_INSPECTION",
  "created_at": "2026-09-12T07:07:52Z"
}
C. Post GST Sales Invoice (Screen 7)[cite: 1, 4]Endpoint: POST /rest/v1/rpc/post_gst_sales_invoiceRequest Payload:JSON{
  "customer_id": "a1b2c3d4-e5f6-7890-1234-56789abcdef0",
  "taxable_value_pkr": 100000.00,
  "apply_further_tax": true,
  "line_items": [
    { "product_id": "p9876543-210a-bcde-f012-3456789abcde", "qty": 100, "unit_price": 1000.00 }
  ]
}
Expected Response (200 OK):JSON{
  "invoice_number": "INV-2026-0412",
  "taxable_value": 100000.00,
  "sales_tax_amount": 18000.00,
  "further_tax_amount": 4000.00,
  "total_payable": 122000.00,
  "is_posted": true
}
Service 2: Realtime WebSocket CDC SubscriptionsPurpose: Live cross-terminal sync (e.g., when an IGP is logged on PC-01, PC-02 updates its table without page refresh)[cite: 1, 2, 4].Protocol: wss://YOUR_SUPABASE_PROJECT.supabase.co/realtime/v1/websocketChannel Subscription Event:JSON{
  "topic": "realtime:public:system_audit_logs",
  "event": "phx_join",
  "payload": {},
  "ref": "1"
}
Incoming Realtime Broadcast Packet (INSERT):JSON{
  "event": "INSERT",
  "schema": "public",
  "table": "system_audit_logs",
  "record": {
    "id": "e4b3a210-9876-5432-10fe-dcba98765432",
    "device_node": "PC-02",
    "operator_name": "Store Manager",
    "action_type": "CONVERTED_IGP_TO_GRN",
    "module": "PROCUREMENT",
    "created_at": "2026-09-12T07:07:52Z"
  }
}
2.2 Tauri v2 Native Desktop IPC IntegrationService 1: Hardware Local Thermal Printing HookPurpose: Triggers direct silent or dialog-assisted printing of GST Sales Invoices directly to USB receipt/thermal printers connected to the local Windows PC[cite: 2, 4].IPC Channel Command: invoke('plugin:printer|print_pdf')IPC Request Payload (Rust Interop):JSON{
  "printer_name": "POS-80-Thermal",
  "document_data_base64": "JVBERi0xLjQKJ..."
}
IPC Response Expected:JSON{
  "success": true,
  "job_id": 4102,
  "message": "Print job dispatched to POS-80-Thermal"
}
Service 2: Native System Environment RetrievalPurpose: Retrieves hardware-level node identification (PC-01, PC-02) at app startup[cite: 2, 4].IPC Channel Command: invoke('get_hardware_node_id')IPC Response Expected:JSON{
  "node_id": "PC-01",
  "os_version": "Windows 11 Enterprise",
  "mac_address_hash": "a4f8e912..."
}
2.3 Chart.js Visual Engine IntegrationService 1: Raw vs Finished Goods Stock Line Chart (Screen 1)[cite: 1, 4]Component Context: High-density industrial trend line renderer[cite: 1, 4].Configuration Specification:JavaScriptconst chartConfig = {
  type: 'line',
  data: {
    labels: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'],
    datasets: [
      {
        label: 'Raw Materials (WH-01)',
        borderColor: '#DC2626', // Primary Crimson
        backgroundColor: 'rgba(220, 38, 38, 0.1)',
        fill: true,
        tension: 0.3,
        data: [4.1, 4.2, 3.9, 4.0, 4.25, 4.25]
      },
      {
        label: 'Finished Goods (WH-02)',
        borderColor: '#10B981', // Optimal Green
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        data: [8.5, 8.6, 8.7, 8.75, 8.9, 8.91]
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
Service 2: Material Share Donut Chart (Screen 3)[cite: 1, 4]Component Context: Raw material stock balance distribution chart[cite: 1, 4].Configuration Specification:JavaScriptconst donutConfig = {
  type: 'doughnut',
  data: {
    labels: ['Brass Ingot', 'Zinc Scrap', 'Plating Salts', 'Others'],
    datasets: [{
      data: [65, 20, 10, 5],
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