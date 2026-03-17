import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAccountsStore } from "@/stores/accountsStore";
import { Send, Bot, User, Loader2, Paperclip, FileSpreadsheet, Image, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import * as XLSX from "xlsx";

interface ChatAttachment {
  name: string;
  type: "excel" | "image";
  /** For excel: JSON stringified rows. For image: base64 data URL */
  data: string;
  preview?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function parseExcelFile(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[]; raw: string }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const rawArr = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][];
  const headers = rawArr.length > 0 ? rawArr[0].map(String) : [];
  return { headers, rows, raw: JSON.stringify(rows.slice(0, 300)) };
}

export default function AccountsAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const getAllData = useAccountsStore((s) => s.getAllData);
  const files = useAccountsStore((s) => s.files);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleFileSelect = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
      const isExcel = ["xlsx", "csv", "xls"].includes(ext);

      if (!isImage && !isExcel) {
        continue; // skip unsupported
      }

      if (isImage) {
        const base64 = await fileToBase64(file);
        setAttachments((prev) => [
          ...prev,
          { name: file.name, type: "image", data: base64, preview: base64 },
        ]);
      } else {
        try {
          const parsed = await parseExcelFile(file);
          setAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              type: "excel",
              data: parsed.raw,
              preview: `${parsed.rows.length} rows · ${parsed.headers.join(", ")}`,
            },
          ]);
        } catch {
          setAttachments((prev) => [
            ...prev,
            { name: file.name, type: "excel", data: "ERROR: Could not parse file", preview: "Parse error" },
          ]);
        }
      }
    }
  }, []);

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isLoading) return;

    const currentAttachments = [...attachments];
    const userMsg: Message = { role: "user", content: text, attachments: currentAttachments.length > 0 ? currentAttachments : undefined };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachments([]);
    setIsLoading(true);

    // Prepare account data from Hub
    const accountData = getAllData();
    const hubContext = accountData.length > 0
      ? accountData.map((f) => `File: ${f.fileName} (${f.month})\n${JSON.stringify(f.data.slice(0, 200))}`).join("\n\n")
      : "";

    // Prepare inline attachment data
    const attachmentContext = currentAttachments
      .filter((a) => a.type === "excel")
      .map((a) => `Inline file: ${a.name}\n${a.data}`)
      .join("\n\n");

    const fullDataContext = [hubContext, attachmentContext].filter(Boolean).join("\n\n---\n\n") || "No files uploaded yet.";

    // Build messages for the API - include image attachments as multimodal content
    const apiMessages = [...messages, userMsg].map((m) => {
      if (m.role === "user" && m.attachments?.some((a) => a.type === "image")) {
        const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const att of m.attachments.filter((a) => a.type === "image")) {
          content.push({ type: "image_url", image_url: { url: att.data } });
        }
        if (m.attachments.some((a) => a.type === "excel")) {
          content.push({ type: "text", text: `[Excel data attached: ${m.attachments.filter((a) => a.type === "excel").map((a) => a.name).join(", ")}]` });
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });

    let assistantSoFar = "";

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
            messages: apiMessages,
            accountData: fullDataContext,
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
            {files.length} hub file{files.length !== 1 ? "s" : ""} loaded
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
                <p className="text-sm font-medium text-foreground">Accounts Agent</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upload Excel files or screenshots directly here, or load them from Accounts Hub.
                  Ask about sales, expenses, balances, and more.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  "Total sales this month",
                  "Expense summary",
                  "Find mistakes in data",
                  "Calculate profit",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
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
                  className={`flex gap-3 animate-fade-in ${msg.role === "user" ? "justify-end" : ""}`}
                >
                  {msg.role === "assistant" && (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div className={`max-w-[75%] space-y-2`}>
                    {/* Attachment previews for user messages */}
                    {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {msg.attachments.map((att, ai) => (
                          <div key={ai} className="rounded-md border border-border bg-accent px-2.5 py-1.5 text-xs">
                            {att.type === "image" ? (
                              <div className="flex items-center gap-1.5">
                                <Image className="h-3 w-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{att.name}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <FileSpreadsheet className="h-3 w-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{att.name}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div
                      className={`rounded-lg px-3.5 py-2.5 text-sm ${
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
                        msg.content || (msg.attachments ? "📎 Files attached" : "")
                      )}
                    </div>
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

        {/* Attachment preview bar */}
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-border bg-accent px-2.5 py-1.5 text-xs animate-fade-in"
              >
                {att.type === "image" ? (
                  <>
                    <img src={att.preview} alt="" className="h-6 w-6 rounded object-cover" />
                    <span className="max-w-[120px] truncate text-muted-foreground">{att.name}</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="max-w-[120px] truncate text-muted-foreground">{att.name}</span>
                    <span className="text-muted-foreground/60">{att.preview}</span>
                  </>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xlsx,.csv,.xls,.png,.jpg,.jpeg,.webp,.gif"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFileSelect(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Ask about your accounts or attach files..."
            className="h-10 flex-1 rounded-lg border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || (!input.trim() && attachments.length === 0)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
