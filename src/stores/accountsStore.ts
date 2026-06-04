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

/** Look up a value from a parsed row using case-insensitive key matching */
function getCaseInsensitive(row: Record<string, any>, ...keys: string[]): any {
  for (const key of keys) {
    // Exact match
    if (row[key] !== undefined) return row[key];
    // Case-insensitive match
    const lowerKey = key.toLowerCase();
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === lowerKey) return row[k];
    }
  }
  return undefined;
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

    // Save account rows to DB using raw positional data for reliability
    if (rawData.length > 1) {
      // Log headers for debugging
      console.log('[AccountsStore] Excel headers detected:', headers);
      if (rawData.length > 1) {
        console.log('[AccountsStore] First data row:', rawData[1]);
      }

      // Build column index map: find which column index maps to which DB field
      // Try matching by header name first, fall back to position
      const colMap = { date: 0, account: 1, sub_account: 2, description: 3, debit: 4, credit: 5 };
      const headerAliases: Record<string, string[]> = {
        date: ['date'],
        account: ['account'],
        sub_account: ['sub account', 'sub_account', 'subaccount'],
        description: ['discerption', 'description', 'describtion', 'desc'],
        debit: ['debit'],
        credit: ['credit'],
      };

      // Try to match headers by name (case-insensitive)
      for (const [field, aliases] of Object.entries(headerAliases)) {
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i].toLowerCase().trim();
          if (aliases.includes(h)) {
            colMap[field as keyof typeof colMap] = i;
            break;
          }
        }
      }

      console.log('[AccountsStore] Column mapping:', colMap);

      // Map raw rows (skip header row at index 0) to DB rows
      const rows = rawData.slice(1).map((row) => ({
        file_id: fileId,
        date: String(row[colMap.date] ?? ''),
        account: String(row[colMap.account] ?? ''),
        sub_account: String(row[colMap.sub_account] ?? ''),
        description: String(row[colMap.description] ?? ''),
        debit: Number(row[colMap.debit]) || 0,
        credit: Number(row[colMap.credit]) || 0,
      }));

      console.log('[AccountsStore] First mapped DB row:', rows[0]);

      // Resolve a permanent Account ID for each unique sub_account
      const uniqueSubs = Array.from(new Set(rows.map((r) => r.sub_account).filter(Boolean)));
      const idMap: Record<string, string> = {};
      for (const name of uniqueSubs) {
        const { data: aid, error: rpcErr } = await supabase.rpc('resolve_or_create_account', { _name: name });
        if (rpcErr) {
          console.error('[AccountsStore] resolve_or_create_account error', name, rpcErr);
          continue;
        }
        if (aid) idMap[name] = aid as string;
      }
      const stampedRows = rows.map((r) => ({ ...r, account_id: idMap[r.sub_account] ?? null }));

      // Insert in batches of 500
      for (let i = 0; i < stampedRows.length; i += 500) {
        const batch = stampedRows.slice(i, i + 500);
        const { error: rowError } = await supabase
          .from('account_rows')
          .insert(batch);
        if (rowError) {
          console.error('[AccountsStore] Insert error:', rowError);
          throw rowError;
        }
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
          // If file missing from storage, try loading from DB rows as fallback
          const { data: dbRows } = await supabase
            .from('account_rows')
            .select('*')
            .eq('file_id', dbFile.id);

          const fallbackData: AccountRow[] = (dbRows || []).map((r: any) => ({
            Date: r.date || '',
            Account: r.account || '',
            'Sub Account': r.sub_account || '',
            Discerption: r.description || '',
            Debit: Number(r.debit) || 0,
            Credit: Number(r.credit) || 0,
          }));
          const fallbackHeaders = fallbackData.length > 0
            ? ['Date', 'Account', 'Sub Account', 'Discerption', 'Debit', 'Credit']
            : [];
          const fallbackRaw: string[][] = fallbackData.length > 0
            ? [fallbackHeaders, ...fallbackData.map(r => [r.Date, r.Account, r['Sub Account'], r.Discerption, String(r.Debit), String(r.Credit)])]
            : [];

          loadedFiles.push({
            id: dbFile.id,
            name: dbFile.file_name,
            month: dbFile.month,
            uploadDate: dbFile.upload_date,
            data: fallbackData,
            raw: fallbackRaw,
            headers: fallbackHeaders,
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
