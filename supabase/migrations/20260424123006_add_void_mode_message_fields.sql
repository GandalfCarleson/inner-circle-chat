ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_void_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS void_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_duration_seconds INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_void_duration_seconds_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_void_duration_seconds_check
      CHECK (void_duration_seconds IS NULL OR void_duration_seconds > 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_messages_void_expires_at
  ON public.messages (void_expires_at)
  WHERE is_void_mode = TRUE;
