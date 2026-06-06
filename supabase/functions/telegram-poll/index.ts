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
  customer?: { name: string; account_id?: string };
  date?: DateRange;
}

interface Pending {
  type: 'customer_select' | 'date_year' | 'date_month' | 'correction_text';
  original: Extracted;                   // request to replay after answer
  candidates?: Array<{ account_id: string | null; name: string }>;
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

/** Local date parser — used to recover dates when trained-intent or AI miss them. */
function parseDateFromText(text: string): { month?: number; year?: number; date_text?: string; relative?: 'today' | 'yesterday' | 'this_year' | 'last_year' | 'this_month' | 'last_month' } {
  const t = (text || '').toLowerCase();
  const out: ReturnType<typeof parseDateFromText> = {};
  if (/\btoday\b/.test(t)) { out.relative = 'today'; out.date_text = 'today'; return out; }
  if (/\byesterday\b/.test(t)) { out.relative = 'yesterday'; out.date_text = 'yesterday'; return out; }
  if (/\bthis\s+year\b/.test(t)) { out.relative = 'this_year'; out.year = new Date().getFullYear(); out.date_text = 'this year'; return out; }
  if (/\blast\s+year\b/.test(t)) { out.relative = 'last_year'; out.year = new Date().getFullYear() - 1; out.date_text = 'last year'; return out; }
  if (/\bthis\s+month\b/.test(t)) {
    const now = new Date();
    out.relative = 'this_month'; out.month = now.getMonth() + 1; out.year = now.getFullYear();
    out.date_text = 'this month'; return out;
  }
  if (/\blast\s+month\b/.test(t)) {
    const now = new Date(); now.setMonth(now.getMonth() - 1);
    out.relative = 'last_month'; out.month = now.getMonth() + 1; out.year = now.getFullYear();
    out.date_text = 'last month'; return out;
  }
  const m = monthFromText(t);
  if (m) { out.month = m; out.date_text = t; }
  const ym = t.match(/\b(20\d{2})\b/);
  if (ym) out.year = parseInt(ym[1], 10);
  return out;
}

/** Merge a parsed date into an Extracted, only filling in null fields. */
function mergeDate(ex: Extracted, parsed: ReturnType<typeof parseDateFromText>): Extracted {
  if (parsed.month && !ex.month) ex.month = parsed.month;
  if (parsed.year && !ex.year) ex.year = parsed.year;
  if (parsed.date_text && !ex.date_text) ex.date_text = parsed.date_text;
  return ex;
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

async function findCustomerCandidates(
  supabase: any,
  query: string,
): Promise<Array<{ account_id: string | null; name: string }>> {
  const q = query.trim();
  if (!q) return [];

  // 0) Account ID direct match (e.g. "ACC0003")
  const idMatch = q.toUpperCase().match(/^ACC\d{3,}$/);
  if (idMatch) {
    const { data: byId } = await supabase
      .from('accounts_master')
      .select('account_id, account_name')
      .eq('account_id', idMatch[0]);
    if (byId?.length) return byId.map((a: any) => ({ account_id: a.account_id, name: a.account_name }));
  }

  // 1) Exact match in accounts_master (normalized; tolerate ". " vs "." spacing)
  const normRaw = q.toUpperCase().replace(/\s+/g, ' ');
  const variants = new Set<string>([normRaw]);
  // Normalize "1306.JAWFER" / "1306 JAWFER" / "1306. JAWFER" → all to "1306. JAWFER"
  const numHead = q.match(/^\s*(\d{1,6})\s*\.?\s*(.+?)\s*$/);
  if (numHead) {
    const head = numHead[1];
    const rest = numHead[2].toUpperCase().replace(/\s+/g, ' ').trim();
    variants.add(`${head}. ${rest}`);
    variants.add(`${head}.${rest}`);
    variants.add(`${head} ${rest}`);
  }
  const { data: exact } = await supabase
    .from('accounts_master')
    .select('account_id, account_name')
    .in('normalized_name', Array.from(variants));
  if (exact && exact.length === 1) {
    return [{ account_id: exact[0].account_id, name: exact[0].account_name }];
  }
  if (exact && exact.length > 1) {
    return exact.map((a: any) => ({ account_id: a.account_id, name: a.account_name }));
  }

  // 1b) Numeric-prefix exact: "1306" or "1306." → match account_name starting with that number.
  const numOnly = q.trim().match(/^(\d{2,6})\.?$/);
  if (numOnly) {
    const prefix = numOnly[1];
    const { data: byNum } = await supabase
      .from('accounts_master')
      .select('account_id, account_name')
      .or(`account_name.ilike.${prefix}.%,account_name.ilike.${prefix} %`)
      .limit(20);
    if (byNum?.length) return byNum.map((a: any) => ({ account_id: a.account_id, name: a.account_name }));
  }

  // 2) Alias exact match
  const { data: aliasHit } = await supabase
    .from('account_aliases')
    .select('account_id, sub_account_name')
    .ilike('alias', q);
  const aliasIds = (aliasHit ?? []).map((a: any) => a.account_id).filter(Boolean);
  if (aliasIds.length) {
    const { data: aliasAccts } = await supabase
      .from('accounts_master')
      .select('account_id, account_name')
      .in('account_id', aliasIds);
    if (aliasAccts?.length === 1) {
      return [{ account_id: aliasAccts[0].account_id, name: aliasAccts[0].account_name }];
    }
    if (aliasAccts?.length) {
      return aliasAccts.map((a: any) => ({ account_id: a.account_id, name: a.account_name }));
    }
  }

  // 3) Partial match in accounts_master
  const { data: partial } = await supabase
    .from('accounts_master')
    .select('account_id, account_name')
    .ilike('account_name', `%${q}%`)
    .limit(20);
  if (partial?.length) {
    return partial.map((a: any) => ({ account_id: a.account_id, name: a.account_name }));
  }

  // 4) Fallback: legacy sub_account scan
  const { data: legacy } = await supabase
    .from('account_rows')
    .select('sub_account, account_id')
    .ilike('sub_account', `%${q}%`)
    .limit(50);
  const seen = new Set<string>();
  const out: Array<{ account_id: string | null; name: string }> = [];
  for (const r of legacy ?? []) {
    const key = (r.sub_account || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ account_id: r.account_id ?? null, name: r.sub_account });
  }
  return out;
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
  // Header intentionally removed — users found the "Applied filters" block noisy.
  void ctx;
  return '';
}

function customerLabel(c?: { name: string; account_id?: string }): string | undefined {
  if (!c) return undefined;
  return c.account_id ? `${c.name} (${c.account_id})` : c.name;
}

/** Drop sticky context.customer / context.date when a new message is a fresh top-level query. */
function freshenContext(ex: Extracted, rawText: string, context: ConvContext): ConvContext {
  const out: ConvContext = { ...context };
  const lower = rawText.toLowerCase();
  const prevKeyword = /\b(his|her|their|same|that|previous|above|prev)\b/.test(lower);
  const referencesPrevCustomer = !!(out.customer && (
    prevKeyword ||
    lower.includes(out.customer.name.toLowerCase())
  ));
  const referencesPrev = referencesPrevCustomer || prevKeyword;
  const topLevel = ['sales', 'purchase', 'expense', 'profit', 'report', 'stock'].includes(ex.intent);

  // If extract provides its own customer_query, the runIntent customer resolution will override anyway —
  // but clear sticky customer so we don't accidentally merge.
  if (ex.customer_query) out.customer = undefined;

  // Top-level totals/reports with no reference to previous customer → drop sticky customer.
  if (topLevel && !ex.customer_query && !referencesPrevCustomer) out.customer = undefined;

  // If the new query brings its own date phrase, drop sticky date so we don't merge.
  if (ex.date_text || ex.month || ex.year) out.date = undefined;

  // Drop sticky date whenever the new query does not explicitly reference the previous turn.
  // A bare customer_lookup (just a name) or a fresh top-level query should NOT inherit a leftover date.
  if (!referencesPrev) out.date = undefined;

  return out;
}

// ---------- Handlers ----------

async function fetchRows(supabase: any, opts: { customer?: string; account_id?: string; accountLike?: string }) {
  let q = supabase.from('account_rows').select('credit, debit, account, sub_account, date, description, account_id');
  if (opts.account_id) {
    q = q.eq('account_id', opts.account_id);
  } else if (opts.customer) {
    q = q.eq('sub_account', opts.customer);
  }
  if (opts.accountLike) q = q.ilike('account', `%${opts.accountLike}%`);
  const { data } = await q;
  return data ?? [];
}

async function fetchAccountMeta(supabase: any, account_id?: string) {
  if (!account_id) return null;
  const { data } = await supabase
    .from('accounts_master')
    .select('account_id, account_name, account_type, mobile, status')
    .eq('account_id', account_id)
    .maybeSingle();
  return data ?? null;
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
    await fetchRows(supabase, { customer: ctx.customer?.name, account_id: ctx.customer?.account_id, accountLike }),
    ctx.date ?? { kind: 'all', label: 'All time' },
  );
  const total = rows.reduce((s, r) => s + Number(r[field] || 0), 0);
  const label = kind === 'sales' ? '💰 Sales' : kind === 'purchase' ? '🛒 Purchase' : '💸 Expense';
  const header = filtersHeader({
    customer: customerLabel(ctx.customer),
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
  const all = applyDateFilter(await fetchRows(supabase, { customer: ctx.customer?.name, account_id: ctx.customer?.account_id }), range);
  const sales = all.filter((r) => /sale/i.test(r.account || '')).reduce((s, r) => s + Number(r.credit || 0), 0);
  const purchase = all.filter((r) => /purchase/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const expense = all.filter((r) => /expense/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const gross = sales - purchase;
  const stockValue = Number(settings?.stock_value || 0);

  let reply = filtersHeader({ customer: customerLabel(ctx.customer), date: ctx.date, report: 'Profit' });
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
  const all = applyDateFilter(await fetchRows(supabase, { customer: ctx.customer?.name, account_id: ctx.customer?.account_id }), range);
  const sales = all.filter((r) => /sale/i.test(r.account || '')).reduce((s, r) => s + Number(r.credit || 0), 0);
  const purchase = all.filter((r) => /purchase/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const expense = all.filter((r) => /expense/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const staff = all.filter((r) => /staff|worker/i.test(r.account || '')).reduce((s, r) => s + Number(r.debit || 0), 0);
  const gross = sales - purchase;
  const stockValue = Number(settings?.stock_value || 0);

  let reply = filtersHeader({ customer: customerLabel(ctx.customer), date: ctx.date, report: 'Full Report' });
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
  const rows = applyDateFilter(await fetchRows(supabase, { customer: ctx.customer!.name, account_id: ctx.customer!.account_id }), range);
  const debit = rows.reduce((s, r) => s + Number(r.debit || 0), 0);
  const credit = rows.reduce((s, r) => s + Number(r.credit || 0), 0);
  const account = rows[0]?.account || 'Unknown';
  const meta = await fetchAccountMeta(supabase, ctx.customer!.account_id);
  const debitCount = rows.filter((r) => Number(r.debit) > 0).length;
  const creditCount = rows.filter((r) => Number(r.credit) > 0).length;

  // Sort rows by parsed date asc for first/last; recent = last 10 newest-first
  const dated = rows
    .map((r) => ({ r, d: parseRowDate(r.date) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d!.getTime() - b.d!.getTime());
  const firstDate = dated[0]?.r.date;
  const lastDate = dated[dated.length - 1]?.r.date;

  const type = (meta?.account_type || account || '').toString();
  const isSupplier = /supplier|purchase/i.test(type);
  const balance = isSupplier ? credit - debit : debit - credit;
  const balanceLabel = isSupplier ? 'Balance (Cr − Dr)' : 'Balance (Dr − Cr)';

  let reply = filtersHeader({ customer: customerLabel(ctx.customer), date: ctx.date, report: 'Customer Summary' });
  reply += `👤 <b>${ctx.customer!.name}</b> ${ctx.customer!.account_id ? `<code>${ctx.customer!.account_id}</code>` : ''}\n`;
  if (meta?.account_type) reply += `🏷️ Type: ${meta.account_type}\n`;
  else reply += `🏷️ Group: ${account}\n`;
  if (meta?.mobile) reply += `📱 Mobile: ${meta.mobile}\n`;
  if (meta?.status && meta.status !== 'active') reply += `⚪ Status: ${meta.status}\n`;
  reply += `\n💳 Total Debit: ${fmt(debit)} (${debitCount})\n`;
  reply += `💰 Total Credit: ${fmt(credit)} (${creditCount})\n`;
  reply += `⚖️ <b>${balanceLabel}: ${fmt(balance)}</b>\n`;
  reply += `📊 ${rows.length} transaction(s)`;
  if (firstDate && lastDate) reply += ` • ${firstDate} → ${lastDate}`;
  reply += `\n`;

  const recent = (dated.length ? dated.map((x) => x.r) : rows).slice(-10).reverse();
  if (recent.length) {
    reply += `\n📝 <b>Recent (last ${recent.length}):</b>\n`;
    recent.forEach((r) => {
      const d = Number(r.debit) > 0 ? `Dr ${fmt(Number(r.debit))}` : `Cr ${fmt(Number(r.credit))}`;
      reply += `  • ${r.date || '-'} | ${d} | ${r.description || '-'}\n`;
    });
  }
  reply += `\n<i>Tip: reply with a month (e.g. <b>april</b>) to filter, or <b>reset</b> to clear.</i>`;
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
    let chosen: { account_id: string | null; name: string } | undefined;
    if (!isNaN(idx) && idx >= 1 && idx <= pending.candidates.length) {
      chosen = pending.candidates[idx - 1];
    } else {
      // Try exact name or ACC ID match within candidates
      chosen = pending.candidates.find(
        (c) => c.name.toLowerCase() === t.toLowerCase() || c.account_id === t.toUpperCase(),
      );
      // Numeric-prefix match (e.g. "1306" → "1306. JAWFER") within the offered candidates only.
      if (!chosen) {
        const numHit = t.trim().match(/^(\d{2,6})\.?$/);
        if (numHit) {
          const pref = numHit[1] + '.';
          const matches = pending.candidates.filter((c) => c.name.trim().startsWith(pref));
          if (matches.length === 1) chosen = matches[0];
        }
      }
    }
    if (!chosen) return { reply: '', consumed: false };
    const newCtx: ConvContext = {
      ...context,
      customer: { name: chosen.name, account_id: chosen.account_id ?? undefined },
    };
    // CRITICAL: clear customer_query on the replayed extract so runIntent uses the
    // selected context.customer instead of re-running the search and showing the same list.
    const replay: Extracted = { ...pending.original, customer_query: null };
    if (replay.intent === 'unknown') replay.intent = 'customer_lookup';
    const reply = await runIntent(supabase, replay, newCtx, settings, chatId);
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
  const monthFromCurrent = !!(ex.month || ex.date_text);
  if (context.date && context.date.kind === 'month' && !context.date.year && monthFromCurrent) {
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
  } else if (context.date && context.date.kind === 'month' && !context.date.year && !monthFromCurrent) {
    // Stale month-only date from earlier turn — discard, don't re-prompt.
    context.date = undefined;
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
      const list = cands
        .map((c, i) => `  ${i + 1}. <code>${c.account_id ?? '----'}</code> — ${c.name}`)
        .join('\n');
      return `🔎 Multiple accounts found for "<b>${ex.customer_query}</b>":\n\n${list}\n\nReply with the number, full name, or Account ID.`;
    }
    context.customer = { name: cands[0].name, account_id: cands[0].account_id ?? undefined };
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
      body: JSON.stringify({ offset: currentOffset, timeout, allowed_updates: ['message', 'callback_query'] }),
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
      // Handle feedback buttons
      if (update.callback_query) {
        const cb = update.callback_query;
        const chatId = cb.message?.chat?.id;
        const data: string = cb.data || '';
        const [tag, rating, feedbackId] = data.split(':');
        if (tag === 'fb' && chatId && feedbackId) {
          // Record rating
          const { data: fb } = await supabase
            .from('feedback').select('id, query, response_summary')
            .eq('id', feedbackId).maybeSingle();
          await supabase.from('feedback').update({ rating }).eq('id', feedbackId);
          await answerCallback(cb.id, LOVABLE_API_KEY, TELEGRAM_API_KEY,
            rating === 'up' ? 'Thanks!' : 'Got it — please tell me the correct answer.');
          if (rating === 'down' && fb?.query) {
            const { context } = await loadState(supabase, chatId);
            await saveState(supabase, chatId, {
              type: 'correction_text',
              original: { intent: 'unknown', confidence: 0 },
              feedback_id: feedbackId,
              original_query: fb.query,
              wrong_result: fb.response_summary || '',
            }, context);
            await sendMessage(chatId, `📝 What should I have answered for:\n<i>${fb.query}</i>\n\nReply with the correct answer.`, LOVABLE_API_KEY, TELEGRAM_API_KEY);
          }
        }
        continue;
      }

      if (!update.message?.text) continue;
      const chatId = update.message.chat.id;
      const rawText = String(update.message.text);
      console.log(`[telegram-poll] from=${chatId} text="${rawText}"`);

      const { pending, context } = await loadState(supabase, chatId);

      // ===== Query pipeline =====
      let reply = '';
      let feedbackId: string | undefined;
      let attachFeedback = false;

      // 1) Pending clarification
      let activePending = pending;
      if (pending) {
        const r = await answerPending(supabase, chatId, pending, rawText, context, settings);
        if (r.consumed) { reply = r.reply; attachFeedback = pending.type !== 'correction_text'; }
        else {
          // Pending was not consumed — user is asking something new.
          // Drop stale pending so we don't keep re-prompting, and clear half-finished date.
          activePending = null;
          if (pending.type === 'date_year' || pending.type === 'date_month') {
            context.date = undefined;
          }
          await saveState(supabase, chatId, null, context);
        }
      }

      if (!reply) {
        const lowered = rawText.trim().toLowerCase();
        if (lowered === 'reset' || lowered === 'cancel' || lowered === 'new') {
          await saveState(supabase, chatId, null, {});
          reply = `🔄 Conversation context cleared.`;
        } else {
          // 2) Corrections
          const corr = await lookupCorrection(supabase, rawText);
          if (corr) {
            reply = `📚 <i>(from training)</i>\n\n${corr.correct_result}`;
            attachFeedback = true;
          } else {
            // 3) Alias expansion
            const { text: expanded, resolved } = await expandAliases(supabase, rawText);
            // 3b) Raw-text exact account match (handles "1306. Jawfer", "ACC0003", "1306").
            //     This runs BEFORE the AI so numeric prefixes are not stripped.
            let preCands: Array<{ account_id: string | null; name: string }> | null = null;
            const rawTrim = rawText.trim();
            if (/^[A-Za-z0-9 .'\-]+$/.test(rawTrim) && rawTrim.split(/\s+/).length <= 6) {
              const c = await findCustomerCandidates(supabase, rawTrim);
              // Only short-circuit on a single confident hit. Multi-hit falls through to normal flow.
              if (c.length === 1) preCands = c;
            }
            // 4) Trained intent
            const trainedIntent = await lookupTrainedIntent(supabase, expanded);
            let ex: Extracted;
            if (preCands) {
              ex = {
                intent: 'customer_lookup',
                customer_query: preCands[0].name,
                date_text: null, month: null, year: null,
                confidence: 0.98,
              };
              console.log(`[telegram-poll] raw-text exact account hit → ${preCands[0].account_id} ${preCands[0].name}`);
            } else if (trainedIntent) {
              ex = trainedIntentToExtract(trainedIntent, resolved ?? null);
              console.log(`[telegram-poll] trained intent=${trainedIntent}`);
            } else {
              // 5) AI extraction
              ex = await aiExtract(expanded, LOVABLE_API_KEY);
              if (resolved && !ex.customer_query) ex.customer_query = resolved;
              // If the user message has a numeric account code, prefer the raw text over
              // the AI's stripped name (e.g. AI returns "Jawfer" for "1306. Jawfer").
              if (/^\s*\d{2,6}\.?\s+\S+/.test(rawText) && ex.intent !== 'sales' && ex.intent !== 'purchase' && ex.intent !== 'expense' && ex.intent !== 'profit' && ex.intent !== 'report') {
                ex.customer_query = rawTrim;
                if (ex.intent === 'unknown') ex.intent = 'customer_lookup';
              }
              console.log(`[telegram-poll] extracted`, ex);
            }

            // 5b) Always merge a local date parse (recovers dates lost by trained-intent shortcut or AI misses).
            ex = mergeDate(ex, parseDateFromText(rawText));

            // 5c) Bare-name fallback: short message + unknown intent → try customer lookup.
            if (ex.intent === 'unknown') {
              const tokens = rawText.trim().split(/\s+/);
              const isBareName = tokens.length > 0 && tokens.length <= 5 && /^[A-Za-z0-9][A-Za-z0-9 .'\-]*$/.test(rawText.trim());
              if (isBareName) {
                const cands = await findCustomerCandidates(supabase, rawText.trim());
                if (cands.length >= 1) {
                  ex = { ...ex, intent: 'customer_lookup', customer_query: rawText.trim(), confidence: 0.95 };
                  console.log(`[telegram-poll] bare-name fallback → customer_lookup (${cands.length} candidates)`);
                }
              }
            }

            // 5d) Drop sticky context if this looks like a fresh top-level query.
            const freshCtx = freshenContext(ex, rawText, context);

            if (ex.confidence < 0.4 || ex.intent === 'unknown') {
              const tokens = rawText.trim().split(/\s+/);
              const isBareName = tokens.length > 0 && tokens.length <= 5 && /^[A-Za-z0-9][A-Za-z0-9 .'\-]*$/.test(rawText.trim());
              if (isBareName) {
                reply = `❓ No customer found matching "<b>${rawText.trim()}</b>". Check the spelling or add an alias in the Training Center.`;
              } else {
                reply = `🤔 I'm not sure what you're asking (confidence ${(ex.confidence * 100).toFixed(0)}%).\n\nTry: <i>sales april 2024</i>, <i>profit this year</i>, <i>nisran sales</i>, or type <b>help</b>.`;
              }
            } else if (ex.confidence < 0.9 && ex.intent === 'customer_lookup' && !ex.customer_query) {
              reply = `❓ Which customer or staff did you mean? Please send the name.`;
            } else {
              reply = await runIntent(supabase, ex, freshCtx, settings, chatId);
              attachFeedback = true;
            }
          }
        }
      }

      if (reply) {
        // Log feedback row so 👍/👎 callbacks can reference it
        if (attachFeedback) {
          const { data: fbRow } = await supabase.from('feedback').insert({
            chat_id: chatId,
            query: rawText,
            response_summary: reply.slice(0, 500),
            rating: 'up', // default, overwritten on callback
          }).select('id').single();
          feedbackId = fbRow?.id;
        }
        await sendMessage(chatId, reply, LOVABLE_API_KEY, TELEGRAM_API_KEY, feedbackId);
        console.log(`[telegram-poll] replied to ${chatId} (feedback=${feedbackId ?? 'none'})`);
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