
-- 1. Accounts Master
CREATE TABLE public.accounts_master (
  account_id text PRIMARY KEY,
  account_name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  account_type text,
  mobile text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.accounts_master TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_master TO authenticated;
GRANT ALL ON public.accounts_master TO service_role;

ALTER TABLE public.accounts_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read accounts_master"
  ON public.accounts_master FOR SELECT TO public USING (true);

CREATE POLICY "Service write accounts_master"
  ON public.accounts_master FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Service update accounts_master"
  ON public.accounts_master FOR UPDATE TO public USING (true);

CREATE POLICY "Admins delete accounts_master"
  ON public.accounts_master FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Sequence + next_account_id()
CREATE SEQUENCE IF NOT EXISTS public.account_id_seq START 1;

CREATE OR REPLACE FUNCTION public.next_account_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  n := nextval('public.account_id_seq');
  RETURN 'ACC' || LPAD(n::text, 4, '0');
END;
$$;

-- 3. resolve_or_create_account(name) -> account_id
CREATE OR REPLACE FUNCTION public.resolve_or_create_account(_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm text;
  existing_id text;
  new_id text;
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RETURN NULL;
  END IF;
  norm := upper(regexp_replace(trim(_name), '\s+', ' ', 'g'));

  SELECT account_id INTO existing_id
  FROM public.accounts_master
  WHERE normalized_name = norm
  LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  -- also check aliases
  SELECT account_id INTO existing_id
  FROM public.account_aliases
  WHERE upper(regexp_replace(trim(alias), '\s+', ' ', 'g')) = norm
    AND account_id IS NOT NULL
  LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  new_id := public.next_account_id();
  INSERT INTO public.accounts_master (account_id, account_name, normalized_name)
  VALUES (new_id, trim(_name), norm)
  ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
  RETURNING account_id INTO existing_id;
  RETURN existing_id;
END;
$$;

-- 4. Add account_id to existing tables
ALTER TABLE public.account_aliases ADD COLUMN IF NOT EXISTS account_id text;
CREATE INDEX IF NOT EXISTS idx_account_aliases_account_id ON public.account_aliases(account_id);

ALTER TABLE public.account_rows ADD COLUMN IF NOT EXISTS account_id text;
CREATE INDEX IF NOT EXISTS idx_account_rows_account_id ON public.account_rows(account_id);

-- 5. Backfill: create accounts_master from existing distinct sub_accounts,
-- then stamp account_rows.account_id and account_aliases.account_id.
DO $$
DECLARE
  r record;
  aid text;
BEGIN
  FOR r IN
    SELECT DISTINCT sub_account
    FROM public.account_rows
    WHERE sub_account IS NOT NULL AND length(trim(sub_account)) > 0
  LOOP
    aid := public.resolve_or_create_account(r.sub_account);
    UPDATE public.account_rows
      SET account_id = aid
      WHERE sub_account = r.sub_account AND account_id IS NULL;
  END LOOP;

  -- backfill aliases by sub_account_name
  FOR r IN
    SELECT id, sub_account_name
    FROM public.account_aliases
    WHERE account_id IS NULL AND sub_account_name IS NOT NULL
  LOOP
    aid := public.resolve_or_create_account(r.sub_account_name);
    UPDATE public.account_aliases SET account_id = aid WHERE id = r.id;
  END LOOP;
END $$;

-- 6. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_accounts_master_updated_at
  BEFORE UPDATE ON public.accounts_master
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 7. Report templates
CREATE TABLE public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  intent text NOT NULL,
  default_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.report_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_templates TO authenticated;
GRANT ALL ON public.report_templates TO service_role;

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read report_templates"
  ON public.report_templates FOR SELECT TO public USING (true);

CREATE POLICY "Admins manage report_templates"
  ON public.report_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
