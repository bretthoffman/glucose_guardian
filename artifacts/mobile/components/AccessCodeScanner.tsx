/**
 * Full-screen QR scanner for access codes — shared by the auth screen's "sign in with an access
 * code" popup and the nurse menu's "Add caregiver code" popup. Reads the RAW code our QR tiles
 * encode (no URL, so the system camera would just web-search it — this scanner is the intended
 * path). The moment a QR resolves to a plausible code, `onScanned` fires ONCE with the cleaned
 * code and the host closes the camera + auto-submits. Cancel always available; identical behavior
 * on iPhone and iPad.
 */
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

/** Strip a scanned payload down to a plausible access code (6–8 alphanumerics), else null. */
export function extractAccessCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return cleaned.length >= 6 ? cleaned : null;
}

export default function AccessCodeScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fired once per open with the cleaned code — the host fills the field and auto-submits. */
  onScanned: (code: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const firedRef = useRef(false);

  // Fresh scan session per open; ask for camera access the first time (iOS shows the system prompt).
  useEffect(() => {
    if (!visible) return;
    firedRef.current = false;
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const handleScan = ({ data }: { data: string }) => {
    if (firedRef.current) return;
    const code = extractAccessCode(data);
    if (!code) return; // not one of ours — keep scanning
    firedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onScanned(code);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleScan}
          />
        ) : (
          <View style={styles.permissionWrap}>
            {permission == null ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="camera-off" size={34} color="rgba(255,255,255,0.8)" />
                <Text style={styles.permissionText}>
                  Camera access is needed to scan the QR code. Enable it in Settings → Glucose
                  Guardian → Camera.
                </Text>
              </>
            )}
          </View>
        )}

        {/* Instruction banner + framing guide + Cancel — overlaid on the live camera. */}
        <View style={styles.topBanner} pointerEvents="none">
          <Text style={styles.topBannerText}>Scan the QR code on the other device</Text>
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
        </View>
        <View style={styles.bottomBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel scanning"
            style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={onClose}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  permissionWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 40 },
  permissionText: { color: "rgba(255,255,255,0.85)", fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  topBanner: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 64, paddingBottom: 14, alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  topBannerText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: { width: 230, height: 230, borderRadius: 22, borderWidth: 3, borderColor: COLORS.primary + "CC" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 44, paddingTop: 14, alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  cancelBtn: { paddingHorizontal: 34, paddingVertical: 12, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  cancelText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
});
