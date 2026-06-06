## Problem
1. Asking "Kumar" triggers "Which year for March?" because a previous month-only query left `context.date = { month: 3, year: undefined }` sticky, and `freshenContext` only drops it when the new message itself contains a date phrase.
2. Asking "Salman" returns March 2026 results because the year answered earlier was saved into `context.date` and inherited by the next unrelated customer query.

## Fix (single file: `supabase/functions/telegram-poll/index.ts`)

1. **`freshenContext` — drop sticky `context.date` more aggressively**
   - Drop `context.date` whenever the new message does not reference the previous turn ("his/her/their/same/that/previous/above" or the prior customer name).
   - Always drop `context.date` for bare-name `customer_lookup` queries — a name on its own means "show this account overall".

2. **Discard stale `pending` on a fresh query**
   - In the main pipeline, when `pending` exists and `answerPending` returns `consumed: false`, clear `pending` before continuing if the new message is a fresh query (bare name, new totals/report intent, or new customer_lookup).
   - When the discarded pending was `date_year` or `date_month`, also clear `context.date` so the half-finished month doesn't survive.

3. **`runIntent` year-prompt guard**
   - Only prompt "Which year for {month}?" when the month was supplied by the current extract (`ex.month` or `ex.date_text`), not from sticky `context.date`. Prevents re-asking the same question on unrelated follow-ups.

## Validation
- After an unanswered "march", sending "kumar" resolves Kumar without a year prompt.
- After resolving a year, sending "salman" returns Salman across all time (or a normal customer summary), not March 2026.
- Follow-ups like "his sales" or "same period purchase" still inherit previous customer/date.
- Existing flows for `1306. Jawfer`, `ACC0003`, and numeric list selection are unchanged.
