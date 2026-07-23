import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
  refresh: () => Promise<void>;
  openThread: (threadKey: string) => Promise<CareMessage[]>;
  sendMessage: (threadKey: string, text: string) => Promise<void>;
  markRead: (threadKey: string) => Promise<void>;
}

const MessagesContext = createContext<MessagesContextType | null>(null);

const POLL_MS = 15_000;

/** Convex query/mutation args for the active messaging identity, or null when this session can't message. */
function identityArgs(identity: MessagingIdentity) {
  if (!identity) return null;
  if (identity.kind === "code") return { code: identity.code } as const;
  return {
    userId: identity.userId as Id<"users">,
    passwordHash: identity.passwordHash,
    patientUserId: identity.patientUserId as Id<"users">,
  } as const;
}

/** A stable string key so effects re-run only when the identity meaningfully changes. */
function identityKey(identity: MessagingIdentity): string | null {
  if (!identity) return null;
  return identity.kind === "code"
    ? `code:${identity.code}`
    : `user:${identity.userId}:${identity.patientUserId}`;
}

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { messagingIdentity } = useAuth();
  const key = identityKey(messagingIdentity);

  const [threads, setThreads] = useState<CareThread[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Keep the latest identity in a ref so the stable callbacks below always read the current session.
  const identityRef = useRef<MessagingIdentity>(messagingIdentity);
  useEffect(() => { identityRef.current = messagingIdentity; }, [messagingIdentity]);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    const args = identityArgs(identityRef.current);
    if (!args) {
      setThreads([]);
      setUnreadCount(0);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await createConvexAuthClient().query(api.careMessages.listThreads, args);
      // Guard against a late response after the session changed.
      if (identityKey(identityRef.current) !== key) return;
      setThreads(res.threads as CareThread[]);
      setUnreadCount(res.unreadTotal);
    } catch {
      // Offline / not-yet-deployed — keep whatever we last had.
    } finally {
      inFlightRef.current = false;
    }
  }, [key]);

  // Reset + poll whenever the messaging identity changes.
  useEffect(() => {
    setThreads([]);
    setUnreadCount(0);
    if (!key) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [key, refresh]);

  const openThread = useCallback(async (threadKey: string): Promise<CareMessage[]> => {
    const args = identityArgs(identityRef.current);
    if (!args) return [];
    try {
      const msgs = await createConvexAuthClient().query(api.careMessages.listMessages, { ...args, threadKey });
      return msgs as CareMessage[];
    } catch {
      return [];
    }
  }, []);

  const sendMessage = useCallback(async (threadKey: string, text: string) => {
    const args = identityArgs(identityRef.current);
    if (!args) return;
    await createConvexAuthClient().mutation(api.careMessages.sendMessage, { ...args, threadKey, text });
    void refresh();
  }, [refresh]);

  const markRead = useCallback(async (threadKey: string) => {
    const args = identityArgs(identityRef.current);
    if (!args) return;
    // Optimistically clear this thread's unread so the badge updates immediately.
    setThreads((prev) => prev.map((th) => (th.threadKey === threadKey ? { ...th, unread: 0 } : th)));
    setUnreadCount((prev) => {
      const th = threads.find((t) => t.threadKey === threadKey);
      return Math.max(0, prev - (th?.unread ?? 0));
    });
    try {
      await createConvexAuthClient().mutation(api.careMessages.markThreadRead, { ...args, threadKey });
    } finally {
      void refresh();
    }
  }, [refresh, threads]);

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
