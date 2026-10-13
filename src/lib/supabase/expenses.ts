import { Account } from "@/lib/supabase/ledger";
import { Party } from "@/lib/supabase/crm";

export type ExpenseCategory =
  | "RENT"
  | "ELECTRICITY"
  | "SALARIES"
  | "TRANSPORT"
  | "FUEL"
  | "MAINTENANCE"
  | "PACKAGING"
  | "MISCELLANEOUS";

export type ExpensePaymentMethod = "CASH" | "BANK" | "PAYABLE" | "CHEQUE";

export type ExpenseStatus = "DRAFT" | "UNPAID" | "PAID" | "CANCELLED";

export interface Expense {
  id: string;
  expense_number: string;
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  payment_method: ExpensePaymentMethod;
  expense_account_id: string;
  payment_account_id: string | null;
  payable_account_id: string | null;
  party_id: string | null;
  payee_name: string | null;
  notes: string | null;
  status: ExpenseStatus;
  receipt_url: string | null;
  journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
  operator_name: string | null;
  device_node: string | null;
  created_at: string;
  updated_at: string;
  expense_account?: Account | null;
  payment_account?: Account | null;
  payable_account?: Account | null;
  party?: Party | null;
}

export interface CreateExpenseInput {
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  payment_method: ExpensePaymentMethod;
  expense_account_id: string;
  payment_account_id?: string | null;
  payable_account_id?: string | null;
  party_id?: string | null;
  payee_name?: string | null;
  notes?: string | null;
  status: ExpenseStatus;
  receipt_url?: string | null;
  operator_name?: string;
  device_node?: string;
}

export interface ExpenseFilter {
  startDate?: string;
  endDate?: string;
  category?: ExpenseCategory | "ALL";
  status?: ExpenseStatus | "ALL";
  paymentMethod?: ExpensePaymentMethod | "ALL";
  searchQuery?: string;
}

export interface ExpenseSummary {
  todayTotal: number;
  monthTotal: number;
  paidTotal: number;
  unpaidTotal: number;
  draftTotal: number;
  cancelledTotal: number;
  grandTotal: number;
  count: number;
  categoryBreakdown: Record<
    ExpenseCategory,
    { amount: number; count: number; percentage: number }
  >;
}

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; defaultCode: string }[] = [
  { value: "RENT", label: "Rent Expense", defaultCode: "5004" },
  { value: "ELECTRICITY", label: "Electricity & Utilities", defaultCode: "5003" },
  { value: "SALARIES", label: "Salaries & Wages", defaultCode: "5002" },
  { value: "TRANSPORT", label: "Transport & Freight", defaultCode: "5005" },
  { value: "FUEL", label: "Fuel & Generator", defaultCode: "5007" },
  { value: "MAINTENANCE", label: "Repair & Maintenance", defaultCode: "6400" },
  { value: "PACKAGING", label: "Packaging & Consumables", defaultCode: "6300" },
  { value: "MISCELLANEOUS", label: "General & Miscellaneous", defaultCode: "6500" },
];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  ELECTRICITY: "Electricity & Utilities",
  SALARIES: "Salaries & Wages",
  TRANSPORT: "Transport & Freight",
  FUEL: "Fuel",
  MAINTENANCE: "Maintenance",
  PACKAGING: "Packaging",
  MISCELLANEOUS: "Miscellaneous",
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

/**
 * Validate input fields before submission to prevent invalid data or duplicate requests.
 */
export function validateExpenseInput(input: Partial<CreateExpenseInput>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!input.description || !input.description.trim()) {
    errors.description = "Description is required.";
  }

  if (typeof input.amount !== "number" || isNaN(input.amount) || input.amount <= 0) {
    errors.amount = "Amount must be a positive number greater than zero.";
  }

  if (!input.expense_date) {
    errors.expense_date = "Expense date is required.";
  }

  if (!input.category) {
    errors.category = "Category is required.";
  }

  if (!input.expense_account_id) {
    errors.expense_account_id = "Debit expense account is required.";
  }

  if (input.status === "PAID" && !input.payment_account_id) {
    errors.payment_account_id = "Cash or Bank payment account is required for paid expenses.";
  }

  if (input.status === "UNPAID" && !input.payable_account_id) {
    errors.payable_account_id = "Accounts payable liability account is required for unpaid expenses.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Fetch expenses with join to accounts and parties, and optional filters.
 */
export async function fetchExpenses(filter?: ExpenseFilter): Promise<Expense[]> {
  if (!SUPABASE_URL) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/expenses?select=*,expense_account:accounts_chart!expenses_expense_account_id_fkey(id,account_code,account_name,account_type),payment_account:accounts_chart!expenses_payment_account_id_fkey(id,account_code,account_name,account_type),payable_account:accounts_chart!expenses_payable_account_id_fkey(id,account_code,account_name,account_type),party:parties!expenses_party_id_fkey(id,name,phone,party_type)&order=expense_date.desc,created_at.desc`;

    if (filter?.category && filter.category !== "ALL") {
      url += `&category=eq.${filter.category}`;
    }

    if (filter?.status && filter.status !== "ALL") {
      url += `&status=eq.${filter.status}`;
    }

    if (filter?.paymentMethod && filter.paymentMethod !== "ALL") {
      url += `&payment_method=eq.${filter.paymentMethod}`;
    }

    if (filter?.startDate) {
      url += `&expense_date=gte.${filter.startDate}`;
    }

    if (filter?.endDate) {
      url += `&expense_date=lte.${filter.endDate}`;
    }

    let res = await fetch(url, { headers: headers() });

    // Fallback if joined FKs fail or table has simple structure
    if (!res.ok) {
      const fallbackUrl = `${SUPABASE_URL}/rest/v1/expenses?select=*&order=expense_date.desc,created_at.desc`;
      res = await fetch(fallbackUrl, { headers: headers() });
    }

    if (!res.ok) {
      console.warn("Supabase Warning [fetchExpenses]:", res.status, await res.text().catch(() => ""));
      return [];
    }

    const json = await res.json();
    let records = (Array.isArray(json) ? json : []) as Expense[];

    if (filter?.searchQuery && filter.searchQuery.trim()) {
      const q = filter.searchQuery.trim().toLowerCase();
      records = records.filter(
        (e) =>
          (e.expense_number && e.expense_number.toLowerCase().includes(q)) ||
          (e.description && e.description.toLowerCase().includes(q)) ||
          (e.payee_name && e.payee_name.toLowerCase().includes(q)) ||
          (e.notes && e.notes.toLowerCase().includes(q)) ||
          (e.category && e.category.toLowerCase().includes(q))
      );
    }

    return records;
  } catch (err) {
    console.error("Supabase Error [fetchExpenses]:", err);
    return [];
  }
}

/**
 * Create or post a new expense. Uses PostgreSQL RPC if available, or client fallback.
 */
export async function createExpense(
  input: CreateExpenseInput
): Promise<{ data: Expense | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };

  const validation = validateExpenseInput(input);
  if (!validation.valid) {
    const msg = Object.values(validation.errors).join(" ");
    return { data: null, error: msg };
  }

  try {
    // 1. Try RPC create_or_post_expense
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_or_post_expense`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_payload: input }),
    });

    if (rpcRes.ok) {
      const json = await rpcRes.json();
      return { data: json as Expense, error: null };
    }

    // 2. Client-side fallback if RPC is not yet created
    const expenseNumber = `EXP-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
    let journalEntryId: string | null = null;

    if (input.status === "PAID" || input.status === "UNPAID") {
      const jeNumber = `JE-${input.expense_date.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`;
      const narration = `${input.status === "UNPAID" ? "Accrued " : ""}Expense ${expenseNumber} [${input.category}] — ${input.payee_name || input.description}`;

      const jeRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({
          entry_number: jeNumber,
          entry_date: input.expense_date,
          narration,
          is_balanced: true,
          status: "POSTED",
          customer_name: input.payee_name || null,
        }),
      });

      // A PAID/UNPAID expense that cannot post its journal must NOT be saved:
      // an expense row claiming PAID with no money behind it desynchronises
      // the expense report from the general ledger.
      if (!jeRes.ok) {
        return {
          data: null,
          error: "Failed to post the expense journal entry — nothing was saved.",
        };
      }
      const jeRows = await jeRes.json();
      const jeId = jeRows?.[0]?.id;
      if (!jeId) {
        return {
          data: null,
          error:
            "Journal entry response did not include an id — verify the ledger before retrying.",
        };
      }
      journalEntryId = jeId;
      const creditAccId =
        input.status === "PAID"
          ? input.payment_account_id!
          : input.payable_account_id!;

      const lines = [
        {
          journal_entry_id: jeId,
          account_id: input.expense_account_id,
          party_id: input.party_id || null,
          debit_pkr: input.amount,
          credit_pkr: 0.0,
        },
        {
          journal_entry_id: jeId,
          account_id: creditAccId,
          party_id: input.party_id || null,
          debit_pkr: 0.0,
          credit_pkr: input.amount,
        },
      ];

      const linesRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(lines),
      });

      if (!linesRes.ok) {
        await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${jeId}`, {
          method: "DELETE",
          headers: headers(),
        });
        return { data: null, error: "Failed to post balanced journal lines." };
      }
    }

    // Insert expense row
    const expRow = {
      expense_number: expenseNumber,
      expense_date: input.expense_date,
      category: input.category,
      description: input.description,
      amount: input.amount,
      payment_method: input.payment_method,
      expense_account_id: input.expense_account_id,
      payment_account_id: input.payment_account_id || null,
      payable_account_id: input.payable_account_id || null,
      party_id: input.party_id || null,
      payee_name: input.payee_name || null,
      notes: input.notes || null,
      status: input.status,
      receipt_url: input.receipt_url || null,
      journal_entry_id: journalEntryId,
      operator_name: input.operator_name || "System Operator",
      device_node: input.device_node || "NODE-01",
    };

    const expRes = await fetch(`${SUPABASE_URL}/rest/v1/expenses`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(expRow),
    });

    if (!expRes.ok) {
      const errText = await expRes.text();
      // Compensate: without this, a failed expense insert leaves an orphan
      // POSTED journal entry, and the retry would post a second one.
      if (journalEntryId) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${journalEntryId}`,
          { method: "DELETE", headers: headers() }
        );
        await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${journalEntryId}`, {
          method: "DELETE",
          headers: headers(),
        });
      }
      return { data: null, error: `Failed to insert expense record: ${errText}` };
    }

    const createdRows = await expRes.json();
    const createdExp = createdRows?.[0] as Expense;

    // Audit log
    fetch(`${SUPABASE_URL}/rest/v1/system_audit_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        operator_name: input.operator_name || "System Operator",
        action_type: `EXPENSE_${input.status}`,
        module: "EXPENSES",
        details: {
          expense_number: expenseNumber,
          category: input.category,
          amount: input.amount,
          status: input.status,
        },
      }),
    }).catch(() => {});

    return { data: createdExp, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [createExpense]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

/**
 * Update an existing DRAFT expense in place.
 *
 * Posted rows are immutable through this path: the SQL guard
 * (`status=eq.DRAFT`) refuses the PATCH, because editing the amount or
 * accounts of a posted expense would silently desynchronise its journal
 * entry from the expense report.
 */
export async function updateExpenseDraft(
  expenseId: string,
  input: CreateExpenseInput
): Promise<{ data: Expense | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };

  const validation = validateExpenseInput({ ...input, status: "DRAFT" });
  if (!validation.valid) {
    return { data: null, error: Object.values(validation.errors).join(" ") };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/expenses?id=eq.${expenseId}&status=eq.DRAFT`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({
          expense_date: input.expense_date,
          category: input.category,
          description: input.description,
          amount: input.amount,
          payment_method: input.payment_method,
          expense_account_id: input.expense_account_id,
          payee_name: input.payee_name || null,
          party_id: input.party_id || null,
          notes: input.notes || null,
          receipt_url: input.receipt_url || null,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { data: null, error: `Failed to update draft expense: ${text}` };
    }
    const rows = (await res.json()) as Expense[] | null;
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        data: null,
        error:
          "Only DRAFT expenses can be edited — this one was already posted or does not exist.",
      };
    }
    return { data: rows[0], error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Supabase Error [updateExpenseDraft]:", errorMsg);
    return { data: null, error: errorMsg };
  }
}

/**
 * Pay an unpaid accrued expense later.
 * Debit Payable (2001), Credit Cash/Bank (1000/1002).
 */
export async function payUnpaidExpense(
  expenseId: string,
  paymentAccountId: string,
  paymentMethod: ExpensePaymentMethod = "CASH",
  paymentDate: string = new Date().toISOString().slice(0, 10),
  operatorName: string = "System Operator"
): Promise<{ data: Expense | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };

  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pay_unpaid_expense`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_expense_id: expenseId,
        p_payment_account_id: paymentAccountId,
        p_payment_method: paymentMethod,
        p_payment_date: paymentDate,
        p_operator_name: operatorName,
      }),
    });

    if (rpcRes.ok) {
      const json = await rpcRes.json();
      return { data: json as Expense, error: null };
    }

    // Client fallback
    const expRes = await fetch(`${SUPABASE_URL}/rest/v1/expenses?id=eq.${expenseId}&select=*`, {
      headers: headers(),
    });
    if (!expRes.ok) return { data: null, error: "Failed to locate expense." };
    const expRows = await expRes.json();
    const exp = expRows?.[0] as Expense;
    if (!exp || exp.status !== "UNPAID") {
      return { data: null, error: "Expense not found or not in UNPAID status." };
    }

    // Validate the payable account BEFORE any ledger write so a misconfigured
    // expense can never leave an orphan journal header behind.
    const payableAccId = exp.payable_account_id;
    if (!payableAccId) return { data: null, error: "Missing payable account on expense." };

    // Post payment journal entry
    const jeNumber = `JE-${paymentDate.replace(/-/g, "")}-${Date.now().toString().slice(-6)}`;
    const narration = `Settlement for Expense ${exp.expense_number} — ${exp.payee_name || exp.description}`;

    const jeRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        entry_number: jeNumber,
        entry_date: paymentDate,
        narration,
        is_balanced: true,
        status: "POSTED",
        customer_name: exp.payee_name || null,
      }),
    });

    if (!jeRes.ok) return { data: null, error: "Failed to post payment journal entry." };
    const jeRows = await jeRes.json();
    const jeId = jeRows?.[0]?.id;
    if (!jeId) {
      return { data: null, error: "Payment journal entry response did not include an id." };
    }

    const lines = [
      {
        journal_entry_id: jeId,
        account_id: payableAccId,
        party_id: exp.party_id || null,
        debit_pkr: exp.amount,
        credit_pkr: 0.0,
      },
      {
        journal_entry_id: jeId,
        account_id: paymentAccountId,
        party_id: exp.party_id || null,
        debit_pkr: 0.0,
        credit_pkr: exp.amount,
      },
    ];

    // 1. Post the balanced lines; on failure remove the empty header so a
    //    retry starts from a clean state.
    const linesRes = await fetch(`${SUPABASE_URL}/rest/v1/journal_lines`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify(lines),
    });
    if (!linesRes.ok) {
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${jeId}`, {
        method: "DELETE",
        headers: headers(),
      });
      return { data: null, error: "Failed to post the payment journal lines." };
    }

    // 2. Guarded status flip (status=eq.UNPAID acts as a compare-and-set):
    //    a concurrent/duplicate pay attempt loses here and rolls back its own
    //    journal, so cash can never be credited twice for one expense.
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/expenses?id=eq.${expenseId}&status=eq.UNPAID`,
      {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({
          status: "PAID",
          payment_account_id: paymentAccountId,
          payment_method: paymentMethod,
          payment_journal_entry_id: jeId,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    const patchRows = patchRes.ok ? ((await patchRes.json()) as Expense[] | null) : null;
    const updated = Array.isArray(patchRows) && patchRows.length > 0 ? patchRows[0] : null;
    if (!updated) {
      // The claim failed (concurrent payment or unexpected state): undo this
      // attempt's journal so the books stay untouched, then surface the error.
      await fetch(`${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${jeId}`, {
        method: "DELETE",
        headers: headers(),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${jeId}`, {
        method: "DELETE",
        headers: headers(),
      });
      const errText = patchRes.ok
        ? "the expense was no longer UNPAID"
        : `HTTP ${patchRes.status}`;
      return {
        data: null,
        error: `Payment was not recorded (${errText}); no ledger change was kept. Please retry.`,
      };
    }
    return { data: updated, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { data: null, error: errorMsg };
  }
}

/**
 * Cancel an expense. Reverses/deletes posted journal entries so balances are unharmed.
 */
export async function cancelExpense(
  expenseId: string,
  operatorName: string = "System Operator",
  reason: string = "Cancelled by operator"
): Promise<{ data: Expense | null; error: string | null }> {
  if (!SUPABASE_URL) return { data: null, error: "Database URL not configured." };

  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_expense`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_expense_id: expenseId,
        p_operator_name: operatorName,
        p_reason: reason,
      }),
    });

    if (rpcRes.ok) {
      const json = await rpcRes.json();
      return { data: json as Expense, error: null };
    }

    // Client fallback
    const expRes = await fetch(`${SUPABASE_URL}/rest/v1/expenses?id=eq.${expenseId}&select=*`, {
      headers: headers(),
    });
    if (!expRes.ok) return { data: null, error: "Failed to locate expense." };
    const exp = (await expRes.json())?.[0] as Expense;
    if (!exp || exp.status === "CANCELLED") {
      return { data: null, error: "Expense not found or already cancelled." };
    }

    // Remove the expense's ledger entries with response checks, keeping the
    // delete-then-flag order: every failure point stays retryable (deletes are
    // idempotent), whereas flagging first could leave a CANCELLED expense with
    // live journal lines that the retry guard would never clean up.
    const removeEntry = async (entryId: string): Promise<string | null> => {
      const linesDel = await fetch(
        `${SUPABASE_URL}/rest/v1/journal_lines?journal_entry_id=eq.${entryId}`,
        { method: "DELETE", headers: headers() }
      );
      if (!linesDel.ok) return `journal lines of entry ${entryId} could not be removed`;
      const entryDel = await fetch(`${SUPABASE_URL}/rest/v1/journal_entries?id=eq.${entryId}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!entryDel.ok) return `journal entry ${entryId} could not be removed`;
      return null;
    };

    if (exp.journal_entry_id) {
      const fail = await removeEntry(exp.journal_entry_id);
      if (fail) return { data: null, error: `Cancel failed: ${fail}. Please retry.` };
    }

    if (exp.payment_journal_entry_id) {
      const fail = await removeEntry(exp.payment_journal_entry_id);
      if (fail) return { data: null, error: `Cancel failed: ${fail}. Please retry.` };
    }

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/expenses?id=eq.${expenseId}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        status: "CANCELLED",
        journal_entry_id: null,
        payment_journal_entry_id: null,
        notes: `${exp.notes || ""} [Cancelled: ${reason}]`.trim(),
        updated_at: new Date().toISOString(),
      }),
    });

    const patchRows = patchRes.ok ? ((await patchRes.json()) as Expense[] | null) : null;
    const updated = Array.isArray(patchRows) ? patchRows[0] : undefined;
    if (!updated) {
      return {
        data: null,
        error:
          "Journal entries were removed but the expense status could not be updated. Please retry the cancellation.",
      };
    }
    return { data: updated, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { data: null, error: errorMsg };
  }
}

/**
 * Delete a draft expense completely.
 */
export async function deleteExpenseDraft(
  expenseId: string
): Promise<{ success: boolean; error: string | null }> {
  if (!SUPABASE_URL) return { success: false, error: "Database URL not configured." };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/expenses?id=eq.${expenseId}&status=eq.DRAFT`, {
      method: "DELETE",
      headers: { ...headers(), Prefer: "return=representation" },
    });
    if (!res.ok) {
      return { success: false, error: "Cannot delete non-draft or missing expense." };
    }
    // A row-count-aware check: DELETE with a non-matching filter still returns
    // 2xx, so only the returned rows prove that something was actually deleted.
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: false, error: "Cannot delete non-draft or missing expense." };
    }
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Calculate KPI summary and category aggregations across expenses.
 */
export function calculateExpenseSummary(expenses: Expense[]): ExpenseSummary {
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayStr.slice(0, 7); // YYYY-MM

  let todayTotal = 0;
  let monthTotal = 0;
  let paidTotal = 0;
  let unpaidTotal = 0;
  let draftTotal = 0;
  let cancelledTotal = 0;
  let grandTotal = 0;

  const categoryBreakdown: Record<
    ExpenseCategory,
    { amount: number; count: number; percentage: number }
  > = {
    RENT: { amount: 0, count: 0, percentage: 0 },
    ELECTRICITY: { amount: 0, count: 0, percentage: 0 },
    SALARIES: { amount: 0, count: 0, percentage: 0 },
    TRANSPORT: { amount: 0, count: 0, percentage: 0 },
    FUEL: { amount: 0, count: 0, percentage: 0 },
    MAINTENANCE: { amount: 0, count: 0, percentage: 0 },
    PACKAGING: { amount: 0, count: 0, percentage: 0 },
    MISCELLANEOUS: { amount: 0, count: 0, percentage: 0 },
  };

  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0;

    if (exp.status === "CANCELLED") {
      cancelledTotal += amt;
      continue; // Cancelled expenses don't count towards active totals
    }

    if (exp.status === "DRAFT") {
      draftTotal += amt;
    } else if (exp.status === "PAID") {
      paidTotal += amt;
      grandTotal += amt;
    } else if (exp.status === "UNPAID") {
      unpaidTotal += amt;
      grandTotal += amt;
    }

    if (exp.expense_date === todayStr && exp.status !== "DRAFT") {
      todayTotal += amt;
    }

    if (exp.expense_date.startsWith(currentMonthStr) && exp.status !== "DRAFT") {
      monthTotal += amt;
    }

    if (exp.status !== "DRAFT") {
      const cat = exp.category || "MISCELLANEOUS";
      if (!categoryBreakdown[cat]) {
        categoryBreakdown[cat] = { amount: 0, count: 0, percentage: 0 };
      }
      categoryBreakdown[cat].amount += amt;
      categoryBreakdown[cat].count += 1;
    }
  }

  // Calculate percentages
  const activeTotal = grandTotal > 0 ? grandTotal : 1;
  for (const cat of Object.keys(categoryBreakdown) as ExpenseCategory[]) {
    categoryBreakdown[cat].percentage = Math.round(
      (categoryBreakdown[cat].amount / activeTotal) * 100
    );
  }

  return {
    todayTotal,
    monthTotal,
    paidTotal,
    unpaidTotal,
    draftTotal,
    cancelledTotal,
    grandTotal,
    count: expenses.filter((e) => e.status !== "CANCELLED").length,
    categoryBreakdown,
  };
}
