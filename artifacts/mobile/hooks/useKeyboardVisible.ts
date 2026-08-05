import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, LayoutAnimation, Platform, View, type KeyboardEvent } from "react-native";

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
    if (Platform.OS !== "ios") {
      return () => {
        show.remove();
        hide.remove();
      };
    }
    // Same fallback as useKeyboardInset: if the iOS "will" events don't fire, the "did" events still
    // flip this, so the input bar can't be left with its full resting clearance while typing.
    const didShow = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
    const didHide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
      didShow.remove();
      didHide.remove();
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
/**
 * `useKeyboardInset`, corrected for containers that are NOT bottom-flush with the window — iPad
 * pageSheet modals float with a gap beneath them, so padding by the raw window overlap over-lifts
 * the input by exactly that gap (the "empty space above the keyboard" bug). Attach `ref` +
 * `onLayout` to the padded container; it measures its true bottom edge in window coordinates and
 * subtracts the gap. Bottom-flush containers measure gap 0 and behave identically to the raw hook.
 */
export function useContainerKeyboardInset(): {
  inset: number;
  ref: React.RefObject<View | null>;
  onLayout: () => void;
} {
  const raw = useKeyboardInset();
  const ref = useRef<View | null>(null);
  const [bottomGap, setBottomGap] = useState(0);

  const onLayout = useCallback(() => {
    // measureInWindow next frame so the layout pass (and sheet presentation) has settled.
    requestAnimationFrame(() => {
      ref.current?.measureInWindow((_x, y, _w, h) => {
        const windowH = Dimensions.get("window").height;
        if (!Number.isFinite(y) || !Number.isFinite(h) || h <= 0) return;
        setBottomGap(Math.max(0, Math.round(windowH - (y + h))));
      });
    });
  }, []);

  /**
   * FAIL TOWARD VISIBLE. The gap correction can only ever SUBTRACT, so a bad measurement shows up as
   * an input bar that is partly or entirely underneath the keyboard — the exact failure reported for
   * the Messages thread, where the bar vanished completely. A too-small lift is a cosmetic annoyance;
   * a swallowed lift makes the field unusable, so when the correction eats the whole overlap we
   * distrust the measurement and use the raw window overlap instead.
   *
   * `measureInWindow` inside a pageSheet Modal is the fragile part: it can resolve against the
   * modal's own coordinate space (or mid-presentation, while the sheet is still animating up), so the
   * gap it reports isn't always comparable to `Dimensions.get("window").height`.
   */
  const corrected = Math.max(0, raw - bottomGap);
  const inset = raw > 0 && corrected <= 0 ? raw : corrected;
  return { inset, ref, onLayout };
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    /**
     * `animate` is set only for the "will" events — the "did" events fire AFTER the keyboard has
     * finished moving, so animating from them would replay a transition the user already saw.
     */
    const apply = (e: KeyboardEvent, animate: boolean) => {
      const windowH = Dimensions.get("window").height;
      const next = Math.max(0, Math.round(windowH - (e.endCoordinates?.screenY ?? windowH)));
      // Animate the padding change in step with the keyboard's own animation. Wrapped because
      // LayoutAnimation is a legacy-renderer API: under the New Architecture it can be a no-op or
      // throw, and a cosmetic animation must never stop the inset itself from being applied.
      if (animate && Platform.OS === "ios") {
        try {
          LayoutAnimation.configureNext({
            duration: e.duration && e.duration > 0 ? e.duration : 250,
            update: { type: "keyboard" },
          });
        } catch {
          /* no animation — the padding still applies, which is what actually matters */
        }
      }
      setInset(next);
    };
    if (Platform.OS === "ios") {
      const change = Keyboard.addListener("keyboardWillChangeFrame", (e) => apply(e, true));
      const hide = Keyboard.addListener("keyboardWillHide", () => setInset(0));
      // BELT AND BRACES: only the "will" events fire early enough to animate, but they are also the
      // ones that can go missing — which presents as the input sitting UNDER the keyboard again
      // (reported after `newArchEnabled: true` landed in app.json). The "did" variants come from
      // UIKit's own notifications and arrive even when the "will" pass doesn't, so the worst case
      // degrades to an un-animated jump instead of a hidden input. Re-applying the same number is a
      // no-op for React, so the redundancy costs nothing when both fire.
      const didChange = Keyboard.addListener("keyboardDidChangeFrame", (e) => apply(e, false));
      const didShow = Keyboard.addListener("keyboardDidShow", (e) => apply(e, false));
      const didHide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
      return () => {
        change.remove();
        hide.remove();
        didChange.remove();
        didShow.remove();
        didHide.remove();
      };
    }
    const show = Keyboard.addListener("keyboardDidShow", (e) => apply(e, false));
    const hide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}
