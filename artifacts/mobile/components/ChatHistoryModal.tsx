/**
 * Chat History: every day the person talked with the assistant, newest first, plus a calendar to
 * jump to any date. Tapping a day shows that conversation exactly as it happened (read-only).
 * Private to the person (see hooks/useChatHistory).
 */
import React, { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { ControlShade, ScreenShade } from "@/components/Shade";
import { CloseButton } from "@/components/CloseButton";
import CalendarPicker from "@/components/CalendarPicker";
import { useChatDay, useChatDays, type ChatOwnerArgs } from "@/hooks/useChatHistory";
import { chatDayKey, chatDayLabel, dateFromDayKey } from "@/utils/chatHistory";

type Palette = (typeof Colors)["light"];
export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

export default function ChatHistoryModal({
  visible,
  onClose,
  owner,
  colors,
  renderMessage,
}: {
  visible: boolean;
  onClose: () => void;
  owner: ChatOwnerArgs | null;
  colors: Palette;
  renderMessage: (m: HistoryMessage) => React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const days = useChatDays(visible ? owner : null);
  const dayMessages = useChatDay(visible ? owner : null, openDay);

  const close = () => {
    setOpenDay(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="overFullScreen" onRequestClose={close}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <ScreenShade />
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
          {openDay ? (
            <Pressable
              onPress={() => setOpenDay(null)}
              accessibilityRole="button"
              accessibilityLabel="Back to chat history"
              hitSlop={10}
              style={styles.back}
            >
              <Feather name="chevron-left" size={22} color={COLORS.primary} />
              <Text style={[styles.backText, { color: COLORS.primary }]}>History</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setCalendarOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Pick a date"
              hitSlop={8}
              style={[styles.calBtn, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
            >
              <ControlShade radius={18} />
              <Feather name="calendar" size={16} color={COLORS.primary} />
            </Pressable>
          )}
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {openDay ? chatDayLabel(openDay) : "Chat history"}
          </Text>
          <CloseButton onPress={close} accessibilityLabel="Close chat history" />
        </View>

        {openDay ? (
          <FlatList
            data={(dayMessages ?? []).map((m) => ({ id: m.id, role: m.role, text: m.text, timestamp: new Date(m.at) }))}
            keyExtractor={(m) => m.id}
            contentContainerStyle={[styles.thread, { paddingBottom: insets.bottom + 24 }]}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textMuted }]}>
                {dayMessages === undefined ? "Loading..." : "No chats on this day."}
              </Text>
            }
            renderItem={({ item }) => <>{renderMessage(item)}</>}
          />
        ) : (
          <FlatList
            data={days ?? []}
            keyExtractor={(d) => d.day}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
            ListHeaderComponent={
              <Text style={[styles.privacy, { color: colors.textMuted }]}>
                Only you can see your chats with Glucose Guardian.
              </Text>
            }
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textMuted }]}>
                {days === undefined ? "Loading..." : "No saved chats yet. From now on, each day's conversation is saved here."}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  setOpenDay(item.day);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${chatDayLabel(item.day)}: ${item.preview}`}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.rowDay, { color: colors.text }]} numberOfLines={1}>
                    {chatDayLabel(item.day)}
                  </Text>
                  <Text style={[styles.rowPreview, { color: colors.textSecondary }]} numberOfLines={2}>
                    {item.preview || "Conversation"}
                  </Text>
                </View>
                <Text style={[styles.rowCount, { color: colors.textMuted }]}>{item.count}</Text>
                <Feather name="chevron-right" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          />
        )}

        <CalendarPicker
          visible={calendarOpen}
          selected={openDay ? dateFromDayKey(openDay) : new Date()}
          onSelect={(d) => {
            setCalendarOpen(false);
            setOpenDay(chatDayKey(d));
          }}
          onClose={() => setCalendarOpen(false)}
          colors={colors}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 18, fontWeight: "800", textAlign: "center" },
  back: { flexDirection: "row", alignItems: "center", minWidth: 36 },
  backText: { fontSize: 15, fontWeight: "600" },
  calBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  list: { padding: 16, gap: 10 },
  privacy: { fontSize: 12.5, marginBottom: 4, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1 },
  rowDay: { fontSize: 15.5, fontWeight: "700" },
  rowPreview: { fontSize: 13.5, marginTop: 2, lineHeight: 18 },
  rowCount: { fontSize: 12.5, fontWeight: "600" },
  thread: { padding: 16, gap: 4 },
  empty: { textAlign: "center", marginTop: 40, fontSize: 14.5, lineHeight: 20, paddingHorizontal: 24 },
});
