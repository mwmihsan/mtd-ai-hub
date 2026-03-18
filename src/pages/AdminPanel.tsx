import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Trash2,
  Plus,
  Save,
  X,
  FileSpreadsheet,
  Loader2,
  ArrowUpDown,
  Pencil,
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

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [fRes, rRes] = await Promise.all([
      supabase.from("uploaded_files").select("*").order("upload_date", { ascending: false }),
      supabase.from("account_rows").select("*"),
    ]);
    if (fRes.data) setFiles(fRes.data as FileRecord[]);
    if (rRes.data) setRows(rRes.data as AccountRow[]);
    setLoading(false);
  }

  const accountTypes = useMemo(() => {
    return [...new Set(rows.map((r) => r.account).filter(Boolean))].sort();
  }, [rows]);

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
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
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
    const { error } = await supabase
      .from("account_rows")
      .update({
        date: editData.date,
        account: editData.account,
        sub_account: editData.sub_account,
        description: editData.description,
        debit: Number(editData.debit) || 0,
        credit: Number(editData.credit) || 0,
      })
      .eq("id", editingRow);
    if (error) { toast.error("Failed to save"); return; }
    setRows((prev) => prev.map((r) => (r.id === editingRow ? { ...r, ...editData, debit: Number(editData.debit) || 0, credit: Number(editData.credit) || 0 } : r)));
    setEditingRow(null);
    toast.success("Row updated");
  }

  async function addRow() {
    const fileId = selectedFileId !== "all" ? selectedFileId : files[0]?.id;
    if (!fileId) { toast.error("No file selected"); return; }
    const { data, error } = await supabase
      .from("account_rows")
      .insert({
        file_id: fileId,
        date: newRow.date,
        account: newRow.account,
        sub_account: newRow.sub_account,
        description: newRow.description,
        debit: Number(newRow.debit) || 0,
        credit: Number(newRow.credit) || 0,
      })
      .select()
      .single();
    if (error) { toast.error("Failed to add row"); return; }
    setRows((prev) => [...prev, data as AccountRow]);
    setAddingRow(false);
    setNewRow({ date: "", account: "", sub_account: "", description: "", debit: 0, credit: 0 });
    toast.success("Row added");
  }

  const totalDebit = filteredRows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = filteredRows.reduce((s, r) => s + Number(r.credit), 0);
  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage uploaded files and account data</p>
        </div>

        {/* Files list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Uploaded Files</CardTitle>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {files.map((file) => (
                  <div key={file.id} className="flex items-center gap-3 py-2">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{file.file_name}</p>
                      <p className="text-xs text-muted-foreground">{file.month} · {file.row_count} rows</p>
                    </div>
                    <button onClick={() => deleteFile(file.id)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedFileId} onValueChange={setSelectedFileId}>
            <SelectTrigger className="w-[200px]">
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
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Account type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accountTypes.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[200px]">
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
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Add Row
          </button>
        </div>

        {/* Totals */}
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            Showing <strong className="text-foreground">{filteredRows.length}</strong> rows
          </span>
          <span className="text-muted-foreground">
            Total Debit: <strong className="text-foreground">{fmt(totalDebit)}</strong>
          </span>
          <span className="text-muted-foreground">
            Total Credit: <strong className="text-foreground">{fmt(totalCredit)}</strong>
          </span>
        </div>

        {/* Data table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    {(["date", "account", "sub_account", "description", "debit", "credit"] as SortField[]).map((field) => (
                      <th
                        key={field}
                        onClick={() => handleSort(field)}
                        className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <div className="flex items-center gap-1">
                          {field === "sub_account" ? "Sub Account" : field === "description" ? "Description" : field.charAt(0).toUpperCase() + field.slice(1)}
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </th>
                    ))}
                    <th className="w-20 px-3 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Add new row inline */}
                  {addingRow && (
                    <tr className="border-b border-border bg-primary/5">
                      {["date", "account", "sub_account", "description"].map((field) => (
                        <td key={field} className="px-2 py-1.5">
                          <input
                            value={(newRow as any)[field]}
                            onChange={(e) => setNewRow((p) => ({ ...p, [field]: e.target.value }))}
                            placeholder={field}
                            className="h-8 w-full rounded border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          value={newRow.debit}
                          onChange={(e) => setNewRow((p) => ({ ...p, debit: Number(e.target.value) }))}
                          className="h-8 w-24 rounded border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          value={newRow.credit}
                          onChange={(e) => setNewRow((p) => ({ ...p, credit: Number(e.target.value) }))}
                          className="h-8 w-24 rounded border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                        />
                      </td>
                      <td className="flex gap-1 px-2 py-1.5">
                        <button onClick={addRow} className="rounded p-1 text-success hover:bg-success/10"><Save className="h-4 w-4" /></button>
                        <button onClick={() => setAddingRow(false)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  )}

                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 transition-colors hover:bg-accent/50">
                      {editingRow === row.id ? (
                        <>
                          {["date", "account", "sub_account", "description"].map((field) => (
                            <td key={field} className="px-2 py-1.5">
                              <input
                                value={(editData as any)[field] || ""}
                                onChange={(e) => setEditData((p) => ({ ...p, [field]: e.target.value }))}
                                className="h-8 w-full rounded border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              value={editData.debit ?? 0}
                              onChange={(e) => setEditData((p) => ({ ...p, debit: Number(e.target.value) }))}
                              className="h-8 w-24 rounded border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              value={editData.credit ?? 0}
                              onChange={(e) => setEditData((p) => ({ ...p, credit: Number(e.target.value) }))}
                              className="h-8 w-24 rounded border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                            />
                          </td>
                          <td className="flex gap-1 px-2 py-1.5">
                            <button onClick={saveEdit} className="rounded p-1 text-success hover:bg-success/10"><Save className="h-4 w-4" /></button>
                            <button onClick={() => setEditingRow(null)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="whitespace-nowrap px-3 py-2 text-foreground">{row.date}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-foreground">{row.account}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-foreground">{row.sub_account}</td>
                          <td className="max-w-[200px] truncate px-3 py-2 text-foreground">{row.description}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{fmt(Number(row.debit))}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{fmt(Number(row.credit))}</td>
                          <td className="flex gap-1 px-3 py-2">
                            <button onClick={() => startEdit(row)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => deleteRow(row.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">No rows found.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
