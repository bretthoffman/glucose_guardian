import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

interface Props {
  colors: (typeof Colors)["light"];
  canEdit: boolean;
}

function diabetesLabel(type?: string): string {
  if (type === "type1") return "Type 1";
  if (type === "type2") return "Type 2";
  if (type === "other") return "Diabetes";
  return "";
}

function ageLabel(ageYears: number | null): string {
  if (ageYears === null) return "";
  if (ageYears < 1) return "< 1 yr";
  if (ageYears === 1) return "1 yr old";
  return `${ageYears} yrs old`;
}

export default function ProfileChip({ colors, canEdit }: Props) {
  const { profile, ageYears, updateProfile } = useAuth();
  const [uploading, setUploading] = useState(false);

  const name = profile?.childName ?? "";
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const photoUri = profile?.profilePhotoUri ?? null;
  const age = ageLabel(ageYears);
  const type = diabetesLabel(profile?.diabetesType);

  async function pickPhoto() {
    if (!canEdit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to add a profile photo.",
        [{ text: "OK" }]
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.75,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    setUploading(true);
    try {
      const src = result.assets[0].uri;
      const ext = src.split(".").pop() ?? "jpg";
      const dest = ((FileSystem as any).documentDirectory ?? "") + `profile_photo.${ext}`;
      await FileSystem.copyAsync({ from: src, to: dest });
      await updateProfile({ profilePhotoUri: dest });
    } catch {
      Alert.alert("Error", "Could not save the photo. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Pressable
      style={styles.chip}
      onPress={pickPhoto}
      disabled={!canEdit || uploading}
    >
      <View style={styles.photoWrap}>
        {uploading ? (
          <View style={[styles.circle, { backgroundColor: colors.backgroundTertiary }]}>
            <ActivityIndicator size="small" color={COLORS.primary} />
          </View>
        ) : photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.circle} />
        ) : (
          <View style={[styles.circle, { backgroundColor: COLORS.primary + "22" }]}>
            {initials ? (
              <Text style={[styles.initials, { color: COLORS.primary }]}>{initials}</Text>
            ) : (
              <Feather name="user" size={18} color={COLORS.primary} />
            )}
          </View>
        )}
        {canEdit && (
          <View style={[styles.editBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="camera" size={9} color={colors.textSecondary} />
          </View>
        )}
      </View>

      <View style={styles.info}>
        {age ? (
          <Text style={[styles.ageLine, { color: colors.text }]}>{age}</Text>
        ) : null}
        {type ? (
          <Text style={[styles.typeLine, { color: COLORS.accent }]}>{type}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  photoWrap: {
    position: "relative",
  },
  circle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initials: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  editBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    gap: 2,
  },
  ageLine: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  typeLine: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
});
