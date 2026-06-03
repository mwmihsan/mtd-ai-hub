import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------- Types ----------

type IntentKind =
  | 'sales' | 'purchase' | 'expense' | 'profit' | 'report' | 'stock'
  | 'customer_lookup' | 'help' | 'reset' | 'unknown';

interface DateRange {
  kind: 'all' | 'today' | 'yesterday' | 'month' | 'year' | 'range';
  month?: number;     // 1-12
  year?: number;
  from?: string;      // ISO date
  to?: string;        // ISO date
  label: string;      // human label e.g. "April 2024", "Today", "All time"
}

interface Extracted {
  intent: IntentKind;
  customer_query?: string | null;
  date_text?: string | null;     // raw date phrase
  month?: number | null;         // 1-12 if explicit
  year?: number | null;
  confidence: number;            // 0-1
}

interface ConvContext {
  customer?: { name: string };           // resolved sub_account
  date?: DateRange;
}

interface Pending {
  type: 'customer_select' | 'date_year' | 'date_month' | 'correction_text';
  original: Extracted;                   // request to replay after answer
  candidates?: string[];                 // for customer_select
  available_years?: number[];            // for date_year
  feedback_id?: string;                  // for correction_text
  original_query?: string;               // for correction_text
  wrong_result?: string;                 // for correction_text
}

// ---------- Helpers ----------

function fmt(n: number): string {
  return Number(n || 0).toLocaleString();
}

const MONTHS = [
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
];

function monthFromText(t: string): number | null {
  const lower = t.toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    if (lower.includes(MONTHS[i]) || lower.includes(MONTHS[i].slice(0, 3))) return i + 1;
  }
  return null;
}

function monthLabel(m: number, y?: number): string {
  return `${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)}${y ? ' ' + y : ''}`;
}

function parseRowDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Try ISO first, then dd/mm/yyyy or dd-mm-yyyy
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const day = +m[1], mon = +m[2], year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    d = new Date(year, mon - 1, day);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function dateInRange(rowDate: string | null | undefined, range: DateRange): boolean {
  if (range.kind === 'all') return true;
  const d = parseRowDate(rowDate);
  if (!d) return false;
  if (range.kind === 'today') {
    const t = new Date(); t.setHours(0,0,0,0);
    const dd = new Date(d); dd.setHours(0,0,0,0);
    return dd.getTime() === t.getTime();
  }
  if (range.kind === 'yesterday') {
    const t = new Date(); t.setDate(t.getDate() - 1); t.setHours(0,0,0,0);
    const dd = new Date(d); dd.setHours(0,0,0,0);
    return dd.getTime() === t.getTime();
  }
  if (range.kind === 'month') {
    return d.getFullYear() === range.year && (d.getMonth() + 1) === range.month;
  }
  if (range.kind === 'year') {
    return d.getFullYear() === range.year;
  }
  if (range.kind === 'range' && range.from && range.to) {
    return d >= new Date(range.from) && d <= new Date(range.to);
  }
  return false;
}

// ---------- AI extraction ----------

// ---------- Training: aliases, intents, corrections ----------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Replace alias tokens in the message with the real sub-account name. */
async function expandAliases(supabase: any, text: string): Promise<{ text: string; resolved?: string }> {
  const { data: aliases } = await supabase.from('account_aliases').select('alias, sub_account_name');
  if (!aliases?.length) return { text };
  const norm = ' ' + normalize(text) + ' ';
  let resolved: string | undefined;
  let out = text;
  // Longest aliases first to avoid partial overlap
  const sorted = [...aliases].sort((a: any, b: any) => b.alias.length - a.alias.length);
  for (const a of sorted) {
    const al = ' ' + normalize(a.alias) + ' ';
    if (norm.includes(al)) {
      const re = new RegExp(`\\b${a.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      out = out.replace(re, a.sub_account_name);
      resolved = a.sub_account_name;
      break;
    }
  }
  return { text: out, resolved };
}

/** Look up the user's text against trained intent examples. */
async function lookupTrainedIntent(supabase: any, text: string): Promise<string | null> {
  const { data: examples } = await supabase.from('intent_training').select('example_text, intent');
  if (!examples?.length) return null;
  const target = normalize(text);
  const targetTokens = new Set(target.split(' ').filter(Boolean));
  let best: { intent: string; score: number } | null = null;
  for (const ex of examples) {
    const exNorm = normalize(ex.example_text);
    if (target === exNorm) return ex.intent;
    const exTokens = new Set(exNorm.split(' ').filter(Boolean));
    let overlap = 0;
    exTokens.forEach((t) => { if (targetTokens.has(t)) overlap++; });
    const score = overlap / Math.max(exTokens.size, 1);
    if (!best || score > best.score) best = { intent: ex.intent, score };
  }
  return best && best.score >= 0.75 ? best.intent : null;
}

/** Look up a previous correction for this query. */
async function lookupCorrection(supabase: any, text: string): Promise<{ id: string; correct_result: string } | null> {
  const target = normalize(text);
  const { data } = await supabase.from('corrections').select('id, original_query, correct_result').limit(500);
  if (!data?.length) return null;
  const hit = data.find((c: any) => normalize(c.original_query) === target);
  if (!hit) return null;
  // Increment usage_count
  await supabase.from('corrections')
    .update({ usage_count: (await supabase.from('corrections').select('usage_count').eq('id', hit.id).single()).data?.usage_count + 1 || 1 })
    .eq('id', hit.id);
  return { id: hit.id, correct_result: hit.correct_result };
}

/** Map a trained intent string to an Extracted shape. */
function trainedIntentToExtract(intent: string, customer_query: string | null): Extracted {
  const map: Record<string, IntentKind> = {
    sales_report: 'sales',
    purchase_report: 'purchase',
    expense_report: 'expense',
    profit_report: 'profit',
    full_report: 'report',
    stock_value: 'stock',
    customer_lookup: 'customer_lookup',
    help: 'help',
    reset: 'reset',
    sales: 'sales',
    purchase: 'purchase',
    expense: 'expense',
    profit: 'profit',
    report: 'report',
    stock: 'stock',
  };
  return {
    intent: map[intent] || 'unknown',
    customer_query,
    date_text: null,
    month: null,
    year: null,
    confidence: 0.95,
  };
}

async function aiExtract(text: string, apiKey: string): Promise<Extracted> {
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
            content: `You extract structured parameters from a Telegram message about a shop accounts database.
Intents:
- sales: totals of sales (Account ilike "sale")
- purchase: totals of purchases
- expense: totals of expenses
- profit: profit report (sales - purchase, etc.)
- report: full summary
- stock: stock value
- customer_lookup: any specific person/customer/staff/supplier/sub-account inquiry
- help: help / start
- reset: clear conversation context (cancel, reset, new)
- unknown: anything else

Return a confidence between 0 and 1. If the message is ambiguous about which customer or which date period, lower the confidence below 0.9.
Do NOT guess a year or month that was not mentioned. Use null for missing values.`
          },
          { role: 'user', content: text }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_query',
            description: 'Extract structured query parameters',
            parameters: {
              type: 'object',
              properties: {
                intent: { type: 'string', enum: ['sales','purchase','expense','profit','report','stock','customer_lookup','help','reset','unknown'] },
                customer_query: { type: ['string','null'], description: 'Customer / staff / sub-account name as mentioned, else null' },
                date_text: { type: ['string','null'], description: 'Date phrase if any, else null' },
                month: { type: ['integer','null'], minimum: 1, maximum: 12 },
                year: { type: ['integer','null'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
              },
              required: ['intent','confidence']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'extract_query' } }
      }),
    });

    if (!response.ok) {
      console.error('AI extract failed:', response.status, await response.text());
      return { intent: 'unknown', confidence: 0 };
    }
    const data = await response.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc?.function?.arguments) return { intent: 'unknown', confidence: 0 };
    const p = JSON.parse(tc.function.arguments);
    return {
      intent: (p.intent || 'unknown') as IntentKind,
      customer_query: p.customer_query ?? null,
      date_text: p.date_text ?? null,
      month: p.month ?? null,
      year: p.year ?? null,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
    };
  } catch (e) {
    console.error('AI extract error:', e);
    return { intent: 'unknown', confidence: 0 };
  }
}

// ---------- Customer resolution ----------

async function findCustomerCandidates(supabase: any, query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  // Exact match (case-insensitive)
  const { data: exact } = await supabase
    .from('account_rows')
    .select('sub_account')
    .ilike('sub_account', q);
  const exactNames = Array.from(new Set((exact ?? []).map((r: any) => r.sub_account).filter(Boolean)));
  if (exactNames.length === 1) return exactNames as string[];

  // Partial match
  const { data: partial } = await supabase
    .from('account_rows')
    .select('sub_account')
    .ilike('sub_account', `%${q}%`);
  const names = Array.from(new Set((partial ?? []).map((r: any) => r.sub_account).filter(Boolean))) as string[];

  if (exactNames.length > 1) return exactNames as string[];
  return names;
}

// ---------- Date resolution ----------

async function availableYears(supabase: any): Promise<number[]> {
  const { data } = await supabase.from('account_rows').select('date');
  const years = new Set<number>();
  (data ?? []).forEach((r: any) => {
    const d = parseRowDate(r.date);
    if (d) years.add(d.getFullYear());
  });
  return Array.from(years).sort();
}

function resolveDateFromExtract(ex: Extracted, fallback?: DateRange): DateRange | null {
  const txt = (ex.date_text || '').toLowerCase();
  if (/\btoday\b/.test(txt)) return { kind: 'today', label: 'Today' };
  if (/\byesterday\b/.test(txt)) return { kind: 'yesterday', label: 'Yesterday' };

  const month = ex.month ?? monthFromText(txt);
  const year = ex.year ?? (txt.match(/\b(20\d{2})\b/) ? parseInt(txt.match(/\b(20\d{2})\b/)![1]) : null);

  if (month && year) return { kind: 'month', month, year, label: monthLabel(month, year) };
  if (year && !month) return { kind: 'year', year, label: String(year) };
  if (month && !year) {
    // Need year disambiguation by caller
    return { kind: 'month', month, label: monthLabel(month) };
  }
  if (fallback) return fallback;
  return null;
}

// ---------- Conversation state ----------

async function loadState(supabase: any, chatId: number): Promise<{ pending: Pending | null; context: ConvContext }> {
  const { data } = await supabase
    .from('telegram_conversation_state')
    .select('pending, context, expires_at')
    .eq('chat_id', chatId)
    .maybeSingle();
  // Expire memory after 5 minutes
  if (data?.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { pending: null, context: {} };
  }
  return {
    pending: (data?.pending ?? null) as Pending | null,
    context: (data?.context ?? {}) as ConvContext,
  };
}

async function saveState(supabase: any, chatId: number, pending: Pending | null, context: ConvContext) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await supabase.from('telegram_conversation_state').upsert({
    chat_id: chatId,
    pending,
    context,
    updated_at: new Date().toISOString(),
    expires_at: expiresAt,
  }, { onConflict: 'chat_id' });
}

async function clearPending(supabase: any, chatId: number, context: ConvContext) {
  await saveState(supabase, chatId, null, context);
}

// ---------- Filters header ----------

function filtersHeader(ctx: { customer?: string; date?: DateRange; report: string }): string {
  return `📌 <b>Applied filters</b>\n` +
    `  • Customer: ${ctx.customer || 'All'}\n` +
    `  • Date range: ${ctx.date?.label || 'All time'}\n` +
    `  • Report type: ${ctx.report}\n\n`;
}

// ---------- Handlers ----------

async function fetchRows(supabase: any, opts: { customer?: string; accountLike?: string }) {
  let q = supabase.from('account_rows').select('credit, debit, account, sub_account, date, description');
  if (opts.customer) q = q.eq('sub_account', opts.customer);
  if (opts.accountLike) q = q.ilike('account', `%${opts.accountLike}%`);
  const { data } = await q;
  return data ?? [];
}

function applyDateFilter(rows: any[], range: DateRange): any[] {
  if (range.kind === 'all') return rows;
  return rows.filter((r) => dateInRange(r.date, range));
}

async function handleTotalsCommand(
  supabase: any,
  kind: 'sales' | 'purchase' | 'expense',
  ctx: ConvContext,
): Promise<string> {
  const accountLike =
    kind === 'sales' ? 'sale' : kind === 'purchase' ? 'purchase' : 'expense';
  const field: 'credit' | 'debit' = kind === 'sales' ? 'credit' : 'debit';
  const rows = applyDateFilter(
    await fetchRows(supabase, { customer: ctx.customer?.name, accountLike }),
    ctx.date ?? { kind: 'all', label: 'All time' },
  );
  const total = rows.reduce((s, r) => s + Number(r[field] || 0), 0);
  const label = kind === 'sales' ? '💰 Sales' : kind === 'purchase' ? '🛒 Purchase' : '💸 Expense';
  const header = filtersHeader({
    customer: ctx.customer?.name,
    date: ctx.date,
    report: kind[0].toUpperCase() + kind.slice(1),
  });
  let reply = header + `${label} Total: <b>${fmt(total)}</b>\n📊 ${rows.length} transaction(s)`;

  if (kind === 'expense' && !ctx.customer) {
    const groups: Record<string, number> = {};
    rows.forEach((r) => {
      const k = r.sub_account || 'Other';
      groups[k] = (groups[k] || 0) + Number(r.debit || 0);
    });
    const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) {
      reply += `\n\n<b>Breakdown:</b>\n`;
      top.forEach(([n, v]) => { reply += `  • ${n}: ${fmt(v)}\n`; });
    }
  }
  return reply;
}

async function handleProfit(supabase: any, ctx: ConvContext, settings: any): Promise<string> {
  const range = ctx.date ?? { kind: 'all', label: 'All time' };
  const all = applyDateFilter(await fetchRows(supabase, { customer: ctx.customer?.name }), range);
  const sales = all.filter((r) => /sale/i.test(r.account || '')).reduce((s, r) => s + Number(r.credit || 0), 0);
  const purchase = all.filter((r) => /purchase/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const expense = all.filter((r) => /expense/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const gross = sales - purchase;
  const stockValue = Number(settings?.stock_value || 0);

  let reply = filtersHeader({ customer: ctx.customer?.name, date: ctx.date, report: 'Profit' });
  reply += `Total Sales: ${fmt(sales)}\nTotal Purchase: ${fmt(purchase)}\n<b>Gross Profit: ${fmt(gross)}</b>\n`;
  if (stockValue > 0 && !ctx.customer && range.kind === 'all') {
    reply += `\nStock Value: ${fmt(stockValue)}\nTotal Expense: ${fmt(expense)}\n<b>Net Profit: ${fmt(gross + stockValue - expense)}</b>`;
  } else {
    reply += `\nTotal Expense: ${fmt(expense)}`;
    if (stockValue === 0) reply += `\n\n⚠️ Stock value not set. Set it in Telegram Settings for Net Profit.`;
  }
  return reply;
}

async function handleReport(supabase: any, ctx: ConvContext, settings: any): Promise<string> {
  const range = ctx.date ?? { kind: 'all', label: 'All time' };
  const all = applyDateFilter(await fetchRows(supabase, { customer: ctx.customer?.name }), range);
  const sales = all.filter((r) => /sale/i.test(r.account || '')).reduce((s, r) => s + Number(r.credit || 0), 0);
  const purchase = all.filter((r) => /purchase/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const expense = all.filter((r) => /expense/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const staff = all.filter((r) => /staff|worker/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const gross = sales - purchase;
  const stockValue = Number(settings?.stock_value || 0);

  let reply = filtersHeader({ customer: ctx.customer?.name, date: ctx.date, report: 'Full Report' });
  reply += `💰 Sales: ${fmt(sales)}\n🛒 Purchase: ${fmt(purchase)}\n💸 Expenses: ${fmt(expense)}\n👷 Staff/Workers: ${fmt(staff)}\n\n<b>Gross Profit: ${fmt(gross)}</b>\n`;
  if (stockValue > 0 && !ctx.customer && range.kind === 'all') {
    reply += `📦 Stock Value: ${fmt(stockValue)}\n<b>Net Profit: ${fmt(gross + stockValue - expense)}</b>`;
  } else if (stockValue === 0) {
    reply += `\n⚠️ Set stock value in settings for Net Profit.`;
  }
  return reply;
}

async function handleCustomerSummary(supabase: any, ctx: ConvContext): Promise<string> {
  const range = ctx.date ?? { kind: 'all', label: 'All time' };
  const rows = applyDateFilter(await fetchRows(supabase, { customer: ctx.customer!.name }), range);
  const debit = rows.reduce((s, r) => s + Number(r.debit || 0), 0);
  const credit = rows.reduce((s, r) => s + Number(r.credit || 0), 0);
  const account = rows[0]?.account || 'Unknown';

  let reply = filtersHeader({ customer: ctx.customer!.name, date: ctx.date, report: 'Customer Summary' });
  reply += `👤 <b>${ctx.customer!.name}</b> (${account})\n`;
  reply += `💳 Total Debit: ${fmt(debit)}\n💰 Total Credit: ${fmt(credit)}\n📊 ${rows.length} transaction(s)\n`;
  const recent = rows.slice(-5);
  if (recent.length) {
    reply += `\n📝 <b>Recent:</b>\n`;
    recent.forEach((r) => {
      const d = Number(r.debit) > 0 ? `Dr ${fmt(Number(r.debit))}` : `Cr ${fmt(Number(r.credit))}`;
      reply += `  • ${r.date || '-'} | ${d} | ${r.description || '-'}\n`;
    });
  }
  return reply;
}

function handleHelp(): string {
  return `🤖 <b>Accounts Bot</b>\n\nAsk naturally — I extract <b>intent</b>, <b>customer</b>, <b>date range</b> before querying.\n\n` +
    `Examples:\n` +
    `  • <i>sales april 2024</i>\n` +
    `  • <i>profit this year</i>\n` +
    `  • <i>nisran sales</i> → I'll ask which Nisran if multiple\n` +
    `  • <i>expense today</i>\n` +
    `  • <i>report</i>\n\n` +
    `Type <b>reset</b> to clear the current customer/date context.`;
}

// ---------- Orchestrator ----------

async function answerPending(
  supabase: any,
  chatId: number,
  pending: Pending,
  text: string,
  context: ConvContext,
  settings: any,
): Promise<{ reply: string; consumed: boolean }> {
  const t = text.trim();
  if (pending.type === 'customer_select' && pending.candidates) {
    const idx = parseInt(t, 10);
    let chosen: string | undefined;
    if (!isNaN(idx) && idx >= 1 && idx <= pending.candidates.length) {
      chosen = pending.candidates[idx - 1];
    } else {
      // Try exact name match within candidates
      chosen = pending.candidates.find((c) => c.toLowerCase() === t.toLowerCase());
    }
    if (!chosen) return { reply: '', consumed: false };
    const newCtx: ConvContext = { ...context, customer: { name: chosen } };
    const reply = await runIntent(supabase, pending.original, newCtx, settings, chatId);
    return { reply, consumed: true };
  }
  if (pending.type === 'date_year' && pending.available_years && pending.original.month) {
    const yr = parseInt(t.match(/\b(20\d{2})\b/)?.[1] || t, 10);
    if (!yr || !pending.available_years.includes(yr)) return { reply: '', consumed: false };
    const m = pending.original.month!;
    const newCtx: ConvContext = { ...context, date: { kind: 'month', month: m, year: yr, label: monthLabel(m, yr) } };
    const reply = await runIntent(supabase, { ...pending.original, year: yr }, newCtx, settings, chatId);
    return { reply, consumed: true };
  }
  if (pending.type === 'date_month') {
    const m = monthFromText(t) ?? parseInt(t, 10);
    if (!m || m < 1 || m > 12) return { reply: '', consumed: false };
    const yr = pending.original.year ?? new Date().getFullYear();
    const newCtx: ConvContext = { ...context, date: { kind: 'month', month: m, year: yr, label: monthLabel(m, yr) } };
    const reply = await runIntent(supabase, { ...pending.original, month: m, year: yr }, newCtx, settings, chatId);
    return { reply, consumed: true };
  }
  if (pending.type === 'correction_text' && pending.feedback_id && pending.original_query) {
    // User is providing the correct answer
    await supabase.from('corrections').insert({
      original_query: pending.original_query,
      wrong_result: pending.wrong_result || null,
      correct_result: text.trim(),
      usage_count: 0,
    });
    await clearPending(supabase, chatId, context);
    return { reply: `✅ Got it. I'll use that next time for "<b>${pending.original_query}</b>".`, consumed: true };
  }
  return { reply: '', consumed: false };
}

async function runIntent(
  supabase: any,
  ex: Extracted,
  ctxIn: ConvContext,
  settings: any,
  chatId: number,
): Promise<string> {
  let context: ConvContext = { ...ctxIn };

  // Resolve date from extract or keep context
  const resolved = resolveDateFromExtract(ex, context.date);
  if (resolved) context.date = resolved;

  // Need year if month-only
  if (context.date && context.date.kind === 'month' && !context.date.year) {
    const years = await availableYears(supabase);
    if (years.length === 1) {
      context.date.year = years[0];
      context.date.label = monthLabel(context.date.month!, years[0]);
    } else {
      await saveState(supabase, chatId, {
        type: 'date_year',
        original: ex,
        available_years: years,
      }, context);
      return `📅 Which year for ${monthLabel(context.date.month!)}?\n\n${years.map((y, i) => `  ${i + 1}. ${y}`).join('\n')}\n\nReply with the year (e.g. <b>${years[years.length - 1]}</b>).`;
    }
  }

  // Customer resolution
  if (ex.customer_query) {
    const cands = await findCustomerCandidates(supabase, ex.customer_query);
    if (cands.length === 0) {
      await clearPending(supabase, chatId, context);
      return `❓ No customer found matching "<b>${ex.customer_query}</b>". Check the name and try again.`;
    }
    if (cands.length > 1) {
      await saveState(supabase, chatId, {
        type: 'customer_select',
        original: ex,
        candidates: cands,
      }, context);
      return `🔎 Multiple accounts found for "<b>${ex.customer_query}</b>":\n\n${cands.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n\nReply with the number or full name.`;
    }
    context.customer = { name: cands[0] };
  }

  await clearPending(supabase, chatId, context);

  // Dispatch
  switch (ex.intent) {
    case 'sales':
    case 'purchase':
    case 'expense':
      return handleTotalsCommand(supabase, ex.intent, context);
    case 'profit':
      return handleProfit(supabase, context, settings);
    case 'report':
      return handleReport(supabase, context, settings);
    case 'stock': {
      const v = Number(settings?.stock_value || 0);
      return v > 0 ? `📦 <b>Current Stock Value:</b> ${fmt(v)}` : `⚠️ Stock value not set. Update it in Telegram Settings.`;
    }
    case 'customer_lookup':
      if (!context.customer) {
        return `❓ Please tell me which customer. Example: <i>nisran</i> or <i>imtiyas</i>.`;
      }
      return handleCustomerSummary(supabase, context);
    case 'help':
      return handleHelp();
    case 'reset':
      await saveState(supabase, chatId, null, {});
      return `🔄 Conversation context cleared.`;
    default:
      return `❓ I didn't understand that. Type <b>help</b> for examples.`;
  }
}

// ---------- Main ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), { status: 500, headers: corsHeaders });
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!TELEGRAM_API_KEY) return new Response(JSON.stringify({ error: 'TELEGRAM_API_KEY not configured' }), { status: 500, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: settings } = await supabase.from('telegram_settings').select('*').eq('id', 1).single();
  if (!settings?.is_active) {
    return new Response(JSON.stringify({ ok: true, message: 'Bot is inactive' }), { headers: corsHeaders });
  }

  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state').select('update_offset').eq('id', 1).single();
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

    for (const update of updates) {
      if (!update.message?.text) continue;
      const chatId = update.message.chat.id;
      const text = String(update.message.text);
      console.log(`[telegram-poll] from=${chatId} text="${text}"`);

      const { pending, context } = await loadState(supabase, chatId);

      // 1) If there's a pending clarification, try to answer it
      let reply = '';
      if (pending) {
        const r = await answerPending(supabase, chatId, pending, text, context, settings);
        if (r.consumed) reply = r.reply;
      }

      // 2) Otherwise extract a new intent
      if (!reply) {
        const lowered = text.trim().toLowerCase();
        if (lowered === 'reset' || lowered === 'cancel' || lowered === 'new') {
          await saveState(supabase, chatId, null, {});
          reply = `🔄 Conversation context cleared.`;
        } else {
          const ex = await aiExtract(text, LOVABLE_API_KEY);
          console.log(`[telegram-poll] extracted`, ex);
          if (ex.confidence < 0.5 || ex.intent === 'unknown') {
            reply = `🤔 I'm not sure what you're asking (confidence ${(ex.confidence * 100).toFixed(0)}%).\n\nTry: <i>sales april 2024</i>, <i>profit this year</i>, <i>nisran sales</i>, or type <b>help</b>.`;
          } else if (ex.confidence < 0.9 && ex.intent === 'customer_lookup' && !ex.customer_query) {
            reply = `❓ Which customer or staff did you mean? Please send the name.`;
          } else {
            reply = await runIntent(supabase, ex, context, settings, chatId);
          }
        }
      }

      if (reply) {
        await sendMessage(chatId, reply, LOVABLE_API_KEY, TELEGRAM_API_KEY);
        console.log(`[telegram-poll] replied to ${chatId}`);
      }
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase.from('telegram_bot_state').update({ update_offset: newOffset, updated_at: new Date().toISOString() }).eq('id', 1);
    currentOffset = newOffset;
  }

  return new Response(JSON.stringify({ ok: true, processed: totalProcessed }), { headers: corsHeaders });
});

async function sendMessage(
  chatId: number,
  text: string,
  lovableKey: string,
  telegramKey: string,
  feedbackId?: string,
) {
  const body: any = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (feedbackId) {
    body.reply_markup = {
      inline_keyboard: [[
        { text: '👍 Correct', callback_data: `fb:up:${feedbackId}` },
        { text: '👎 Wrong',   callback_data: `fb:down:${feedbackId}` },
      ]],
    };
  }
  await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': telegramKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function answerCallback(callbackId: string, lovableKey: string, telegramKey: string, text?: string) {
  await fetch(`${GATEWAY_URL}/answerCallbackQuery`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': telegramKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ callback_query_id: callbackId, text: text || '' }),
  });
}