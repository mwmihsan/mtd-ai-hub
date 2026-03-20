import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAccountsStore, UploadedFile } from "@/stores/accountsStore";
import { FileUploadZone } from "@/components/FileUploadZone";
import { DataPreviewTable } from "@/components/DataPreviewTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, Trash2, Plus, Save, X, FileSpreadsheet, Loader2,
  ArrowUpDown, Pencil, Eye,
} from "lucide-react";
import { toast } from "sonner";

interface AccountRow {
  id: string;
  file_id: string;
  date: string;
  account: string;
  sub_account: string;
  description: string;
  debit: number;
  credit: number;
}

interface FileRecord {
  id: string;
  file_name: string;
  month: string;
  upload_date: string;
  row_count: number;
  storage_path: string;
}

type SortField = "date" | "account" | "sub_account" | "description" | "debit" | "credit";
type SortDir = "asc" | "desc";
type Tab = "files" | "data";

export default function AdminPanel() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [filterAccount, setFilterAccount] = useState("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [loading, setLoading] = useState(true);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<AccountRow>>({});
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState({ date: "", account: "", sub_account: "", description: "", debit: 0, credit: 0 });
  const [activeTab, setActiveTab] = useState<Tab>("files");
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [fileSearch, setFileSearch] = useState("");

  const { files: storeFiles, removeFile, loadFromCloud, loading: storeLoading } = useAccountsStore();

  useEffect(() => {
    loadData();
    loadFromCloud();
  }, [loadFromCloud]);

  async function loadData() {
    setLoading(true);
    const [fRes] = await Promise.all([
      supabase.from("uploaded_files").select("*").order("upload_date", { ascending: false }),
    ]);
    if (fRes.data) setFiles(fRes.data as FileRecord[]);

    let allRows: AccountRow[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase.from("account_rows").select("*").range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      allRows = [...allRows, ...(data as AccountRow[])];
      if (data.length < pageSize) break;
      from += pageSize;
    }
    const validRows = allRows.filter(
      (r) => r.date || r.account || r.sub_account || r.description || Number(r.debit) > 0 || Number(r.credit) > 0
    );
    setRows(validRows);
    setLoading(false);
  }

  const accountTypes = useMemo(() => [...new Set(rows.map((r) => r.account).filter(Boolean))].sort(), [rows]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (selectedFileId !== "all") result = result.filter((r) => r.file_id === selectedFileId);
    if (filterAccount !== "all") result = result.filter((r) => r.account === filterAccount);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.date?.toLowerCase().includes(q) ||
          r.account?.toLowerCase().includes(q) ||
          r.sub_account?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const aVal = a[sortField] ?? "";
      const bVal = b[sortField] ?? "";
      const cmp = typeof aVal === "number" ? aVal - (bVal as number) : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [rows, selectedFileId, filterAccount, search, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  async function deleteFile(fileId: string) {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    if (!confirm(`Delete "${file.file_name}" and all its data?`)) return;
    await supabase.storage.from("account-files").remove([file.storage_path]);
    await supabase.from("account_rows").delete().eq("file_id", fileId);
    await supabase.from("uploaded_files").delete().eq("id", fileId);
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setRows((prev) => prev.filter((r) => r.file_id !== fileId));
    if (selectedFileId === fileId) setSelectedFileId("all");
    await removeFile(fileId);
    toast.success("File deleted");
  }

  async function deleteRow(rowId: string) {
    await supabase.from("account_rows").delete().eq("id", rowId);
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    toast.success("Row deleted");
  }

  function startEdit(row: AccountRow) {
    setEditingRow(row.id);
    setEditData({ ...row });
  }

  async function saveEdit() {
    if (!editingRow || !editData) return;
    const { error } = await supabase.from("account_rows").update({
      date: editData.date, account: editData.account, sub_account: editData.sub_account,
      description: editData.description, debit: Number(editData.debit) || 0, credit: Number(editData.credit) || 0,
    }).eq("id", editingRow);
    if (error) { toast.error("Failed to save"); return; }
    setRows((prev) => prev.map((r) => r.id === editingRow ? { ...r, ...editData, debit: Number(editData.debit) || 0, credit: Number(editData.credit) || 0 } : r));
    setEditingRow(null);
    toast.success("Row updated");
  }

  async function addRow() {
    const fileId = selectedFileId !== "all" ? selectedFileId : files[0]?.id;
    if (!fileId) { toast.error("No file selected"); return; }
    const { data, error } = await supabase.from("account_rows").insert({
      file_id: fileId, date: newRow.date, account: newRow.account, sub_account: newRow.sub_account,
      description: newRow.description, debit: Number(newRow.debit) || 0, credit: Number(newRow.credit) || 0,
    }).select().single();
    if (error) { toast.error("Failed to add row"); return; }
    setRows((prev) => [...prev, data as AccountRow]);
    setAddingRow(false);
    setNewRow({ date: "", account: "", sub_account: "", description: "", debit: 0, credit: 0 });
    toast.success("Row added");
  }

  const totalDebit = filteredRows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = filteredRows.reduce((s, r) => s + Number(r.credit), 0);
  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Handle upload complete - reload data
  const handleUploadComplete = async () => {
    await loadData();
    await loadFromCloud();
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Upload files, manage data, and edit records</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
          <button
            onClick={() => setActiveTab("files")}
            className={`flex-1 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors ${
              activeTab === "files" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileSpreadsheet className="mr-1.5 inline h-3.5 w-3.5" />
            Files & Upload
          </button>
          <button
            onClick={() => setActiveTab("data")}
            className={`flex-1 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors ${
              activeTab === "data" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowUpDown className="mr-1.5 inline h-3.5 w-3.5" />
            Data Table
          </button>
        </div>

        {/* FILES TAB */}
        {activeTab === "files" && (
          <div className="space-y-4">
            <FileUploadZone />

            {storeLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
              </div>
            )}

            {/* File search */}
            {files.length > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search files..."
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {/* Files list */}
            <Card>
              <CardHeader className="px-3 py-2 sm:px-4 sm:py-3">
                <CardTitle className="text-xs sm:text-sm font-semibold">
                  Uploaded Files ({files.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {files.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No files uploaded yet. Use the upload zone above.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {files
                      .filter((f) => !fileSearch || f.file_name.toLowerCase().includes(fileSearch.toLowerCase()))
                      .map((file) => (
                        <div key={file.id} className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-xs sm:text-sm font-medium text-foreground">{file.file_name}</p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground">
                              {file.month} · {file.row_count} rows · {new Date(file.upload_date).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                const sf = storeFiles.find((sf) => sf.id === file.id);
                                if (sf) setPreviewFile(previewFile?.id === sf.id ? null : sf);
                              }}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="Preview"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button onClick={() => deleteFile(file.id)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {previewFile && (
              <DataPreviewTable file={previewFile} onClose={() => setPreviewFile(null)} searchQuery={fileSearch} />
            )}
          </div>
        )}

        {/* DATA TAB */}
        {activeTab === "data" && (
          <div className="space-y-4">
            {/* Filters - stack on mobile */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <Select value={selectedFileId} onValueChange={setSelectedFileId}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Select file" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Files</SelectItem>
                  {files.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.file_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterAccount} onValueChange={setFilterAccount}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Account type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {accountTypes.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search rows..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <button
                onClick={() => setAddingRow(true)}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:w-auto"
              >
                <Plus className="h-4 w-4" /> Add Row
              </button>
            </div>

            {/* Totals */}
            <div className="flex flex-wrap gap-3 text-xs sm:text-sm">
              <span className="text-muted-foreground">
                Rows: <strong className="text-foreground">{filteredRows.length}</strong>
              </span>
              <span className="text-muted-foreground">
                Debit: <strong className="text-foreground">{fmt(totalDebit)}</strong>
              </span>
              <span className="text-muted-foreground">
                Credit: <strong className="text-foreground">{fmt(totalCredit)}</strong>
              </span>
            </div>

            {/* Data table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto scrollbar-thin -mx-px">
                  <table className="w-full min-w-[640px] text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted">
                        {(["date", "account", "sub_account", "description", "debit", "credit"] as SortField[]).map((field) => (
                          <th
                            key={field}
                            onClick={() => handleSort(field)}
                            className="cursor-pointer whitespace-nowrap px-2 py-2 sm:px-3 sm:py-2.5 text-left text-[10px] sm:text-xs font-medium text-muted-foreground hover:text-foreground"
                          >
                            <div className="flex items-center gap-1">
                              {field === "sub_account" ? "Sub Acc" : field === "description" ? "Desc" : field.charAt(0).toUpperCase() + field.slice(1)}
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </th>
                        ))}
                        <th className="w-16 px-2 py-2 sm:px-3 text-[10px] sm:text-xs font-medium text-muted-foreground">Act</th>
                      </tr>
                    </thead>
                    <tbody>
                      {addingRow && (
                        <tr className="border-b border-border bg-primary/5">
                          {["date", "account", "sub_account", "description"].map((field) => (
                            <td key={field} className="px-1.5 py-1 sm:px-2 sm:py-1.5">
                              <input
                                value={(newRow as any)[field]}
                                onChange={(e) => setNewRow((p) => ({ ...p, [field]: e.target.value }))}
                                placeholder={field}
                                className="h-7 sm:h-8 w-full rounded border border-input bg-background px-1.5 sm:px-2 text-[10px] sm:text-xs focus:ring-1 focus:ring-ring"
                              />
                            </td>
                          ))}
                          <td className="px-1.5 py-1 sm:px-2">
                            <input type="number" value={newRow.debit} onChange={(e) => setNewRow((p) => ({ ...p, debit: Number(e.target.value) }))} className="h-7 sm:h-8 w-full rounded border border-input bg-background px-1.5 text-[10px] sm:text-xs focus:ring-1 focus:ring-ring" />
                          </td>
                          <td className="px-1.5 py-1 sm:px-2">
                            <input type="number" value={newRow.credit} onChange={(e) => setNewRow((p) => ({ ...p, credit: Number(e.target.value) }))} className="h-7 sm:h-8 w-full rounded border border-input bg-background px-1.5 text-[10px] sm:text-xs focus:ring-1 focus:ring-ring" />
                          </td>
                          <td className="flex gap-0.5 px-1.5 py-1 sm:px-2">
                            <button onClick={addRow} className="rounded p-1 text-success hover:bg-success/10"><Save className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setAddingRow(false)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
                          </td>
                        </tr>
                      )}
                      {filteredRows.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 transition-colors hover:bg-accent/50">
                          {editingRow === row.id ? (
                            <>
                              {["date", "account", "sub_account", "description"].map((field) => (
                                <td key={field} className="px-1.5 py-1 sm:px-2">
                                  <input
                                    value={(editData as any)[field] || ""}
                                    onChange={(e) => setEditData((p) => ({ ...p, [field]: e.target.value }))}
                                    className="h-7 sm:h-8 w-full rounded border border-input bg-background px-1.5 text-[10px] sm:text-xs focus:ring-1 focus:ring-ring"
                                  />
                                </td>
                              ))}
                              <td className="px-1.5 py-1 sm:px-2">
                                <input type="number" value={editData.debit ?? 0} onChange={(e) => setEditData((p) => ({ ...p, debit: Number(e.target.value) }))} className="h-7 sm:h-8 w-full rounded border border-input bg-background px-1.5 text-[10px] sm:text-xs focus:ring-1 focus:ring-ring" />
                              </td>
                              <td className="px-1.5 py-1 sm:px-2">
                                <input type="number" value={editData.credit ?? 0} onChange={(e) => setEditData((p) => ({ ...p, credit: Number(e.target.value) }))} className="h-7 sm:h-8 w-full rounded border border-input bg-background px-1.5 text-[10px] sm:text-xs focus:ring-1 focus:ring-ring" />
                              </td>
                              <td className="flex gap-0.5 px-1.5 py-1 sm:px-2">
                                <button onClick={saveEdit} className="rounded p-1 text-success hover:bg-success/10"><Save className="h-3.5 w-3.5" /></button>
                                <button onClick={() => setEditingRow(null)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 sm:py-2 text-foreground">{row.date}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 sm:py-2 text-foreground">{row.account}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 sm:py-2 text-foreground">{row.sub_account}</td>
                              <td className="max-w-[120px] sm:max-w-[200px] truncate px-2 py-1.5 sm:px-3 sm:py-2 text-foreground">{row.description}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-foreground">{fmt(Number(row.debit))}</td>
                              <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-foreground">{fmt(Number(row.credit))}</td>
                              <td className="flex gap-0.5 px-2 py-1.5 sm:px-3 sm:py-2">
                                <button onClick={() => startEdit(row)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                                  <Pencil className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                </button>
                                <button onClick={() => deleteRow(row.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                  <Trash2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredRows.length === 0 && (
                    <p className="p-6 text-center text-sm text-muted-foreground">No rows found.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
