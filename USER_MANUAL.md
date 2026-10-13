# Glassco ERP — Complete User Manual

**Plain-English guide. No jargon left unexplained.**
*Version 2.0 · Covers every screen in the app · Read time ≈ 45 minutes*

---

## How to use this manual

- **Just want to use the app?** Read Part 1 → Part 3 → Part 5 (your module) → Part 6 (recipes).
- **Installing it for the first time?** Read Part 1 → Part 2 → Part 4.
- **Curious how money/accounting works?** Part 7 and Part 8.
- **Something broke?** Go straight to Part 10 (Troubleshooting) and Part 12 (Known quirks).
- **Every button and screen name in this book is exactly what you see in the app**, so you can search for it.

---

# PART 1 — What is this software?

## 1.1 The 10-year-old explanation

Imagine a factory that makes taps, pipes and bathroom fittings. Every day, **10 kinds of paper** pile up on desks:

| Paper pile | What it asks |
|---|---|
| Gate register | "Which truck came in? What material?" |
| Store register | "How much raw material is in the godown?" |
| Purchase bill file | "How much do we owe the supplier?" |
| Sales bill book | "What did we sell the customer?" |
| Cash book | "How much cash is in the drawer?" |
| Ledger | "What did we spend and earn?" |
| Attendance register | "Who came to work?" |
| Salary sheet | "Who gets paid how much?" |
| Quality report | "Was this batch good?" |
| Production diary | "How much did we make today?" |

**This app is all ten of those papers, glued into one screen.**

It is called an **ERP** (Enterprise Resource Planning). Think of it as *the factory's brain*: every department writes into the same notebook, so when Sales writes something, Accounts can see it instantly — nobody re-types anything.

## 1.2 The three characters in the story

1. **Material** — raw stuff comes in the gate, is stored, becomes finished goods, then goes out to customers.
2. **Money** — we pay suppliers and workers, customers pay us, and every rupee is written down twice (once as *debit*, once as *credit*) so nothing vanishes.
3. **People** — workers attend, get salaries, take loans; users log in and leave their name on every action.

## 1.3 "Node" and "Terminal" — what do those words mean here?

The app is designed to run on **several computers at once** (counter PC, warehouse tablet, office laptop). Each computer is called a **node** or **terminal**. The top bar shows which node you are on, like `WEB-NODE: Counter Node 1`.

There are two kinds of users:

| You log in as | Shown as | You are |
|---|---|---|
| The owner account | `OWNER (REMOTE)` (red badge) | The boss — can do everything, including adding money |
| A node account (1 of 4) | `WEB-NODE: <name>` | A staff terminal — can do everything except a couple of owner-only things |

## 1.4 What the app is *not*

- It is **not** connected to a bank — "payment" means *we recorded* a payment, not that money physically moved.
- It does **not** automatically send anything to the tax authority (FBR). It prepares the numbers; a human files them.
- It is **not** multi-language for the whole screen (English). Only some PDFs can be printed bilingually (English + Urdu) if a translation key is set up.

---

# PART 2 — Getting started (install & first run)

## 2.1 For a person who just wants to *use* it

1. Open the app (browser, or the desktop icon if it was installed).
2. You land on the **login screen** ("Authentication Terminal v2.0").
3. Click one of the **Quick Select Terminal** buttons — they fill in your email and password for you:
   - **Owner Remote Sign-In** (badge: ADMIN)
   - **Node 1 — Main Counter**
   - **Node 2 — Counter 2**
   - **Node 3 — Warehouse**
   - **Node 4 — Office**
4. Press **AUTHENTICATE**.
5. You arrive at the **Dashboard**.

> **Tip:** the demo passwords are built into those buttons, so you never need to type them. Ask your administrator for your own real credentials.

**Other ways to sign in:** type your email + password manually under "OR SIGN IN MANUALLY", then press AUTHENTICATE.

**To log out:** click your name/badge at the top right → **Sign Out** (or Settings → **Logout**).

## 2.2 First-time setup (10 minutes, do it once)

Go to **Settings** (bottom of the left menu) and fill the **Company Profile** tab:

- Company Name, Address, Phone, Email
- **NTN / STRN** (your tax numbers — they print on invoices)
- **Company Logo** (PNG/JPG/SVG, max 2 MB) — drag and drop it

Press **Save Changes**.

> ⚠️ **Important:** this company profile is saved **in this browser/computer only** (it is stored locally). If you log in on a second computer, set the profile there too. See Part 12.

Then check the money accounts are right:

1. Open **Ledger / Accounts** → tab **Accounts**.
2. You should see the chart of accounts (1000 Cash in Hand, 1002 Bank, 1100 Accounts Receivable, 1101 Raw Material, 2001 Accounts Payable, 5100 Sales, …).
3. If anything is missing you can add it with **+ Add Account** (Part 5.6).

## 2.3 For the person who *installs* it (developer / IT)

**What you need:** Node.js 20+, npm, and the Supabase project details (URL + anon key) from the project owner.

```bash
npm install
# create .env.local with the keys listed below
npm run dev          # opens http://localhost:3000 → redirects to /login
```

**`.env.local` keys** (names only — values come from the project owner):

| Key | What it is for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Where the database lives. Without it the app shows empty/zero screens. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The public key the browser uses to talk to that database. |
| `NEXT_PUBLIC_MASTER_APP_PIN` | 4-digit master PIN (its keypad screen exists but is not wired up yet — see Part 12). |
| `GEMINI_API_KEY` / `NEXT_PUBLIC_GEMINI_API_KEY` | Optional. English→Urdu translation for bilingual PDFs. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, server-side only. Not required for normal use. |

**Database:** the schema lives in `supabase/schema-consolidated.sql` (run once in the Supabase SQL Editor on a fresh project), with 60+ incremental files in `supabase/migrations/`. Seed/demo data is in `supabase/migrations/99_seed_demo_data.sql`.

**Build commands:**

| Command | Result |
|---|---|
| `npm run build` | Static website written to the `out/` folder |
| `npm run lint` | Code style check |
| `npm run tauri:build` | Windows desktop app (`.exe`) — needs Rust + Tauri tools |

---

# PART 3 — The Big Picture: how everything links together

## 3.1 The journey of one order (follow the arrows)

```
   ┌─────────────── BUYING MATERIAL ───────────────┐
   │  CRM            (who is the supplier?)        │
   │    ↓                                           │
   │  In / Out Gate  ➜ truck arrives → "+ New Intake"│
   │    ↓            (IGP)                          │
   │  Generate GRN   ➜ creates GRN + Purchase Invoice│
   │    ↓                                           │
   │  Pending Vendor Invoices → "Approve & Post"    │
   │    ↓                 (DR 1101 Inventory,       │
   │    │                  CR 2001 We-Owe-Supplier) │
   │  Payables (AP)   ➜ watch what we owe           │
   └───────────────────────────────────────────────┘

   ┌─────────────── MAKING GOODS ──────────────────┐
   │  Product Catalog / Bill of Materials / Formulas│
   │    ↓                                           │
   │  Production Orders ➜ "Finish Batch" → new lot  │
   │  Formulas         ➜ "Execute Batch Production" │
   │    ↓                 (uses raw material)       │
   │  Quality Control  ➜ PASSED / QC-FLAGGED        │
   │  Inventory        ➜ quantity on hand           │
   │  Stock Transfers  ➜ move goods WH-01 → WH-02   │
   └───────────────────────────────────────────────┘

   ┌─────────────── SELLING & GETTING PAID ────────┐
   │  CRM             (who is the customer?)        │
   │    ↓                                           │
   │  Dispatch / Sales ➜ "+ New Invoice" → Post     │
   │    ↓                (DR 1100 Customer,          │
   │    │                 CR 5100 Sales + 2200/2210 tax)│
   │    └─ deducts stock from Inventory             │
   │  Customer Receipts (AR) ➜ "Record Customer Payment"│
   │    ↓                (DR Cash/Bank, CR 1100)    │
   └───────────────────────────────────────────────┘

   ┌─────────────── SPENDING & PAYING PEOPLE ──────┐
   │  Payment Vouchers ➜ Cash/Bank/Party payments   │
   │  Labour           ➜ attendance, loans          │
   │  SalaryCard       ➜ "Pay Salary" (SPV voucher) │
   │  Payroll          ➜ monthly salary sheet       │
   └───────────────────────────────────────────────┘

   ┌─────────────── THE REPORTING ROOM ────────────┐
   │  Ledger / Accounts                             │
   │   Journal · Trial Balance · P&L · Balance Sheet│
   │   Accounts (chart of accounts)                 │
   │  Dashboard  ➜ money, stock, profit, live audit │
   └───────────────────────────────────────────────┘
```

**Rule of thumb:** *whichever screen you start on, the money always ends up in **Ledger / Accounts**, and the stock always ends up in **Inventory**.*

## 3.2 The menu, in the order you see it

The left sidebar has **18 items** (plus Settings at the bottom). Some menu names differ from the page title — this table fixes that confusion:

| # | Menu label (what you click) | Page title / URL | One-line purpose |
|---|---|---|---|
| 1 | **Dashboard** | `/dashboard` | The boss's summary: money, stock, people, profit, live activity |
| 2 | **CRM** | `/crm` | Address book of customers & suppliers + their statements |
| 3 | **Dispatch / Sales** | `/invoicing` | Make, post and print sales invoices |
| 4 | **Customer Receipts (AR)** | `/invoicing/receipts` | Record money customers pay us; see who is late |
| 5 | **Payment Vouchers** | `/payment-vouchers` | Record money we pay out (cash, bank, party, salary) |
| 6 | **Ledger / Accounts** | `/ledger` | All accounting: journal, trial balance, P&L, balance sheet |
| 7 | **In / Out Gate** | `/procurement` | Trucks coming in; create GRNs from gate passes |
| 8 | **Payables Ledger (AP)** | `/procurement/payables` | Purchase invoices waiting for approval + what we owe |
| 9 | **Inventory** | `/inventory` | Stock levels, low-stock alerts, dispatch from stock |
| 10 | **Stock Transfers** | `/inventory/transfers` | Move stock between warehouses |
| 11 | **Product Catalog** | `/catalog` | The product list (prices, categories) |
| 12 | **Production Orders** | `/production` | Factory work orders: make X of product Y |
| 13 | **Bill of Materials** | `/bom` | "What parts go into one finished product" |
| 14 | **Formulas / Recipes** | `/formulas` | Recipe engine + one-click batch production |
| 15 | **Quality Control (QC)** | `/qc` | 3-stage inspection; flag bad lots |
| 16 | **Labour / HR** | `/labour` | Workers, attendance, tasks, loans, paying salary |
| 17 | **Payroll** | `/payroll` | Monthly salary run and payslips |
| 18 | **Settings** | `/settings` | Company profile, vouchers, users, logout |

**Two pages are not in the menu** (type the address in the browser):

| URL | What it is |
|---|---|
| `/loans` | Loan register & repayment schedule (same data as Labour → **Loan Ledger**) |
| `/settings/backups` | Database backup & export screen |

---

# PART 4 — Every screen explained

> For each screen: **What it's for → What you see → Buttons → What happens next.**

## 4.1 Dashboard (`/dashboard`)

**For:** the boss, at a glance.
**Cards:** Available Funds (cash + bank split), Total Inventory Stock Value, Total Employees, Active Live Devices (x/4), Net Profit Balance.
**Charts:** profit over Day/Week/Month, and a product histogram.
**Live feed table:** Terminal Node · Operator · Module · Action · Timestamp — everything anyone just did.
**Buttons:** owners see **+ Add Funds** on the Available Funds card (record money the owner injects into the business).

## 4.2 CRM (`/crm`)

**For:** keeping every buyer and supplier in one place, and seeing what each of them owes or is owed.
**Buttons:** **+ Add New Contact**, **Export PDF**, filter tabs *All / Buyers / Suppliers*, search.
**Table:** Name, Type, Phone, Email, Address, Actions (**Details, Edit, Export PDF**, delete).
**Details drawer** shows Contact Info, Financial Summary, and a **party Ledger** (Date, Doc. No, Details, Debit, Credit, Balance) with quick links to Invoicing and Procurement.
**Link:** customers created here appear in sales invoices; suppliers appear in gate passes and purchase invoices.

## 4.3 Dispatch / Sales (`/invoicing`) — the sales hub

**For:** creating sales invoices, posting them to the ledger, printing them, and watching dispatches.
**Tabs:** **Sales Invoices** · **Dispatch Invoices (n)** · **Pending Vendor Invoices (n)** (that last tab links to `/invoicing/pending`).
**KPIs:** Total Invoices, Draft, Posted Revenue, Total Tax Collected.
**Buttons:** **Backup Data** (exports dispatch records as JSON), **+ New Invoice**.
**Table columns:** Invoice #, Customer, Taxable, Tax, Total, Status (Posted/Draft), Actions → **Edit**, **Post**, click row to view.

**How to post correctly (important):**

- On the invoice row, click **Post** → the *Post & Print* drawer opens → press **Post & Print**.
  This does **everything**: marks it posted, writes the ledger entry (**DR 1100 Customer · CR 5100 Sales + 2200 Sales Tax + 2210 Further Tax**), **takes the stock out of Inventory**, records a dispatch, and prints.
- The *view* drawer also has a **Post Invoice** button. That one posts **only the ledger entry** — it does **not** move stock. Use the row **Post** button in normal work.

## 4.4 Pending Vendor Invoices (`/invoicing/pending`)

**For:** the accountant's approval queue for supplier bills (3-way match: gate pass ↔ GRN ↔ invoice).
**KPIs:** Pending, Blocked Variance, Total Pending Value, *Ledger Status: Strictly Isolated*.
**Table:** GRN #, Vendor, Qty, Unit Price, Payable, **3-Way Match** (Matched / Blocked Variance), Status, Actions.
**Buttons per row:** **Approve & Post** (confirmation shows `DEBIT → 1101` and `CREDIT → 2001`) and **Dismiss** (throws the invoice away, no ledger entry).
**Rule:** if the match has a *variance* (price/qty mismatch), the button is replaced by **"Manager Required"** — a terminal user cannot approve it; only the owner/manager can.

## 4.5 Customer Receipts / AR (`/invoicing/receipts`)

**For:** recording money customers pay us, and spotting late payers.
**KPIs:** Total Collected, Total AR Outstanding, Over 90 Days Overdue.
**Tabs:** **Receipt Vouchers (n)** · **AR Aging Analysis** (Current 0-30d, 31-60, 61-90, 90+ days per customer).
**Buttons:** **Record Customer Payment** → modal with Customer, Receipt Date, Amount, Payment Mode (Bank Transfer / Cash in Hand / Cheque / Online), Reference, Remarks → **Post Receipt Voucher** (or **Update Receipt Voucher** when editing).
**Accounting effect:** DR Cash/Bank · CR 1100 Accounts Receivable — i.e. the customer's debt shrinks.
**Row actions:** edit (pencil), delete (trash).

## 4.6 Payment Vouchers (`/payment-vouchers`)

**For:** every rupee going *out* — cash, bank, supplier, or salary.
**Voucher types:** **CPV** Cash Payment · **BPV** Bank Payment · **PPV** Party Payment · **SPV** Salary Payment.
**Buttons:** **+ Cash Payment**, **+ Bank Payment**, **+ Party Payment**, **Export PDF** (bilingual EN/UR).
**Tabs:** All / Cash (CPV) / Bank (BPV) / Party (PPV) / Salary (SPV); search by voucher #, payee or purpose.
**Row actions:** **Download PDF** (bilingual), **Edit**, **Delete**.
**Accounting effect:** DR the account you chose · CR 1000 Cash or 1002 Bank — and a journal entry is created automatically.

## 4.7 Ledger / Accounts (`/ledger`) — the accounting room

**Tabs:** **Journal** · **Trial Balance** · **P&L** · **Balance Sheet** · **Accounts**.

- **Journal** — every double entry as a card (entry #, date, POSTED/DRAFT badge, **PDF**). Drafts have **Edit** and **Post**; posted entries cannot be edited. Lines show Account, Debit, Credit.
- **Trial Balance** — Code, Account, Type, Debit, Credit, and **View Ledger** per row (opens a printable statement with date filters: All / This Month / Last 30 Days / This Quarter / This Year).
- **P&L** — Revenue, Expenses, **Net Profit** (green = profit, red = loss).
- **Balance Sheet** — Assets, Liabilities, Equity + Profit, with a **BALANCED / OUT OF BALANCE** check bar.
- **Accounts** — the **Chart of Accounts** manager: **+ Add Account** (Code, Name, Type = Asset/Liability/Equity/Revenue/Expense), row **Edit** / **Del**.

**Top buttons:** **+ New Entry** (creates a draft journal entry: date, remarks, party, DR/CR lines) and **Export PDF**; each tab also has its own export icon.
**Available Funds card:** shows live cash+bank (sum of debits minus credits); owners get **+ Add Funds** (capital injection: DR cash/bank, CR 3000 Owner Equity).

## 4.8 In / Out Gate (`/procurement`) — material coming in

**For:** the gate register. Every truck that enters gets a Gate Pass (IGP); one click turns it into a GRN + a pending purchase invoice.
**Stat cards:** Pending Inspection, Converted to GRN, Rejected.
**Table:** IGP Code, Material, Party/Vendor, Vendor Lot, Inward Qty, Status, Date, Action.
**Row buttons:** **Generate GRN** (only when status is `PENDING_INSPECTION`; tooltip: "1-Click GRN & Pending Invoice"), pencil **Edit**, trash **Delete**.
**Creating:** **+ New Intake** opens the "Material Intake & GRN" drawer.
**What Generate GRN creates:** a `goods_receipt_notes` row, a `purchase_invoices` row (status *pending_approval*), and the gate pass becomes `CONVERTED_TO_GRN`. Nothing is booked to accounting yet — that happens at approval (next screen).

## 4.9 Payables Ledger / AP (`/procurement/payables`)

**For:** the supplier-bill desk: what is waiting, what is already booked.
**KPIs:** Pending Invoices, Payable (Pending), Posted to AP, Total AP Posted.
**Tables:** *Vendor AP Summary* (Pending / Posted / Total per vendor) and *Purchase Invoices* with filter chips **All / Pending / Posted to AP** + search.
**Row actions:** **View** (drawer: Invoice Summary, Financials, Line Items), **Approve** (only for `pending_approval` → "Approve & Post to Ledger" modal), or an **In Ledger** badge when posted.
**Accounting effect:** **DR 1101 Raw Material Inventory · CR 2001 Accounts Payable** — we now "owe the supplier".

## 4.10 Inventory (`/inventory`)

**For:** knowing what is in the godown and raising an alert before you run out.
**KPIs:** Total Items, In Stock, Low Stock, Out of Stock.
**Buttons:** **Refresh**, **Export PDF**, **Add Product**; toggle **Low Stock Alerts / Show All**.
**Table:** SKU, Product Name, Category, QOH (quantity on hand), Reorder Lvl, Alert (*OK / REORDER SOON / CRITICAL LOW*), Actions.
**Row actions:** **Edit**, **Dispatch** (disabled at 0 stock → opens Dispatch & Generate Invoice, which reduces stock and creates a dispatch invoice), **PDF** (stock card), delete.

## 4.11 Stock Transfers (`/inventory/transfers`)

**For:** moving goods between warehouses (e.g. WH-01 raw → WH-02 finished).
**KPIs:** Total / Received / In Transit.
**Buttons:** **New Transfer** → Source Warehouse, Target Warehouse, Date, Dispatched By, items, remarks.
**Effect:** stock leaves the source lot and appears as a new lot at the target (FEFO/FIFO rules). **No accounting entry** — stock moved, no money involved.

## 4.12 Product Catalog (`/catalog`)

**For:** the product master: browse by category chip, search by SKU/name/finish, **Export PDF**.
**Row menu (⋮):** **Edit**, **Delete** (delete is blocked if the product has dispatches or sales).
**Link:** products here feed Inventory, Invoicing and Production.

## 4.13 Production Orders (`/production`)

**For:** factory work orders.
**KPIs:** Planned Orders, Completed Batches, Total Units Produced.
**Buttons:** **Create Work Order** (choose BOM/Recipe, target quantity, start date).
**Row actions:** edit, delete, **Finish Batch** (only while `PLANNED`) → creates a finished-goods lot in WH-02 and marks the order `COMPLETED`.
**Note:** *Finish Batch* does **not** eat the raw material from stock (the Formulas screen does — see 4.15).

## 4.14 Bill of Materials (`/bom`)

**For:** the recipe card — what components make one finished product.
**KPIs:** Finished Goods, Active BOMs, Raw Materials.
**Cards:** product name, version badge `v{n}`, component list with quantities. **Compose** (from the product table) opens the BOM drawer: pick raw materials + quantities → Save.

## 4.15 Formulas / Recipes (`/formulas`)

**For:** the batch-production engine with a shortage check.
**Buttons:** **Add Product SKU**, **Create Formula**, **Execute Batch Production**.
**How it helps:** each formula card shows *required vs available* for every material, with a **SHORTAGE** badge. If anything is missing the execute button turns into **"Shortage — Cannot Execute"** — the app refuses to start a batch you cannot finish.
**Effect:** uses raw material from WH-01 (FEFO order) and creates the finished lot.

## 4.16 Quality Control (`/qc`)

**For:** 3-stage inspection — **Raw Material Intake**, **In-Process Machining**, **Packaging & Plating**.
**KPIs:** Passed, Flagged, Total Records.
**Form (right panel):** Lot/Batch, stage parameters (Cu/Zn/Pb/hardness · PSI/thread/porosity · µm/surface finish), Inspector Name, Notes.
**Buttons:** **Submit QC Result**, or **Submit & Flag Lot** (appears when a test failed).
**Important design:** QC is **non-blocking** — a flagged lot gets a crimson **QC-FLAGGED** badge but can still move. The app warns you; it doesn't stop the factory.

## 4.17 Labour / HR (`/labour`)

**For:** workers, attendance, tasks, loans, and paying a salary instantly.
**Buttons:** **+ Add Worker**, **Export PDF**, **Loan Ledger** (modal), month ‹ › pager, view toggle **Calendar / Timesheet**.
**Worker card:** **Edit**, **Delete**, **SalaryCard** (pay now), tabs **attendance / tasks / loans**.
**Attendance:** click a calendar cell → P / A / L (present, absent, leave).
**Loans:** **+ Issue Loan** → deducted automatically from payroll later; **Repay** records a repayment.
**SalaryCard (pay a worker right now):** shows the expense account (5002) and lets you choose Cash (1000) or Bank (1002) → **Pay Salary** creates an **SPV** salary payment voucher **with a ledger entry (DR 5002 · CR 1000/1002)** and a printable payslip. It refuses to pay twice for the same period.

## 4.18 Payroll (`/payroll`)

**For:** the monthly salary engine for everyone at once.
**Buttons:** **Run Payroll** → choose Month + Year → **Run Payroll**.
**Result:** a payroll run (`PAY-YYYY-MM`, status POSTED) and one payslip per worker: Role, Base Salary, Days, Present, Absent, Daily Rate, Earned, Loan Deduction, **Net**.
**Note:** the payroll run produces the *sheet* — it does **not** by itself post a ledger entry. Money actually leaving is recorded through **SalaryCard** or a **Salary (SPV) payment voucher**.

## 4.19 Settings (`/settings`)

**Header:** **Logout**, **Save Changes**.

| Tab | What's in it | Does it save? |
|---|---|---|
| **Company Profile** | Name, address, phone, email, NTN/STRN, logo | ✅ Yes — saved in *this browser* (localStorage), not in the cloud |
| **Financial & Vouchers** | CPV/PPV/BPV prefixes, default cash/bank accounts, print options | ❌ Not yet — display only, resets on reload |
| **User Management** | list of users, role badges, module toggles, **+ Add User** | ❌ Not yet — a preview screen; real users are created in Supabase Auth |

## 4.20 Backups (`/settings/backups`) — hidden page

Type `/settings/backups` in the address bar.
**Cards:** automated 24-hour backup status (a real nightly database job), presets **Backup Last 24 Hours / Last 7 Days / Custom Range**, **Take Backup Now**, **Export PDF Report**, **Print PDF Preview**.
**Take Backup Now** first asks *who you are* (Operator Attribution), then creates a snapshot and downloads a `.json` file (on desktop it opens a native Save dialog).
**There is no "Restore" button** — backups are export-only; restoring is a manual/technical job. Keep the files safe.

---

# PART 5 — Recipes: everyday tasks step by step

### Recipe A — A supplier's truck arrived (buy raw material)

1. **CRM** → make sure the supplier exists (**+ Add New Contact**, type = Supplier).
2. **In / Out Gate** → **+ New Intake** → fill material, vendor, lot, quantity → save. Status: `PENDING_INSPECTION`.
3. On that row click **Generate GRN** → a GRN *and* a pending Purchase Invoice are born; the gate pass becomes `CONVERTED_TO_GRN`.
4. **Invoicing → Pending Vendor Invoices** tab (or **Payables**) → **Approve & Post** → confirm.
   Now the ledger says: *DR 1101 Inventory · CR 2001 Accounts Payable*.
5. Pay them: **Payment Vouchers → + Party Payment** (bank) — or cash via **+ Cash Payment**.
6. Check **Payables** → the vendor's "Posted to AP" total has grown; check **Ledger** → the two entries are there.

### Recipe B — Sell to a customer and get paid

1. **CRM** → add the customer (type = Buyer).
2. **Dispatch / Sales → + New Invoice** → add items → **Save** (it stays a *Draft*, nothing moves yet).
3. On the invoice row press **Post** → **Post & Print** → invoice posted, stock reduced, ledger written (DR 1100 · CR 5100 + taxes).
4. When money arrives: **Customer Receipts (AR) → Record Customer Payment** → fill in amount/mode → **Post Receipt Voucher** (DR cash/bank · CR 1100).
5. Watch **AR Aging Analysis** to see if anyone is late.

### Recipe C — Pay a worker's salary now

1. **Labour** → pick the worker → **SalaryCard**.
2. Choose **Cash** (1000) or **Bank** (1002).
3. Press **Pay Salary** → an **SPV** voucher + journal entry (DR 5002 · CR cash/bank) are created and a payslip can be printed.
4. Confirm in **Payment Vouchers → Salary (SPV)** tab.

### Recipe D — Run the whole month's payroll

1. **Payroll → Run Payroll** → Month + Year → **Run Payroll**.
2. Expand the run to see each worker's payslip (earned, loan deduction, net).
3. Pay people individually with **SalaryCard** or one **SPV** voucher as needed.

### Recipe E — Make a batch of product

*Simple path:* **Production Orders → Create Work Order** → when it's done press **Finish Batch** (finished lot appears in WH-02).
*Controlled path (recommended):* **Formulas** → check the card (no SHORTAGE) → **Execute Batch Production** → raw material is used and the finished lot is created in one go.

### Recipe F — Move goods to another warehouse

**Stock Transfers → New Transfer** → source → target → items → save. Status moves to `RECEIVED` when complete. Stock only, no money.

### Recipe G — Check "how much money do we have?"

- **Dashboard → Available Funds** (cash and bank split), or
- **Ledger** → Available Funds card, or
- **Ledger → Trial Balance** → look at 1000 Cash in Hand and 1002 Bank Account.

### Recipe H — Check "are we making profit?"

**Ledger → P&L** tab: Revenue − Expenses = **Net Profit**. Also on the **Dashboard** (Net Profit Balance + profit chart).

### Recipe I — Buy office supplies with cash

**Payment Vouchers → + Cash Payment** → payee, amount, expense account (e.g. 5003 Utilities / 5004 Rent) → Create → a **CPV** and its journal entry are made; print the PDF if needed.

### Recipe J — Back up the data

**Go to `/settings/backups`** → pick a range → **Take Backup Now** → confirm the operator name → save the `.json` file somewhere safe. Do this weekly.

---

# PART 6 — Roles: who can do what

## 6.1 The two roles

| Capability | Owner (OWNER) | Terminal (TERMINAL) |
|---|---|---|
| Log in, use every menu screen | ✅ | ✅ |
| See the top-bar identity badge | red `OWNER (REMOTE)` | `WEB-NODE: <device>` |
| **+ Add Funds** (inject owner capital) | ✅ only this role | ❌ button hidden |
| Approve a purchase invoice that **matches** | ✅ | ✅ |
| Approve a purchase invoice with a **variance** (price/qty mismatch) | ✅ | ❌ shows **"Manager Required"** |
| Everything else (invoices, vouchers, QC, HR…) | ✅ | ✅ |

There is **no hidden menu** — every logged-in user sees all 18 menu items.

## 6.2 Operator attribution (the "who did this?" pop-up)

Before some sensitive actions (posting an invoice, converting a GRN, executing a batch, taking a backup) the app asks you to **pick the operator name**. That name is written into the audit log (`system_audit_logs`) together with the device node — so the Dashboard feed shows *who, where, when, what*.

## 6.3 The audit trail

Every action lands in **Dashboard → live feed**: Terminal Node, Operator, Module, Action, Timestamp. There is no screen to edit or delete audit records — they are meant to be permanent.

---

# PART 7 — Accounting in 10 minutes (explained simply)

## 7.1 Why every transaction is written twice

If you buy Rs 100 of material on credit, two things are true at the same time:

1. We **have** Rs 100 more stuff (asset goes **up**),
2. We **owe** the supplier Rs 100 (debt goes **up**).

So the app writes **one line on the debit side and one on the credit side** for the same amount. If they don't balance, the app warns you (**Balance Check: OUT OF BALANCE**). Nothing can "disappear" — that's the whole point of double-entry.

## 7.2 Debit and credit in kid words

- **Debit (DR)** = "what came *in* / what we spent *on*".
- **Credit (CR)** = "what went *out* / where it *came from*".

| Situation | Debit | Credit |
|---|---|---|
| Bought material on credit | 1101 Inventory | 2001 Accounts Payable (we owe) |
| Customer buys on credit | 1100 Receivable (they owe us) | 5100 Sales + 2200/2210 taxes |
| Customer pays us | 1000 Cash / 1002 Bank | 1100 Receivable |
| We pay a supplier | the expense/asset we chose | 1000 Cash / 1002 Bank |
| Pay a salary | 5002 Salary Expense | 1000 Cash / 1002 Bank |
| Owner puts money in | 1000 Cash / 1002 Bank | 3000 Owner Equity |

## 7.3 The main account codes you'll see

| Code | Name | Type | Used by |
|---|---|---|---|
| 1000 | Cash in Hand | Asset | payment/receipt vouchers, salary, capital |
| 1002 | Bank Account | Asset | bank vouchers, salary by bank |
| 1100 | Accounts Receivable | Asset | sales invoices, customer receipts |
| 1101 | Raw Material Inventory | Asset | purchase invoices (debit side) |
| 2001 | Accounts Payable | Liability | purchase invoices (credit side) |
| 2200 / 2210 | Sales Tax / Further Tax | Liability | sales invoice tax lines |
| 3000 / 3100 | Owner Equity / Retained Earnings | Equity | capital, reports |
| 5002 | Salary & Wages Expense | Expense | salary payments |
| 5001/5003–5006 | Raw material, utilities, rent, freight, COGS | Expense | purchases & expenses |
| 5100 | Sales | **Revenue** | sales invoice credit line |
| 4001 / 4002 / 4100 | Sales Revenue / Other Income / Service Revenue | Revenue | extra income |

## 7.4 The four financial reports (Ledger tabs)

- **Trial Balance** — every account's total debit and credit. Should balance.
- **P&L (Profit & Loss)** — Revenue − Expenses = **Net Profit** for a period.
- **Balance Sheet** — what we **have** (Assets) vs what we **owe** (Liabilities) and what the owner owns (Equity), on one day.
- **Journal** — the raw list of all double entries (the "source of truth").

---

# PART 8 — Printing, PDF and exports

Almost every screen has an **Export PDF** button in its header, and tables often have per-row **PDF** buttons:

| What | Where |
|---|---|
| Sales invoice print / bilingual (EN+UR) invoice | Dispatch / Sales → row **Post** → Post & Print drawer → **Print / Save PDF** |
| Receipt & payment vouchers (bilingual) | Payment Vouchers → row **PDF**; Customer Receipts table |
| Journal entry, trial balance, P&L, balance sheet | Ledger → **Export PDF** (and per-tab export icons) |
| Party statement | CRM → Details → print/PDF; Trial Balance → **View Ledger** → Print/PDF |
| Stock card, product list | Inventory / Catalog row **PDF**, page **Export PDF** |
| Payroll payslips | Payroll → expand a run |
| Backups report | `/settings/backups` → **Export PDF Report** |

Urdu translation only happens if the Gemini translation key is configured; otherwise the PDF stays in English.

---

# PART 9 — Troubleshooting ("It does X…")

| You see | Because | Fix |
|---|---|---|
| **"SYSTEM OFFLINE"** full-screen lock | The app can't reach the database or your internet dropped | Click **Retry Connection**; check network; the app only unlocks when it hears from Supabase |
| **"Manager Required"** on a purchase invoice | The invoice has a price/qty *variance* | Log in as the Owner (OWNER) or ask a manager |
| **"Could not resolve Accounts Payable (2001)…"** | A chart-of-account row was missing | Fixed — the standard accounts are seeded. Check **Ledger → Accounts**; add with **+ Add Account** if ever missing |
| Dashboard/KPIs show **0 / empty** everywhere | `.env.local` is missing/wrong, or wrong Supabase project | Check `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`, restart `npm run dev` |
| Login says **"Invalid email or password"** | Wrong credentials | Use a **Quick Select Terminal** preset button, or ask the admin |
| Invoice posted but **stock didn't change** | The *view* drawer's **Post Invoice** was used (ledger only) | Use the row **Post → Post & Print** button |
| A screen shows **"Operator Attribution Required"** | Sensitive action needs a named operator | Pick a name from the list → **Confirm Action** |
| **Company logo/NTN missing** on another PC | Company profile is stored *per browser* | Re-enter it in Settings on that computer |
| **Salary paid twice?** | — | SalaryCard blocks duplicate payments for the same period |
| Can't delete a product | It has dispatches/sales | Delete/disable its transactions first |
| Sidebar item missing? | — | The menu has 18 fixed items; `/loans` and `/settings/backups` are typed directly in the address bar |
| Changes don't appear on another terminal | That terminal has its own local settings | Refresh; company profile must be set per device |

---

# PART 10 — Words you'll hear (glossary)

| Word | Meaning |
|---|---|
| **ERP** | One program that runs the whole business |
| **Node / Terminal** | One computer using the app (counter, warehouse, office) |
| **IGP** | Inward Gate Pass — the truck-arrival slip at the gate |
| **GRN** | Goods Received Note — proof the material physically arrived |
| **3-way match** | Gate pass + GRN + invoice must agree |
| **Variance** | A mismatch in price/quantity between those three |
| **AP (Payables)** | Money **we owe** suppliers |
| **AR (Receivables)** | Money **customers owe us** |
| **CPV / BPV / PPV / SPV** | Cash / Bank / Party / Salary Payment Voucher |
| **JE** | Journal Entry — one double-entry record in the ledger |
| **DR / CR** | Debit / Credit |
| **COA** | Chart of Accounts — the list of all account codes |
| **QOH** | Quantity On Hand — stock count |
| **WH-01 / WH-02** | Warehouse 1 (raw material) / Warehouse 2 (finished goods) |
| **FEFO/FIFO** | Rules for which batch gets used first (earliest expiry / first in) |
| **BOM** | Bill of Materials — the recipe of a product |
| **QC-FLAGGED** | A lot that failed a quality test (warning badge) |
| **PENDING_INSPECTION / CONVERTED_TO_GRN** | Gate pass statuses |
| **pending_approval / posted / cancelled** | Purchase invoice statuses |
| **DRAFT / POSTED** | Journal entry statuses (only POSTED counts in reports) |
| **PLANNED / COMPLETED** | Production order statuses |
| **NTN / STRN** | Pakistani tax registration numbers printed on invoices |
| **RLS** | Row Level Security — database-level permission rules |

---

# Part 11 — Known quirks (read once, save confusion later)

These are honest notes about how the app behaves **today**:

1. **Two "Post" buttons on sales invoices.** Row **Post → Post & Print** does everything (ledger + stock). View-drawer **Post Invoice** does ledger only. Prefer the row button.
2. **Payroll run ≠ payment.** *Run Payroll* makes the salary sheet; the money leaves via **SalaryCard** or an **SPV voucher** (which do post to the ledger).
3. **Production "Finish Batch" doesn't consume raw stock** — it only creates the finished lot. Use **Formulas → Execute Batch Production** when you want raw material deducted.
4. **QC never blocks.** A QC-FLAGGED lot still moves; the badge is a warning, not a lock.
5. **Company profile, voucher prefixes and the User Management tab**: only Company Profile actually saves (and it saves *per browser*). The other two tabs are a preview and reset on reload. Real users/roles are managed in Supabase Auth.
6. **Backups are export-only** — there's no Restore button.
7. **Two hidden pages**: `/loans` and `/settings/backups` are not in the sidebar.
8. **Master PIN keypad exists but isn't switched on** — the app logs in with email + password only.
9. **Offline lock** appears whenever the database is unreachable, even if the page is cached.
10. **Branding**: the interface, window title and desktop installer are all named "Glassco Sanitary Fitting".

---

# Part 12 — Appendix

## A. All routes

`/login` (login) · `/dashboard` · `/crm` · `/invoicing` · `/invoicing/pending` · `/invoicing/receipts` · `/payment-vouchers` · `/ledger` · `/procurement` · `/procurement/payables` · `/inventory` · `/inventory/transfers` · `/catalog` · `/production` · `/bom` · `/formulas` · `/qc` · `/labour` · `/payroll` · `/loans`* · `/settings` · `/settings/backups`*
(*not in the menu)

## B. Status values you'll see

| Table | Statuses |
|---|---|
| Gate pass (IGP) | `PENDING_INSPECTION` → `CONVERTED_TO_GRN` (or rejected) |
| GRN | `pending_invoice` → `invoiced` |
| Purchase invoice | `pending_approval` → `posted` / `cancelled` |
| Sales invoice | Draft → `Posted` (`is_posted`) |
| Journal entry | `DRAFT` → `POSTED` |
| Production order | `PLANNED` → `COMPLETED` |
| QC record | `PASSED` / `QC-FLAGGED` |
| Stock transfer | `IN TRANSIT` → `RECEIVED` |
| Worker | `ACTIVE` / `INACTIVE` |
| Payroll run | `POSTED` / `PAID` / `DRAFT` |

## C. Command cheat-sheet (for installers)

```bash
npm install          # first time only
npm run dev          # run locally on http://localhost:3000
npm run build        # build the static website into out/
npm run lint         # check the code
npm run tauri:build  # build the Windows desktop app
```

## D. Where the important files live (for developers)

| Thing | Path |
|---|---|
| All pages | `src/app/(dashboard)/…` |
| Sidebar menu | `src/components/sidebar.tsx` |
| Data access (one file per module) | `src/lib/supabase/*.ts` |
| Reusable UI (tables, modals, forms) | `src/components/modules/…` |
| Database schema | `supabase/schema-consolidated.sql` |
| Migrations & seeds | `supabase/migrations/` |
| Environment keys | `.env.local` |
| Desktop app config | `src-tauri/tauri.conf.json` |

---

*End of manual. Keep it next to the computer — or print it and stick it on the wall like the old paper registers.*
