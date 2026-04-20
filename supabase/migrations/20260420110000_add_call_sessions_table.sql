-- 1:1 in-app call sessions for WebRTC signaling/session state.
CREATE TABLE public.call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  caller_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  status TEXT NOT NULL CHECK (status IN ('ringing', 'accepted', 'declined', 'ended', 'missed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  CONSTRAINT call_sessions_no_self_call CHECK (caller_user_id <> callee_user_id)
);

CREATE INDEX idx_call_sessions_conversation_id ON public.call_sessions(conversation_id);
CREATE INDEX idx_call_sessions_caller_user_id ON public.call_sessions(caller_user_id);
CREATE INDEX idx_call_sessions_callee_user_id ON public.call_sessions(callee_user_id);
CREATE INDEX idx_call_sessions_status_created_at ON public.call_sessions(status, created_at DESC);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view call sessions"
  ON public.call_sessions FOR SELECT TO authenticated
  USING (auth.uid() = caller_user_id OR auth.uid() = callee_user_id);

CREATE POLICY "Caller can create dm call sessions"
  ON public.call_sessions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = caller_user_id
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_id
        AND c.type = 'dm'
    )
    AND public.is_conversation_member(conversation_id, caller_user_id)
    AND public.is_conversation_member(conversation_id, callee_user_id)
  );

CREATE POLICY "Participants can update call sessions"
  ON public.call_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = caller_user_id OR auth.uid() = callee_user_id)
  WITH CHECK (auth.uid() = caller_user_id OR auth.uid() = callee_user_id);

CREATE OR REPLACE FUNCTION public.enforce_call_session_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.conversation_id <> OLD.conversation_id
     OR NEW.caller_user_id <> OLD.caller_user_id
     OR NEW.callee_user_id <> OLD.callee_user_id
     OR NEW.type <> OLD.type
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'call_sessions immutable fields cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_sessions_guard_immutable ON public.call_sessions;
CREATE TRIGGER trg_call_sessions_guard_immutable
BEFORE UPDATE ON public.call_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_call_session_immutable_fields();

DROP TRIGGER IF EXISTS trg_call_sessions_updated ON public.call_sessions;
CREATE TRIGGER trg_call_sessions_updated
BEFORE UPDATE ON public.call_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$$;
