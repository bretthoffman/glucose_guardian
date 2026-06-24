import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { T } from "@/constants/theme";
import GlucoseStatusPill from "@/components/GlucoseStatusPill";

const H = T.tabGlucoseHeader;

/** Safe-area-aware top padding for tab headers with GlucoseStatusPill (reference: Chat). */
export function tabGlucoseHeaderPaddingTop(insetsTop: number): number {
  const safeTop = Platform.OS === "web" ? 67 : insetsTop;
  return safeTop + H.paddingTopInset;
}

interface RowProps {
  left: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Shared left/right header row — right slot anchors GlucoseStatusPill at a fixed coordinate. */
export default function TabGlucoseHeaderRow({ left, style }: RowProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.left}>{left}</View>
      <View style={styles.glucoseSlot}>
        <GlucoseStatusPill />
      </View>
    </View>
  );
}

interface ShellProps {
  children: React.ReactNode;
  borderBottomColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Outer tab header shell — common horizontal inset and top safe-area offset. */
export function TabGlucoseHeaderShell({ children, borderBottomColor, style }: ShellProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.shell,
        { paddingTop: tabGlucoseHeaderPaddingTop(insets.top), borderBottomColor },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    paddingHorizontal: H.paddingHorizontal,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: H.rowGap,
    minHeight: H.rowMinHeight,
  },
  left: {
    flex: 1,
    minWidth: 0,
  },
  glucoseSlot: {
    flexShrink: 0,
    alignSelf: "flex-start",
  },
});
