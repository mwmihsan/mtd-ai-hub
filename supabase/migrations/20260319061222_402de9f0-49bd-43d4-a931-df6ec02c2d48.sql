
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  attachments jsonb DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read chat_messages" ON public.chat_messages FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert chat_messages" ON public.chat_messages FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete chat_messages" ON public.chat_messages FOR DELETE TO public USING (true);
