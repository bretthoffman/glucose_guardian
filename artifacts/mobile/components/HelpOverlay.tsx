/**
 * Help Mode's overlay — the spotlight, the explanation card, and the exit pill. Mounted ONCE in the
 * tabs layout, above every page but below nothing that matters: its panels deliberately stop above
 * the floating tab bar, so switching pages stays live mid-tour.
 *
 * The spotlight is four dim panels around the target's rect (the element itself shows through at
 * full color) plus a rounded outline. EVERY covered point is a pressable that advances the tour —
 * including a transparent cover over the hole itself, which is what guarantees Help Mode can never
 * reach a real control underneath.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHelp } from "@/context/HelpContext";
import { COLORS } from "@/constants/colors";

const DIM = "rgba(3, 9, 24, 0.82)";
const CARD_BG = "#101F3A";
const HOLE_PAD = 6;
const HOLE_RADIUS = 16;
/**
 * The floating tab bar's footprint (see app/(tabs)/_layout.tsx). The dim panels run to EXACTLY this
 * line: erring a couple of pixels ONTO the bar's top edge is fine (its tap targets are centered),
 * but stopping short would leave an undimmed strip of page where a real touch could sneak through.
 */
function tabClearance(insetBottom: number): number {
  return 64 + Math.max(insetBottom, 12);
}

export default function HelpOverlay() {
  const { helpMode, exitHelp, tour, step, stepCount, rect, advance } = useHelp();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const anim = useRef(new Animated.Value(0)).current; // card + spotlight entrance per step
  const holeX = useRef(new Animated.Value(0)).current;
  const holeY = useRef(new Animated.Value(0)).current;
  const holeW = useRef(new Animated.Value(0)).current;
  const holeH = useRef(new Animated.Value(0)).current;
  const hadRect = useRef(false);

  useEffect(() => {
    if (!rect) {
      hadRect.current = false;
      return;
    }
    const x = Math.max(2, rect.x - HOLE_PAD);
    const y = Math.max(2, rect.y - HOLE_PAD);
    const w = Math.min(winW - 4, rect.width + HOLE_PAD * 2);
    const h = rect.height + HOLE_PAD * 2;
    if (!hadRect.current) {
      // First step after idle: place instantly, fade in.
      holeX.setValue(x); holeY.setValue(y); holeW.setValue(w); holeH.setValue(h);
      hadRect.current = true;
    } else {
      Animated.parallel(
        [Animated.spring(holeX, { toValue: x, useNativeDriver: false, friction: 9, tension: 70 }),
         Animated.spring(holeY, { toValue: y, useNativeDriver: false, friction: 9, tension: 70 }),
         Animated.spring(holeW, { toValue: w, useNativeDriver: false, friction: 9, tension: 70 }),
         Animated.spring(holeH, { toValue: h, useNativeDriver: false, friction: 9, tension: 70 })],
      ).start();
    }
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: false }).start();
  }, [rect, winW, anim, holeX, holeY, holeW, holeH]);

  if (!helpMode) return null;

  const barTop = winH - tabClearance(insets.bottom);
  const touring = !!tour && !!step;
  // The card sits at the bottom unless the spotlight is down there — then it moves to the top.
  const cardAtTop = !!rect && rect.y + rect.height > winH * 0.55;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {touring && rect ? (
        <>
          {/* Four dim panels around the hole; each tap advances. Heights/positions are animated. */}
          <AnimatedPressable style={{ position: "absolute", left: 0, right: 0, top: 0, height: holeY, backgroundColor: DIM }} onPress={advance} />
          <AnimatedPressable
            style={{ position: "absolute", left: 0, top: holeY, width: holeX, height: holeH, backgroundColor: DIM }}
            onPress={advance}
          />
          <AnimatedPressable
            style={{
              position: "absolute", top: holeY, height: holeH, backgroundColor: DIM,
              left: Animated.add(holeX, holeW), right: 0,
            }}
            onPress={advance}
          />
          <AnimatedPressable
            style={{
              position: "absolute", left: 0, right: 0, top: Animated.add(holeY, holeH), backgroundColor: DIM,
              height: Animated.subtract(new Animated.Value(barTop), Animated.add(holeY, holeH)),
            }}
            onPress={advance}
          />
          {/* Transparent cover over the hole: the element shows through but can never be tapped. */}
          <AnimatedPressable
            style={{ position: "absolute", left: holeX, top: holeY, width: holeW, height: holeH }}
            onPress={advance}
            accessibilityLabel="Continue the walkthrough"
          />
          {/* The spotlight outline. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: holeX, top: holeY, width: holeW, height: holeH,
              borderRadius: HOLE_RADIUS, borderWidth: 2.5, borderColor: "#8F9BFF",
              shadowColor: "#8F9BFF", shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
              opacity: anim,
            }}
          />
          {/* The explanation card. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.card,
              cardAtTop ? { top: insets.top + 54 } : { bottom: tabClearance(insets.bottom) + 14 },
              { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [cardAtTop ? -12 : 12, 0] }) }] },
            ]}
          >
            <Text style={styles.cardTitle} maxFontSizeMultiplier={1.4}>{step!.title}</Text>
            <Text style={styles.cardText} maxFontSizeMultiplier={1.4}>{step!.text}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.cardCount} maxFontSizeMultiplier={1.4}>
                {Math.min((tour!.index ?? 0) + 1, stepCount)} of {stepCount}
              </Text>
              <Text style={styles.cardHint} maxFontSizeMultiplier={1.4}>Tap anywhere to continue ›</Text>
            </View>
          </Animated.View>
        </>
      ) : touring ? (
        // Measuring / scrolling to the next element — hold the dim so nothing is tappable meanwhile.
        <Pressable style={[styles.fullDim, { bottom: winH - barTop }]} onPress={() => {}} />
      ) : (
        // Idle: help mode is on but no page tour is running (the Dashboard, or a finished tour).
        <>
          <View style={[styles.fullDim, { bottom: winH - barTop }]} />
          <View style={[styles.card, styles.idleCard, { top: winH * 0.24 }]}>
            <View style={styles.idleIcon}>
              <Feather name="help-circle" size={26} color="#8F9BFF" />
            </View>
            <Text style={[styles.cardTitle, { textAlign: "center" }]} maxFontSizeMultiplier={1.4}>Help Mode</Text>
            <Text style={[styles.cardText, { textAlign: "center" }]} maxFontSizeMultiplier={1.4}>
              Open a page below — Glucose, Insulin, Food, or Chat — and I'll walk you through everything
              on it, one thing at a time. You can switch pages whenever you like; each page starts its
              own tour. Nothing you tap in Help Mode changes your real data.
            </Text>
            <Text style={[styles.cardHint, { textAlign: "center", marginTop: 10 }]} maxFontSizeMultiplier={1.4}>
              Leave any time with the ✕ above
            </Text>
          </View>
        </>
      )}

      {/* Exit pill — always present in help mode, always on top. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Exit help mode"
        onPress={exitHelp}
        style={({ pressed }) => [styles.exitPill, { top: insets.top + 8, opacity: pressed ? 0.8 : 1 }]}
      >
        <Feather name="x" size={15} color="#fff" />
        <Text style={styles.exitText} maxFontSizeMultiplier={1.3}>Exit Help</Text>
      </Pressable>
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  fullDim: { position: "absolute", left: 0, right: 0, top: 0, backgroundColor: DIM },
  card: {
    position: "absolute", left: 16, right: 16, backgroundColor: CARD_BG, borderRadius: 18,
    borderWidth: 1, borderColor: "rgba(143, 155, 255, 0.35)", padding: 18, gap: 8,
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  idleCard: { alignItems: "center", gap: 10 },
  idleIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(143, 155, 255, 0.16)",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  cardText: { color: "rgba(255,255,255,0.88)", fontSize: 13.5, fontWeight: "400", lineHeight: 20 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  cardCount: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "600" },
  cardHint: { color: "#8F9BFF", fontSize: 12.5, fontWeight: "700" },
  exitPill: {
    position: "absolute", right: 14, flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 17, backgroundColor: "rgba(16, 31, 58, 0.92)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  exitText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
