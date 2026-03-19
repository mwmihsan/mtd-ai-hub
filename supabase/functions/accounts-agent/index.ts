import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
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
8. DO NOT list individual transaction rows unless the user explicitly asks for "details", "list", "breakdown", or "rows".

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
- Calculate profit: Total Credit (Sales + Other income) - Total Debit (Purchases + Expenses)
- Read and analyze screenshots of account tables

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
