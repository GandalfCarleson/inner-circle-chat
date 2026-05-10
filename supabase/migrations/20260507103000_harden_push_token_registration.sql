-- Harden push token registration to prevent cross-account token drift and duplicate sends.
ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS device_info JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Normalize existing token values before adding stronger constraints.
UPDATE public.push_tokens
SET token = btrim(token)
WHERE token <> btrim(token);

DELETE FROM public.push_tokens
WHERE btrim(token) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_tokens_token_not_blank'
  ) THEN
    ALTER TABLE public.push_tokens
      ADD CONSTRAINT push_tokens_token_not_blank
      CHECK (length(btrim(token)) > 0)
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.push_tokens
  VALIDATE CONSTRAINT push_tokens_token_not_blank;

-- Keep only the newest row per concrete device token + platform pair.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY token, platform
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.push_tokens
)
DELETE FROM public.push_tokens pt
USING ranked r
WHERE pt.id = r.id
  AND r.rn > 1;

ALTER TABLE public.push_tokens
  DROP CONSTRAINT IF EXISTS push_tokens_user_token_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token_platform_unique
  ON public.push_tokens (token, platform);

CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token TEXT,
  p_platform TEXT,
  p_device_info JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _me UUID := auth.uid();
  _token TEXT := btrim(COALESCE(p_token, ''));
  _platform TEXT := lower(btrim(COALESCE(p_platform, '')));
  _row_id UUID;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _token = '' THEN
    RAISE EXCEPTION 'p_token is required';
  END IF;

  IF _platform NOT IN ('ios', 'android', 'web') THEN
    RAISE EXCEPTION 'Unsupported platform: %', _platform;
  END IF;

  INSERT INTO public.push_tokens (user_id, token, platform, device_info)
  VALUES (_me, _token, _platform, COALESCE(p_device_info, '{}'::jsonb))
  ON CONFLICT (token, platform)
  DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    device_info = EXCLUDED.device_info,
    updated_at = now()
  RETURNING id INTO _row_id;

  RETURN _row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT, JSONB) TO authenticated;
