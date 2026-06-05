
# Telegram Bot Accuracy Fixes

Three concrete bugs from the screenshots, each with a targeted fix in `supabase/functions/telegram-poll/index.ts` (no schema changes).

---

## Bug 1 — Account selection reply is too thin

Current `handleCustomerSummary` shows only account name, totals and 5 recent rows.

**Fix** — expand the reply to include:

- Account ID + name + type + mobile + status (pulled from `accounts_master`)
- Balance line: `Balance = Debit − Credit` (or Credit − Debit for suppliers based on `account_type`), explicitly labelled
- Transaction count split: debits vs credits
- First date / last date of activity
- Last 10 transactions (was 5), newest first, formatted as `date | Dr/Cr amount | description`
- Footer hint: "Reply <i>pdf</i> for full statement, <i>april</i> to filter month" (PDF is later phase, hint only)

Add a small `fetchAccountMeta(account_id)` helper that queries `accounts_master`.

---

## Bug 2 — "wood working" / single-name queries return "I'm not sure"

Root cause: the AI extractor returns `intent=unknown, confidence≈0.6` when the user sends only a bare name with no verb. The pipeline then bails out instead of treating it as a customer lookup.

**Fix** — before falling through to the generic "I don't understand" reply:

1. After AI extraction, if `intent === 'unknown'` **and** the raw text is short (≤ 4 tokens, alphabetic), run `findCustomerCandidates(rawText)`.
   - 1 match → treat as `customer_lookup` for that account.
   - >1 matches → trigger the existing disambiguation flow.
   - 0 matches → keep the current "not sure" reply but include the search miss ("No customer named '<i>wood working</i>' found").
2. Lower the unknown-cutoff: only show the "not sure" message when `confidence < 0.4` AND no customer candidates exist.

This recovers "Wood working", "Aazir", "Nisran", typos, etc., without ever guessing.

---

## Bug 3 — "April sales" / "march purchase" returns wrong account or 0 transactions

Two compounding bugs visible in screenshot 2:

### 3a. Trained-intent shortcut discards the date
`lookupTrainedIntent` matches "april sales" → `sales_report` (confidence 0.95) and returns immediately via `trainedIntentToExtract`, which hard-codes `month: null, year: null, date_text: null`. The "april" is lost, so the report falls back to "All time".

**Fix** — after `trainedIntentToExtract`, run a lightweight local date parser on the original text and merge it in:

- Detect month names / `today` / `yesterday` / `this year` / `last month` / `YYYY` via the existing `monthFromText` + a regex.
- Populate `ex.month`, `ex.year`, `ex.date_text` on the trained-intent result.
- Same parser also runs as a safety net on the AI-extracted result (so a model miss on the date is still recovered).

### 3b. Sticky customer context leaks into unrelated next queries
After the user picked "2. NISRAN", `context.customer` was kept. The next message "April sales" inherited it, scoping sales to NISRAN → 0 rows.

**Fix** — clear `context.customer` (and `context.date`) when the new message looks like a fresh, self-contained query:

- The new extract has its own `customer_query` → replace, don't merge.
- The new extract has its own date phrase → replace, don't merge.
- The new intent is a top-level totals/profit/report **and** the user did not reference the previous customer (no pronoun like "his", "her", "their", or the customer name) → drop `context.customer`.
- Add an explicit reset trigger: any of `sales`, `purchase`, `expense`, `profit`, `report` without a customer phrase → start from clean context.

Result:
- "Nisran" → pick 2 → summary for NISRAN (context kept).
- "April sales" → context.customer dropped, date=April, asks for year if ambiguous (since two years exist in the data), then returns overall April sales.
- "His april sales" → context.customer kept, date=April, scoped report.

### 3c. Missing year prompt was skipped
When trained-intent path was used, the "ask for year" branch in `runIntent` never fired because date was null. With 3a fixed, "April sales" now reaches `resolveDateFromExtract` with `month=4, year=null`, which already triggers the year-disambiguation prompt correctly.

---

## Technical summary of edits (one file)

`supabase/functions/telegram-poll/index.ts`:

1. New helper `parseDateFromText(text): Partial<Extracted>` — month name, `today`, `yesterday`, `this/last year`, `this/last month`, `between X and Y`, `YYYY`.
2. Apply it inside the pipeline:
   - After `trainedIntentToExtract` (overwrite null fields).
   - After `aiExtract` (overwrite only when AI returned null).
3. New helper `isFreshTopLevelQuery(ex, rawText, context)` → returns whether to drop sticky `context.customer` / `context.date`. Wire into the pipeline just before `runIntent`.
4. `runIntent` — after AI step in main handler, if `ex.intent === 'unknown'` and `rawText` is ≤ 4 alphabetic tokens, call `findCustomerCandidates(rawText)` and either set `ex.intent='customer_lookup'` with single match, trigger disambiguation, or return a clear "not found" message.
5. `fetchAccountMeta(account_id)` helper + expanded `handleCustomerSummary` reply (account meta block, balance line, debit/credit counts, first/last date, last 10 transactions, footer hint).

No DB migrations. No frontend changes. Edge function will redeploy automatically.

---

## Out of scope (call out only)

- PDF export, charts, multi-language — already in Phase C/D of the broader plan; this fix is just the accuracy patch.
- Adding more training examples for "wood working" — fix above makes it work without training, and you can still add an alias in the Training Center for cleaner display.

Reply "go" and I'll apply the patch.
