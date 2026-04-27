-- TestFlight V0.1 hardening migration
-- 1) Tighten conversation membership RLS
-- 2) Enforce DB-level DM dedupe with secure RPC creation path
-- 3) Prevent reverse-duplicate friendships

-- ---------------------------------------------------------------------------
-- 1) RLS hardening
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can create conversations" ON public.conversations;
CREATE POLICY "Authenticated can create group conversations"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND type = 'group');

DROP POLICY IF EXISTS "Add self or by creator" ON public.conversation_members;
CREATE POLICY "Creator can add conversation members"
  ON public.conversation_members FOR INSERT TO authenticated
  WITH CHECK (public.is_conversation_creator(conversation_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- 2) DM pair uniqueness + secure RPC
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS dm_user_low UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS dm_user_high UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill DM pair columns for existing 1:1 conversations where exactly 2 members exist.
WITH dm_pairs AS (
  SELECT
    cm.conversation_id,
    (ARRAY_AGG(cm.user_id ORDER BY cm.user_id))[1] AS user_low,
    (ARRAY_AGG(cm.user_id ORDER BY cm.user_id))[2] AS user_high,
    COUNT(DISTINCT cm.user_id) AS member_count
  FROM public.conversation_members cm
  JOIN public.conversations c ON c.id = cm.conversation_id
  WHERE c.type = 'dm'
  GROUP BY cm.conversation_id
)
UPDATE public.conversations c
SET
  dm_user_low = p.user_low,
  dm_user_high = p.user_high
FROM dm_pairs p
WHERE c.id = p.conversation_id
  AND p.member_count = 2
  AND (c.dm_user_low IS NULL OR c.dm_user_high IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_dm_pair_shape_check'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_dm_pair_shape_check
      CHECK (
        (
          type = 'dm'
          AND dm_user_low IS NOT NULL
          AND dm_user_high IS NOT NULL
          AND dm_user_low <> dm_user_high
          AND dm_user_low < dm_user_high
        )
        OR (
          type = 'group'
          AND dm_user_low IS NULL
          AND dm_user_high IS NULL
        )
      )
      NOT VALID;
  END IF;
END
$$;

-- Validate after backfill.
ALTER TABLE public.conversations
  VALIDATE CONSTRAINT conversations_dm_pair_shape_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_dm_unique_pair
  ON public.conversations (dm_user_low, dm_user_high)
  WHERE type = 'dm';

CREATE OR REPLACE FUNCTION public.find_or_create_dm(other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _me UUID := auth.uid();
  _user_low UUID;
  _user_high UUID;
  _conversation_id UUID;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF other_user_id IS NULL THEN
    RAISE EXCEPTION 'other_user_id is required';
  END IF;

  IF _me = other_user_id THEN
    RAISE EXCEPTION 'Cannot create a DM with yourself';
  END IF;

  _user_low := LEAST(_me, other_user_id);
  _user_high := GREATEST(_me, other_user_id);

  SELECT id
  INTO _conversation_id
  FROM public.conversations
  WHERE type = 'dm'
    AND dm_user_low = _user_low
    AND dm_user_high = _user_high
  LIMIT 1;

  IF _conversation_id IS NULL THEN
    INSERT INTO public.conversations (
      type,
      created_by,
      dm_user_low,
      dm_user_high
    )
    VALUES (
      'dm',
      _me,
      _user_low,
      _user_high
    )
    ON CONFLICT (dm_user_low, dm_user_high) WHERE type = 'dm'
    DO UPDATE SET updated_at = public.conversations.updated_at
    RETURNING id INTO _conversation_id;
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES
    (_conversation_id, _me, 'member'),
    (_conversation_id, other_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN _conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_dm(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_or_create_dm(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Low-risk cleanup: prevent reverse duplicate friendships
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.friendships
)
DELETE FROM public.friendships f
USING ranked r
WHERE f.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_unique_unordered_pair
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
