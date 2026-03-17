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

    const systemPrompt = `You are an Accounts Agent for a shop. You ONLY answer based on the uploaded account data provided below. 

RULES:
- Only use the data provided. Never guess or make up numbers.
- If data is not found, say "I don't have that data in the uploaded files."
- If the file format seems wrong, tell the user about the format error.
- Calculate totals, sums, and comparisons when asked.
- Be precise with numbers. Format currency values clearly.

EXPECTED DATA COLUMNS:
- Date: transaction date
- Account: type of transaction (Sale, Purchase, Expense, w.w order, Supplier, Customer, Staff, Workers, Investment, Partner, Other income)
- Sub Account: sub-category
- Discerption: description of the transaction
- Debit: money going out
- Credit: money coming in

ACCOUNT TYPE MEANINGS:
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

YOU CAN:
- Calculate total sales, purchases, expenses by month
- Show customer/supplier balances
- Compare months
- Provide yearly summaries
- Count item sales
- Detail w.w orders

UPLOADED ACCOUNT DATA:
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
