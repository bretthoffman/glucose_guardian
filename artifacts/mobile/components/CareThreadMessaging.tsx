import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { useMessages, type CareMessage } from "@/context/MessagesContext";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function groupByDate(messages: CareMessage[]) {
  const groups: { date: string; messages: CareMessage[] }[] = [];
  let lastDate = "";
  for (const m of messages) {
    const date = fmtDate(m.createdAt);
    if (date !== lastDate) {
      groups.push({ date, messages: [m] });
      lastDate = date;
    } else {
      groups[groups.length - 1].messages.push(m);
    }
  }
  return groups;
}

const POLL_MS = 8_000;

interface Props {
  colors: (typeof Colors)["light"];
  threadKey: string;
  /** The other participant's name (for empty-state + reply placeholder copy). */
  title: string;
  /** Bottom padding under the input bar so it clears the floating tab bar (inline) or safe area (modal). */
  bottomSpace: number;
  /** KeyboardAvoidingView vertical offset for this rendering context. */
  keyboardOffset: number;
}

/** One cross-account conversation (guardian↔code / code↔code), backed by MessagesContext. */
export default function CareThreadMessaging({ colors, threadKey, title, bottomSpace, keyboardOffset }: Props) {
  const { openThread, sendMessage, markRead } = useMessages();
  const [messages, setMessages] = useState<CareMessage[]>([]);
  const [input, setInput] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    const msgs = await openThread(threadKey);
    setMessages(msgs);
  }, [openThread, threadKey]);

  useEffect(() => {
    void load();
    void markRead(threadKey);
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
    // markRead is stable per identity; re-running only on threadKey is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey, load]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");
    // Optimistic echo so the bubble appears instantly; reconciled by the next load().
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, text, senderKey: "me", senderName: "You", fromMe: true, createdAt: Date.now() },
    ]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      await sendMessage(threadKey, text);
    } finally {
      void load();
    }
  }

  const groups = groupByDate(messages);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={keyboardOffset}
    >
      <FlatList
        ref={flatListRef}
        data={groups}
        keyExtractor={(g) => g.date}
        {...NO_AUTO_CONTENT_INSETS}
        contentContainerStyle={[styles.listContent, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={{ fontSize: 36 }}>💬</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No messages yet</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              Send {title} a message — it&apos;ll appear here.
            </Text>
          </View>
        }
        renderItem={({ item: group }) => (
          <View>
            <View style={styles.dateSep}>
              <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dateLabel, { color: colors.textMuted, backgroundColor: colors.background }]}>
                {group.date}
              </Text>
              <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
            </View>
            {group.messages.map((msg: CareMessage) => {
              const isMine = msg.fromMe;
              return (
                <View key={msg.id} style={[styles.msgRow, { justifyContent: isMine ? "flex-end" : "flex-start" }]}>
                  {!isMine && (
                    <View style={[styles.avatar, { backgroundColor: COLORS.primary + "20" }]}>
                      <Text style={{ fontSize: 11 }}>👤</Text>
                    </View>
                  )}
                  <View style={{ maxWidth: "75%" }}>
                    {!isMine && (
                      <Text style={[styles.senderLabel, { color: colors.textMuted }]}>{msg.senderName}</Text>
                    )}
                    <View
                      style={[
                        styles.bubble,
                        isMine
                          ? { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 }
                          : { backgroundColor: colors.backgroundTertiary, borderBottomLeftRadius: 4, borderColor: colors.border, borderWidth: 1 },
                      ]}
                    >
                      <Text style={[styles.bubbleText, { color: isMine ? "#fff" : colors.text }]}>{msg.text}</Text>
                    </View>
                    <Text style={[styles.timeLabel, { color: colors.textMuted, textAlign: isMine ? "right" : "left" }]}>
                      {fmtTime(msg.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      />

      <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: bottomSpace }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, color: colors.text }]}
          placeholder={`Message ${title}…`}
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={1000}
          returnKeyType="send"
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <Pressable
          style={[styles.sendBtn, { backgroundColor: input.trim() ? COLORS.primary : colors.backgroundTertiary }]}
          onPress={send}
          disabled={!input.trim()}
        >
          <Feather name="send" size={16} color={input.trim() ? "#fff" : colors.textMuted} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingTop: 16, paddingHorizontal: 16, gap: 4 },
  emptyWrap: { flex: 1, alignItems: "center", paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 13, fontWeight: "400", textAlign: "center", lineHeight: 20 },
  dateSep: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 16 },
  dateLine: { flex: 1, height: 1 },
  dateLabel: { fontSize: 11, fontWeight: "500", paddingHorizontal: 4 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  senderLabel: { fontSize: 10, fontWeight: "500", marginBottom: 2, marginLeft: 2 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleText: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  timeLabel: { fontSize: 10, fontWeight: "400", marginTop: 3, marginHorizontal: 4 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, fontWeight: "400", maxHeight: 120 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
