# Advanced Accounting AI Agent — Build Plan

Extends the existing Phase 1/2 Training Center into a full accounting agent. Adds a permanent Account ID system, deterministic SQL-based calculations, PDF/chart reports, and richer admin tools.

## What you'll get

1. **Permanent Account IDs** (`ACC0001`…) auto-assigned on import; every transaction is linked by ID, never by name.
2. **Disambiguation by ID** — when multiple accounts share a similar name, bot lists them with IDs and asks you to pick.
3. **Strict pipeline** — Memory → Alias → Intent training → AI (intent + dates + account only) → DB query → formatted reply → feedback log.
4. **Date parser** — handles `today`, `last week`, `april`, `2025 april`, `between jan and march`; asks for the year when ambiguous.
5. **All reports**: monthly sales / purchases / expenses, customer & supplier balances, account statement, debit/credit totals, profit, monthly comparison, ledger.
6. **PDF reports** with filters, summary, transactions, totals + chart images (bar/line/pie) sent directly to Telegram.
7. **Admin dashboard** expansion: Accounts Master, Aliases, Intents, Corrections, Memory, Feedback Analytics, Report Templates.
8. **Accuracy guards** — never guess year/account; confidence < 90% asks; all maths from DB.

---

## Phase A — Account ID foundation (DB + import)

**New tables**

- `accounts_master(account_id text PK ACC####, account_name, account_type, mobile, status, created_at)`
- Extend `account_aliases` with `account_id` (keep old `sub_account_name` for back-compat, populate during migration)
- Extend `account_rows` with `account_id text` (nullable, indexed)
- Sequence + function `next_account_id()` → `ACC0001`…
- Function `resolve_or_create_account(name)` → returns `account_id` (matches by exact name → alias → fuzzy; creates new if none)
- Backfill: walk existing `account_rows`, assign IDs, populate `accounts_master`

**Import flow update**
On Excel upload, for each unique `sub_account`, call `resolve_or_create_account` and stamp `account_id` on every row.

## Phase B — Pipeline rewrite (`telegram-poll`)

8-step pipeline as specified. AI (Gemini via Lovable AI) extracts **only**:

```
{ intent, accountQuery, startDate, endDate, reportType, confidence }
```

Account resolution returns `{match}` or `{candidates: [{account_id, account_name}]}`. If candidates, store pending action and reply:

```
Multiple accounts found:
1. ACC0001 - M.N.M NISRAN
2. ACC0002 - NISRAN
Reply 1 or 2.
```

User's numeric reply resumes the original query from `conversation_state.original_query` with the chosen `account_id`.

**Date parser** as a pure helper (`parseDateRange(text, now)`); returns `{start, end}` or `{askYear: true}`.

**Reports** are pure SQL functions keyed by `report_type`:
- `account_statement(account_id, start, end)`
- `monthly_sales(account_id?, start, end)`
- `monthly_purchases`, `monthly_expenses`
- `customer_balance(account_id)` → `SUM(debit) - SUM(credit)`
- `supplier_balance(account_id)` → `SUM(credit) - SUM(debit)`
- `profit(start, end)` → `sales - purchases - expenses`
- `monthly_comparison(months[])`
- `ledger(account_id, start, end)`

All replies use the standard header:

```
Applied Filters:
Account: M.N.M NISRAN (ACC0001)
Date Range: 01-Apr-2025 to 30-Apr-2025
Report: Account Statement

Results: …
```

Each reply ends with 👍/👎 inline buttons (existing feedback flow).

## Phase C — PDF & charts

Edge function helper `buildReportPdf(report, filters)` using `pdf-lib` (Deno-compatible) generating: title, filters block, summary, transactions table, totals, optional chart image. Charts rendered server-side via `quickchart.io` URL (no extra deps) embedded as PNG. PDF sent via Telegram `sendDocument`; chart-only requests via `sendPhoto`.

Triggers: keywords `pdf`, `statement pdf`, `chart`, `chart pdf` in the user message (also stored as intents).

## Phase D — Admin dashboard expansion

Extend `/training` with new tabs:

- **Accounts Master** — list `accounts_master` with ID, name, type, mobile, status; inline edit; merge tool stays disabled (per "never merge").
- **Report Templates** — saved canned queries that map to `report_type` + default filters.
- **Feedback Analytics** — top queries, accuracy %, failed-search list, most-corrected queries.
- Existing tabs (Aliases, Intents, Corrections, Memory) get an `account_id` column where relevant.

## Technical details

**New migrations**
- `accounts_master`, `next_account_id()`, `resolve_or_create_account()` (SECURITY DEFINER, locked search_path)
- ALTER `account_aliases ADD account_id text` + index
- ALTER `account_rows ADD account_id text` + index + backfill
- `report_templates(id, name, intent, default_filters jsonb, created_at)`
- All new tables: GRANTs + RLS (admin write, public read where bot needs it)

**Edge function changes** (`telegram-poll`)
- New pure helpers: `parseDateRange`, `resolveAccount` (5-tier), `runReport`, `formatReport`, `buildPdf`, `buildChartUrl`
- `conversation_state.pending.kind` extended: `account_pick`, `year_pick`, `correction`
- Confidence gate: `< 0.9` → ask clarifier instead of running

**Frontend** (`src/pages/TrainingCenter.tsx`)
- New tabs: Accounts Master, Report Templates, expanded Analytics
- Aliases form now picks `account_id` from a searchable list (not free-text sub-account name)

**Future-ready**
- All bot logic stays in pure helpers in the edge function, so WhatsApp / voice / OCR channels can call the same `processMessage(text, chatId)` later.

## Build order

1. **Phase A** (Account IDs + backfill) — must land first, everything else depends on it.
2. **Phase B** (Pipeline + reports + date parser).
3. **Phase C** (PDF + charts).
4. **Phase D** (Dashboard tabs).

## Open questions

1. **Account type detection** during import — auto-classify by Account column (e.g. `Sales` → customer, `Purchases` → supplier) or leave `account_type` blank for admin to set later?
2. **Backfill ambiguity** — existing rows have only names. If two different files used slightly different spellings ("NISRAN" vs "Nisran "), should backfill treat them as the **same** Account ID (normalize case/whitespace) or **different** IDs that you merge manually in the Accounts Master tab?
3. **PDF library** — OK to use `pdf-lib` via `npm:` specifier in the edge function (lightweight, no native deps)?

Reply with answers (or "your call") and I'll start Phase A.
