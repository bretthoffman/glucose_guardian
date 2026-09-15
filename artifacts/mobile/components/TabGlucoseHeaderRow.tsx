import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { T } from "@/constants/theme";
import GlucoseStatusPill from "@/components/GlucoseStatusPill";
import { HeaderShade } from "@/components/Shade";

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
  /** Draw the header band (default). Food passes false: no band, no line — just the page. */
  shade?: boolean;
}

/** Outer tab header shell — common horizontal inset and top safe-area offset. */
/**
 * The header strip is its OWN section: a lighter band (cardTop settling to cardElevated) that runs
 * from the very top of the screen down to the strip's bottom edge, where its soft step against the
 * darker page does the separating. That is why there is no divider line any more — `borderBottomColor`
 * is accepted for call-site compatibility and deliberately not drawn, and any bottom border a caller's
 * style carries is zeroed so the band's edge is the only boundary.
 *
 * `shade={false}` (Food) draws no band at all: the strip is simply the top of the page, transparent
 * over the page's own shading, with no line under it either.
 */
export function TabGlucoseHeaderShell({ children, borderBottomColor: _borderBottomColor, style, shade = true }: ShellProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.shell,
        { paddingTop: tabGlucoseHeaderPaddingTop(insets.top) },
        style,
        { borderBottomWidth: 0 },
      ]}
    >
      {shade && <HeaderShade />}
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
