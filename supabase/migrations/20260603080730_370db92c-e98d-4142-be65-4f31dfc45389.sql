
-- Roles infrastructure
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Add expiry to conversation memory
ALTER TABLE public.telegram_conversation_state
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes');

-- Account aliases
CREATE TABLE public.account_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_account_name TEXT NOT NULL,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias)
);
CREATE INDEX idx_account_aliases_alias_lower ON public.account_aliases (lower(alias));
CREATE INDEX idx_account_aliases_subacct_lower ON public.account_aliases (lower(sub_account_name));

GRANT SELECT ON public.account_aliases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_aliases TO authenticated;
GRANT ALL ON public.account_aliases TO service_role;

ALTER TABLE public.account_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read aliases" ON public.account_aliases FOR SELECT USING (true);
CREATE POLICY "Admins manage aliases" ON public.account_aliases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Intent training
CREATE TABLE public.intent_training (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  example_text TEXT NOT NULL,
  intent TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_intent_training_example_lower ON public.intent_training (lower(example_text));

GRANT SELECT ON public.intent_training TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intent_training TO authenticated;
GRANT ALL ON public.intent_training TO service_role;

ALTER TABLE public.intent_training ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read intents" ON public.intent_training FOR SELECT USING (true);
CREATE POLICY "Admins manage intents" ON public.intent_training FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Corrections
CREATE TABLE public.corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_query TEXT NOT NULL,
  wrong_result TEXT,
  correct_result TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_corrections_query_lower ON public.corrections (lower(original_query));

GRANT SELECT ON public.corrections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corrections TO authenticated;
GRANT ALL ON public.corrections TO service_role;

ALTER TABLE public.corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read corrections" ON public.corrections FOR SELECT USING (true);
CREATE POLICY "Service write corrections" ON public.corrections FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update corrections" ON public.corrections FOR UPDATE USING (true);
CREATE POLICY "Admins delete corrections" ON public.corrections FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Feedback
CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  query TEXT,
  response_summary TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('up','down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_feedback_created ON public.feedback (created_at DESC);

GRANT SELECT ON public.feedback TO anon;
GRANT SELECT, INSERT ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read feedback" ON public.feedback FOR SELECT USING (true);
CREATE POLICY "Public insert feedback" ON public.feedback FOR INSERT WITH CHECK (true);
