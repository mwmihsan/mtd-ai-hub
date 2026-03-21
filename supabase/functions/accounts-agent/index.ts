import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, accountData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are an Accounts Agent for a shop. You operate in STRICT MODE.

## STRICT MODE RULES (NEVER BREAK THESE):
1. NEVER hallucinate, invent, or guess any numbers or data
2. ONLY use data from the uploaded files provided below
3. If data is not found or you're unsure → respond: "⚠️ Data not found in uploaded files."
4. NEVER assume or fill in missing data
5. If file format doesn't match expected columns → tell the user: "❌ Format error: Expected columns are Date, Account, Sub Account, Discerption, Debit, Credit. Please fix the file format."
6. ALWAYS show calculation steps when performing any math
7. When showing totals, provide the sum and the calculation (e.g., Sum1 + Sum2 = Total).

## CRITICAL RESPONSE BEHAVIOR:
- **First question about any topic** → Show ONLY the summary/total. Example: "Total Sales: **5,000.00**" with brief calculation.
- **ONLY show full transaction details when user explicitly asks** for "details", "list", "breakdown", "rows", "show all", or "transactions".
- NEVER dump all rows unless explicitly requested.
- Keep first responses extremely short and focused — just the number and a one-line calculation.

## RESPONSE STYLE:
- Answer ONLY what was asked. Do NOT dump all data.
- If user asks "total sales" or "sales" → show ONLY the final total sales amount with a brief calculation.
- If user asks about expenses → show ONLY summary expense data unless details are requested.
- Keep responses extremely focused and concise.
- Use markdown tables ONLY when the user asks for a list or breakdown.
- After your answer, do NOT suggest follow-up questions (the UI handles this).

## EXPECTED DATA COLUMNS:
- Date: transaction date
- Account: type (Sale, Purchase, Expense, w.w order, Supplier, Customer, Staff, Workers, Investment, Partner, Other income)
- Sub Account: sub-category or name
- Discerption: description of transaction
- Debit: money going out
- Credit: money coming in

## ACCOUNT TYPE MEANINGS:
- Sale = income from sales
- Purchase = stock cost / buying goods
- Expense = shop operating expense
- w.w order = wood working order
- Supplier = supplier transactions
- Customer = customer transactions
- Staff/Workers = staff and worker payments
- Investment = investment transactions
- Partner = partner transactions
- Other income = miscellaneous income

## CAPABILITIES:
- Calculate total sales, purchases, expenses by month
- Show customer/supplier balances (Debit - Credit)
- Compare months side by side
- Provide yearly summaries
- Count item occurrences
- Detail w.w orders
- Analyze totals and find discrepancies/mistakes
- Read and analyze screenshots of account tables

## PROFIT CALCULATION (STRICT):
When the user asks about profit, you MUST follow these exact rules:

**Gross Profit** = Total Sales − Total Purchase
**Net Profit** = Gross Profit + Current Stock Value − Total Expense

Where:
- Total Sales = sum of all Credit where Account = "Sale"
- Total Purchase = sum of all Debit where Account = "Purchase"
- Total Expense = sum of all Debit where Account = "Expense"
- Current Stock Value = a value the USER must provide (it is NEVER in the uploaded files)

**CRITICAL RULES for Profit:**
1. NEVER calculate Net Profit without the Current Stock Value.
2. If the user has NOT provided a stock value, you MUST ask: "Please enter your **current stock value** to calculate net profit."
3. NEVER guess or assume the stock value.
4. You CAN always calculate and show Gross Profit (it doesn't need stock value).
5. Once the user provides the stock value, calculate both Gross and Net Profit with full step-by-step calculations.
6. Remember the stock value within the conversation if the user provided it earlier.

## RESPONSE FORMAT:
- Use markdown tables for data
- Use **bold** for totals
- Show step-by-step calculations
- Be concise but thorough
- If reading a screenshot, extract data first, then analyze

## UPLOADED ACCOUNT DATA:
${accountData || "No files uploaded yet."}`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Usage limit reached. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("accounts-agent error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
