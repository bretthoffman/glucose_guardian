/**
 * Full-screen Visit Summary preview, like tapping a PDF in Files: iOS renders the built PDF
 * (scroll the pages, pinch to zoom); Android WebViews can't display PDF files, so Android renders
 * the same report HTML instead, which looks the same. Requires react-native-webview's NATIVE
 * side, which ships with the first native build after 2026-11-17. On binaries older than that,
 * `reportViewerAvailable` is false (the TurboModule probe below) and the Doctor Office panel
 * falls back to the system print preview, so OTA updates carrying this code are safe everywhere.
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TurboModuleRegistry, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";

type Palette = typeof Colors.dark;

// Probe the NATIVE module without importing the package: requiring react-native-webview on a
// binary that doesn't contain it throws (its module calls TurboModuleRegistry.getEnforcing).
let WebView: (typeof import("react-native-webview"))["WebView"] | null = null;
try {
  if (TurboModuleRegistry.get("RNCWebViewModule") != null) {
    WebView = (require("react-native-webview") as typeof import("react-native-webview")).WebView;
  }
} catch {
  WebView = null;
}

/** True once the running binary contains the WebView native module. */
export const reportViewerAvailable = WebView != null;

export function ReportPreviewModal({
  visible,
  title,
  pdfUri,
  html,
  colors,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** iOS: the built PDF file to show. */
  pdfUri?: string;
  /** Android: the report HTML to show instead (WebViews there can't render PDFs). */
  html?: string;
  colors: Palette;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!WebView) return null;
  const Web = WebView;
  const source = pdfUri ? { uri: pdfUri } : { html: html ?? "" };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header, { paddingTop: insets.top + 6, borderBottomColor: colors.border }]}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close preview"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, { backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="x" size={20} color={colors.text} />
          </Pressable>
        </View>
        <Web
          source={source}
          originWhitelist={["*"]}
          allowFileAccess
          allowingReadAccessToURL={pdfUri ? pdfUri.slice(0, pdfUri.lastIndexOf("/") + 1) : undefined}
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.textSecondary} />
            </View>
          )}
          // The document itself is white, like the PDF it becomes.
          style={{ flex: 1, backgroundColor: "#ffffff" }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: "700", flexShrink: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
