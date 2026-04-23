import { supabase } from "@/integrations/supabase/client";

interface CountOptions {
  limit?: number;
  concurrency?: number;
}

export async function countMessagesByConversationIds(
  conversationIds: string[],
  options: CountOptions = {},
): Promise<Record<string, number>> {
  const limit = options.limit ?? 16;
  const concurrency = options.concurrency ?? 6;
  const uniqueConversationIds = Array.from(new Set(conversationIds.filter(Boolean))).slice(0, limit);
  if (uniqueConversationIds.length === 0) return {};

  const counts: Record<string, number> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < uniqueConversationIds.length) {
      const currentIndex = cursor;
      cursor += 1;
      const conversationId = uniqueConversationIds[currentIndex];

      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId);

      if (error) {
        console.error("Failed to count conversation messages", { conversationId, error });
        continue;
      }
      counts[conversationId] = count ?? 0;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), uniqueConversationIds.length) }, worker),
  );
  return counts;
}
