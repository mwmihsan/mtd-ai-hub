import { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAccountsStore } from "@/stores/accountsStore";
import { Send, Bot, User, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AccountsAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const getAllData = useAccountsStore((s) => s.getAllData);
  const files = useAccountsStore((s) => s.files);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // Prepare account data context
    const accountData = getAllData();
    const dataContext = accountData.length > 0
      ? accountData.map((f) => `File: ${f.fileName} (${f.month})\n${JSON.stringify(f.data.slice(0, 200))}`).join("\n\n")
      : "No files uploaded yet.";

    let assistantSoFar = "";
    const allMessages = [...messages, userMsg];

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/accounts-agent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
            accountData: dataContext,
          }),
        }
      );

      if (!resp.ok || !resp.body) {
        throw new Error(`Error: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
                  );
                }
                return [...prev, { role: "assistant", content: assistantSoFar }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e.message || "Something went wrong"}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-3rem)] flex-col">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-foreground">Accounts Agent</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions about your shop accounts ·{" "}
            {files.length} file{files.length !== 1 ? "s" : ""} loaded
          </p>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-lg border border-border bg-card scrollbar-thin"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Bot className="h-7 w-7 text-primary" />
              </div>
              <div className="max-w-sm text-center">
                <p className="text-sm font-medium text-foreground">
                  Accounts Agent
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upload Excel files in Accounts Hub, then ask me about sales,
                  expenses, purchases, customer balances, and more.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  "Total sales this month",
                  "Expense summary",
                  "Customer balance",
                  "Compare months",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); }}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1 p-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-3 animate-fade-in ${
                    msg.role === "user" ? "justify-end" : ""
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-lg px-3.5 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-accent text-foreground"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex gap-3 animate-fade-in">
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-accent px-4 py-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse-dot" />
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse-dot [animation-delay:0.2s]" />
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse-dot [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Ask about your accounts..."
            className="h-10 flex-1 rounded-lg border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
