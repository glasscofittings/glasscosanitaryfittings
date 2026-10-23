# Step-by-Step Testing & Verification Guide: SAP HCM / FI Payroll Module

This guide details the exact steps to verify, run, and test the newly implemented SAP HCM / FI Payroll module in **node-station**.

---

## Prerequisites & Migration Step

Before testing the UI and calculations, make sure your Supabase database has executed the new migration file.

### Step 1: Run the Database Migration
1. Open your Supabase Dashboard or local Postgres client (e.g. pgAdmin, DBeaver, or Supabase Studio SQL Editor).
2. Open the newly created migration file:
   [`supabase/migrations/20261116010000_sap_payroll_core_engine.sql`](file:///d:/usama%20glassco%20setup/node-station/node-station/supabase/migrations/20261116010000_sap_payroll_core_engine.sql)
3. Execute the full script. It will:
   - Extend `accounts_chart` with `report_group` (`'COGS'` | `'OPEX'`).
   - Create accounts `5010` (Direct Labour Wages), `5011` (Direct Labour Salaries), `1150` (Staff Loans Receivable), and verify `2300` (Wages Payable).
   - Extend `workers` with `employment_type` and `cost_class`.
   - Seed `payroll_wage_types` (Basic, Overtime, Allowances, Deductions, Loan Recovery).
   - Create transaction tables (`payroll_periods`, `payroll_runs_v2`, `payroll_run_items`, `payroll_run_item_lines`, `payroll_payment_logs`).
   - Install the `SECURITY DEFINER` RPCs (`create_payroll_period`, `post_payroll_run`, `pay_payroll_items`, `reverse_payroll_run`).
   - Migrate historical `payroll_entries` without double counting.

---

## Automated Unit & Integration Tests

### Step 2: Run the Automated Engine Test Suite
Open a PowerShell terminal in the repository root and run:

```bash
npx tsx --test tests/payroll.test.ts
```

#### What this asserts:
- **Test 1**: Permanent staff salary calculations with attendance (Present, Absent, Leave), pro-rated overtime, and undertime deductions.
- **Test 2**: Daily-wage calculations (`present days × daily rate`).
- **Test 3**: Loan recovery capping (ensuring deductions do not exceed outstanding loan balances or the 50% net pay threshold).
- **Test 4**: General Ledger Profit & Loss integration (verifying that Production Direct Labour goes to COGS above the Gross Profit line, while Admin Payroll goes to OPEX below the Gross Profit line).

*Expected output: 4 passed, 0 failed.*

---

## Step-by-Step UI & Workflow Testing

Launch the application (or view your running Tauri app / `localhost:3000` dev server).

```bash
npm run tauri dev
```

### Step 3: Verify the Master Data & Periods
1. In the sidebar, navigate to **Payroll**.
2. Click on the **Payroll Periods** tab:
   - Verify that default periods exist.
   - Click **New Period** and create a test period:
     - **Period Code**: `2026-M11`
     - **Type**: `Monthly`
     - **Start Date**: `2026-11-01`
     - **End Date**: `2026-11-30`
   - Click **Save Period**. You will see it appear with status `OPEN`.
3. Click on the **Wage Types (COA Mapping)** tab:
   - Check the automatic account determination rules:
     - `BASIC` & `DAILY_WAGE` Production GL: `5010/5011` (COGS)
     - `BASIC` Admin GL: `5002` (OPEX)
     - `LOAN_RECOVERY`: `1150` (Asset control)
     - Net Payable liability: `2300` (Wages & Salaries Payable)

---

### Step 4: Run a Payroll Simulation
1. Click the top button **New Payroll Run** (or switch to the **Calculation Wizard** tab).
2. Select your period (e.g. `2026-M11` or the current month).
3. Under **Cost Classification**, you can choose:
   - `All Factory & Admin Staff`
   - `Production / Direct Labour (COGS only)`
   - `Administration & Management (OPEX only)`
4. Click **Run Simulation**.
5. **Inspect the Simulation Register**:
   - Verify the summary KPI tiles: **Total Staff**, **Gross Earnings**, **Direct Labour (COGS)**, and **Net Payable**.
   - Review each employee line:
     - Verify attendance days (Present, Absent, Leave).
     - Check overtime additions and undertime deductions.
     - Notice loan deductions: if a worker has an active loan in `worker_loans`, the deduction is calculated up to their scheduled monthly amount and capped at 50% of net pay.

---

### Step 5: Approve the Run & Post to Accounting (Accrual Phase)
1. At the top right of the simulation grid, click **Approve Run (PKR ...)**.
2. The system creates the run in `APPROVED` status and returns you to the **Payroll Runs** tab.
3. On the run card, click **Post Accrual (GL)**:
   - This invokes the atomic PostgreSQL RPC `post_payroll_run`.
   - The status updates to **POSTED**.
   - Behind the scenes, a balanced Journal Entry (`JE-YYYY-XXXXX`) is created:
     - **Debit**: `5010`/`5011` (Direct Labour COGS) for production workers
     - **Debit**: `5002` (Admin Payroll Expense) for admin workers
     - **Credit**: `1150` (Staff Loans Receivable) for loan recoveries
     - **Credit**: `2300` (Wages & Salaries Payable) for the net salaries due
   - Active loan balances in `worker_loans` are decremented by the recovery amount.

---

### Step 6: Test General Ledger & P&L Presentation
1. In the sidebar, navigate to **General Ledger** -> **Financial Statements** (or open the Profit & Loss card).
2. Verify the structured presentation:
   - **Revenue**: Sales revenue.
   - **Cost of Goods Sold (COGS)**: Material consumption (`5001`/`5006`) **PLUS** Direct Labour (`5010`/`5011`).
   - **Gross Profit Subtotal**: `Revenue - COGS`.
   - **Operating Expenses (OPEX)**: Admin Salaries (`5002`), Rent, Utilities.
   - **Net Profit**: `Gross Profit - Operating Expenses`.

---

### Step 7: Disburse Payroll (Cash / Bank Payment Phase)
1. Return to **Payroll** -> **Payroll Runs**.
2. On your posted run card, click **Disburse Pay**:
   - The disbursement modal will open.
   - Select your disbursement method: **Cash in Hand** or **Bank Account / Transfer**.
   - Choose the liquid account (e.g. `1000 Cash in Hand` or `1002 Bank Account`).
   - Click **Confirm & Post Payment**.
3. **Verify the Payment Output**:
   - The run card will update to **PAID** (or **PARTIALLY_PAID** if partial).
   - In the General Ledger, a disbursement entry is posted:
     - **Debit**: `2300` Wages Payable (clearing the liability).
     - **Credit**: `1000` or `1002` Cash/Bank.
   - Switch to the **Disbursement Logs** tab to view the audit register.
   - Click **Disbursement PDF** on the run card to export the bank transfer / cash payout sheet.

---

### Step 8: Test Storno Reversal
*Note: A posted run with PKR 0 disbursed payments can be Storno-reversed in full.*
1. If you wish to test a cancellation, create and approve another test run.
2. Click **Post Accrual (GL)**.
3. Click **Storno Reverse**:
   - Enter a reason (e.g. *"Incorrect overtime hours"*).
   - Click **Execute Storno Reversal**.
4. Verify:
   - A Storno journal entry is created with inverted debits/credits.
   - The run status changes to **REVERSED**.
   - Any worker loan deductions are restored to their previous balance.
   - The run cannot be modified or double-posted.

---

### Step 9: Verify Labour Page Salary Card Read-Only Protection
1. Navigate to **Labour & Factory** -> select any worker.
2. Inspect the **Salary Card**:
   - Notice that the old direct payment button has been replaced with a **Payroll Module** link.
   - Clicking **Print** generates the worker's payslip PDF with attendance details.
   - Direct double-payments from the Labour screen are prevented.

---

## Summary Checklist

| # | Test Step | Expected Result | Pass/Fail |
|---|---|---|---|
| 1 | `npx tsx --test tests/payroll.test.ts` | 4/4 tests pass | [ ] |
| 2 | `npx tsc --noEmit` | 0 TypeScript errors | [ ] |
| 3 | Create Period `2026-M11` | Status `OPEN`, listed in master table | [ ] |
| 4 | Run Payroll Simulation | Correct Gross, Overtime, Undertime, Loan Cap | [ ] |
| 5 | Post Accrual to GL | Single atomic JE, Dr 5010/5002, Cr 2300/1150 | [ ] |
| 6 | Check Profit & Loss statement | Direct Labour appears under COGS above Gross Profit | [ ] |
| 7 | Disburse Pay | Status -> `PAID`, Dr 2300 / Cr 1000/1002 | [ ] |
| 8 | Export Disbursement PDF | Bilingual sheet with employees, accounts & amounts | [ ] |
| 9 | Labour Salary Card | Read-only with link to unified payroll | [ ] |
