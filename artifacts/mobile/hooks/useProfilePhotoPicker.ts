import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useState } from "react";
import { Alert } from "react-native";
import { useAuth } from "@/context/AuthContext";

/**
 * Profile-photo selection — extracted verbatim from the previous `ProfileChip.pickPhoto` so the exact
 * existing behavior (permissions, photo-library picker, file copy, profile update, loading/error state)
 * can be invoked from the Settings popup's "Update Profile Image" action without duplicating the flow.
 */
export function useProfilePhotoPicker() {
  const { updateProfile, account } = useAuth();
  const [uploading, setUploading] = useState(false);

  async function pickPhoto() {
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
      /**
       * ACCOUNT-SCOPED + UNIQUE filename. This used to be a fixed `profile_photo.<ext>`, which meant
       * two accounts on one phone wrote to the SAME file: whoever picked a photo last overwrote the
       * other's, and because the stored path was byte-identical, the first account then displayed the
       * second account's child. That is a PHI mis-association, not a cosmetic bug.
       *
       * The timestamp also busts the image cache — reusing a path made a newly picked photo appear
       * not to change until the app restarted.
       */
      const scope = account?.convexUserId ?? "local";
      const dest =
        (FileSystem.documentDirectory ?? "") + `profile_photo_${scope}_${Date.now()}.${ext}`;
      await FileSystem.copyAsync({ from: src, to: dest });
      await updateProfile({ profilePhotoUri: dest });
    } catch {
      Alert.alert("Error", "Could not save the photo. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return { pickPhoto, uploading };
}
