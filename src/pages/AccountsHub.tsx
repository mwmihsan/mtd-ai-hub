import { useState } from "react";
import { useAccountsStore, UploadedFile } from "@/stores/accountsStore";
import { FileUploadZone } from "@/components/FileUploadZone";
import { DataPreviewTable } from "@/components/DataPreviewTable";
import { AppLayout } from "@/components/AppLayout";
import { FileSpreadsheet, Trash2, Eye, Search } from "lucide-react";

export default function AccountsHub() {
  const { files, removeFile } = useAccountsStore();
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [search, setSearch] = useState("");

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Accounts Hub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload and manage monthly shop account files
          </p>
        </div>

        <FileUploadZone />

        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search in files..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {files.length} file{files.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {file.month} · {file.data.length} rows ·{" "}
                      {new Date(file.uploadDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        setPreviewFile(previewFile?.id === file.id ? null : file)
                      }
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="Preview"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (previewFile?.id === file.id) setPreviewFile(null);
                        removeFile(file.id);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {previewFile && (
          <DataPreviewTable
            file={previewFile}
            onClose={() => setPreviewFile(null)}
            searchQuery={search}
          />
        )}
      </div>
    </AppLayout>
  );
}
