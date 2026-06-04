-- conversations: per-user chat sessions
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

CREATE POLICY "Users select own conversations"   ON public.conversations FOR SELECT    TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own conversations"   ON public.conversations FOR INSERT    TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own conversations"   ON public.conversations FOR UPDATE    TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own conversations"   ON public.conversations FOR DELETE    TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- messages: individual chat turns inside a conversation
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

CREATE POLICY "Users select own messages"   ON public.messages FOR SELECT    TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own messages"   ON public.messages FOR INSERT    TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own messages"   ON public.messages FOR UPDATE    TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own messages"   ON public.messages FOR DELETE    TO authenticated USING (auth.uid() = user_id);

-- Index for fast conversation message listing
CREATE INDEX messages_conversation_id_idx ON public.messages (conversation_id, created_at);
CREATE INDEX conversations_user_id_idx    ON public.conversations (user_id, created_at DESC);
