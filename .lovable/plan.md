Implement a targeted Telegram bot accuracy patch in `supabase/functions/telegram-poll/index.ts`.

## Goal
Make numbered sub-accounts like `1306. Jawfer`, `1024. Jawfer`, `1224. Ranjith`, etc. resolve by the exact account code/name instead of stripping the number and repeatedly asking for selection.

## Changes

1. Fix repeated account-selection loop
- When the user replies `1`, `2`, or an Account ID to a multiple-account prompt, keep the selected account in context.
- Replay the original request with `customer_query` cleared so `runIntent()` does not search `Jawfer` again and return the same selection list.

2. Add numbered sub-account parsing
- Detect account-style inputs such as:
  - `1306. Jawfer`
  - `1306 Jawfer`
  - `1306`
  - `ACC0003`
- Prefer exact Account ID / account-code matches before fuzzy name matching.
- If `1306. Jawfer` uniquely maps to `ACC0003 — 1306. JAWFER`, return that account directly.
- If the code/name combination does not uniquely match, show a clear shortlist with Account IDs and names.

3. Preserve raw user text before AI extraction
- The AI sometimes extracts only `Jawfer` from `1306. Jawfer`, which loses the important `1306` code.
- Add a pre-resolution step using the raw Telegram text so exact numeric account codes are handled before the AI result is trusted.

4. Improve candidate matching rules
- Let bare-name fallback accept digits and dots, not only letters.
- Allow selection by:
  - list number (`1`)
  - Account ID (`ACC0003`)
  - full account name (`1306. JAWFER`)
  - numeric prefix (`1306`) when it uniquely identifies a listed candidate.

5. Keep no-guessing behavior
- Do not merge `1024. JAWFER`, `1187. JAWFER`, and `1306. JAWFER`.
- If a query is not exact, continue showing the account list with IDs.
- Example: if the database has `1386. RAJANTHA` but the user asks `1386. Ranjith`, the bot should not silently choose the wrong account; it should ask for clarification or show closest valid matches.

## Validation
- Check database samples for `Jawfer` and `Ranjith` account rows.
- Deploy the updated Telegram function.
- Verify these flows from logs/function behavior:
  - `1306. Jawfer` resolves directly to `ACC0003 — 1306. JAWFER`.
  - `Jawfer` still shows multiple accounts.
  - Replying `1` to a multiple-account list returns the selected account summary, not the same list again.
  - `1224. Ranjith` resolves directly.
  - Ambiguous or mismatched code/name queries do not guess.