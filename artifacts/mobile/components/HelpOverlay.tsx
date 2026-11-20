/**
 * Help Mode's overlay — the spotlight, the explanation card, the welcome/idle cards, and the exit
 * pill. Mounted ONCE in the tabs layout, above every page and above the floating tab bar.
 *
 * Dimming: four panels box the spotlight hole (the element shows through at full color, plus a
 * rounded outline), and BarSurround dims everything from the tab bar's measured frame down —
 * strips left, right and below the pill, plus an SVG ring that tints the notches between the
 * pill's rounded corners and its bounding box. The pill is the only thing left lit, and the only
 * thing still live: a touch in a corner notch still lands on the bar view's own bounds, so page
 * content below the bar is unreachable. While the bar is hidden (nurse menu), no frame is
 * reported and the dim runs to the bottom of the screen.
 *
 * EVERY dimmed point is a pressable that advances the tour — including a transparent cover over
 * the hole itself, which is what guarantees Help Mode can never reach a real control underneath.
 *
 * The explanation card measures itself and takes the first spot that keeps the spotlight clear:
 * docked above the tab bar, else docked under the exit pill, else the side where the unavoidable
 * overlap is smallest (utils/helpPlacement has the rule and its tests).
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHelp, type SpotlightRect } from "@/context/HelpContext";
import { T } from "@/constants/theme";
import { helpCardAtTop } from "@/utils/helpPlacement";

const DIM = "rgba(3, 9, 24, 0.82)";
const CARD_BG = "#101F3A";
const HOLE_PAD = 6;
const HOLE_RADIUS = 16;
/** Gap kept between the explanation card and the spotlight. */
const CARD_GAP = 12;
/** Card height assumed for the frame before onLayout reports the real one (card is still faded). */
const CARD_EST = 200;

export default function HelpOverlay() {
  const { helpMode, exitHelp, tour, step, stepCount, rect, advance, intro, beginFromIntro, tabBarRect } = useHelp();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const anim = useRef(new Animated.Value(0)).current; // card + spotlight entrance per step
  const holeX = useRef(new Animated.Value(0)).current;
  const holeY = useRef(new Animated.Value(0)).current;
  const holeW = useRef(new Animated.Value(0)).current;
  const holeH = useRef(new Animated.Value(0)).current;
  const hadRect = useRef(false);
  const [cardH, setCardH] = useState(0);

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

  // Everything from the bar's top edge down is BarSurround's job; no reported frame → the plain
  // panels run to the bottom of the screen.
  const barTopY = tabBarRect ? tabBarRect.y : winH;
  const touring = !!tour && !!step;

  // Card placement (see header). Derived from the step's RAW rect — the same numbers the hole
  // springs toward — so the card settles where the spotlight is heading.
  const safeTop = insets.top + 54; // clear of the exit pill
  const holeTop = rect ? Math.max(2, rect.y - HOLE_PAD) : 0;
  const holeBottom = rect ? holeTop + rect.height + HOLE_PAD * 2 : 0;
  const bottomDock = winH - barTopY + 14; // the card's home spot, docked above the bar
  const spaceBelow = barTopY - 14 - CARD_GAP - holeBottom;
  const spaceAbove = holeTop - CARD_GAP - safeTop;
  const cardAtTop = helpCardAtTop(cardH || CARD_EST, spaceAbove, spaceBelow);

  const onCardLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    setCardH((prev) => (prev === next ? prev : next));
  };

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
              height: Animated.subtract(new Animated.Value(barTopY), Animated.add(holeY, holeH)),
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
              borderRadius: HOLE_RADIUS, borderWidth: 2.5, borderColor: "#6CB8FF",
              shadowColor: "#6CB8FF", shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
              opacity: anim,
            }}
          />
          <BarSurround bar={tabBarRect} winH={winH} onPress={advance} />
          {/* The explanation card. */}
          <Animated.View
            pointerEvents="none"
            onLayout={onCardLayout}
            style={[
              styles.card,
              cardAtTop ? { top: safeTop } : { bottom: bottomDock },
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
        <>
          <Pressable style={[styles.fullDim, { height: barTopY }]} onPress={() => {}} />
          <BarSurround bar={tabBarRect} winH={winH} onPress={() => {}} />
        </>
      ) : intro ? (
        // First entry on this device: welcome card. Tapping anywhere (the tab bar included, which
        // starts that page's tour by navigating) begins the walkthrough.
        <>
          <Pressable
            style={[styles.fullDim, { height: barTopY }]}
            onPress={beginFromIntro}
            accessibilityRole="button"
            accessibilityLabel="Start the walkthrough"
          />
          <BarSurround bar={tabBarRect} winH={winH} onPress={beginFromIntro} />
          <View style={[styles.card, styles.idleCard, { top: winH * 0.2 }]} pointerEvents="none">
            <View style={styles.idleIcon}>
              <Feather name="help-circle" size={26} color="#6CB8FF" />
            </View>
            <Text style={[styles.cardTitle, { textAlign: "center" }]} maxFontSizeMultiplier={1.4}>Welcome to Glucose Guardian</Text>
            <Text style={[styles.cardText, { textAlign: "center" }]} maxFontSizeMultiplier={1.4}>
              Since this is your first time in the app on this device, let me show you around. I'll
              walk you through each page, one thing at a time. Nothing you tap during the
              walkthrough changes your real data.
            </Text>
            <Text style={[styles.cardHint, { textAlign: "center", marginTop: 10 }]} maxFontSizeMultiplier={1.4}>
              Tap anywhere to start ›
            </Text>
            <Text style={styles.cardSub} maxFontSizeMultiplier={1.4}>
              Leave any time with the ✕ above. You can always come back from Help on the Dashboard.
            </Text>
          </View>
        </>
      ) : (
        // Idle: help mode is on but no page tour is running (the Dashboard, or a finished tour).
        <>
          <View style={[styles.fullDim, { height: barTopY }]} />
          <BarSurround bar={tabBarRect} winH={winH} onPress={() => {}} />
          <View style={[styles.card, styles.idleCard, { top: winH * 0.24 }]}>
            <View style={styles.idleIcon}>
              <Feather name="help-circle" size={26} color="#6CB8FF" />
            </View>
            <Text style={[styles.cardTitle, { textAlign: "center" }]} maxFontSizeMultiplier={1.4}>Help Mode</Text>
            <Text style={[styles.cardText, { textAlign: "center" }]} maxFontSizeMultiplier={1.4}>
              Open a page below (Glucose, Insulin, Food, Logs, Chat, or Dashboard) and I'll walk you through
              everything on it, one thing at a time. You can switch pages whenever you like; each page
              starts its own tour. Nothing you tap in Help Mode changes your real data.
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

/**
 * Dim from the tab bar's top edge to the bottom of the screen, around the pill: pressable strips
 * left / right / below its frame, plus a non-pressable SVG that tints only the corner notches
 * (bounding box minus rounded rect, filled evenodd). Touches in a notch still hit the bar view's
 * own rectangular bounds, so nothing on the page under the bar is reachable. No reported frame
 * (bar hidden) → nothing to leave lit, and the caller's panels already run to the bottom.
 */
function BarSurround({ bar, winH, onPress }: { bar: SpotlightRect | null; winH: number; onPress: () => void }) {
  if (!bar || bar.y >= winH) return null;
  const barBottom = bar.y + bar.height;
  const r = Math.max(1, Math.min(T.radius.nav, bar.height / 2, bar.width / 2));
  const w = bar.width;
  const h = bar.height;
  const notches =
    `M0 0H${w}V${h}H0Z ` +
    `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
  return (
    <>
      <Pressable style={{ position: "absolute", left: 0, top: bar.y, width: Math.max(0, bar.x), height: winH - bar.y, backgroundColor: DIM }} onPress={onPress} />
      <Pressable style={{ position: "absolute", left: bar.x + bar.width, right: 0, top: bar.y, height: winH - bar.y, backgroundColor: DIM }} onPress={onPress} />
      <Pressable style={{ position: "absolute", left: bar.x, width: bar.width, top: barBottom, height: Math.max(0, winH - barBottom), backgroundColor: DIM }} onPress={onPress} />
      <Svg pointerEvents="none" style={{ position: "absolute", left: bar.x, top: bar.y }} width={w} height={h}>
        <Path d={notches} fill={DIM} fillRule="evenodd" />
      </Svg>
    </>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  fullDim: { position: "absolute", left: 0, right: 0, top: 0, backgroundColor: DIM },
  card: {
    position: "absolute", left: 16, right: 16, backgroundColor: CARD_BG, borderRadius: 18,
    borderWidth: 1, borderColor: "rgba(108, 184, 255, 0.35)", padding: 18, gap: 8,
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  idleCard: { alignItems: "center", gap: 10 },
  idleIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(108, 184, 255, 0.16)",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  cardText: { color: "rgba(255,255,255,0.88)", fontSize: 13.5, fontWeight: "400", lineHeight: 20 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  cardCount: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "600" },
  cardHint: { color: "#6CB8FF", fontSize: 12.5, fontWeight: "700" },
  cardSub: { color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center", marginTop: 2, lineHeight: 17 },
  exitPill: {
    position: "absolute", right: 14, flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 17, backgroundColor: "rgba(16, 31, 58, 0.92)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  exitText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
