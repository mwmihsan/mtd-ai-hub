## Changes to `supabase/functions/telegram-poll/index.ts`

### 1. Remove the "Applied filters" header from every reply
- Replace `filtersHeader(...)` so it returns an empty string (keeping the function call sites intact). Removes the 📌 Applied filters block from sales/purchase/expense totals, profit, full report, and customer summary replies.

### 2. New intent: "group_balance" — sub-account balances under a main account
Trigger phrases (case-insensitive, matched against raw text before AI extract):
- `expenses` / `expences` → `EXPENCES`
- `supplier balance` / `suppliers` → `SUPPLIERS`
- `customer balance` / `customers` → `CUSTOMERS`
- `partner balance` / `partners` → `PARTNERS`
- `credit and debit balance` / `credits debits` → `CREDITS/DEBITS`
- `bank balance` / `bank` → `BANK`

Implementation:
- Add a `matchGroupKeyword(rawText)` helper returning the canonical `account` value (e.g. `EXPENCES`) or null.
- In the main pipeline, run this match **before** AI intent extraction. If matched, short-circuit to a new `handleGroupBalance(supabase, mainAccount, ctx.date)` handler.
- `handleGroupBalance`:
  1. `select sub_account, credit, debit from account_rows where account = <mainAccount>` (apply optional date range from context).
  2. Group rows by `sub_account`, compute `debit_sum`, `credit_sum`, `balance = debit_sum - credit_sum` (matches existing Dr−Cr convention used in `handleCustomerSummary`).
  3. Sort by absolute balance descending; format reply as:
     ```
     📂 <b>EXPENCES</b> — sub-account balances
     <date range line if any>
     • SALMAN (ACC0325) — Dr 56,062
     • …
     ────────
     Total Dr: …  Total Cr: …  Net: …
     N sub-accounts
     ```
  4. Resolve `account_id` for each sub_account via a single batched lookup in `accounts_master` (by `account_name`) so the ID can be shown in parentheses.
  5. If no rows, return `ℹ️ No transactions found under <mainAccount>.`
- Add `'group_balance'` to the `Intent` union and to the AI enum/dispatch as a safety net (so AI can also route obvious phrasings), but the raw-text pre-match is the primary path so it works without the AI.

### 3. Validation
- "expenses" → list of all expense sub-accounts with balances.
- "bank balance" → balances per bank sub-account.
- "supplier balance" → balances per supplier sub-account.
- Existing flows (customer summary, sales/purchase/expense totals, profit, report) unchanged except the "Applied filters" header is gone.
- Numeric account selection (`1306. Jawfer`, `ACC0003`) still works because the group match only fires on the exact keyword set, not on names/numbers.
