import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useMessages } from "@/context/MessagesContext";
import { useTheme } from "@/context/ThemeContext";
import { T, withAlpha, type ThemeColors } from "@/constants/theme";
import AccessLockScreen from "@/components/AccessLockScreen";
import NurseMenu from "@/components/NurseMenu";
import EmergencyWaitPrompt from "@/components/EmergencyWaitPrompt";

// Derive the tab-bar props type from expo-router's Tabs so we don't import @react-navigation directly
// (it isn't hoisted in this workspace). VISUAL ONLY — navigation behavior uses the standard pattern.
type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/** Glyph size for every tab; the label stays 10.5, so the icon reads slightly larger than it. */
const TAB_ICON_SIZE = 24;

const TAB_META: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Glucose", icon: "water" },
  insulin: { label: "Insulin", icon: "needle" },
  food: { label: "Food", icon: "silverware-fork-knife" },
  chat: { label: "Chat", icon: "message-text-outline" },
  dashboard: { label: "Dashboard", icon: "chart-bar" },
};

/**
 * The selected tab's icon color — a lavender step up from `violetActive`, same hue family. ONE flat
 * color: the two-tone treatment (a deeper second layer on the lower part of the glyph, and before
 * that a third highlight layer) has been removed — neither read well on the small glyphs.
 */
const TAB_ICON_BODY = "#8F9BFF";

/**
 * Dark-clinical floating tab bar matching the redesign reference. VISUAL ONLY: route set, order, the
 * caregiver/doctor hide rules, and navigation all use the standard React Navigation custom-tabBar
 * pattern (emit `tabPress`, then `navigate` if not focused / not prevented).
 */
function FloatingTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { scheme, colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c, scheme === "dark"), [c, scheme]);
  const { isChildMode, caregiverSession, doctorSession, accessCodeRole, accessCodePermissions, isCaregiverAccount, isViewingLinkedPatient, doctorMessages } = useAuth();
  const { unreadCount: careUnread } = useMessages();
  // Red "!" on the Chat tab for any unread message: the guardian's doctor thread (guardian-only) or
  // any cross-account thread (applies to guardians AND access-code / nurse sessions).
  const hasUnreadDoctorChat =
    (!doctorSession && !caregiverSession && doctorMessages.some((m) => m.sender === "doctor" && !m.read)) ||
    careUnread > 0;
  // A Caregiver (nurse) account on its menu (not viewing a child) has no tabs — hide the whole bar.
  if (isCaregiverAccount && !isViewingLinkedPatient) return null;
  // Hide Insulin for a child-view-mode owner account, or for an access-code session (kid / caregiver)
  // whose grants include neither the dose calculator nor logging — nothing to show there.
  const hideInsulinTab =
    (isChildMode && !caregiverSession) ||
    (accessCodeRole != null && !accessCodePermissions?.useCalculator && !accessCodePermissions?.log);
  const hideFoodTab = !!doctorSession;

  const routes = state.routes.filter((r) => {
    if (!TAB_META[r.name]) return false;
    if (r.name === "insulin" && hideInsulinTab) return false;
    if (r.name === "food" && hideFoodTab) return false;
    return true;
  });

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }]} pointerEvents="box-none">
      <View style={styles.bar}>
        {routes.map((route) => {
          const focused = state.routes[state.index]?.key === route.key;
          const meta = TAB_META[route.name]!;
          const color = focused ? T.color.violetActive : c.textMuted;

          const onPress = () => {
            Haptics.selectionAsync();
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.item}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              hitSlop={6}
            >
              {/* The highlight hugs icon + label TOGETHER, so a selected tab reads as one unit. It lives
                  inside the flex:1 Pressable, so every tab keeps an equal full-slot tap target no matter
                  how long its label is. */}
              <View style={[styles.slot, focused && styles.slotActive]}>
                <View style={styles.iconWrap}>
                  <MaterialCommunityIcons name={meta.icon} size={TAB_ICON_SIZE} color={focused ? TAB_ICON_BODY : color} />
                  {route.name === "chat" && hasUnreadDoctorChat && (
                    <View style={styles.chatAlertBadge}>
                      <Text style={styles.chatAlertBadgeText}>!</Text>
                    </View>
                  )}
                </View>
                {/* Never "Gluco…": a truncated tab name is useless. Large accessibility text is capped at
                    1.2× (it stays larger than default, just not slot-breaking), and shrink-to-fit is
                    the backstop on narrow phones — the word gets smaller, it never gets cut off. No
                    lineHeight on this style, so the iOS shrink-past-minimum bug can't trigger. */}
                <Text
                  style={[styles.label, { color }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={1.2}
                >
                  {meta.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  // A single custom dark tab bar so the redesigned navigation renders consistently in Expo Go (the
  // native liquid-glass tab bar can't express this floating-pill treatment). Routes are unchanged.
  return (
    <>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index" options={{ title: "Glucose" }} />
        <Tabs.Screen name="insulin" options={{ title: "Insulin" }} />
        <Tabs.Screen name="food" options={{ title: "Food" }} />
        <Tabs.Screen name="chat" options={{ title: "Chat" }} />
        <Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} />
      </Tabs>
      {/* Nurse (Caregiver account) home — full-screen overlay + hidden tab bar until a child is opened. */}
      <NurseMenu />
      {/* Out-of-schedule / removed-access lock — overlays the tabs for caregiver + viewer sessions. */}
      <AccessLockScreen />
      {/* Adult wait-window "confirm you are okay" prompt — mounted here so it fires on any tab. */}
      <EmergencyWaitPrompt />
    </>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    // On iPad the bar would otherwise stretch the full screen width, leaving 5 tiny icons marooned in
    // a very wide pill. `wrap` already centers, so capping the width is enough. No-op on phones.
    maxWidth: T.layout.contentMaxWidth,
    backgroundColor: withAlpha(c.card, 0.96),
    borderRadius: T.radius.nav,
    borderWidth: 1,
    borderColor: c.border,
    // Tight: the selected slot's own padding provides the breathing room, so the bar adds little.
    paddingVertical: 6,
    paddingHorizontal: 6,
    shadowColor: "#000",
    shadowOpacity: isDark ? 0.4 : 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  // 2px between neighbours so two highlights never touch; the rest of the slot is the label's.
  item: { flex: 1, paddingHorizontal: 2 },
  /** Highlight around icon + label; spans the slot so long labels ("Dashboard") get the full width. */
  slot: { alignSelf: "stretch", alignItems: "center", gap: 3, paddingVertical: 5, paddingHorizontal: 4, borderRadius: 14 },
  slotActive: { backgroundColor: withAlpha(T.color.violet, 0.16) },
  iconWrap: {
    width: 28,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  chatAlertBadge: {
    position: "absolute",
    top: -5,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: c.card,
  },
  chatAlertBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800", lineHeight: 12 },
  label: { fontSize: 10.5, fontWeight: T.font.medium, letterSpacing: 0.1 },
});
