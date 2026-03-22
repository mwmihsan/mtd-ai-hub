import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Intent Detection ---

interface ParsedIntent {
  intent: string;
  amount?: number;
  note?: string;
  raw: string;
}

function parseMessage(text: string): ParsedIntent | null {
  const lower = text.toLowerCase().trim().replace(/^\//, ''); // strip leading slash
  const raw = lower;

  // Extract numbers
  const numberMatch = lower.match(/(\d+(?:\.\d+)?)/);
  const amount = numberMatch ? parseFloat(numberMatch[1]) : undefined;

  // Remove numbers and extra spaces for note extraction
  const withoutNumbers = lower.replace(/\d+(?:\.\d+)?/g, '').trim();

  // --- Add transaction intents ---
  if (/\b(add\s+expense|expense\s+add|new\s+expense)\b/.test(lower) && amount) {
    const note = withoutNumbers.replace(/\b(add|expense|new)\b/g, '').trim() || undefined;
    return { intent: 'add_expense', amount, note, raw };
  }

  if (/\b(add\s+sale|sale\s+add|new\s+sale)\b/.test(lower) && amount) {
    const note = withoutNumbers.replace(/\b(add|sale|new)\b/g, '').trim() || undefined;
    return { intent: 'add_sale', amount, note, raw };
  }

  if (/\b(add\s+purchase|purchase\s+add|new\s+purchase)\b/.test(lower) && amount) {
    const note = withoutNumbers.replace(/\b(add|purchase|new)\b/g, '').trim() || undefined;
    return { intent: 'add_purchase', amount, note, raw };
  }

  // --- Report ---
  if (/\b(full\s+report|send\s+report|report\s+pdf|monthly\s+report|report)\b/.test(lower)) {
    return { intent: 'report', raw };
  }

  // --- Profit ---
  if (/\b(profit|net\s+profit|gross\s+profit|show\s+profit)\b/.test(lower)) {
    return { intent: 'profit', raw };
  }

  // --- Staff with name: "staff imtiyas", "imtiyas salary", just "imtiyas" ---
  if (/\b(staff|salary|worker)\b/.test(lower)) {
    const name = lower.replace(/\b(staff|salary|worker|show|total|details?)\b/g, '').trim() || undefined;
    return { intent: 'staff_detail', note: name, raw };
  }

  // --- Sales ---
  if (/\b(sale|sales|total\s+sales|sales\s+total|today\s+sales|sales\s+today)\b/.test(lower)) {
    return { intent: 'sales', raw };
  }

  // --- Purchase ---
  if (/\b(purchase|purchases|total\s+purchase)\b/.test(lower)) {
    return { intent: 'purchase', raw };
  }

  // --- Expense ---
  if (/\b(expense|expenses|total\s+expense)\b/.test(lower)) {
    if (amount) {
      const note = withoutNumbers.replace(/\b(expense|expenses|total)\b/g, '').trim() || undefined;
      return { intent: 'add_expense', amount, note, raw };
    }
    return { intent: 'expense', raw };
  }

  // --- Stock ---
  if (/\b(stock|current\s+stock|stock\s+value)\b/.test(lower)) {
    return { intent: 'stock', raw };
  }

  // --- Help ---
  if (/\b(help|start)\b/.test(lower) || lower === 'start' || lower === 'help') {
    return { intent: 'help', raw };
  }

  // --- Try as a sub-account name lookup (single word or name) ---
  if (lower.length >= 3 && /^[a-z\s]+$/.test(lower)) {
    return { intent: 'sub_account_lookup', note: lower.trim(), raw };
  }

  return null;
}

async function aiDetectIntent(text: string, apiKey: string): Promise<ParsedIntent> {
  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'system',
            content: `You classify Telegram messages about shop accounts. The shop has staff members (Imtiyas, Aazir, Stephan, Nadan, Salman, Arus Kokey). Return ONLY a JSON object with these fields:
- intent: one of "sales", "purchase", "expense", "profit", "report", "stock", "add_expense", "add_sale", "add_purchase", "staff_detail", "sub_account_lookup", "help", "unknown"
- amount: number if mentioned, else null
- note: person name or sub-account name if mentioned, else null
Use "staff_detail" when asking about a specific staff member or salary. Use "sub_account_lookup" when asking about any named sub-account.
Example: {"intent":"staff_detail","amount":null,"note":"imtiyas"}`
          },
          { role: 'user', content: text }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'classify_intent',
            description: 'Classify a shop account message',
            parameters: {
              type: 'object',
              properties: {
                intent: { type: 'string', enum: ['sales', 'purchase', 'expense', 'profit', 'report', 'stock', 'add_expense', 'add_sale', 'add_purchase', 'staff_detail', 'sub_account_lookup', 'help', 'unknown'] },
                amount: { type: 'number' },
                note: { type: 'string' }
              },
              required: ['intent']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'classify_intent' } }
      }),
    });

    if (!response.ok) {
      console.error('AI intent detection failed:', response.status);
      return { intent: 'unknown', raw: text };
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      return {
        intent: parsed.intent || 'unknown',
        amount: parsed.amount || undefined,
        note: parsed.note || undefined,
        raw: text,
      };
    }
    return { intent: 'unknown', raw: text };
  } catch (e) {
    console.error('AI fallback error:', e);
    return { intent: 'unknown', raw: text };
  }
}

// --- Command Handlers ---

async function handleSalesCommand(supabase: any): Promise<string> {
  const { data: rows } = await supabase
    .from('account_rows')
    .select('credit, account, date, sub_account')
    .or('account.ilike.%sale%,account.ilike.%sales%');

  const allRows = rows ?? [];
  const total = allRows.reduce((sum: number, r: any) => sum + Number(r.credit || 0), 0);
  return `💰 <b>Sales Total:</b> ${total.toLocaleString()}\n\n📊 ${allRows.length} transaction(s)`;
}

async function handlePurchaseCommand(supabase: any): Promise<string> {
  const { data: rows } = await supabase
    .from('account_rows')
    .select('debit, account')
    .ilike('account', '%purchase%');

  const total = (rows ?? []).reduce((sum: number, r: any) => sum + Number(r.debit || 0), 0);
  return `🛒 <b>Purchase Total:</b> ${total.toLocaleString()}\n\n📊 ${(rows ?? []).length} transaction(s)`;
}

async function handleExpenseCommand(supabase: any): Promise<string> {
  const { data: rows } = await supabase
    .from('account_rows')
    .select('debit, account, sub_account')
    .ilike('account', '%expense%');

  const allRows = rows ?? [];
  const total = allRows.reduce((sum: number, r: any) => sum + Number(r.debit || 0), 0);

  // Group by sub_account
  const groups: Record<string, number> = {};
  allRows.forEach((r: any) => {
    const key = r.sub_account || 'Other';
    groups[key] = (groups[key] || 0) + Number(r.debit || 0);
  });

  let detail = '';
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8);
  sorted.forEach(([name, val]) => {
    detail += `  • ${name}: ${val.toLocaleString()}\n`;
  });

  return `💸 <b>Expense Total:</b> ${total.toLocaleString()}\n\n${detail}\n📊 ${allRows.length} transaction(s)`;
}

async function handleProfitCommand(supabase: any, settings: any): Promise<string> {
  const { data: rows } = await supabase.from('account_rows').select('credit, debit, account');
  const allRows = rows ?? [];

  const totalSales = allRows.filter((r: any) => /sale/i.test(r.account || '')).reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
  const totalPurchase = allRows.filter((r: any) => /purchase/i.test(r.account || '')).reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
  const totalExpense = allRows.filter((r: any) => /expense/i.test(r.account || '')).reduce((s: number, r: any) => s + Number(r.debit || 0), 0);

  const grossProfit = totalSales - totalPurchase;
  const stockValue = Number(settings?.stock_value || 0);

  let reply = `📊 <b>Profit Report</b>\n\nTotal Sales: ${totalSales.toLocaleString()}\nTotal Purchase: ${totalPurchase.toLocaleString()}\n<b>Gross Profit: ${grossProfit.toLocaleString()}</b>\n`;

  if (stockValue > 0) {
    const netProfit = grossProfit + stockValue - totalExpense;
    reply += `\nStock Value: ${stockValue.toLocaleString()}\nTotal Expense: ${totalExpense.toLocaleString()}\n<b>Net Profit: ${netProfit.toLocaleString()}</b>`;
  } else {
    reply += `\nTotal Expense: ${totalExpense.toLocaleString()}\n\n⚠️ Stock value not set. Set it in Telegram Settings to calculate Net Profit.`;
  }

  return reply;
}

async function handleStockCommand(settings: any): Promise<string> {
  const stockValue = Number(settings?.stock_value || 0);
  if (stockValue > 0) {
    return `📦 <b>Current Stock Value:</b> ${stockValue.toLocaleString()}`;
  }
  return `⚠️ Stock value not set. Please update it in Telegram Settings.`;
}

async function handleReportCommand(supabase: any, settings: any): Promise<string> {
  const { data: rows } = await supabase.from('account_rows').select('credit, debit, account');
  const allRows = rows ?? [];

  const totalSales = allRows.filter((r: any) => /sale/i.test(r.account || '')).reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
  const totalPurchase = allRows.filter((r: any) => /purchase/i.test(r.account || '')).reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
  const totalExpense = allRows.filter((r: any) => /expense/i.test(r.account || '')).reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
  const totalStaff = allRows.filter((r: any) => /staff|worker/i.test(r.account || '')).reduce((s: number, r: any) => s + Number(r.debit || 0), 0);

  const grossProfit = totalSales - totalPurchase;
  const stockValue = Number(settings?.stock_value || 0);

  let reply = `📋 <b>Full Report</b>\n\n`;
  reply += `💰 Sales: ${totalSales.toLocaleString()}\n`;
  reply += `🛒 Purchase: ${totalPurchase.toLocaleString()}\n`;
  reply += `💸 Expenses: ${totalExpense.toLocaleString()}\n`;
  reply += `👷 Staff/Workers: ${totalStaff.toLocaleString()}\n`;
  reply += `\n<b>Gross Profit: ${grossProfit.toLocaleString()}</b>\n`;

  if (stockValue > 0) {
    const netProfit = grossProfit + stockValue - totalExpense;
    reply += `📦 Stock Value: ${stockValue.toLocaleString()}\n`;
    reply += `<b>Net Profit: ${netProfit.toLocaleString()}</b>`;
  } else {
    reply += `\n⚠️ Set stock value in settings for Net Profit.`;
  }

  return reply;
}

async function handleSubAccountLookup(supabase: any, name: string): Promise<string> {
  if (!name) {
    return `❓ Please specify a name.\n\nExample: <b>imtiyas</b> or <b>staff imtiyas</b>`;
  }

  const { data: rows } = await supabase
    .from('account_rows')
    .select('debit, credit, account, sub_account, date, description')
    .ilike('sub_account', `%${name}%`);

  const allRows = rows ?? [];
  if (allRows.length === 0) {
    return `❓ No records found for "<b>${name}</b>".\n\nCheck the name and try again.`;
  }

  const totalDebit = allRows.reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
  const totalCredit = allRows.reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
  const account = allRows[0]?.account || 'Unknown';

  let reply = `👤 <b>${name.toUpperCase()}</b> (${account})\n\n`;
  reply += `💳 Total Debit: ${totalDebit.toLocaleString()}\n`;
  reply += `💰 Total Credit: ${totalCredit.toLocaleString()}\n`;
  reply += `📊 ${allRows.length} transaction(s)\n`;

  // Show recent transactions (last 5)
  const recent = allRows.slice(-5);
  if (recent.length > 0) {
    reply += `\n📝 <b>Recent:</b>\n`;
    recent.forEach((r: any) => {
      const d = r.debit > 0 ? `Dr ${Number(r.debit).toLocaleString()}` : `Cr ${Number(r.credit).toLocaleString()}`;
      reply += `  • ${r.date || '-'} | ${d} | ${r.description || '-'}\n`;
    });
  }

  return reply;
}

function handleHelpCommand(): string {
  return `🤖 <b>Accounts Bot</b>\n\nYou can type naturally:\n\n💰 <b>sales</b> — Total sales\n🛒 <b>purchase</b> — Total purchase\n💸 <b>expense</b> — Expense breakdown\n📊 <b>profit</b> — Profit report\n📦 <b>stock</b> — Current stock value\n📋 <b>report</b> — Full summary\n👤 <b>imtiyas</b> — Staff/sub-account details\n\n<i>You can also type freely like "imtiyas salary" or "staff aazir"</i>`;
}

// --- Main ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), { status: 500, headers: corsHeaders });

  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!TELEGRAM_API_KEY) return new Response(JSON.stringify({ error: 'TELEGRAM_API_KEY not configured' }), { status: 500, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Check if bot is active
  const { data: settings } = await supabase.from('telegram_settings').select('*').eq('id', 1).single();
  if (!settings?.is_active) {
    return new Response(JSON.stringify({ ok: true, message: 'Bot is inactive' }), { headers: corsHeaders });
  }

  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state')
    .select('update_offset')
    .eq('id', 1)
    .single();

  if (stateErr) return new Response(JSON.stringify({ error: stateErr.message }), { status: 500, headers: corsHeaders });

  let currentOffset = state.update_offset;
  let totalProcessed = 0;

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = MAX_RUNTIME_MS - elapsed;
    if (remainingMs < MIN_REMAINING_MS) break;

    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

    const response = await fetch(`${GATEWAY_URL}/getUpdates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ offset: currentOffset, timeout, allowed_updates: ['message'] }),
    });

    const data = await response.json();
    if (!response.ok) return new Response(JSON.stringify({ error: data }), { status: 502, headers: corsHeaders });

    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    // Store messages
    const rows = updates
      .filter((u: any) => u.message)
      .map((u: any) => ({
        update_id: u.update_id,
        chat_id: u.message.chat.id,
        text: u.message.text ?? null,
        raw_update: u,
      }));

    if (rows.length > 0) {
      await supabase.from('telegram_messages').upsert(rows, { onConflict: 'update_id' });
      totalProcessed += rows.length;
    }

    // Process each message
    for (const update of updates) {
      if (!update.message?.text) continue;
      const chatId = update.message.chat.id;
      const text = update.message.text;

      console.log(`[telegram-poll] Message from ${chatId}: "${text}"`);

      // Try keyword parsing first
      let intent = parseMessage(text);

      // AI fallback if no match
      if (!intent) {
        console.log(`[telegram-poll] No keyword match, using AI fallback for: "${text}"`);
        intent = await aiDetectIntent(text, LOVABLE_API_KEY);
        console.log(`[telegram-poll] AI detected intent: ${intent.intent}`);
      }

      let reply = '';

      switch (intent.intent) {
        case 'sales':
          reply = await handleSalesCommand(supabase);
          break;
        case 'purchase':
          reply = await handlePurchaseCommand(supabase);
          break;
        case 'expense':
          reply = await handleExpenseCommand(supabase);
          break;
        case 'profit':
          reply = await handleProfitCommand(supabase, settings);
          break;
        case 'stock':
          reply = await handleStockCommand(settings);
          break;
        case 'report':
          reply = await handleReportCommand(supabase, settings);
          break;
        case 'help':
          reply = handleHelpCommand();
          break;
        case 'staff_detail':
        case 'sub_account_lookup':
          reply = await handleSubAccountLookup(supabase, intent.note || '');
          break;
        case 'add_expense':
        case 'add_sale':
        case 'add_purchase':
          reply = `⚠️ Adding transactions via Telegram is not yet supported.\nPlease use the Admin Panel to add records.`;
          break;
        default:
          reply = `❓ I didn't understand that.\n\nType <b>help</b> to see available commands.`;
      }

      if (reply) {
        await sendMessage(chatId, reply, LOVABLE_API_KEY, TELEGRAM_API_KEY);
        console.log(`[telegram-poll] Replied to ${chatId} with intent: ${intent.intent}`);
      }
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase.from('telegram_bot_state').update({ update_offset: newOffset, updated_at: new Date().toISOString() }).eq('id', 1);
    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed: totalProcessed }), { headers: corsHeaders });
});

async function sendMessage(chatId: number, text: string, lovableKey: string, telegramKey: string) {
  await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': telegramKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}
