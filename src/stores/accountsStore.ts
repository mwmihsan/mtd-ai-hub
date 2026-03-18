import { create } from 'zustand';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

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
  raw: string[][];
  headers: string[];
  storagePath?: string;
}

interface AccountsStore {
  files: UploadedFile[];
  loading: boolean;
  addFile: (file: File) => Promise<void>;
  removeFile: (id: string) => Promise<void>;
  loadFromCloud: () => Promise<void>;
  getAllData: () => { fileName: string; month: string; data: AccountRow[] }[];
}

function detectMonth(fileName: string, data: AccountRow[]): string {
  const monthMatch = fileName.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-_]*(\d{2,4})?/i);
  if (monthMatch) return monthMatch[0].trim();
  if (data.length > 0 && data[0].Date) {
    const d = new Date(data[0].Date);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  }
  return 'Unknown';
}

function parseWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json<AccountRow>(sheet, { defval: '' });
  const rawData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];
  const headers = rawData.length > 0 ? rawData[0].map(String) : [];
  return { jsonData, rawData, headers };
}

export const useAccountsStore = create<AccountsStore>((set, get) => ({
  files: [],
  loading: false,

  addFile: async (file: File) => {
    const buffer = await file.arrayBuffer();
    const { jsonData, rawData, headers } = parseWorkbook(buffer);
    const month = detectMonth(file.name, jsonData);
    const fileId = crypto.randomUUID();
    const storagePath = `uploads/${fileId}/${file.name}`;

    // Upload to cloud storage
    const { error: storageError } = await supabase.storage
      .from('account-files')
      .upload(storagePath, file);

    if (storageError) throw storageError;

    // Save metadata to DB
    const { error: dbError } = await supabase
      .from('uploaded_files')
      .insert({
        id: fileId,
        file_name: file.name,
        storage_path: storagePath,
        month,
        row_count: jsonData.length,
      });

    if (dbError) throw dbError;

    // Save account rows to DB
    if (jsonData.length > 0) {
      const rows = jsonData.map((row) => ({
        file_id: fileId,
        date: String(row.Date || ''),
        account: String(row.Account || ''),
        sub_account: String(row['Sub Account'] || ''),
        description: String(row.Discerption || ''),
        debit: Number(row.Debit) || 0,
        credit: Number(row.Credit) || 0,
      }));

      // Insert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: rowError } = await supabase
          .from('account_rows')
          .insert(batch);
        if (rowError) throw rowError;
      }
    }

    const uploadedFile: UploadedFile = {
      id: fileId,
      name: file.name,
      month,
      uploadDate: new Date().toISOString(),
      data: jsonData,
      raw: rawData,
      headers,
      storagePath,
    };

    set((state) => ({ files: [...state.files, uploadedFile] }));
  },

  removeFile: async (id: string) => {
    const file = get().files.find((f) => f.id === id);
    if (file?.storagePath) {
      await supabase.storage.from('account-files').remove([file.storagePath]);
    }
    await supabase.from('account_rows').delete().eq('file_id', id);
    await supabase.from('uploaded_files').delete().eq('id', id);
    set((state) => ({ files: state.files.filter((f) => f.id !== id) }));
  },

  loadFromCloud: async () => {
    set({ loading: true });
    try {
      const { data: dbFiles, error } = await supabase
        .from('uploaded_files')
        .select('*')
        .order('upload_date', { ascending: false });

      if (error) throw error;
      if (!dbFiles || dbFiles.length === 0) {
        set({ files: [], loading: false });
        return;
      }

      const loadedFiles: UploadedFile[] = [];

      for (const dbFile of dbFiles) {
        // Download file from storage to parse
        const { data: fileData, error: dlError } = await supabase.storage
          .from('account-files')
          .download(dbFile.storage_path);

        if (dlError || !fileData) {
          // If file missing from storage, still show metadata
          loadedFiles.push({
            id: dbFile.id,
            name: dbFile.file_name,
            month: dbFile.month,
            uploadDate: dbFile.upload_date,
            data: [],
            raw: [],
            headers: [],
            storagePath: dbFile.storage_path,
          });
          continue;
        }

        const buffer = await fileData.arrayBuffer();
        const { jsonData, rawData, headers } = parseWorkbook(buffer);

        loadedFiles.push({
          id: dbFile.id,
          name: dbFile.file_name,
          month: dbFile.month,
          uploadDate: dbFile.upload_date,
          data: jsonData,
          raw: rawData,
          headers,
          storagePath: dbFile.storage_path,
        });
      }

      set({ files: loadedFiles, loading: false });
    } catch (e) {
      console.error('Failed to load from cloud:', e);
      set({ loading: false });
    }
  },

  getAllData: () => {
    return get().files.map((f) => ({
      fileName: f.name,
      month: f.month,
      data: f.data,
    }));
  },
}));
