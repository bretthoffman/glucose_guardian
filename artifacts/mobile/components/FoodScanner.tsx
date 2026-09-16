/**
 * FoodScanner — the Food page's camera. ONE screen, two ways out:
 *  - a retail barcode in frame fires `onBarcode` on its own (UPC/EAN/Code 128/ITF-14 — never QR);
 *  - the shutter takes a photo and fires `onPhoto`, which goes through the existing AI analysis.
 * The host runs the barcode lookup and tells this screen how it went (`lookup`): "looking" shows a
 * spinner banner and pauses detection; "notFound" says so and re-arms so the user can try again or
 * just snap a photo of the label instead. On a hit the host closes the screen.
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
  const [snapping, setSnapping] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    armedRef.current = true;
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

  const banner =
    lookup === "looking"
      ? `Looking up ${lastCode ?? "barcode"}…`
      : lookup === "notFound"
        ? "Barcode not found — try again, or snap a photo of the label"
        : "Point at a barcode, or take a photo of your food";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...PRODUCT_BARCODES] }}
            onBarcodeScanned={lookup === "looking" ? undefined : handleScan}
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

        <View style={[styles.topBanner, lookup === "notFound" && styles.topBannerWarn]} pointerEvents="none">
          {lookup === "looking" && <ActivityIndicator color="#fff" size="small" />}
          <Text style={styles.topBannerText}>{banner}</Text>
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={[styles.frame, lookup === "looking" && { borderColor: "#fff" }]} />
        </View>

        <View style={styles.bottomBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [styles.sideBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={onClose}
          >
            <Text style={styles.sideText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            disabled={!permission?.granted || snapping || lookup === "looking"}
            style={({ pressed }) => [styles.shutterOuter, { opacity: pressed ? 0.8 : 1 }]}
            onPress={snap}
          >
            <View style={styles.shutterInner}>{snapping ? <ActivityIndicator color={COLORS.primary} /> : <Feather name="camera" size={26} color={COLORS.primary} />}</View>
          </Pressable>
          <View style={styles.sideBtn} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  permissionWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 40 },
  permissionText: { color: "rgba(255,255,255,0.85)", fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  topBanner: {
    position: "absolute", top: 0, left: 0, right: 0, paddingTop: 64, paddingBottom: 14, paddingHorizontal: 24,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "rgba(0,0,0,0.45)",
  },
  topBannerWarn: { backgroundColor: "rgba(255,159,28,0.55)" },
  topBannerText: { color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: { width: 260, height: 190, borderRadius: 22, borderWidth: 3, borderColor: COLORS.primary + "CC" },
  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 40, paddingTop: 16, paddingHorizontal: 24,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(0,0,0,0.45)",
  },
  sideBtn: { width: 84, alignItems: "center", paddingVertical: 12 },
  sideText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  shutterOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
