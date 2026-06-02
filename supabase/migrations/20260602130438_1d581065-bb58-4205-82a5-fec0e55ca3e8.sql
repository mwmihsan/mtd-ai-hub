
CREATE TABLE public.telegram_conversation_state (
  chat_id BIGINT PRIMARY KEY,
  pending JSONB,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_conversation_state TO anon, authenticated;
GRANT ALL ON public.telegram_conversation_state TO service_role;

ALTER TABLE public.telegram_conversation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read telegram_conversation_state"
  ON public.telegram_conversation_state FOR SELECT USING (true);
CREATE POLICY "Anyone can insert telegram_conversation_state"
  ON public.telegram_conversation_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update telegram_conversation_state"
  ON public.telegram_conversation_state FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete telegram_conversation_state"
  ON public.telegram_conversation_state FOR DELETE USING (true);
