/**
 * Saving and reading the assistant chat by day (convex/assistantChat.ts). Private to the person:
 * an account uses its own sign-in; grandma / the school nurse / Child Mode use their access code.
 * Legacy codes and the doctor's session don't save history (`owner` is null).
 */
import { useQuery } from "convex/react";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";

export interface SavedChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
}

export type ChatOwnerArgs = { code?: string };

export function useChatOwner(): ChatOwnerArgs | null {
  const auth = useAuth();
  if (auth.doctorSession) return null;
  if (auth.caregiverSession) {
    return auth.caregiverCodeKind === "access" && auth.caregiverCloudCode ? { code: auth.caregiverCloudCode } : null;
  }
  return auth.isSignedIn && auth.account?.convexUserId ? {} : null;
}

/** Days with saved chats, newest first (undefined while loading). */
export function useChatDays(owner: ChatOwnerArgs | null) {
  return useQuery(api.assistantChat.days, owner ? { ...owner } : "skip") as
    | { day: string; preview: string; count: number; updatedAt: number }[]
    | undefined;
}

/** One day's saved conversation, oldest first (undefined while loading). */
export function useChatDay(owner: ChatOwnerArgs | null, day: string | null) {
  return useQuery(api.assistantChat.day, owner && day ? { ...owner, day } : "skip") as SavedChatMessage[] | undefined;
}

export async function loadChatDay(owner: ChatOwnerArgs, day: string): Promise<SavedChatMessage[]> {
  return (await createConvexAuthClient().query(api.assistantChat.day, { ...owner, day })) as SavedChatMessage[];
}

/** Save messages to a day. Never throws: history is a convenience, the chat itself must not fail. */
export async function saveChatMessages(owner: ChatOwnerArgs, day: string, messages: SavedChatMessage[]): Promise<void> {
  try {
    await createConvexAuthClient().mutation(api.assistantChat.append, { ...owner, day, messages });
  } catch {
    /* offline or signed out: the conversation still works, it just isn't saved */
  }
}
