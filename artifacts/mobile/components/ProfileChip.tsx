import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
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
  /** Whether the profile photo can be edited (drives the camera badge hint). */
  canEdit: boolean;
  /** Tap opens the Settings popup (the profile-image action lives inside it now). */
  onPress: () => void;
  /** Driven by the shared photo-picker hook so the avatar shows the upload spinner. */
  uploading?: boolean;
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

export default function ProfileChip({ colors, canEdit, onPress, uploading = false }: Props) {
  const { profile, ageYears } = useAuth();

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

  return (
    <Pressable
      style={styles.chip}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open settings"
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
    fontWeight: "700",
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
    fontWeight: "700",
  },
  typeLine: {
    fontSize: 11,
    fontWeight: "600",
  },
});
