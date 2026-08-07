import { describe, expect, it } from "vitest";
import appJson from "../app.json";
import previewSource from "./alertSoundPreview.ts?raw";
// Read as SOURCE, not imported: PushContext pulls in react-native, which can't load in this
// environment. Parsing the literal list keeps the guard dependency-free.
import pushContextSource from "../context/PushContext.tsx?raw";

/**
 * A bundled alert sound has to be registered in THREE places, and missing any one of them fails
 * silently — which is exactly what happened: 22 sounds were added to the picker and to app.json but
 * not to the preview's require map, so every one of them appeared in the list and played nothing.
 *
 *   1. ALERT_SOUND_OPTIONS      — offers it in the picker
 *   2. app.json expo-notifications.sounds — compiles it into the binary for real pushes
 *   3. alertSoundPreview SOUND_ASSETS     — lets the tap-to-hear preview load it
 */
const registeredNatively: string[] = (appJson.expo.plugins as unknown[])
  .filter((p): p is [string, { sounds: string[] }] => Array.isArray(p) && p[0] === "expo-notifications")
  .flatMap((p) => p[1].sounds)
  .map((path) => path.split("/").pop() as string);

const inPreviewMap = new Set(
  [...previewSource.matchAll(/"([\w.-]+\.wav)":\s*require\(/g)].map((m) => m[1]),
);

const offeredFiles = [
  ...pushContextSource.matchAll(/\{\s*file:\s*"([\w.-]+\.wav)",\s*label:/g),
].map((m) => m[1]);

describe("every alert sound is registered everywhere it needs to be", () => {
  it("found all three registries (guards the parsing itself)", () => {
    expect(offeredFiles.length).toBeGreaterThan(20);
    expect(registeredNatively.length).toBeGreaterThan(20);
    expect(inPreviewMap.size).toBeGreaterThan(20);
  });

  it("every picker option is compiled into the app for real notifications", () => {
    const missing = offeredFiles.filter((f) => !registeredNatively.includes(f));
    expect(
      missing,
      `Add these to app.json expo-notifications.sounds or a real push plays nothing:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every picker option can be previewed in-app", () => {
    const missing = offeredFiles.filter((f) => !inPreviewMap.has(f));
    expect(
      missing,
      `Add these to SOUND_ASSETS in utils/alertSoundPreview.ts or they preview SILENT:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the Silent option is declared with no file, so it can never be looked up", () => {
    expect(pushContextSource).toContain('{ file: undefined, label: "Silent"');
  });
});
