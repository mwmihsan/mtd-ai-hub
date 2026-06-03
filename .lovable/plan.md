# AI Training Center — Build Plan

A staged build for the Telegram bot's learning system. Each module is independent so we can ship incrementally and add future channels (WhatsApp, voice, OCR) later without rework.

## What you'll get

1. **Conversation Memory** — bot remembers your last question and your choice when it asks "which account?". Auto-expires after 5 minutes.
2. **Account Aliases** — teach the bot nicknames (e.g. `mnm` → `M.N.M NISRAN`).
3. **Intent Training** — feed it example phrases ("april sales", "monthly profit") and map them to actions, so it stops guessing.
4. **Corrections** — when bot answers wrong, mark 👎, tell it the right answer, and it learns.
5. **Feedback buttons** — every bot reply ends with 👍 / 👎.
6. **Training Dashboard** — one admin page with tabs for everything above plus analytics (top queries, accuracy %, failed searches).
7. **Smart Matching** — strict priority: Account ID → Exact name → Alias → Partial → AI similarity. Never auto-pick when multiple matches.
8. **Accuracy rules** — never guess customer/year, always show "Applied Filters" header, confidence threshold before querying.

## Build order (suggested phases)

**Phase 1 — Foundation (DB + Pipeline rewrite)**

- New tables: `account_aliases`, `intent_training`, `corrections`, `feedback`. Reuse existing `telegram_conversation_state` for memory (add expiry).
- Rewrite `telegram-poll` query pipeline to run in order: Memory → Corrections → Aliases → Intent training → AI → Query → Reply with feedback buttons → Log learning data.
- Add Smart Matching service with the 5-level priority.

**Phase 2 — Admin Training Center page (`/training`)**
Tabs:

- Conversation Memory (view/clear active sessions)
- Account Aliases (CRUD, linked to sub_account name)
- Intent Training (CRUD + "Test" box to try a phrase)
- Corrections (list, usage_count, delete)
- Feedback Analytics (totals, top corrected queries, accuracy %, failed searches)

**Phase 3 — Feedback loop in Telegram**

- Inline keyboard 👍/👎 on every report.
- 👎 prompts: "What should I have selected?" → saves correction.
- callback_query handler in `telegram-poll`.

## Technical details

**Tables (new)**

- `account_aliases(id, sub_account_name, alias, created_at)` — link by name (no account ID exists in current `account_rows` schema).
- `intent_training(id, example_text, intent, description, created_at)`.
- `corrections(id, original_query, wrong_result, correct_result, usage_count, created_at)`.
- `feedback(id, chat_id, query, response_summary, rating, created_at)`.
- All have permissive RLS for now (matches existing project pattern); will tighten when auth is added.

**Edge function changes (`supabase/functions/telegram-poll/index.ts`)**

- Add `handleCallbackQuery` for 👍/👎 buttons.
- Reorder `processMessage` to the 9-step pipeline.
- Add `resolveAccount(query)` with 5-tier matching that returns `{match}|{candidates}`.
- Add `lookupIntent(text)` against `intent_training` with simple normalized substring + token-overlap scoring before AI fallback.
- Append `reply_markup` with feedback buttons to every report message.
- Confidence < 90% → ask clarification, do not query.

**Frontend (`src/pages/TrainingCenter.tsx` + route `/training`)**

- shadcn Tabs, Tables, Dialogs for CRUD.
- Reuse existing design tokens.
- Add nav entries in `AppSidebar` and `BottomNav`.

**Future-ready**

- All bot logic lives in pure helpers inside the edge function so a future WhatsApp/voice channel just calls the same `processMessage(text, chatId)`.

## Open questions

1. **Do you want me to build all 10 modules in one go**, or ship Phase 1 (DB + pipeline) first so you can test, then Phase 2 (admin UI) and Phase 3 (feedback buttons)?  
ship Phase 1 (DB + pipeline) first
2. **Authentication**: the admin pages and these new tables are currently open to anyone (matches your existing setup). Want me to add real auth + admin role gating as part of this,   
or keep the current open model for now?  
add real auth + admin role gating as part of this

Reply with your preference and I'll start building.