
-- Singleton table to track getUpdates offset
CREATE TABLE public.telegram_bot_state (
  id int PRIMARY KEY CHECK (id = 1),
  update_offset bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0);

-- Incoming messages log
CREATE TABLE public.telegram_messages (
  update_id bigint PRIMARY KEY,
  chat_id bigint NOT NULL,
  text text,
  raw_update jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_messages_chat_id ON public.telegram_messages (chat_id);

-- Bot settings
CREATE TABLE public.telegram_settings (
  id int PRIMARY KEY CHECK (id = 1),
  admin_chat_id text,
  bot_username text,
  is_active boolean NOT NULL DEFAULT false,
  stock_value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_settings (id) VALUES (1);

-- RLS
ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read telegram_bot_state" ON public.telegram_bot_state FOR SELECT USING (true);
CREATE POLICY "Anyone can update telegram_bot_state" ON public.telegram_bot_state FOR UPDATE USING (true);

CREATE POLICY "Anyone can read telegram_messages" ON public.telegram_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can insert telegram_messages" ON public.telegram_messages FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can read telegram_settings" ON public.telegram_settings FOR SELECT USING (true);
CREATE POLICY "Anyone can update telegram_settings" ON public.telegram_settings FOR UPDATE USING (true);
