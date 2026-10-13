# Ledger Audit Findings (Phase 0 Reconnaissance)

Generated: 2026-09-30
Project: node-station (Glassco Sanitary / Komax Brass ERP)

---

## a) Hard-Coded Account Codes

List of occurrences for target account codes (`'1001'`,`'5100'`,`'1100'`,`'2001'`,`'1101'`,`'1102'`,`'2200'`,`'2210'`,`4001'`,`5006'`,`1000'`,`1002'`):

### Client TypeScript / TSX (`src/`)
1. **`src/app/actions/receipt-voucher.ts:70`**: `'1001'`, `'1002'` -> `const debitAccountCode = payload.payment_mode === "CASH" ? "1001" : "1002";`
2. **`src/app/actions/receipt-voucher.ts:81`**: `'1100'` -> `.eq("account_code", "1100")`
3. **`src/app/(dashboard)/settings/page.tsx:84`**: `'1100'` -> `defaultCashAccount: "1100"`
4. **`src/components/modules/labour/SalaryCard.tsx:270`**: `'1000'` -> `accounts.find((a) => a.account_code === "1000");`
5. **`src/components/modules/labour/SalaryCard.tsx:271`**: `'1002'` -> `const bankAcct = accounts.find((a) => a.account_code === "1002");`
6. **`src/components/modules/payment-vouchers/PaymentVoucherForm.tsx:65`**: `'1000'` -> `all.find((a) => a.account_code === "1000")`
7. **`src/components/modules/payment-vouchers/PaymentVoucherForm.tsx:72`**: `'1002'` -> `all.find((a) => a.account_code === "1002")`
8. **`src/components/ui/AccountCombobox.tsx:24`**: `'2001'` (comment example)
9. **`src/lib/party-statement.ts:245`**: `'2001'` -> `return type === "LIABILITY" || code === "2001" || name.includes("payable");`
10. **`src/lib/party-statement.ts:253`**: `'1100'` -> `code === "1100" ||`
11. **`src/lib/supabase/invoicing.ts:814`**: `'5100'` -> `if (!accountId && line.account_code === "5100") { ... or=(account_code.eq.4001...`
12. **`src/lib/supabase/invoicing.ts:873`**: `'1100'` -> `{ account_code: "1100", debit_pkr: taxable + salesTax + furtherTax, credit_pkr: 0, party_id: invoice.customer_id }`
13. **`src/lib/supabase/invoicing.ts:874`**: `'5100'` -> `{ account_code: "5100", debit_pkr: 0, credit_pkr: taxable, party_id: invoice.customer_id }`
14. **`src/lib/supabase/invoicing.ts:877`**: `'2200'` -> `lines.push({ account_code: "2200", debit_pkr: 0, credit_pkr: salesTax, party_id: invoice.customer_id });`
15. **`src/lib/supabase/invoicing.ts:880`**: `'2210'` -> `lines.push({ account_code: "2210", debit_pkr: 0, credit_pkr: furtherTax, party_id: invoice.customer_id });`
16. **`src/lib/supabase/ledger.ts:8`**: `'1000'` (doc comment)
17. **`src/lib/supabase/ledger.ts:344`**: `'1000'`, `'1002'` -> `account_code=in.(1000,1002)`
18. **`src/lib/supabase/ledger.ts:380`**: `'1002'` -> `if (a.account_code === "1002") bankBalance += bal;`
19. **`src/lib/supabase/ledger.ts:900`**: `'1100'` (doc comment)
20. **`src/lib/supabase/payment-vouchers.ts:31`**: `'1000'` (doc comment)
21. **`src/lib/supabase/purchase-invoices.ts:339`**: `'2001'` -> `["2001"]`
22. **`src/lib/supabase/purchase-invoices.ts:341`**: `'2001'` -> `{ account_code: "2001", account_name: "Accounts Payable (Suppliers)", account_type: "LIABILITY" }`
23. **`src/lib/supabase/purchase-invoices.ts:346`**: `'1101'` -> `["1101", "5001"]`
24. **`src/lib/supabase/purchase-invoices.ts:348`**: `'1101'` -> `{ account_code: "1101", account_name: "Raw Material Inventory", account_type: "ASSET" }`
25. **`src/lib/supabase/receipt-vouchers.ts:142`**: `'1001'`, `'1002'` -> `const debitAccountCode = payload.payment_mode === "CASH" ? "1001" : "1002";`
26. **`src/lib/supabase/receipt-vouchers.ts:146`**: `'1100'` -> `account_code=eq.1100`
27. **`src/lib/supabase/receipt-vouchers.ts:233`**: `'1001'`, `'1002'` -> `const debitCode = paymentMode === "CASH" ? "1001" : "1002";`
28. **`src/lib/supabase/receipt-vouchers.ts:238`**: `'1100'` -> `account_code=eq.1100`
29. **`src/lib/supabase/receipt-vouchers.ts:243`**: `'1000'` -> `account_code.eq.1000`
30. **`src/lib/supabase/sap-procurement.ts:374`**: `'2001'`, `'1101'` -> `account_code.eq."2001",account_code.eq."1101"`
31. **`src/lib/supabase/sap-procurement.ts:379`**: `'2001'` -> `a.account_code === "2001"`
32. **`src/lib/supabase/sap-procurement.ts:380`**: `'1101'` -> `a.account_code === "1101"`

*(Note: unrelated integer constants for batch formula yields/delays such as placeholder="1000" in BatchCalculator.tsx and setTimeout 1000ms were excluded from accounting logic).*

### Existing Database Migrations (`supabase/migrations/`)
- `20261003010000_fix_post_gst_invoice_rpc.sql:126-129`: `'1100'`, `'5100'`, `'2200'`, `'2210'` (Note: live DB already patched to `'4001'` in `fix_post_gst_invoice_revenue_4001.sql`)
- `20261005020000_fix_approve_post_purchase_invoice_rpc.sql:162,167`: `'2001'`, `'1101'` (with fallback to any LIABILITY/EXPENSE/ASSET)
- `20261010010000_enforce_journal_balance.sql:208-211, 312, 317`: `'1100'`, `'5100'`, `'2200'`, `'2210'`, `'2001'`, `'1101'`
- `20261010020000_sequential_journal_entry_numbers.sql:143-146, 233, 238`: `'1100'`, `'5100'`, `'2200'`, `'2210'`, `'2001'`, `'1101'`
- `20261011010000_dedupe_chart_of_accounts.sql:45,46,74,75,282,284`: `'1000'`, `'1001'`, `'1002'` (migrated 1001 into 1000)

---

## b) Journal Inserters (`journal_entries`, `journal_lines`, `gl_ledger_entries`)

### Client TypeScript
1. **`src/app/actions/receipt-voucher.ts:87,100`**: Inserts into `journal_entries` and `journal_lines` (Direct client insert via Supabase client, bypassed RPC).
2. **`src/lib/supabase/invoicing.ts:760,828`**: `createJournalEntry()` inserts directly into `journal_entries` and loops over `journal_lines` using REST fetch.
3. **`src/lib/supabase/ledger.ts:478,529`**: `createJournalEntry()` inserts directly into `journal_entries` and `journal_lines`.
4. **`src/lib/supabase/ledger.ts:696`**: `addJournalLines()` inserts directly into `journal_lines`.
5. **`src/lib/supabase/ledger.ts:857`**: `recordLedgerEntry()` inserts into `gl_ledger_entries` (SAP engine table).
6. **`src/lib/ledger/poster.ts:153`**: `executeLedgerPosting()` inserts into `gl_ledger_entries`.
7. **`src/lib/supabase/purchase-invoices.ts:360,404`**: Fallback in `approveAndPostPurchaseInvoice()` inserts directly into `journal_entries` and `journal_lines`.
8. **`src/lib/supabase/receipt-vouchers.ts:157,175`**: `createReceiptVoucher()` inserts directly into `journal_entries` and `journal_lines`.
9. **`src/lib/supabase/receipt-vouchers.ts:324`**: `updateReceiptVoucher()` deletes and re-inserts `journal_lines` directly.
10. **`src/lib/supabase/payment-vouchers.ts:383,467`**: `syncJournalLines()` and `insertJournalLinesDirectly()` insert directly into `journal_lines`.
11. **`src/lib/supabase/sap-procurement.ts:387`**: `approvePurchaseInvoiceSAP()` inserts directly into `gl_ledger_entries`.

### SQL RPCs
1. **`post_gst_paints_invoice`** (`20261003010000_fix_post_gst_invoice_rpc.sql:115,134-156`): Inserts into `journal_entries` and `journal_lines`.
2. **`create_payment_voucher`** (`20261004010000_fix_create_payment_voucher_rpc.sql:95,107,113`): Inserts into `journal_entries` and `journal_lines`.
3. **`approve_and_post_purchase_invoice`** (`20261005020000_fix_approve_post_purchase_invoice_rpc.sql:184,195,199`): Inserts into `journal_entries` and `journal_lines`.
4. **`record_capital_injection`** (`20261011010000_dedupe_chart_of_accounts.sql:304,317`): Inserts into `journal_entries` and `journal_lines`.

---

## c) Journal Line Readers for Balances

1. **Party Summary Card (`src/app/(dashboard)/ledger/page.tsx:234-319`)**:
   - Loops over `entries` and `entry.journal_lines`. Matches party by name or party_id across all accounts (`line.accounts_chart.account_code`).
   - Line 313: Picks control account using `pickPartyControlAccount(p.party_type, p.matchedAccounts, p.matchedAccounts[0])`.
2. **Individual Ledger Modal (`src/components/modules/ledger/IndividualLedgerModal.tsx:173-305`)**:
   - ACCOUNT target calls `getAccountLedger` (`src/lib/supabase/ledger.ts:190-255`) which reads `journal_lines` filtered by `account_id`.
   - PARTY target filters loaded `entries` and `journal_lines`: matches name/narration/party_id. Lines 286-302 pushes lines even on non-control accounts if customer-tagged.
3. **Financial Statements (`src/lib/supabase/ledger.ts:742-812`)**:
   - `fetchFinancialStatements` loads all journal entries via `fetchJournalEntries()`, then `computeTrialBalance()` aggregates `total_debit` and `total_credit` from `journal_lines` grouped by `account_code`.
   - `computePL()` and `computeBalanceSheet()` derive from the trial balance rows.
4. **Net Profit Chart (`src/lib/supabase/client.ts:230-265`)**:
   - `fetchNetProfitByPeriod()` queries `/rest/v1/journal_entries?select=*,journal_lines(debit_pkr,credit_pkr,accounts_chart(account_type))`. Sums lines by REVENUE / EXPENSE.
5. **Available Funds (`src/lib/supabase/ledger.ts:328-393`)**:
   - Queries `journal_lines` where `account_id` is in the liquid accounts (`is_liquid_funds = true` or codes 1000, 1002). Computes `debit - credit` live.

---

## d) Columns of Key Tables (from Schema & Migrations)

### `payment_vouchers`
(From `20260930020000_create_payment_vouchers.sql`, `20261002010000`, `20261004010000`):
- `id` (UUID PK)
- `voucher_no` (TEXT UNIQUE)
- `voucher_type` (TEXT: 'CASH_PAYMENT', 'PARTY_PAYMENT', 'BANK_PAYMENT')
- `voucher_date` (DATE)
- `payee_name` (TEXT)
- `payee_name_ur` (TEXT)
- `payee_address` (TEXT)
- `cnic_ntn` (TEXT)
- `purpose` (TEXT)
- `purpose_ur` (TEXT)
- `reference_no` (TEXT)
- `debit_account_id` (UUID FK accounts_chart)
- `credit_account_id` (UUID FK accounts_chart)
- `amount` (NUMERIC(12,2))
- `amount_in_words` (TEXT)
- `remarks` (TEXT)
- `created_by` (UUID FK auth.users)
- `created_at` (TIMESTAMPTZ)
- *(Need to add via migration: `journal_entry_id` UUID FK journal_entries, `payee_party_id` UUID FK parties, `status` TEXT DEFAULT 'POSTED')*

### `customer_receipt_vouchers`
(From `006_complete_all_tables.sql` & `20261005030000_enterprise_sap_modules.sql`):
- `id` (UUID PK)
- `voucher_no` (TEXT UNIQUE)
- `customer_id` (UUID FK parties)
- `customer_name` (TEXT)
- `receipt_date` (DATE)
- `amount` (NUMERIC(15,2))
- `payment_mode` (TEXT: 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE')
- `reference_no` (TEXT)
- `bank_account_id` (UUID FK accounts_chart)
- `remarks` (TEXT)
- `status` (TEXT: 'DRAFT', 'POSTED', 'CANCELLED' - need to support 'VOID')
- `created_at` (TIMESTAMPTZ)
- *(Need to add via migration: `journal_entry_id` UUID FK journal_entries)*

### `parties`
(From `03_parties_workers_kpis.sql`, `20260913_fix_full_schema.sql`, `20261010050000_party_opening_balance.sql`):
- `id` (UUID PK)
- `name` (TEXT)
- `party_type` (TEXT: 'SUPPLIER', 'CUSTOMER', 'VENDOR', 'BOTH') -> Customer vs Vendor flag: `'CUSTOMER'` vs `'SUPPLIER'` / `'VENDOR'` / `'BOTH'`
- `phone` (TEXT)
- `email` (TEXT)
- `address` (TEXT)
- `ntn_strn` (TEXT)
- `is_registered` (BOOLEAN)
- `opening_balance` (NUMERIC(18,2))
- `opening_balance_type` (TEXT: 'Dr', 'Cr')
- `created_at` (TIMESTAMPTZ)

### `inventory_lots`
(From `20260913_fix_full_schema.sql:109-122`):
- `id` (UUID PK)
- `lot_number` (TEXT UNIQUE)
- `product_id` (UUID FK products_master)
- `warehouse_id` (UUID FK inventory_warehouses)
- `vendor_lot_code` (TEXT)
- `manufacture_date` (DATE)
- `expiration_date` (DATE)
- `initial_qty` (NUMERIC(15,4))
- `remaining_qty` (NUMERIC(15,4))
- `unit_cost_pkr` (NUMERIC(15,2)) -> **Found unit cost column: `unit_cost_pkr`**
- `qc_status` (TEXT: 'PENDING', 'PASSED', 'FLAGGED_WARNING')
- `created_at` (TIMESTAMPTZ)

### `accounts_chart`
(From `20260913_fix_full_schema.sql:214-220`, `20261011010000_dedupe_chart_of_accounts.sql:35-36`):
- `id` (UUID PK)
- `account_code` (TEXT UNIQUE)
- `account_name` (TEXT)
- `account_type` (TEXT: 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')
- `is_default_cash` (BOOLEAN NOT NULL DEFAULT false) -> cash flag
- `is_liquid_funds` (BOOLEAN NOT NULL DEFAULT false) -> cash / bank liquid flag
- `name_urdu` (TEXT)
- `created_at` (TIMESTAMPTZ)
