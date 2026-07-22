import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { T, withAlpha, type ThemeColors } from "@/constants/theme";
import AccessLockScreen from "@/components/AccessLockScreen";
import NurseMenu from "@/components/NurseMenu";

// Derive the tab-bar props type from expo-router's Tabs so we don't import @react-navigation directly
// (it isn't hoisted in this workspace). VISUAL ONLY — navigation behavior uses the standard pattern.
type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const TAB_META: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Glucose", icon: "water" },
  insulin: { label: "Insulin", icon: "needle" },
  food: { label: "Food", icon: "silverware-fork-knife" },
  chat: { label: "Chat", icon: "message-text-outline" },
  dashboard: { label: "Dashboard", icon: "chart-bar" },
};

/**
 * Dark-clinical floating tab bar matching the redesign reference. VISUAL ONLY: route set, order, the
 * caregiver/doctor hide rules, and navigation all use the standard React Navigation custom-tabBar
 * pattern (emit `tabPress`, then `navigate` if not focused / not prevented).
 */
function FloatingTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { scheme, colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c, scheme === "dark"), [c, scheme]);
  const { isChildMode, caregiverSession, doctorSession, accessCodeRole, accessCodePermissions, isCaregiverAccount, isViewingLinkedPatient } = useAuth();
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
              <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                <MaterialCommunityIcons name={meta.icon} size={22} color={color} />
              </View>
              <Text style={[styles.label, { color }]} numberOfLines={1}>
                {meta.label}
              </Text>
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
    backgroundColor: withAlpha(c.card, 0.96),
    borderRadius: T.radius.nav,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOpacity: isDark ? 0.4 : 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  item: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 2 },
  iconWrap: {
    width: 44,
    height: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: withAlpha(T.color.violet, 0.16),
  },
  label: { fontSize: 10.5, fontWeight: T.font.medium, letterSpacing: 0.1 },
});
