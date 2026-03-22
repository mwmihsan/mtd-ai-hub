import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Process commands
    for (const update of updates) {
      if (!update.message?.text) continue;
      const chatId = update.message.chat.id;
      const text = update.message.text.toLowerCase().trim();

      let reply = '';

      if (text === 'sales' || text === '/sales') {
        reply = await handleSalesCommand(supabase);
      } else if (text === 'profit' || text === '/profit') {
        reply = await handleProfitCommand(supabase, settings);
      } else if (text === 'help' || text === '/help' || text === '/start') {
        reply = '🤖 Accounts Bot\n\nCommands:\n/sales — Total sales\n/profit — Profit report\n/help — Show this help';
      }

      if (reply) {
        await sendMessage(chatId, reply, LOVABLE_API_KEY, TELEGRAM_API_KEY);
      }
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase.from('telegram_bot_state').update({ update_offset: newOffset, updated_at: new Date().toISOString() }).eq('id', 1);
    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed: totalProcessed }), { headers: corsHeaders });
});

async function handleSalesCommand(supabase: any): Promise<string> {
  const { data: rows } = await supabase
    .from('account_rows')
    .select('credit, account')
    .ilike('account', '%sale%');

  const total = (rows ?? []).reduce((sum: number, r: any) => sum + Number(r.credit || 0), 0);
  return `💰 Sales Total: ${total.toLocaleString()}`;
}

async function handleProfitCommand(supabase: any, settings: any): Promise<string> {
  const { data: rows } = await supabase.from('account_rows').select('credit, debit, account');
  const allRows = rows ?? [];

  const totalSales = allRows.filter((r: any) => r.account?.toLowerCase().includes('sale')).reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
  const totalPurchase = allRows.filter((r: any) => r.account?.toLowerCase().includes('purchase')).reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
  const totalExpense = allRows.filter((r: any) => r.account?.toLowerCase().includes('expense')).reduce((s: number, r: any) => s + Number(r.debit || 0), 0);

  const grossProfit = totalSales - totalPurchase;
  const stockValue = Number(settings?.stock_value || 0);

  let reply = `📊 Profit Report\n\nTotal Sales: ${totalSales.toLocaleString()}\nTotal Purchase: ${totalPurchase.toLocaleString()}\nGross Profit: ${grossProfit.toLocaleString()}\n`;

  if (stockValue > 0) {
    const netProfit = grossProfit + stockValue - totalExpense;
    reply += `\nStock Value: ${stockValue.toLocaleString()}\nTotal Expense: ${totalExpense.toLocaleString()}\nNet Profit: ${netProfit.toLocaleString()}`;
  } else {
    reply += `\nTotal Expense: ${totalExpense.toLocaleString()}\n\n⚠️ Stock value not set. Set it in Telegram Settings to calculate Net Profit.`;
  }

  return reply;
}

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
