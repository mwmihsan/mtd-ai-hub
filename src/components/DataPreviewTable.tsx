import { UploadedFile } from "@/stores/accountsStore";
import { X } from "lucide-react";

interface DataPreviewTableProps {
  file: UploadedFile;
  onClose: () => void;
  searchQuery: string;
}

export function DataPreviewTable({ file, onClose, searchQuery }: DataPreviewTableProps) {
  const query = searchQuery.toLowerCase();
  const filteredRows = query
    ? file.raw.filter((row, i) =>
        i === 0 || row.some((cell) => String(cell).toLowerCase().includes(query))
      )
    : file.raw;

  return (
    <div className="animate-fade-in rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{file.name}</h3>
          <p className="text-xs text-muted-foreground">
            {file.data.length} rows · {file.month}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-96 overflow-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-sunken">
              {file.headers.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.slice(1).map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-border/50 transition-colors hover:bg-accent/50"
              >
                {row.map((cell, ci) => (
                  <td key={ci} className="whitespace-nowrap px-3 py-2 text-foreground">
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows.length <= 1 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No matching rows found.
          </p>
        )}
      </div>
    </div>
  );
}
