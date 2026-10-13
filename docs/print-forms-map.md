# System Print-Out Forms — Path Map & Connections

> Repo root: `D:\komax brass\node-station\node-station`
> Every print / PDF form in the ERP, its file path, entry point, trigger button, and the
> connections (imports + data flow) between pages, components and print libraries.
> Edit freely — this file is documentation only.

---

## 0. Architecture — print mechanisms

| System | Mechanism | Core file(s) |
|---|---|---|
| **A. jsPDF exports** | `jspdf` + `jspdf-autotable` → `outputReport()` → hidden blob-URL iframe → `iframe.contentWindow.print()` (Save-as-PDF works) | `src\lib\pdf-exporter.ts` |
| **B. HTML → hidden iframe** | Build HTML string → create 0×0 fixed `iframe` → `doc.write(html)` → `contentWindow.print()` | `src\lib\voucher-print.ts`, `src\lib\statement-print.ts`, `src\lib\supabase\invoicing.ts`, `src\lib\supabase\catalog.ts`, `src\lib\supabase\crm.ts`, `OutwardGatePass.tsx` |
| **C. DOM `window.print()`** | Prints the live React DOM against `globals.css @media print` | `src\components\modules\payroll\PayslipPrintTemplate.tsx` (orphan) |
| **D. Tauri native print** | `invoke("print_html_document")` / `invoke("plugin:printer\|print_pdf")` — tried first, always falls back to B (see §6.4) | `src\lib\tauri-bridge.ts` |

---

## TABLE A — Every print / PDF form in the UI (25 forms)

| # | Document printed | File path | Entry function | Trigger button | Output |
|---|---|---|---|---|---|
| 1 | **Payment Voucher** (CPV/BPV/PPV/SPV) — bilingual A4 | `src\app\(dashboard)\payment-vouchers\page.tsx` | `handlePrintVoucher()` L112–121 | `PaymentVoucherList.tsx` L73–85 ("Print", onClick L75) | HTML → iframe |
| 2 | **Payment Voucher list PDF** | same page | `handleExportList()` L92–100 | header "Export PDF" L164 (label L172) | jsPDF |
| 3 | **Single Payment Voucher PDF** (signable) | same page | `handleExportVoucher()` L102–110 | `PaymentVoucherList.tsx` L86–98 ("PDF", onClick L88) | jsPDF |
| 4 | **Customer Receipt Voucher** (CRV/BRV) | `src\app\(dashboard)\invoicing\receipts\page.tsx` | `handlePrint()` L174–186 | row `<Printer>` L478 (block L477–484) | HTML → iframe |
| 5 | **Sales Tax Invoice** print/save PDF | `src\components\modules\invoicing\InvoicePreviewDrawer.tsx` | `handlePrint()` L54–93 | "Print / Save PDF" L244–250 | HTML → iframe |
| 6 | **Post & Print** (post GST invoice then auto-print) | `src\components\modules\invoicing\PostPrintDrawer.tsx` | `handlePostAndPrint()` L33–128; `handleRetryPrint()` L130–156; `handlePDFExport()` L158–183 | "Post & Print" L273–279; "Export PDF" L282–287; "Retry Print" L290–296 | Tauri/iframe |
| 7 | **Outward Gate Pass (OGP)** + tax summary | `src\components\modules\invoicing\OutwardGatePass.tsx` | `handlePrint()` L46–158 | "Print OGP" L229 | HTML → iframe |
| 8 | **Full invoice** from the OGP modal | same file | `handlePrintInvoice()` L20–44 | "Print Full Invoice" L232 | HTML → iframe |
| 9 | **80 mm thermal Slip Invoice** (POS-80) | `src\app\(dashboard)\invoicing\page.tsx` | `SlipInvoiceModal.handlePrint()` L609–619; `handleBrowserPrint()` L621–644 | "Print Thermal" L720; "Print / Save PDF" L727 | thermal/iframe |
| 10 | **Party / Account Statement** (A4) | `src\components\modules\ledger\IndividualLedgerModal.tsx` | `handlePrintStatement()` L418–498 | "Print Statement" L566–576 and L824 | HTML → iframe |
| 11 | **Individual Ledger Statement PDF** | same file | `handleExportPDF()` L501–528 | "Export PDF" L579–588 | jsPDF |
| 12 | **Party ledger print** (CRM) | `src\app\(dashboard)\crm\page.tsx` | `handleExportLedger()` L100–131 | per-row "Export PDF" L283–290 | HTML → iframe |
| 13 | **CRM contacts list PDF** | same page | `handleExportPDF()` L91–98 | header L165–175 | jsPDF |
| 14 | **Worker Payslip PDF** | `src\components\modules\labour\SalaryCard.tsx` | `handlePrint()` L81–89 | "Print" L120–130 | jsPDF |
| 15 | **Payslip print preview** (DOM print) | `src\components\modules\payroll\PayslipPrintTemplate.tsx` | `handlePrint()` L52–54 | "Print Payslip" L60–68 | ⚠️ **orphan — never imported** (§6.1) |
| 16 | **General Ledger report PDF** | `src\app\(dashboard)\ledger\page.tsx` | `handleExportPDF()` L166–169 | header L399 (label L407) | jsPDF |
| 17 | **Journal / TB / P&L / Balance Sheet** per-tab PDFs | same page | `handleExportSection()` L172–181 | `SectionExportBar` L450, L581, L842, L914 (component L1091, ExportPdfButton L1064) | jsPDF |
| 18 | **Single Journal Entry PDF** | same page | inline `exportJournalEntryPDF` L517–521 | per-row "PDF" L519 | jsPDF |
| 19 | **Labour Report PDF** | `src\app\(dashboard)\labour\page.tsx` | `handleExportPDF()` L177–194 | header L223–231 | jsPDF (landscape) |
| 20 | **Product catalog PDF** | `src\app\(dashboard)\catalog\page.tsx` | `handleExportPDF()` L91–99 | header onClick L128 | jsPDF |
| 21 | **Inventory product table PDF** | `src\app\(dashboard)\inventory\page.tsx` | `handleExportPDF()` L102–108 | header onClick L144 | jsPDF |
| 22 | **Stock Card PDF** (one product) | same page | `handlePrintProduct()` L110–118 | per-row "PDF" onClick L329 (block L328–338) | jsPDF |
| 23 | **Inward Gate Passes (IGP) PDF** | `src\app\(dashboard)\procurement\page.tsx` | `handleExportPDF()` L34–37 | header L58–68 (label L67) | jsPDF (landscape) |
| 24 | **Backup Audit Report** (file export) | `src\app\(dashboard)\settings\backups\page.tsx` | `generateERPReportPDF({… autoPrint:false})` L284–297 | onClick L283 (label L301) | jsPDF |
| 25 | **Backup Audit Printout** (auto-print) | same page | `generateERPReportPDF({… autoPrint:true})` L307–319 | onClick L306 (label L323) | jsPDF → print dialog |

---

## TABLE B — Print / PDF library files

### B1. `src\lib\voucher-print.ts` (423 lines) — System B

| Line | Export | Role |
|---|---|---|
| 12 | `type VoucherKind` | `"RECEIPT" \| "PAYMENT" \| "JOURNAL"` |
| 14 | `interface VoucherPrintLine` | Dr/Cr line shape |
| 27 | `interface VoucherPrintData` | print payload |
| 49 | `VOUCHER_TITLES` (private) | En + Urdu titles |
| 55 | `PAYMENT_MODE_BY_TYPE` (private) | CPV/PPV/BPV/SPV → account label |
| **93** | `generateVoucherHTML(data)` | A4 bilingual voucher doc (banner L136, meta L170, Dr/Cr table L238–252, amount-in-words L254, 3 signatures L265) |
| **282** | `printVoucher(data)` | print trigger — Tauri L294 → iframe L301–330 → `print()` L317 |
| **334** | `paymentVoucherPrintData(v, opts)` | Payment Voucher → print shape |
| **368** | `receiptVoucherPrintData(v, opts)` | Receipt Voucher → print shape |
| **403** | `journalVoucherPrintData(input)` | Journal → print shape — ⚠️ no importers (§6.2) |

### B2. `src\lib\statement-print.ts` (353 lines) — System B

| Line | Export | Role |
|---|---|---|
| 26 / 35 / 46 | `StatementTarget` / `StatementRow` / `StatementHTMLInput` | types |
| 64 / 85 / 115 / 141 | `formatStatementDate` / `cleanStatementDescription` / `displayBillNo` / `statementTitleFor` | helpers |
| **149** | `generateStatementHTML(input)` | A4 party/account statement (banner L223, table L314, closing L342); `@page A4` L284 |

### B3. `src\lib\pdf-exporter.ts` (2661 lines) — System A (jsPDF)

**Private infra:** `createReportDoc` L63 · `drawCompanyLogo` L68 · `drawReportHeader` L86 · `drawReportFooter` L143 · `outputReport` **L277** (blob iframe L291–341, `print()` L323) · `saveReportOnDesktop` L345 · `urduCellHooks` L399 · `drawKpiTiles` L817 · `drawBilingualTable` L2245

| Line | Export | Document |
|---|---|---|
| 378 | `interface PDFExportOptions` | options |
| **466** | `generateERPReportPDF(opts)` | generic report engine (#20/#21/#13/#23/#24/#25) |
| **529** | `exportProductsToPDF` | Sanitary Product Catalog |
| **581** | `exportProductToPDF` | Stock Card `<SKU>` |
| **726** | `exportPartiesToPDF` | CRM Contacts |
| **875** | `exportLabourReportPDF` | Labour Report (register, attendance, tasks, loans) |
| **1224** | `exportWorkerPayslipPDF` | Payslip (1 page) |
| **1502** | `exportGatePassesToPDF` | Inward Gate Passes (landscape) |
| **1944** | `exportLedgerReportPDF` | General Ledger Report (journal+TB+P&L+BS) |
| **1985** | `exportJournalPDF` | Journal |
| **2023** | `exportJournalEntryPDF` | Journal Entry `<no>` |
| **2114** | `exportTrialBalancePDF` | Trial Balance |
| **2146** | `exportProfitLossPDF` | Profit & Loss |
| **2185** | `exportBalanceSheetPDF` | Balance Sheet |
| **2326** | `exportPaymentVouchersToPDF` | Payment Vouchers list (bilingual) |
| **2387** | `exportPaymentVoucherPDF` | one Payment Voucher (signable, bilingual) |
| **2531** | `exportPartyLedgerPDF` | Individual Ledger Statement |

### B4. `src\lib\pdf-urdu.ts` — Urdu support for A + B

`URDU_FONT` L13 · `ensureUrduFont()` L49 · `drawUrdu()` L72 · `splitUrdu()` L91 · `numberToUrduWords()` L143 · `formatUrduDate()` L166 · `formatUrduAmount()` L173 · UR dictionary L179 · `URDU_HTML_STYLES` **L478** (injected into every System-B HTML doc)

### B5. HTML printers inside `src\lib\supabase\*`

| File | Line | Export | Document |
|---|---|---|---|
| `invoicing.ts` | **987** | `generateInvoiceHTML(invoice, opts)` | Sales Tax Invoice A4 bilingual (`@media print` L1132) |
| `invoicing.ts` | **1200** | `triggerPrint(invoice)` | Tauri → iframe print (L1233) |
| `catalog.ts` | **621** | `generateSlipInvoiceHTML(invoice)` | 80 mm thermal slip (`@page 80mm` L632) |
| `catalog.ts` | **698** | `triggerSlipPrint(invoice)` | → `printPdfDocument("POS-80-Thermal")` L703 |
| `crm.ts` | **622** | `generatePartyLedgerHTML(party, ledger, o)` | Party ledger A4 (`@page A4` L684) |

### B6. `src\lib\tauri-bridge.ts`

| Line | Export | Behaviour |
|---|---|---|
| 16 | `getHardwareNodeId()` | node id |
| **27–74** | `printPdfDocument(printerName, pdfBase64)` | web: blob iframe `print()` L50 · desktop: `invoke("plugin:printer\|print_pdf")` L63 |

### B7. Support helpers (branding / translation)

| File | Line | Export | Role |
|---|---|---|---|
| `src\lib\company-settings.ts` | 48/54/66/77 | `getExportCompanyName`, `getExportDocumentTitle`, `getCompanyLogoHtml`, `getCompanyLogoDataUrl` | branding of every print |
| `src\lib\branding.ts` | 1–5 | `COMPANY_HEADER`, `SERIF_FONT_FAMILY_CSS(_PDF)` | fonts/banner |
| `src\lib\report-i18n.ts` | 93/131 | `buildTranslatedAccountMap`, `accountUrdu` | Urdu account names in ledger PDFs |
| `src\lib\geminiTranslator.ts` | 334 | `translateBatchToUrdu` | Urdu narrations for invoice/statement prints |
| `src\lib\backup-exporter.ts` | 4/39 | `exportBackupData`, `fallbackWebDownload` | JSON backup (not a print form) |
| `src\lib\supabase\backup.ts` | 101 | `downloadBackup` | JSON backup download |

---

## CONNECTIONS — import / data flow

### 1. Payment vouchers
```
src\app\(dashboard)\payment-vouchers\page.tsx
 ├─ L9    fetchPaymentVouchers()          ← src\lib\supabase\payment-vouchers.ts  (data)
 ├─ L16   exportPaymentVouchersToPDF, exportPaymentVoucherPDF ← src\lib\pdf-exporter.ts
 │          ├─ handleExportList()    L92  → exportPaymentVouchersToPDF() L96   [header btn L164]
 │          └─ handleExportVoucher() L102 → exportPaymentVoucherPDF()   L106
 ├─ L17   paymentVoucherPrintData, printVoucher ← src\lib\voucher-print.ts
 │          └─ handlePrintVoucher() L112 → printVoucher(paymentVoucherPrintData(v)) L116
 └─ L302  <PaymentVoucherList onExport={handleExportVoucher} L306 onPrint={handlePrintVoucher} L307>

src\components\modules\payment-vouchers\PaymentVoucherList.tsx (props onExport L10, onPrint L11)
 ├─ "Print" L73–85 (onClick L75) → page.handlePrintVoucher()
 └─ "PDF"   L86–98 (onClick L88) → page.handleExportVoucher()

EDGE: page → PaymentVoucherList → voucher-print.ts#printVoucher() L282 → generateVoucherHTML() L93
EDGE: page → pdf-exporter.ts#exportPaymentVouchersToPDF() L2326 / #exportPaymentVoucherPDF() L2387
```

### 2. Receipts (Mode B)
```
src\app\(dashboard)\invoicing\receipts\page.tsx
 ├─ L6–14  fetchReceiptVouchers()/fetchCustomers()/fetchInvoices() ← supabase\receipt-vouchers.ts, supabase\invoicing.ts
 ├─ L25    printVoucher, receiptVoucherPrintData ← src\lib\voucher-print.ts
 │          └─ handlePrint(v) L174 → printVoucher(receiptVoucherPrintData(v)) L179–181
 └─ row "Printer" button L477–484 (onClick L478)

EDGE: receipts/page → voucher-print.ts#receiptVoucherPrintData() L368 → printVoucher() L282 → generateVoucherHTML() L93
```

### 3. Sales invoicing (invoice / post-print / OGP / thermal slip)
```
src\app\(dashboard)\invoicing\page.tsx
 ├─ L7   generateSlipInvoiceHTML, triggerSlipPrint, fetchInvoicesWithDispatch ← supabase\catalog.ts
 ├─ L11  PostPrintDrawer      ← src\components\modules\invoicing\PostPrintDrawer.tsx
 ├─ L12  InvoicePreviewDrawer ← src\components\modules\invoicing\InvoicePreviewDrawer.tsx
 ├─ L13  OutwardGatePass      ← src\components\modules\invoicing\OutwardGatePass.tsx
 │
 ├─ InvoicesTable "View" L50 → handleView()   L116 → <InvoicePreviewDrawer> L333
 │              "Post" L85 → handlePost()     L110 → <PostPrintDrawer>      L325
 ├─ handlePosted() L156 → <OutwardGatePass> L340
 └─ DispatchInvoicesTable onSlipClick L293 (row btn L569) → <SlipInvoiceModal> L362–367
      ├─ handlePrint()        L609 → triggerSlipPrint() L612 → catalog.ts L698 → tauri-bridge.printPdfDocument("POS-80-Thermal") L703
      └─ handleBrowserPrint() L621 → generateSlipInvoiceHTML() L622 → iframe L623–643
         buttons: "Print Thermal" L720, "Print / Save PDF" L727

InvoicePreviewDrawer.tsx  handlePrint() L54 → generateInvoiceHTML() (invoicing.ts L987) L68 → iframe → print() L84   [btn L244–250]
PostPrintDrawer.tsx       handlePostAndPrint() L33 → triggerPrint() (invoicing.ts L1200) L109
                          handleRetryPrint()   L130 → triggerPrint() L137
                          handlePDFExport()    L158 → generateInvoiceHTML() L161 → iframe L162–182
                          buttons: L273–279 / L282–287 / L290–296
OutwardGatePass.tsx       handlePrintInvoice() L20 → generateInvoiceHTML() L22 → iframe → print() L38   [btn L232]
                          handlePrint()        L46 → own OGP HTML L54–136 → print() L152               [btn L229]

EDGE: invoicing/page → DispatchInvoicesTable → SlipInvoiceModal → supabase\catalog.ts#triggerSlipPrint() L698 → tauri-bridge.ts#printPdfDocument() L27
EDGE: invoicing/page → InvoicesTable → InvoicePreviewDrawer → supabase\invoicing.ts#generateInvoiceHTML() L987
EDGE: invoicing/page → InvoicesTable → PostPrintDrawer → supabase\invoicing.ts#triggerPrint() L1200
EDGE: invoicing/page L156 → OutwardGatePass → supabase\invoicing.ts#generateInvoiceHTML() L987
```

### 4. Ledger / statements
```
src\app\(dashboard)\ledger\page.tsx
 ├─ L6–15  fetchAccounts/fetchJournalEntries/fetchFinancialStatements ← src\lib\supabase\ledger.ts
 ├─ L19–26 exportLedgerReportPDF, exportJournalPDF, exportJournalEntryPDF,
 │          exportTrialBalancePDF, exportProfitLossPDF, exportBalanceSheetPDF ← src\lib\pdf-exporter.ts
 │          ├─ handleExportPDF()     L166 [header btn L399]
 │          ├─ handleExportSection() L172 [SectionExportBar L450, L581, L842, L914]
 │          └─ per-entry exportJournalEntryPDF() L521 [row btn L519]
 ├─ L36    fetchParties ← src\lib\supabase\crm.ts
 ├─ L37–44 statement helpers ← src\lib\party-statement.ts
 └─ L45    IndividualLedgerModal (rendered L1044, target set L771)

src\components\modules\ledger\IndividualLedgerModal.tsx
 ├─ L7  exportPartyLedgerPDF ← src\lib\pdf-exporter.ts  (handleExportPDF() L501–528, btn L579–588)
 ├─ L12 generateStatementHTML ← src\lib\statement-print.ts (handlePrintStatement() L418–498, print() L486, btns L566–576/L824)
 └─ L5  translateBatchToUrdu ← src\lib\geminiTranslator.ts (L426)

EDGE: ledger/page → pdf-exporter.ts#exportLedgerReportPDF L1944 / #exportJournalPDF L1985 /
                     #exportJournalEntryPDF L2023 / #exportTrialBalancePDF L2114 /
                     #exportProfitLossPDF L2146 / #exportBalanceSheetPDF L2185
EDGE: ledger/page → IndividualLedgerModal → statement-print.ts#generateStatementHTML() L149
EDGE: ledger/page → IndividualLedgerModal → pdf-exporter.ts#exportPartyLedgerPDF() L2531
```

### 5. CRM
```
src\app\(dashboard)\crm\page.tsx
 ├─ L4–15 fetchParties/…/generatePartyLedgerHTML ← src\lib\supabase\crm.ts
 ├─ L17   exportPartiesToPDF ← src\lib\pdf-exporter.ts (handleExportPDF() L91–98, header L165–175)
 └─ handleExportLedger() L100 → generatePartyLedgerHTML() L106 → iframe → print() L122
     └─ per-row "Export PDF" L283–290

EDGE: crm/page → supabase\crm.ts#generatePartyLedgerHTML() L622
EDGE: crm/page → pdf-exporter.ts#exportPartiesToPDF() L726
```

### 6. Labour / payroll
```
src\app\(dashboard)\labour\page.tsx
 ├─ L26 exportLabourReportPDF ← src\lib\pdf-exporter.ts
 │       handleExportPDF() L177–194 (call L182) · header btn L223–231
 └─ L374 <SalaryCard …>

src\components\modules\labour\SalaryCard.tsx
 └─ L13 exportWorkerPayslipPDF ← src\lib\pdf-exporter.ts
         handlePrint() L81–89 (call L85) · "Print" btn L120–130

⚠ payroll\page.tsx has NO print/export code.
⚠ payroll\PayslipPrintTemplate.tsx is unreferenced (§6.1).

EDGE: labour/page → pdf-exporter.ts#exportLabourReportPDF() L875
EDGE: labour/page → SalaryCard → pdf-exporter.ts#exportWorkerPayslipPDF() L1224
```

### 7. Catalog / inventory / procurement / settings
```
catalog\page.tsx            L11 exportProductsToPDF   → handleExportPDF() L91  → btn L128
inventory\page.tsx          L13 {exportProductsToPDF, exportProductToPDF}
                            handleExportPDF() L102 → btn L144
                            handlePrintProduct() L110 → row btn L329
procurement\page.tsx        L8  exportGatePassesToPDF → handleExportPDF() L34–37 → btn L58–68
settings\backups\page.tsx   L18 generateERPReportPDF → export L284–297 (btn L283) / print L307–319 (btn L306)

EDGE: catalog / inventory / procurement / settings\backups → pdf-exporter.ts#generateERPReportPDF() L466
EDGE: inventory → pdf-exporter.ts#exportProductToPDF() L581 (Stock Card)
EDGE: procurement → pdf-exporter.ts#exportGatePassesToPDF() L1502 (IGP)
```

### 8. Cross-cutting edges
```
pdf-exporter.ts        → pdf-urdu.ts (#drawUrdu L72, UR dict L179, #ensureUrduFont L49), company-settings.ts, report-i18n.ts
voucher-print.ts       → pdf-urdu.ts (#URDU_HTML_STYLES L478), invoke("print_html_document") L294
statement-print.ts     → pdf-urdu.ts (#URDU_HTML_STYLES L478), geminiTranslator.ts
supabase\invoicing.ts  → pdf-urdu.ts, tauri-bridge.ts
supabase\catalog.ts    → tauri-bridge.ts (#printPdfDocument L27, "POS-80-Thermal" L703)
supabase\crm.ts        → pdf-urdu.ts
OutwardGatePass / InvoicePreviewDrawer / PostPrintDrawer → supabase\invoicing.ts (#generateInvoiceHTML L987, #triggerPrint L1200)
```

### Print button quick index (list components)

| Component | Print/PDF UI |
|---|---|
| `PaymentVoucherList.tsx` | "Print" L73–85, "PDF" L86–98 (props `onExport` L10, `onPrint` L11) |
| `invoicing\receipts\page.tsx` | Printer icon L477–484 |
| `InvoicesTable.tsx` | "View" L50 (→ preview drawer), "Post" L85 (→ post & print) |
| `DispatchInvoicesTable` (in `invoicing\page.tsx`) | slip row click L569 → thermal modal |
| `crm\page.tsx` rows | "Export PDF" party ledger L283–290 |
| `inventory\page.tsx` rows | "PDF" stock card L328–338 |
| `ledger\page.tsx` rows | "PDF" journal entry L517–521 |
| `SalaryCard.tsx` | "Print" payslip L120–130 |
| `IndividualLedgerModal.tsx` | "Print Statement" L566–576/L824, "Export PDF" L579–588 |

---

## Print CSS & hidden print-preview containers

### `src\app\globals.css`

| Lines | Rule |
|---|---|
| 557–561 | `@page { size: A4 portrait; margin: 0; }` |
| 563–608 | `@media print`: white bg L572, body padding L579, kill link hrefs L584 |
| 588–594 | hides `.no-print, nav, header, aside, button:not(.allow-print)` |
| 596–607 | `.payslip-container` page-break rules |

### Inline `@media print` inside generated documents

| File | Lines |
|---|---|
| `src\lib\voucher-print.ts` | L159, L209–214 |
| `src\lib\statement-print.ts` | L215, `@page A4` L284–289 |
| `src\lib\supabase\invoicing.ts` | L1089, L1132–1135 |
| `src\lib\supabase\catalog.ts` | `@page 80mm auto` L632 |
| `src\lib\supabase\crm.ts` | `@page A4` L684 |
| `src\lib\pdf-urdu.ts` | `URDU_HTML_STYLES` L478 (injected everywhere) |

### Hidden iframe print containers (created at runtime)

| File | Lines |
|---|---|
| `src\lib\voucher-print.ts` | L303–330 |
| `src\lib\supabase\invoicing.ts` | L1219–1242 |
| `src\lib\pdf-exporter.ts` | L291–341 (blob URL) |
| `src\lib\tauri-bridge.ts` | L39–56 (blob URL) |
| `InvoicePreviewDrawer.tsx` | L69–89 |
| `PostPrintDrawer.tsx` | L162–182 |
| `OutwardGatePass.tsx` | L23–43, L137–157 |
| `IndividualLedgerModal.tsx` | L463–497 (blanks `document.title` L481–484) |
| `crm\page.tsx` | L107–127 |
| `invoicing\page.tsx` (SlipInvoiceModal) | L623–643 |

### Visible print-preview UI

| File | Lines | What |
|---|---|---|
| `PayslipPrintTemplate.tsx` | L80 | A4 payslip sheet modal (orphan) |
| `invoicing\page.tsx` | L664–709 | 300 px thermal receipt preview |
| `InvoicePreviewDrawer.tsx` | L114–223 | in-drawer tax invoice preview |
| `OutwardGatePass.tsx` | L160–241 | OGP summary modal |

---

## Routes — print views

**None exist.** No `src/app/print/**`, no `?print=1` query-param usage anywhere.
All printing is triggered from normal dashboard pages via buttons listed in Table A.
Only PDF library: `jspdf` + `jspdf-autotable` (`package.json` L31–32) — no html2canvas.

---

## §6 Dead code / known issues (edit candidates)

1. **`PayslipPrintTemplate.tsx` is orphaned** — zero imports; live payslip path is `labour\page.tsx L374 → SalaryCard.tsx L81 → exportWorkerPayslipPDF()`.
2. **`journalVoucherPrintData()`** (`voucher-print.ts` L403) — exported, never imported (journal entries only PDF-exported from `ledger\page.tsx` L521).
3. **`printCopies` setting unused** — `settings\page.tsx` L36/L86/L437–438 defined but no consumer; every print sends 1 copy.
4. **Native print commands not registered** — `src-tauri\src\lib.rs` only exposes `get_hardware_node_id`; no `tauri-plugin-printer` in `Cargo.toml`. `print_html_document` (`voucher-print.ts` L294, `invoicing.ts` L1209) and `plugin:printer|print_pdf` (`tauri-bridge.ts` L63) always throw → caught by fallbacks → **all printing actually runs through the browser/iframe path** (including POS-80 thermal).
5. **`autoPrint` flag is a no-op** in `pdf-exporter.ts` (documented L263–274) — every jsPDF export opens the print dialog regardless.
6. **No GRN / challan / quotation / delivery-note print forms exist** — gate-pass printing is split into IGP list PDF (`procurement\page.tsx` L34) and OGP (`OutwardGatePass.tsx` L46).
