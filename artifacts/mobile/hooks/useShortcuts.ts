/**
 * This person's Glucose-screen shortcuts (utils/shortcuts): saved per account or access code on the
 * server (convex/shortcuts), cached on the phone so they show at once and offline, and filtered to
 * what this person may use right now.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery } from "convex/react";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChatOwner } from "@/hooks/useChatHistory";
import { api } from "@/utils/convex-auth-client";
import { dashboardSectionVisibility } from "@/utils/dashboardSections";
import {
  availableShortcuts,
  cleanIds,
  resolveShortcuts,
  type ShortcutAccess,
  type ShortcutDef,
} from "@/utils/shortcuts";

const CACHE_PREFIX = "@gluco_guardian_shortcuts:";

export function useShortcutAccess(): ShortcutAccess {
  const auth = useAuth();
  const chatOwner = useChatOwner();
  const { profile, isChildMode, caregiverSession, doctorSession, accessCodeRole, accessCodePermissions, isCaregiverViewingChild } = auth;
  return useMemo(() => {
    const isParent = profile?.accountRole === "parent" || profile?.accountRole === undefined;
    const isAdult = profile?.accountRole === "adult";
    const codeSession = accessCodeRole != null;
    return {
      doctorSession: !!doctorSession,
      canOpenLogs: !codeSession || !!accessCodePermissions?.log,
      canUseCalculator: codeSession ? !!accessCodePermissions?.useCalculator : !(isChildMode && !caregiverSession),
      canChat: !codeSession || !!accessCodePermissions?.chat,
      hasChatHistory: !!chatOwner,
      dashboard: dashboardSectionVisibility({
        isChildMode,
        caregiverSession,
        doctorSession,
        isParent,
        isAdult,
        caregiverViewingChild: isCaregiverViewingChild,
      }),
    };
  }, [profile?.accountRole, isChildMode, caregiverSession, doctorSession, accessCodeRole, accessCodePermissions, isCaregiverViewingChild, chatOwner]);
}

/** Saved ids (null = never set), plus a setter that saves to the server and the phone. */
export function useShortcuts(): {
  shortcuts: ShortcutDef[];
  saved: string[] | null;
  available: ShortcutDef[];
  setIds: (ids: string[]) => void;
} {
  const owner = useChatOwner();
  const access = useShortcutAccess();
  const { account, caregiverCloudCode } = useAuth();
  const cacheKey = CACHE_PREFIX + (owner?.code ? `c:${owner.code}` : account?.convexUserId ? `u:${account.convexUserId}` : caregiverCloudCode ? `c:${caregiverCloudCode}` : "local");
  const remote = useQuery(api.shortcuts.mine, owner ? { ...owner } : "skip") as string[] | null | undefined;
  const save = useMutation(api.shortcuts.set);
  const [cached, setCached] = useState<string[] | null | undefined>(undefined);
  const [local, setLocal] = useState<string[] | null>(null); // a change made on this phone, until the server echoes it

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (alive) setCached(raw ? (JSON.parse(raw) as string[]) : null);
      })
      .catch(() => alive && setCached(null));
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  // The server's copy wins once it arrives (another phone may have changed it); keep the cache fresh.
  useEffect(() => {
    if (remote === undefined) return;
    setLocal(null);
    if (remote) AsyncStorage.setItem(cacheKey, JSON.stringify(remote)).catch(() => {});
  }, [remote, cacheKey]);

  const saved = local ?? (remote !== undefined ? remote : cached ?? null);

  const setIds = useCallback(
    (ids: string[]) => {
      const clean = cleanIds(ids);
      setLocal(clean);
      AsyncStorage.setItem(cacheKey, JSON.stringify(clean)).catch(() => {});
      if (owner) save({ ...owner, ids: clean }).catch(() => {});
    },
    [cacheKey, owner, save],
  );

  return {
    shortcuts: resolveShortcuts(saved, access),
    saved,
    available: availableShortcuts(access),
    setIds,
  };
}

/** Jump to a shortcut's screen. `t` nonces make a repeat tap re-open it. */
export function openShortcut(s: ShortcutDef): void {
  const t = String(Date.now());
  switch (s.target.kind) {
    case "insulin":
      router.push({ pathname: "/(tabs)/insulin", params: s.target.add ? { tab: "log", add: "1", t } : { tab: s.target.tab, t } });
      return;
    case "settings":
      router.push({ pathname: "/(tabs)/dashboard", params: { open: "settings", t } });
      return;
    case "help":
      // Help needs the Help context; ShortcutsRow starts it itself.
      return;
    case "food":
      router.push("/(tabs)/food");
      return;
    case "chat":
      router.push({
        pathname: "/(tabs)/chat",
        params: s.target.open === "messages" ? { openMessages: t } : { openHistory: t },
      });
      return;
    case "dashboard":
      router.push({ pathname: "/(tabs)/dashboard", params: { open: s.target.section, t } });
      return;
  }
}
