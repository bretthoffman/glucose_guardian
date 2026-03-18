import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import React, { useEffect, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import type { DoctorMessage } from "@/context/AuthContext";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function groupMessagesByDate(messages: DoctorMessage[]) {
  const groups: { date: string; messages: DoctorMessage[] }[] = [];
  let lastDate = "";
  for (const m of messages) {
    const date = fmtDate(m.timestamp);
    if (date !== lastDate) {
      groups.push({ date, messages: [m] });
      lastDate = date;
    } else {
      groups[groups.length - 1].messages.push(m);
    }
  }
  return groups;
}

interface Props {
  colors: (typeof Colors)["light"];
  isDoctor: boolean;
}

export default function DoctorMessaging({ colors, isDoctor }: Props) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { doctorMessages, addDoctorMessage, markDoctorMessagesRead, profile } = useAuth();
  const [input, setInput] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const sender = isDoctor ? "doctor" : "guardian";
  const name = profile?.childName ?? "the patient";
  const parentName = profile?.parentName?.trim() || "Guardian";
  const doctorName = profile?.doctorName?.trim() || "Doctor";

  useEffect(() => {
    markDoctorMessagesRead();
  }, []);

  function send() {
    const text = input.trim();
    if (!text) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addDoctorMessage(text, sender);
    setInput("");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const groups = groupMessagesByDate(doctorMessages);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={tabBarHeight}
    >
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={[styles.headerIcon, { backgroundColor: "#6366F1" + "20" }]}>
          <Feather name="message-circle" size={16} color="#6366F1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {isDoctor ? `Message to ${parentName}` : `Messages from ${doctorName}`}
          </Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {isDoctor
              ? `Leave notes and observations about ${name}'s care`
              : "Private messages from your care team"}
          </Text>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={groups}
        keyExtractor={(g) => g.date}
        contentContainerStyle={[styles.listContent, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={{ fontSize: 36 }}>💬</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No messages yet</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              {isDoctor
                ? `Send a message to ${parentName} about ${name}'s care plan, observations, or next steps.`
                : `When your doctor sends a message about ${name}'s care, it will appear here.`}
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
            {group.messages.map((msg: DoctorMessage) => {
              const isMine = msg.sender === sender;
              const isDoc = msg.sender === "doctor";
              return (
                <View
                  key={msg.id}
                  style={[styles.msgRow, { justifyContent: isMine ? "flex-end" : "flex-start" }]}
                >
                  {!isMine && (
                    <View style={[styles.avatar, { backgroundColor: isDoc ? "#6366F1" + "20" : COLORS.accent + "20" }]}>
                      <Text style={{ fontSize: 11 }}>{isDoc ? "🩺" : "👤"}</Text>
                    </View>
                  )}
                  <View style={{ maxWidth: "75%" }}>
                    {!isMine && (
                      <Text style={[styles.senderLabel, { color: colors.textMuted }]}>
                        {isDoc ? doctorName : parentName}
                      </Text>
                    )}
                    <View
                      style={[
                        styles.bubble,
                        isMine
                          ? { backgroundColor: isDoctor ? "#6366F1" : COLORS.primary, borderBottomRightRadius: 4 }
                          : { backgroundColor: colors.backgroundTertiary, borderBottomLeftRadius: 4, borderColor: colors.border, borderWidth: 1 },
                      ]}
                    >
                      <Text style={[styles.bubbleText, { color: isMine ? "#fff" : colors.text }]}>
                        {msg.text}
                      </Text>
                    </View>
                    <Text style={[styles.timeLabel, { color: colors.textMuted, textAlign: isMine ? "right" : "left" }]}>
                      {fmtTime(msg.timestamp)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      />

      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          },
        ]}
      >
        <TextInput
          style={[styles.input, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, color: colors.text }]}
          placeholder={isDoctor ? `Message ${parentName}…` : `Reply to ${doctorName}…`}
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
          style={[styles.sendBtn, { backgroundColor: input.trim() ? (isDoctor ? "#6366F1" : COLORS.primary) : colors.backgroundTertiary }]}
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
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  listContent: { paddingTop: 16, paddingHorizontal: 16, gap: 4 },

  emptyWrap: { flex: 1, alignItems: "center", paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  dateSep: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 16 },
  dateLine: { flex: 1, height: 1 },
  dateLabel: { fontSize: 11, fontFamily: "Inter_500Medium", paddingHorizontal: 4 },

  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  senderLabel: { fontSize: 10, fontFamily: "Inter_500Medium", marginBottom: 2, marginLeft: 2 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  timeLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 3, marginHorizontal: 4 },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
