import { useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { useAccountsStore } from "@/stores/accountsStore";
import { toast } from "sonner";

export function FileUploadZone() {
  const addFile = useAccountsStore((s) => s.addFile);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      for (const file of Array.from(fileList)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext !== "xlsx" && ext !== "csv" && ext !== "xls") {
          toast.error(`Unsupported file: ${file.name}. Use .xlsx or .csv`);
          continue;
        }
        try {
          await addFile(file);
          toast.success(`Uploaded ${file.name}`);
        } catch {
          toast.error(`Failed to parse ${file.name}`);
        }
      }
    },
    [addFile]
  );

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40"
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
        <Upload className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">
          Drop Excel files here or click to upload
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Supports .xlsx, .csv
        </p>
      </div>
      <input
        type="file"
        multiple
        accept=".xlsx,.csv,.xls"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
    </label>
  );
}
