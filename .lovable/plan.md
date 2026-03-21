

## Telegram Bot Integration Plan

### Important Note
The Telegram connector gateway does **not support webhooks**. The recommended approach is **long polling via pg_cron**, which achieves near-real-time message delivery (0-5 second latency). This is the standard pattern for Telegram bots on this platform.

### Architecture

```text
Telegram Chat → getUpdates (polling) → telegram-poll Edge Function → telegram_messages table
                                                                          ↓
telegram-reply Edge Function ← pg trigger or poll loop ← process message
         ↓
   sendMessage via Gateway → Telegram Chat
```

### Step 1: Connect Telegram Connector
Use the Telegram connector to get gateway credentials (`TELEGRAM_API_KEY`, `LOVABLE_API_KEY`). This handles authentication automatically — no raw bot token needed in code.

### Step 2: Database Tables (Migration)
- **`telegram_bot_state`** — singleton row tracking `update_offset` for polling
- **`telegram_messages`** — stores incoming messages (`update_id`, `chat_id`, `text`, `raw_update`)
- **`telegram_settings`** — stores bot config (`admin_chat_id`, `bot_username`, `is_active`)

### Step 3: Edge Function — `telegram-poll`
- Invoked every minute by pg_cron
- Runs a polling loop for ~55 seconds using `getUpdates` with long-poll timeout
- Stores incoming messages in `telegram_messages`
- For recognized commands ("profit", "sales"), queries `account_rows` and sends reply via `sendMessage`
- **Profit logic**: `Gross Profit = Sales credit - Purchase debit`, `Net Profit = Gross Profit + Stock - Expenses` (stock value from `telegram_settings` or asks user)
- **Sales logic**: Sum of credit where account = 'SALES'

### Step 4: Edge Function — `telegram-send` (utility)
- Reusable function to send messages to any chat_id
- Called from `telegram-poll` for auto-replies and from the settings page for test messages

### Step 5: pg_cron Schedule
- Schedule `telegram-poll` to run every minute using `cron.schedule`

### Step 6: Telegram Settings Page (`src/pages/TelegramSettings.tsx`)
- **Fields**: Admin Chat ID, Stock Value (for net profit calc), Bot active toggle
- **Test Connection button**: Calls `telegram-send` to send a test message to Admin Chat ID
- **Save button**: Saves settings to `telegram_settings` table
- Note: Bot token is handled by the connector — no token field needed in UI

### Step 7: Navigation Updates
- Add "Telegram" link to `AppSidebar.tsx` and `BottomNav.tsx`
- Add route `/telegram` in `App.tsx`

### Files to Create/Edit
| File | Action |
|------|--------|
| `supabase/migrations/...` | Create `telegram_bot_state`, `telegram_messages`, `telegram_settings` tables |
| `supabase/functions/telegram-poll/index.ts` | Polling + command handling edge function |
| `supabase/functions/telegram-send/index.ts` | Reusable send message edge function |
| `src/pages/TelegramSettings.tsx` | Settings UI page |
| `src/App.tsx` | Add `/telegram` route |
| `src/components/AppSidebar.tsx` | Add Telegram nav link |
| `src/components/BottomNav.tsx` | Add Telegram nav link |

### Bot Command Responses

**"profit"** reply format:
```
📊 Profit Report
Total Sales: 1,468,405
Total Purchase: 231,040
Gross Profit: 1,237,365
Stock Value: [from settings]
Total Expense: 95,023
Net Profit: [calculated]
```

**"sales"** reply format:
```
💰 Sales Total: 1,468,405
```

