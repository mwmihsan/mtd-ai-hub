
-- Storage bucket for Excel files
INSERT INTO storage.buckets (id, name, public) VALUES ('account-files', 'account-files', true);

-- Allow anyone to upload/read (no auth required for this app)
CREATE POLICY "Anyone can upload account files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'account-files');
CREATE POLICY "Anyone can read account files" ON storage.objects FOR SELECT USING (bucket_id = 'account-files');
CREATE POLICY "Anyone can delete account files" ON storage.objects FOR DELETE USING (bucket_id = 'account-files');

-- Uploaded files metadata
CREATE TABLE public.uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  month TEXT NOT NULL DEFAULT 'Unknown',
  upload_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read uploaded_files" ON public.uploaded_files FOR SELECT USING (true);
CREATE POLICY "Anyone can insert uploaded_files" ON public.uploaded_files FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update uploaded_files" ON public.uploaded_files FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete uploaded_files" ON public.uploaded_files FOR DELETE USING (true);

-- Account rows table
CREATE TABLE public.account_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID REFERENCES public.uploaded_files(id) ON DELETE CASCADE NOT NULL,
  date TEXT,
  account TEXT,
  sub_account TEXT,
  description TEXT,
  debit NUMERIC NOT NULL DEFAULT 0,
  credit NUMERIC NOT NULL DEFAULT 0
);

ALTER TABLE public.account_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read account_rows" ON public.account_rows FOR SELECT USING (true);
CREATE POLICY "Anyone can insert account_rows" ON public.account_rows FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update account_rows" ON public.account_rows FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete account_rows" ON public.account_rows FOR DELETE USING (true);
