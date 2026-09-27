/**
 * FoodScanner — the Food page's camera, with TWO EXPLICIT MODES on a bottom toggle:
 *  - "Food": a plain camera. The shutter takes a photo and fires `onPhoto`, which goes through the
 *    existing AI analysis. Barcode detection is OFF — pointing at a package does nothing here.
 *  - "Barcode": no shutter. The purple framing box shows, detection runs on every frame, and a
 *    retail code held in view fires `onBarcode` on its own (UPC/EAN/Code 128/ITF-14 — never QR).
 * The host runs the barcode lookup and drives `lookup`: "looking" pauses detection and shows a
 * status pill under the frame; "notFound" says so there and re-arms. On a hit the host closes.
 *
 * No instruction banner at the top — the mode toggle says what the camera is doing.
 *
 * Same camera module as the access-code QR scanner (already in the shipped binary). If camera access
 * is denied the host is told, so it can fall back to the system picker.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

export type BarcodeLookupState = "idle" | "looking" | "notFound";

type ScanMode = "photo" | "barcode";

/** Retail product codes only. QR is deliberately excluded — it is the access-code scanner's job. */
const PRODUCT_BARCODES = ["ean13", "ean8", "upc_a", "upc_e", "code128", "itf14"] as const;

export default function FoodScanner({
  visible,
  lookup,
  onClose,
  onBarcode,
  onPhoto,
  onPermissionDenied,
}: {
  visible: boolean;
  lookup: BarcodeLookupState;
  onClose: () => void;
  /** Fired once per detection with the digits; the host looks it up and drives `lookup`. */
  onBarcode: (code: string) => void;
  /** A photo was taken; the host closes this screen and analyzes it. */
  onPhoto: (uri: string) => void;
  /** Camera access refused — the host falls back to the system camera / library. */
  onPermissionDenied: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const armedRef = useRef(true);
  const [mode, setMode] = useState<ScanMode>("photo");
  const [snapping, setSnapping] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  // Fresh session per open: photo mode first (the panel's primary promise), scanner re-armed.
  useEffect(() => {
    if (!visible) return;
    armedRef.current = true;
    setMode("photo");
    setLastCode(null);
    setSnapping(false);
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible, permission, requestPermission]);

  // Denied for good → let the host offer the system picker instead of a dead camera screen.
  useEffect(() => {
    if (visible && permission && !permission.granted && !permission.canAskAgain) onPermissionDenied();
  }, [visible, permission, onPermissionDenied]);

  // Re-arm after a miss so the next code (or the same one, re-framed) fires again.
  useEffect(() => {
    if (lookup !== "looking") armedRef.current = true;
  }, [lookup]);

  const barcodeMode = mode === "barcode";

  const switchMode = (next: ScanMode) => {
    if (next === mode) return;
    Haptics.selectionAsync().catch(() => {});
    armedRef.current = true;
    setMode(next);
  };

  const handleScan = ({ data }: BarcodeScanningResult) => {
    if (!armedRef.current || snapping) return;
    const digits = String(data ?? "").replace(/\D+/g, "");
    if (digits.length < 8) return; // not a product code — keep looking
    armedRef.current = false;
    setLastCode(digits);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onBarcode(digits);
  };

  const snap = async () => {
    if (snapping || !cameraRef.current) return;
    setSnapping(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onPhoto(photo.uri);
      else setSnapping(false);
    } catch {
      setSnapping(false);
    }
  };

  const status =
    lookup === "looking"
      ? `Looking up ${lastCode ?? "barcode"}…`
      : lookup === "notFound"
        ? "Not found — try again, or take a photo of the label"
        : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            // Detection only exists in barcode mode — food mode is a plain camera.
            barcodeScannerSettings={barcodeMode ? { barcodeTypes: [...PRODUCT_BARCODES] } : undefined}
            onBarcodeScanned={barcodeMode && lookup !== "looking" ? handleScan : undefined}
          />
        ) : (
          <View style={styles.permissionWrap}>
            {permission == null ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="camera-off" size={34} color="rgba(255,255,255,0.8)" />
                <Text style={styles.permissionText}>
                  Camera access is needed to scan a barcode or photograph food. Enable it in Settings →
                  Glucose Guardian → Camera.
                </Text>
              </>
            )}
          </View>
        )}

        {/* Barcode mode: the framing box, with the lookup status pill under it. */}
        {barcodeMode && (
          <View style={styles.frameWrap} pointerEvents="none">
            <View style={[styles.frame, lookup === "looking" && { borderColor: "#fff" }]} />
            {status && (
              <View style={[styles.statusPill, lookup === "notFound" && styles.statusPillWarn]}>
                {lookup === "looking" && <ActivityIndicator color="#fff" size="small" />}
                <Text style={styles.statusText}>{status}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.bottomBar}>
          {/* Mode toggle — Food (shutter) | Barcode (auto-scan). */}
          <View style={styles.modeRow}>
            {(
              [
                { key: "photo", label: "Food", icon: "camera" },
                { key: "barcode", label: "Barcode", icon: "maximize" },
              ] as const
            ).map((m) => {
              const active = mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={m.key === "photo" ? "Photo mode — take a picture of your food" : "Barcode mode — scan a package"}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  onPress={() => switchMode(m.key)}
                >
                  <Feather name={m.icon} size={14} color={active ? "#fff" : "rgba(255,255,255,0.75)"} />
                  <Text style={[styles.modeText, active && styles.modeTextActive]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.sideBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={onClose}
            >
              <Text style={styles.sideText}>Cancel</Text>
            </Pressable>
            {barcodeMode ? (
              // No shutter in barcode mode — the camera fires on its own; keep the bar's height stable.
              <View style={styles.shutterOuter} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take a photo"
                disabled={!permission?.granted || snapping}
                style={({ pressed }) => [styles.shutterOuter, styles.shutterVisible, { opacity: pressed ? 0.8 : 1 }]}
                onPress={snap}
              >
                <View style={styles.shutterInner}>
                  {snapping ? <ActivityIndicator color={COLORS.primary} /> : <Feather name="camera" size={26} color={COLORS.primary} />}
                </View>
              </Pressable>
            )}
            <View style={styles.sideBtn} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  permissionWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 40 },
  permissionText: { color: "rgba(255,255,255,0.85)", fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 18 },
  frame: { width: 260, height: 190, borderRadius: 22, borderWidth: 3, borderColor: COLORS.primary + "CC" },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 320,
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.6)",
  },
  statusPillWarn: { backgroundColor: "rgba(255,159,28,0.75)" },
  statusText: { color: "#fff", fontSize: 13.5, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 40, paddingTop: 14,
    paddingHorizontal: 24, gap: 14, backgroundColor: "rgba(0,0,0,0.45)",
  },
  modeRow: {
    flexDirection: "row", alignSelf: "center", backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 20, padding: 3, gap: 3,
  },
  modeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 17 },
  modeBtnActive: { backgroundColor: COLORS.primary },
  modeText: { color: "rgba(255,255,255,0.75)", fontSize: 13.5, fontWeight: "700" },
  modeTextActive: { color: "#fff" },
  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sideBtn: { width: 84, alignItems: "center", paddingVertical: 12 },
  sideText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  shutterOuter: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  shutterVisible: { borderWidth: 4, borderColor: "#fff" },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
