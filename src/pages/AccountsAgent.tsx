import React, { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAccountsStore } from "@/stores/accountsStore";
import { supabase } from "@/integrations/supabase/client";
import { Send, Bot, User, Loader2, Paperclip, FileSpreadsheet, Image, X, Trash2, FileDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface ChatAttachment {
  name: string;
  type: "excel" | "image";
  data: string;
  preview?: string;
}

interface Message {
  id?: string;
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
  const [chatLoaded, setChatLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadFromCloud, files } = useAccountsStore();

  useEffect(() => {
    loadFromCloud();
    loadChatHistory();
  }, [loadFromCloud]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Load chat history from cloud
  async function loadChatHistory() {
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .order("created_at", { ascending: true });
    if (data && data.length > 0) {
      setMessages(
        data.map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          attachments: m.attachments || undefined,
        }))
      );
    }
    setChatLoaded(true);
  }

  // Save a message to cloud
  async function saveMessage(msg: Message) {
    const { data } = await supabase
      .from("chat_messages")
      .insert({
        role: msg.role,
        content: msg.content,
        attachments: msg.attachments ? JSON.parse(JSON.stringify(msg.attachments.map(a => ({ name: a.name, type: a.type, preview: a.preview })))) : null,
      })
      .select()
      .single();
    return data?.id;
  }

  // Clear chat history
  async function clearChat() {
    await supabase.from("chat_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setMessages([]);
  }

  // Load cloud data context
  const getCloudContext = useCallback(async () => {
    const { data: rows } = await supabase.from("account_rows").select("*");
    const { data: dbFiles } = await supabase.from("uploaded_files").select("*");
    if (!rows || !dbFiles || rows.length === 0) return "No files uploaded yet.";

    // Filter empty rows
    const validRows = rows.filter(
      (r: any) => r.date || r.account || r.sub_account || r.description || Number(r.debit) > 0 || Number(r.credit) > 0
    );

    const grouped: Record<string, typeof validRows> = {};
    for (const row of validRows) {
      const file = dbFiles.find((f: any) => f.id === row.file_id);
      const key = file ? `${(file as any).file_name} (${(file as any).month})` : row.file_id;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }

    return Object.entries(grouped)
      .map(([key, fileRows]) => `File: ${key}\n${JSON.stringify(fileRows.slice(0, 200))}`)
      .join("\n\n");
  }, []);

  const handleFileSelect = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
      const isExcel = ["xlsx", "csv", "xls"].includes(ext);
      if (!isImage && !isExcel) continue;

      if (isImage) {
        const base64 = await fileToBase64(file);
        setAttachments((prev) => [...prev, { name: file.name, type: "image", data: base64, preview: base64 }]);
      } else {
        try {
          const parsed = await parseExcelFile(file);
          setAttachments((prev) => [...prev, {
            name: file.name, type: "excel", data: parsed.raw,
            preview: `${parsed.rows.length} rows · ${parsed.headers.join(", ")}`,
          }]);
        } catch {
          setAttachments((prev) => [...prev, { name: file.name, type: "excel", data: "ERROR: Could not parse file", preview: "Parse error" }]);
        }
      }
    }
  }, []);

  const removeAttachment = (index: number) => setAttachments((prev) => prev.filter((_, i) => i !== index));

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
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

    // Save user message to cloud
    await saveMessage(userMsg);

    // Get cloud data
    const cloudContext = await getCloudContext();

    // Inline attachment data
    const attachmentContext = currentAttachments
      .filter((a) => a.type === "excel")
      .map((a) => `Inline file: ${a.name}\n${a.data}`)
      .join("\n\n");

    const fullDataContext = [cloudContext, attachmentContext].filter(Boolean).join("\n\n---\n\n") || "No files uploaded yet.";

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
          body: JSON.stringify({ messages: apiMessages, accountData: fullDataContext }),
        }
      );

      if (!resp.ok || !resp.body) throw new Error(`Error: ${resp.status}`);

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
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
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

      // Save assistant response to cloud
      if (assistantSoFar) {
        await saveMessage({ role: "assistant", content: assistantSoFar });
      }
    } catch (e: any) {
      const errMsg = `Error: ${e.message || "Something went wrong"}`;
      setMessages((prev) => [...prev, { role: "assistant", content: errMsg }]);
      await saveMessage({ role: "assistant", content: errMsg });
    } finally {
      setIsLoading(false);
    }
  };

  // Generate PDF from assistant reply
  const generatePDF = useCallback((content: string) => {
    const doc = new jsPDF();
    const lines = content.split("\n").filter(Boolean);
    
    // Try to extract table rows (date, description, debit, credit)
    const tableRows: string[][] = [];
    for (const line of lines) {
      // Skip markdown separator rows like |:---|:---|
      if (/^[\s|:-]+$/.test(line)) continue;
      // Match patterns like: 2025-10-05 | description | 25,000 | 100,000
      const cells = line.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2 && !cells.every(c => /^[-:]+$/.test(c))) {
        tableRows.push(cells);
        continue;
      }
      // Match markdown table rows
      const mdCells = line.replace(/^\||\|$/g, "").split("|").map(c => c.trim()).filter(Boolean);
      if (mdCells.length >= 2 && !mdCells.every(c => /^[-:]+$/.test(c))) {
        tableRows.push(mdCells);
      }
    }

    // Header
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Accounts Report", 14, 18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 25);

    if (tableRows.length > 1) {
      const headers = tableRows[0];
      const body = tableRows.slice(1);
      autoTable(doc, {
        startY: 32,
        head: [headers],
        body,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });
    } else {
      // Fallback: put text content in a simple table
      const textLines = content.split("\n").filter(Boolean).map(l => [l]);
      autoTable(doc, {
        startY: 32,
        body: textLines,
        styles: { fontSize: 9, cellPadding: 3 },
      });
    }

    doc.save("accounts-report.pdf");
  }, []);

  // Generate follow-up suggestions based on last assistant message
  const getSuggestions = useCallback((): string[] => {
    if (messages.length === 0) return [];
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return [];
    const content = last.content.toLowerCase();

    const suggestions: string[] = [];
    if (content.includes("sale")) {
      suggestions.push("Show sales details", "Show return sales");
    }
    if (content.includes("expense")) {
      suggestions.push("Show expense breakdown", "Show meals expense");
    }
    if (content.includes("purchase")) {
      suggestions.push("Show purchase details", "Compare with last month");
    }
    if (content.includes("profit")) {
      suggestions.push("Show profit breakdown", "Monthly comparison");
    }
    if (suggestions.length === 0) {
      suggestions.push("Show details", "Calculate profit", "Find mistakes");
    }
    return suggestions.slice(0, 4);
  }, [messages]);

  const suggestions = getSuggestions();

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-8rem)] md:h-[calc(100vh-3rem)] flex-col">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Accounts Agent</h1>
            <p className="text-sm text-muted-foreground">
              Ask questions about your shop accounts · {files.length} cloud file{files.length !== 1 ? "s" : ""} loaded
            </p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Clear Chat
            </button>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-lg border border-border bg-card scrollbar-thin">
          {!chatLoaded ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Bot className="h-7 w-7 text-primary" />
              </div>
              <div className="max-w-sm text-center">
                <p className="text-sm font-medium text-foreground">Accounts Agent</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upload Excel files or screenshots directly here. Data is loaded from cloud automatically.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {["Total sales this month", "Expense summary", "Find mistakes in data", "Calculate profit"].map((q) => (
                  <button key={q} onClick={() => setInput(q)} className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1 p-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 animate-fade-in ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div className="max-w-[75%] space-y-2">
                    {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {msg.attachments.map((att, ai) => (
                          <div key={ai} className="rounded-md border border-border bg-accent px-2.5 py-1.5 text-xs">
                            <div className="flex items-center gap-1.5">
                              {att.type === "image" ? <Image className="h-3 w-3 text-muted-foreground" /> : <FileSpreadsheet className="h-3 w-3 text-muted-foreground" />}
                              <span className="text-muted-foreground">{att.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={`rounded-lg px-3.5 py-2.5 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}>
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

              {/* Follow-up suggestions after assistant reply */}
              {!isLoading && messages[messages.length - 1]?.role === "assistant" && (
                <div className="flex flex-wrap gap-2 pl-10 pt-2 animate-fade-in">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSuggestionClick(s)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    onClick={() => generatePDF(messages[messages.length - 1].content)}
                    className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10"
                  >
                    <FileDown className="h-3 w-3" /> Want PDF
                  </button>
                </div>
              )}

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

        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-accent px-2.5 py-1.5 text-xs animate-fade-in">
                {att.type === "image" ? (
                  <><img src={att.preview} alt="" className="h-6 w-6 rounded object-cover" /><span className="max-w-[120px] truncate text-muted-foreground">{att.name}</span></>
                ) : (
                  <><FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" /><span className="max-w-[120px] truncate text-muted-foreground">{att.name}</span><span className="text-muted-foreground/60">{att.preview}</span></>
                )}
                <button onClick={() => removeAttachment(i)} className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <button onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50" title="Attach file">
            <Paperclip className="h-4 w-4" />
          </button>
          <input ref={fileInputRef} type="file" multiple accept=".xlsx,.csv,.xls,.png,.jpg,.jpeg,.webp,.gif" className="hidden" onChange={(e) => { if (e.target.files) handleFileSelect(e.target.files); e.target.value = ""; }} />
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()} placeholder="Ask about your accounts or attach files..." className="h-10 flex-1 rounded-lg border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" disabled={isLoading} />
          <button onClick={sendMessage} disabled={isLoading || (!input.trim() && attachments.length === 0)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
