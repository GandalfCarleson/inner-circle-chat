-- Store native push tokens per device for iOS/Android delivery.
CREATE TABLE public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_user_token_unique UNIQUE (user_id, token)
);

CREATE INDEX idx_push_tokens_user_id ON public.push_tokens(user_id);
CREATE INDEX idx_push_tokens_platform ON public.push_tokens(platform);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own push tokens"
  ON public.push_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own push tokens"
  ON public.push_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own push tokens"
  ON public.push_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own push tokens"
  ON public.push_tokens FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_push_tokens_updated ON public.push_tokens;
CREATE TRIGGER trg_push_tokens_updated
BEFORE UPDATE ON public.push_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
