/**
 * Tap-to-hear previews for the bundled alert sounds (the same files iOS plays on real pushes —
 * they ship in the app bundle via the expo-notifications `sounds` config). Previews play through
 * expo-audio and are forced audible over the silent switch, since alert sounds themselves are.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

const SOUND_ASSETS: Record<string, number> = {
  "chime.wav": require("../assets/sounds/chime.wav"),
  "bell.wav": require("../assets/sounds/bell.wav"),
  "pulse.wav": require("../assets/sounds/pulse.wav"),
  "soft.wav": require("../assets/sounds/soft.wav"),
  "urgent.wav": require("../assets/sounds/urgent.wav"),
};

let audioModeReady = false;
let current: AudioPlayer | null = null;

/** Play one bundled sound (no-op for "Default" — the system sound can't be played by apps). */
export function playAlertSoundPreview(file: string | undefined): void {
  if (!file || !(file in SOUND_ASSETS)) return;
  try {
    if (!audioModeReady) {
      audioModeReady = true;
      void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    }
    current?.remove();
    const player = createAudioPlayer(SOUND_ASSETS[file]);
    current = player;
    player.play();
  } catch {
    // Preview is best-effort — selection still works without audio.
  }
}

/** Stop any in-flight preview (call when the picker closes). */
export function stopAlertSoundPreview(): void {
  try {
    current?.remove();
  } catch {
    /* already released */
  }
  current = null;
}
