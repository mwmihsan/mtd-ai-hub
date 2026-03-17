import { create } from 'zustand';
import * as XLSX from 'xlsx';

export interface AccountRow {
  Date: string;
  Account: string;
  "Sub Account": string;
  Discerption: string;
  Debit: number;
  Credit: number;
}

export interface UploadedFile {
  id: string;
  name: string;
  month: string;
  uploadDate: string;
  data: AccountRow[];
  raw: string[][]; // raw rows for display
  headers: string[];
}

interface AccountsStore {
  files: UploadedFile[];
  addFile: (file: File) => Promise<void>;
  removeFile: (id: string) => void;
  getAllData: () => { fileName: string; month: string; data: AccountRow[] }[];
}

function detectMonth(fileName: string, data: AccountRow[]): string {
  // Try to extract month from filename
  const monthMatch = fileName.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-_]*(\d{2,4})?/i);
  if (monthMatch) {
    return monthMatch[0].trim();
  }
  // Try from first date in data
  if (data.length > 0 && data[0].Date) {
    const d = new Date(data[0].Date);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  }
  return 'Unknown';
}

export const useAccountsStore = create<AccountsStore>((set, get) => ({
  files: [],
  addFile: async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<AccountRow>(sheet, { defval: '' });
    const rawData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];
    const headers = rawData.length > 0 ? rawData[0].map(String) : [];

    const month = detectMonth(file.name, jsonData);

    const uploadedFile: UploadedFile = {
      id: crypto.randomUUID(),
      name: file.name,
      month,
      uploadDate: new Date().toISOString(),
      data: jsonData,
      raw: rawData,
      headers,
    };

    set((state) => ({ files: [...state.files, uploadedFile] }));
  },
  removeFile: (id: string) => {
    set((state) => ({ files: state.files.filter((f) => f.id !== id) }));
  },
  getAllData: () => {
    return get().files.map((f) => ({
      fileName: f.name,
      month: f.month,
      data: f.data,
    }));
  },
}));
