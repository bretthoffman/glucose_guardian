import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { useAuth, type MessagingIdentity } from "@/context/AuthContext";

/** One conversation in the Messages page (a guardian↔code or code↔code thread). */
export interface CareThread {
  threadKey: string;
  otherName: string;
  otherKind: "guardian" | "child" | "caregiver";
  lastText: string | null;
  lastAt: number | null;
  lastFromMe: boolean;
  unread: number;
}

/** One message inside a thread. */
export interface CareMessage {
  id: string;
  text: string;
  senderKey: string;
  senderName: string;
  fromMe: boolean;
  createdAt: number;
}

interface MessagesContextType {
  /** Cross-account threads for the current session (excludes the Doctor thread, which is separate). */
  threads: CareThread[];
  /** Total unread across all cross-account threads — drives the tab/floating badges. */
  unreadCount: number;
  /** No-op since the subscription is live; kept so existing callers don't change. */
  refresh: () => Promise<void>;
  /** One-shot fetch of a thread (used by non-reactive callers; the thread view subscribes instead). */
  openThread: (threadKey: string) => Promise<CareMessage[]>;
  sendMessage: (threadKey: string, text: string) => Promise<void>;
  markRead: (threadKey: string) => Promise<void>;
}

const MessagesContext = createContext<MessagesContextType | null>(null);

/** Convex query/mutation args for the active messaging identity, or null when it can't message. */
function identityArgs(identity: MessagingIdentity) {
  if (!identity) return null;
  if (identity.kind === "code") return { code: identity.code } as const;
  return {
    userId: identity.userId as Id<"users">,
    passwordHash: identity.passwordHash,
    patientUserId: identity.patientUserId as Id<"users">,
  } as const;
}

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { messagingIdentity } = useAuth();
  const args = identityArgs(messagingIdentity);

  // LIVE subscription (Stage 2 of the ConvexReactClient migration): the server pushes thread/unread
  // changes the moment they happen — no more 15s polling timer. "skip" disables the subscription for
  // sessions that can't message (doctor, nurse on their menu, signed out).
  const live = useQuery(api.careMessages.listThreads, args ?? "skip");

  // Optimistic read overlay so tapping a thread clears its badge instantly; the overlay resets as
  // soon as the next server state arrives (which then includes the read).
  const [readOverride, setReadOverride] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (live) setReadOverride(new Set());
  }, [live]);

  const threads = useMemo<CareThread[]>(() => {
    const base = (live?.threads ?? []) as CareThread[];
    if (readOverride.size === 0) return base;
    return base.map((t) => (readOverride.has(t.threadKey) ? { ...t, unread: 0 } : t));
  }, [live, readOverride]);
  const unreadCount = useMemo(() => threads.reduce((n, t) => n + t.unread, 0), [threads]);

  const refresh = useCallback(async () => {
    /* live subscription — nothing to do */
  }, []);

  const openThread = useCallback(async (threadKey: string): Promise<CareMessage[]> => {
    const a = identityArgs(messagingIdentity);
    if (!a) return [];
    try {
      const msgs = await createConvexAuthClient().query(api.careMessages.listMessages, { ...a, threadKey });
      return msgs as CareMessage[];
    } catch {
      return [];
    }
  }, [messagingIdentity]);

  const sendMessage = useCallback(async (threadKey: string, text: string) => {
    const a = identityArgs(messagingIdentity);
    if (!a) return;
    // The thread-list subscription updates itself when the write lands.
    await createConvexAuthClient().mutation(api.careMessages.sendMessage, { ...a, threadKey, text });
  }, [messagingIdentity]);

  const markRead = useCallback(async (threadKey: string) => {
    const a = identityArgs(messagingIdentity);
    if (!a) return;
    setReadOverride((prev) => new Set(prev).add(threadKey));
    try {
      await createConvexAuthClient().mutation(api.careMessages.markThreadRead, { ...a, threadKey });
    } catch {
      /* the overlay clears on the next server state either way */
    }
  }, [messagingIdentity]);

  return (
    <MessagesContext.Provider value={{ threads, unreadCount, refresh, openThread, sendMessage, markRead }}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages(): MessagesContextType {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used within a MessagesProvider");
  return ctx;
}

/**
 * LIVE messages of one thread — the open-conversation view subscribes here, so incoming messages
 * appear the moment they're written (replaces the old 8s poll). `undefined` while loading.
 */
export function useThreadMessages(threadKey: string): CareMessage[] | undefined {
  const { messagingIdentity } = useAuth();
  const a = identityArgs(messagingIdentity);
  const live = useQuery(api.careMessages.listMessages, a ? { ...a, threadKey } : "skip");
  return live as CareMessage[] | undefined;
}
