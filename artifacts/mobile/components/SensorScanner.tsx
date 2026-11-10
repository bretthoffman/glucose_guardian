/**
 * Full-screen camera that reads the square barcode on a sensor applicator or box (GS1 DataMatrix):
 * product, serial number, Dexcom's pairing code and the expiration date (convex/sensorLogic
 * parseSensorLabel). Fires once with what it read; anything that isn't a sensor label is ignored.
 */
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { parseSensorLabel, type SensorLabel } from "../../../convex/sensorLogic";

export default function SensorScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (label: SensorLabel) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    firedRef.current = false;
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible, permission, requestPermission]);

  const handleScan = ({ data }: { data: string }) => {
    if (firedRef.current) return;
    const label = parseSensorLabel(data);
    if (!label) return; // not a sensor label: keep looking
    firedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onScanned(label);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["datamatrix", "qr"] }}
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
                  Camera access is needed to scan the sensor. Turn it on in Settings, Glucose Guardian, Camera.
                </Text>
              </>
            )}
          </View>
        )}
        <View style={styles.topBanner} pointerEvents="none">
          <Text style={styles.topBannerText}>Scan the square code on the sensor</Text>
          <Text style={styles.topBannerSub}>It's on the applicator or the box, next to the pairing code</Text>
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
  topBanner: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 64, paddingBottom: 14, paddingHorizontal: 24, alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.45)" },
  topBannerText: { color: "#fff", fontSize: 15.5, fontWeight: "700", textAlign: "center" },
  topBannerSub: { color: "rgba(255,255,255,0.8)", fontSize: 13, textAlign: "center" },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: { width: 180, height: 180, borderRadius: 18, borderWidth: 3, borderColor: COLORS.primary + "CC" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 44, paddingTop: 14, alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  cancelBtn: { paddingHorizontal: 34, paddingVertical: 12, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  cancelText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
});
