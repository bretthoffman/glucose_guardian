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
  // Licensed royalty-free alert library (see assets/sounds/SOURCES.md).
  "emergency.wav": require("../assets/sounds/emergency.wav"),
  "critical.wav": require("../assets/sounds/critical.wav"),
  "classicalarm.wav": require("../assets/sounds/classicalarm.wav"),
  "warningbuzzer.wav": require("../assets/sounds/warningbuzzer.wav"),
  "redalert.wav": require("../assets/sounds/redalert.wav"),
  "siren.wav": require("../assets/sounds/siren.wav"),
  "security.wav": require("../assets/sounds/security.wav"),
  "alertalarm.wav": require("../assets/sounds/alertalarm.wav"),
  "alarmtone.wav": require("../assets/sounds/alarmtone.wav"),
  "shortalarm.wav": require("../assets/sounds/shortalarm.wav"),
  "alarmclock.wav": require("../assets/sounds/alarmclock.wav"),
  "urgentloop.wav": require("../assets/sounds/urgentloop.wav"),
  "battleship.wav": require("../assets/sounds/battleship.wav"),
  "retroalarm.wav": require("../assets/sounds/retroalarm.wav"),
  "ding.wav": require("../assets/sounds/ding.wav"),
  "happybells.wav": require("../assets/sounds/happybells.wav"),
  "positive.wav": require("../assets/sounds/positive.wav"),
  "bright.wav": require("../assets/sounds/bright.wav"),
  "pop.wav": require("../assets/sounds/pop.wav"),
  "announce.wav": require("../assets/sounds/announce.wav"),
  "marimba.wav": require("../assets/sounds/marimba.wav"),
  "guitar.wav": require("../assets/sounds/guitar.wav"),
  "flute.wav": require("../assets/sounds/flute.wav"),
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
