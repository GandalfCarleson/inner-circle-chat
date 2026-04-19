import { supabase } from "@/integrations/supabase/client";

const AVATAR_BUCKET = "avatars";

export function resolveAvatarUrl(value?: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const normalizedPath = value.replace(/^\/+/, "").replace(/^avatars\//, "");
  if (!normalizedPath) return null;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(normalizedPath);
  return data.publicUrl;
}

export function buildAvatarStoragePath(userId: string) {
  return `${userId}/avatar`;
}
