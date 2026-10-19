/**
 * "What's new" — tells people what changed after an update.
 *
 *  - <WhatsNewPrompt />: mounted once in the tabs layout. At launch, if this bundle carries a newer
 *    release note than this device has shown, a bottom sheet lists it once (see utils/whatsNew for
 *    the rules — brand-new installs are skipped). The note is marked seen as soon as it shows, so it
 *    never nags.
 *  - <WhatsNewHistoryModal />: every update, newest first — opened from Dashboard → What's new.
 *
 * Notes are bundled (constants/releaseNotes.ts), so each over-the-air update brings its own.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { RELEASE_NOTES, type ReleaseNote } from "@/constants/releaseNotes";
import { WHATS_NEW_SEEN_STORAGE_KEY } from "@/constants/storage-keys";
import { AccentShade, CardShade } from "@/components/Shade";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNoteDate, whatsNewAction } from "@/utils/whatsNew";

type Palette = (typeof Colors)["light"];

/** Let launch settle (other prompts, first render) before the sheet slides up. */
const SHOW_DELAY_MS = 1500;

export function WhatsNewPrompt() {
  const { isLoading, insulinLog, foodLog, fingerStickLog } = useAuth();
  const [note, setNote] = useState<ReleaseNote | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const hasExistingData = insulinLog.length > 0 || foodLog.length > 0 || fingerStickLog.length > 0;

  useEffect(() => {
    if (isLoading || checked) return;
    setChecked(true);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      let lastSeen: string | null = null;
      try {
        lastSeen = await AsyncStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY);
      } catch {
        return; // storage unavailable — skip quietly rather than risk showing it every launch
      }
      const latest = RELEASE_NOTES[0];
      const action = whatsNewAction(RELEASE_NOTES, lastSeen, hasExistingData);
      if (action === "none" || !latest) return;
      AsyncStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, latest.id).catch(() => {});
      if (action === "show") {
        timer = setTimeout(() => {
          if (!cancelled) setNote(latest);
        }, SHOW_DELAY_MS);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isLoading, checked, hasExistingData]);

  return (
    <>
      <WhatsNewSheet
        note={note}
        onClose={() => setNote(null)}
        onSeeAll={() => {
          setNote(null);
          // iOS can't present a second modal while the first is still sliding away.
          setTimeout(() => setHistoryOpen(true), 400);
        }}
      />
      <WhatsNewHistoryModal visible={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function usePalette(): { colors: Palette; isDark: boolean } {
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  return { colors: isDark ? Colors.dark : Colors.light, isDark };
}

function WhatsNewSheet({ note, onClose, onSeeAll }: { note: ReleaseNote | null; onClose: () => void; onSeeAll: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = usePalette();
  if (!note) return null;
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetHost}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(15,25,45,0.38)" }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close What's new"
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 20 },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.kicker, { color: COLORS.primaryLight }]}>UPDATED · {formatNoteDate(note.date).toUpperCase()}</Text>
          <Text style={[styles.sheetTitle, { color: colors.text }]} accessibilityRole="header">
            What's new
          </Text>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 18, paddingVertical: 4 }}>
            {note.items.map((item) => (
              <View key={item.title} style={styles.item}>
                <View style={[styles.itemIcon, { backgroundColor: COLORS.primary + "2E" }]}>
                  <Feather name={item.icon} size={20} color={COLORS.primaryLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
                  <Text style={[styles.itemBody, { color: colors.textSecondary }]}>{item.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <AccentShade radius={14} />
            <Text style={styles.primaryBtnText}>Got it</Text>
          </Pressable>
          <Pressable onPress={onSeeAll} accessibilityRole="button" style={styles.linkBtn}>
            <Text style={[styles.linkText, { color: COLORS.primaryLight }]}>See all updates</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function WhatsNewHistoryModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = usePalette();
  const installedId = RELEASE_NOTES[0]?.id;
  return (
    <DashboardSectionModal visible={visible} onClose={onClose} accessibilityLabel="What's new">
      <View style={[styles.historyWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={{ gap: 4, marginBottom: 14 }}>
        <Text style={[styles.historyTitle, { color: colors.text }]}>What's new</Text>
        <Text style={[styles.historySub, { color: colors.textSecondary }]}>Every update, newest first.</Text>
      </View>
      <View style={{ gap: 12 }}>
        {RELEASE_NOTES.map((note) => {
          const installed = note.id === installedId;
          return (
            <View
              key={note.id}
              style={[
                styles.historyCard,
                { backgroundColor: colors.backgroundTertiary, borderColor: installed ? COLORS.primary + "80" : colors.border },
              ]}
            >
              <View style={styles.historyHead}>
                <Text style={[styles.historyDate, { color: installed ? COLORS.primaryLight : colors.textMuted }]}>
                  {formatNoteDate(note.date).toUpperCase()}
                </Text>
                {installed && (
                  <View style={styles.installedTag}>
                    <Text style={styles.installedText}>INSTALLED</Text>
                  </View>
                )}
              </View>
              {note.items.map((item) => (
                <View key={item.title} style={styles.historyItem}>
                  <View style={[styles.bullet, { backgroundColor: COLORS.primaryLight }]} />
                  <Text style={[styles.historyItemText, { color: colors.textSecondary }]}>
                    <Text style={{ color: colors.text, fontWeight: "700" }}>{item.title}. </Text>
                    {item.body}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  sheetHost: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0,
    paddingHorizontal: 24, paddingTop: 10, gap: 14, maxHeight: "85%",
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginBottom: 6 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.9 },
  sheetTitle: { fontSize: 28, fontWeight: "800", letterSpacing: -0.4, marginTop: -8, marginBottom: 4 },
  item: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  itemIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 16, fontWeight: "700" },
  itemBody: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  primaryBtn: {
    marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15,
    alignItems: "center", overflow: "hidden",
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  linkBtn: { alignItems: "center", paddingVertical: 6 },
  linkText: { fontSize: 15, fontWeight: "600" },
  historyWrap: { borderRadius: 16, borderWidth: 1, padding: 16 },
  historyTitle: { fontSize: 22, fontWeight: "700" },
  historySub: { fontSize: 13.5 },
  historyCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 9 },
  historyHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  historyDate: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  installedTag: { backgroundColor: COLORS.primary, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  installedText: { color: "#fff", fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },
  historyItem: { flexDirection: "row", gap: 9, alignItems: "flex-start" },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  historyItemText: { flex: 1, fontSize: 14, lineHeight: 20 },
});
