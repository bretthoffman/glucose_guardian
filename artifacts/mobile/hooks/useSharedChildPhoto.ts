/**
 * The child's photo, the same on every phone in the care circle (convex/profilePhoto.ts).
 *
 * - Family accounts (the owner and co-guardians) read it live from `profilePhoto.mine` and may change it.
 * - Access-code sessions (grandma, the school nurse, Child Mode) and a co-guardian viewing a linked
 *   patient already get it inside their profile (`slimPatientProfile`), so they just show `profile`.
 * - A photo picked on a guardian's phone is shrunk to a small square JPEG and shared. A phone that
 *   only ever had it locally (from before sharing existed) shares it once, if the circle has none yet.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";

const SIDE = 320;
const pendingKey = (uid: string) => `@gg_shared_photo_pending_${uid}`;
const sharedKey = (uid: string) => `@gg_shared_photo_shared_${uid}`;

/** Whether this session is a family account that owns/administers the circle photo. */
export function useCanChangeChildPhoto(): boolean {
  const auth = useAuth();
  return (
    auth.isSignedIn &&
    !!auth.account?.convexUserId &&
    !auth.caregiverSession &&
    !auth.nurseViewCode &&
    !auth.doctorSession &&
    !auth.isCaregiverAccount &&
    !auth.isChildMode
  );
}

/** The photo to show for the child on this phone, or null for the initials. */
export function useChildPhoto(): string | null {
  const auth = useAuth();
  const family = useCanChangeChildPhoto() && !auth.isViewingLinkedPatient;
  const data = useQuery(api.profilePhoto.mine, family ? {} : "skip");
  const local = auth.profile?.profilePhotoUri ?? null;
  if (!family) return local;
  return data?.photo ?? local;
}

/** A small square JPEG data URI of a local image, ready to share. */
export async function makeSharedPhoto(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: SIDE } }], {
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error("no image data");
  return `data:image/jpeg;base64,${out.base64}`;
}

/** Share a just-picked local photo with the circle; on failure it is retried on the next app open. */
export async function shareChildPhoto(userId: string, localUri: string): Promise<boolean> {
  try {
    const photo = await makeSharedPhoto(localUri);
    await createConvexAuthClient().mutation(api.profilePhoto.set, { photo });
    await AsyncStorage.setItem(sharedKey(userId), localUri).catch(() => {});
    await AsyncStorage.removeItem(pendingKey(userId)).catch(() => {});
    return true;
  } catch {
    await AsyncStorage.setItem(pendingKey(userId), localUri).catch(() => {});
    return false;
  }
}

/**
 * Mounted once (tabs layout). Shares a photo that is only on this phone: a pick that failed to
 * upload, or (once) a photo from before sharing existed when the circle has none yet.
 */
export function SharedPhotoSync(): null {
  const auth = useAuth();
  const canChange = useCanChangeChildPhoto() && !auth.isViewingLinkedPatient;
  const data = useQuery(api.profilePhoto.mine, canChange ? {} : "skip");
  const uid = auth.account?.convexUserId ?? null;
  const local = auth.profile?.profilePhotoUri ?? null;
  const running = useRef(false);

  useEffect(() => {
    if (!canChange || !uid || data === undefined || !local || !local.startsWith("file:") || running.current) return;
    running.current = true;
    (async () => {
      const [pending, shared] = await Promise.all([
        AsyncStorage.getItem(pendingKey(uid)).catch(() => null),
        AsyncStorage.getItem(sharedKey(uid)).catch(() => null),
      ]);
      const retryPick = pending === local;
      const firstShare = data?.photo == null && shared !== local;
      if (!retryPick && !firstShare) return;
      const info = await FileSystem.getInfoAsync(local).catch(() => null);
      if (!info?.exists) {
        await AsyncStorage.removeItem(pendingKey(uid)).catch(() => {});
        return;
      }
      await shareChildPhoto(uid, local);
    })()
      .catch(() => {})
      .finally(() => {
        running.current = false;
      });
  }, [canChange, uid, data, local]);

  return null;
}
