import { useEffect, useState } from "react";
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from "react-native";

/**
 * Whether the soft keyboard is up. Used to swap an input bar's resting bottom clearance (tab-bar /
 * safe-area padding) for a snug gap while typing — otherwise the KeyboardAvoidingView lift ADDS to
 * that clearance and the bar floats high above the keyboard.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // "Will" events on iOS so the padding swap animates together with the keyboard.
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * How many points of the app window the keyboard currently covers (0 when closed).
 *
 * Pad a bottom-flush container by exactly this and its content always sits directly above the
 * keyboard — no library view-measurement involved, which is what broke on iPad: the
 * keyboard-controller KeyboardAvoidingView mis-computes its overlap inside iPad pageSheet
 * modals (and drifted on the iPad AI chat), leaving inputs under the keyboard or floating high.
 * `keyboardWillChangeFrame` covers show, hide, rotation, and iPad dock/undock/QuickType-bar
 * changes; `endCoordinates.screenY` is the keyboard's top edge, so overlap = window bottom − it.
 * A floating/split iPad keyboard or a hardware-keyboard mini-bar yields a small or zero inset,
 * which degrades gracefully. The measured pieces both live in window coordinates, and both
 * surfaces that use this (full screens + pageSheet modals) are bottom-flush with the window on
 * iPhone AND iPad — the invariant that makes this exact.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const apply = (e: KeyboardEvent) => {
      const windowH = Dimensions.get("window").height;
      const next = Math.max(0, Math.round(windowH - (e.endCoordinates?.screenY ?? windowH)));
      // Animate the padding change in step with the keyboard's own animation.
      if (Platform.OS === "ios") {
        LayoutAnimation.configureNext({
          duration: e.duration && e.duration > 0 ? e.duration : 250,
          update: { type: "keyboard" },
        });
      }
      setInset(next);
    };
    if (Platform.OS === "ios") {
      const change = Keyboard.addListener("keyboardWillChangeFrame", apply);
      const hide = Keyboard.addListener("keyboardWillHide", () => setInset(0));
      return () => {
        change.remove();
        hide.remove();
      };
    }
    const show = Keyboard.addListener("keyboardDidShow", apply);
    const hide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}
