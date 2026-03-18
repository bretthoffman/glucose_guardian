import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

function computeTrend(history: { glucose: number; timestamp: string }[]): {
  arrow: string;
  label: string;
} {
  if (history.length < 2) return { arrow: "→", label: "steady" };
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const last = sorted[sorted.length - 1].glucose;
  const prev = sorted[Math.max(0, sorted.length - 4)].glucose;
  const delta = last - prev;
  if (delta > 40) return { arrow: "↑↑", label: "rising fast" };
  if (delta > 15) return { arrow: "↑", label: "rising" };
  if (delta > 5) return { arrow: "↗", label: "trending up" };
  if (delta < -40) return { arrow: "↓↓", label: "dropping fast" };
  if (delta < -15) return { arrow: "↓", label: "dropping" };
  if (delta < -5) return { arrow: "↘", label: "trending down" };
  return { arrow: "→", label: "steady" };
}

function glucoseColor(g: number): string {
  if (g < 70 || g > 250) return COLORS.danger;
  if (g < 80 || g > 180) return COLORS.warning;
  return COLORS.success;
}

function glucoseLabel(g: number): string {
  if (g < 55) return "Critically Low";
  if (g < 70) return "Low";
  if (g < 80) return "Below Range";
  if (g <= 180) return "In Range";
  if (g <= 250) return "High";
  return "Very High";
}

function buildSuggestions(
  glucose: number | null,
  name: string
): string[] {
  if (glucose === null) {
    return [
      "How do I log a meal?",
      "What's a good blood sugar?",
      "Can I exercise with diabetes?",
      "I'm not feeling great",
    ];
  }
  if (glucose < 70) {
    return [
      "My sugar feels low right now",
      "What should I eat quickly?",
      "When will I feel better?",
      "Should I tell someone?",
    ];
  }
  if (glucose > 250) {
    return [
      "My sugar is really high",
      "What should I drink?",
      "When will it come down?",
      "Do I need a correction?",
    ];
  }
  if (glucose > 180) {
    return [
      "Why is my sugar high?",
      "What can I do to bring it down?",
      "Can I still exercise?",
      "Will this affect how I feel?",
    ];
  }
  return [
    `My sugar feels low`,
    "What should I snack on?",
    "Can I exercise now?",
    "How am I trending today?",
  ];
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { history, latestReading, carbRatio, targetGlucose, correctionFactor } = useGlucose();
  const { profile, ageYears } = useAuth();
  const { prompt } = useLocalSearchParams<{ prompt?: string }>();
  const promptSentRef = useRef(false);

  const name = profile?.childName ?? "there";
  const trend = computeTrend(history);
  const glucose = latestReading?.glucose ?? null;
  const suggestions = buildSuggestions(glucose, name);

  const [messages, setMessages] = useState<Message[]>(() => {
    const greet = glucose != null
      ? `Hey ${name}! Your glucose is at ${glucose} mg/dL right now and ${trend.label} ${trend.arrow} — ${glucose >= 80 && glucose <= 180 ? "looking solid!" : glucose < 70 ? "let's get that up, okay?" : "let's keep an eye on it."} What's on your mind?`
      : `Hey ${name}! I'm Glucose Guardian, your diabetes sidekick. I can see your glucose readings, help with carb counts, and just chat when you need someone who gets it. What's up?`;

    return [
      {
        id: "0",
        role: "assistant",
        text: greet,
        timestamp: new Date(),
      },
    ];
  });

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const conversationRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (prompt && !promptSentRef.current) {
      promptSentRef.current = true;
      const delay = setTimeout(() => send(prompt), 400);
      return () => clearTimeout(delay);
    }
  }, [prompt]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || isThinking) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError(null);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: msg,
      timestamp: new Date(),
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput("");
    setIsThinking(true);

    conversationRef.current = [
      ...conversationRef.current,
      { role: "user", content: msg },
    ];

    try {
      const recentHistory = [...history]
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-10)
        .map((h) => ({ glucose: h.glucose, timestamp: h.timestamp }));

      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationRef.current.slice(-14),
          context: {
            childName: profile?.childName,
            ageYears: ageYears,
            weightLbs: profile?.weightLbs,
            diabetesType: profile?.diabetesType,
            currentGlucose: glucose,
            trendArrow: trend.arrow,
            trendLabel: trend.label,
            recentReadings: recentHistory,
            targetRange: { low: 80, high: 180 },
            anomalyWarning: latestReading?.anomaly?.warning ?? false,
            anomalyMessage: latestReading?.anomaly?.message,
            carbRatio,
            targetGlucose,
            correctionFactor,
          },
        }),
      });

      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const reply: string = data.reply ?? "Hmm, something went wrong on my end. Try again?";

      conversationRef.current = [
        ...conversationRef.current,
        { role: "assistant", content: reply },
      ];

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [aiMsg, ...prev]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setError("Couldn't reach Glucose Guardian right now. Check your connection and try again.");
      conversationRef.current = conversationRef.current.slice(0, -1);
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <View style={[styles.avatarSmall, { backgroundColor: COLORS.primary + "20" }]}>
          <Image source={require("../../assets/images/logo.png")} style={styles.avatarLogo} resizeMode="contain" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Glucose Guardian</Text>
          <Text style={[styles.headerSub, { color: COLORS.success }]}>Your AI diabetes companion</Text>
        </View>
        {glucose != null && (
          <View style={[styles.glucosePill, { backgroundColor: glucoseColor(glucose) + "18", borderColor: glucoseColor(glucose) + "40" }]}>
            <Text style={[styles.glucosePillValue, { color: glucoseColor(glucose) }]}>
              {glucose} <Text style={styles.glucosePillUnit}>mg/dL</Text>
            </Text>
            <Text style={[styles.glucosePillTrend, { color: glucoseColor(glucose) }]}>{trend.arrow}</Text>
            <Text style={[styles.glucosePillLabel, { color: glucoseColor(glucose) }]}>{glucoseLabel(glucose)}</Text>
          </View>
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        inverted
        contentContainerStyle={[styles.list, { paddingBottom: 12 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {isThinking && (
              <View style={[styles.bubble, styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ThinkingDots colors={colors} />
              </View>
            )}
            {error && (
              <View style={[styles.errorBubble, { backgroundColor: COLORS.danger + "12", borderColor: COLORS.danger + "30" }]}>
                <Feather name="wifi-off" size={13} color={COLORS.danger} />
                <Text style={[styles.errorText, { color: COLORS.danger }]}>{error}</Text>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => <MessageBubble message={item} colors={colors} />}
      />

      <View style={[styles.suggestionsRow, { borderTopColor: colors.border }]}>
        <FlatList
          horizontal
          data={suggestions}
          keyExtractor={(s) => s}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.suggestionChip, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
              onPress={() => send(item)}
              disabled={isThinking}
            >
              <Text style={[styles.suggestionText, { color: colors.text }]}>{item}</Text>
            </Pressable>
          )}
        />
      </View>

      <View
        style={[
          styles.inputRow,
          { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: bottomPadding + 58 },
        ]}
      >
        <TextInput
          style={[styles.inputField, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={input}
          onChangeText={setInput}
          placeholder={`Ask Glucose Guardian anything...`}
          placeholderTextColor={colors.textMuted}
          returnKeyType="send"
          onSubmitEditing={() => send()}
          multiline
          maxLength={400}
          editable={!isThinking}
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            { backgroundColor: input.trim() && !isThinking ? COLORS.primary : colors.backgroundTertiary, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={() => send()}
          disabled={!input.trim() || isThinking}
        >
          <Feather name="send" size={18} color={input.trim() && !isThinking ? "#fff" : colors.textMuted} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, colors }: { message: Message; colors: (typeof Colors)["light"] }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.bubbleWrapper, isUser ? styles.userBubbleWrapper : styles.aiBubbleWrapper]}>
      {!isUser && (
        <View style={[styles.avatarTiny, { backgroundColor: COLORS.primary + "20" }]}>
          <Image source={require("../../assets/images/logo.png")} style={styles.avatarTinyLogo} resizeMode="contain" />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: COLORS.primary }]
            : [styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }],
        ]}
      >
        <Text style={[styles.bubbleText, { color: isUser ? "#fff" : colors.text }]}>
          {message.text}
        </Text>
        <Text style={[styles.bubbleTime, { color: isUser ? "rgba(255,255,255,0.55)" : colors.textMuted }]}>
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
    </View>
  );
}

function ThinkingDots({ colors }: { colors: (typeof Colors)["light"] }) {
  return (
    <View style={styles.thinkingRow}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.thinkingDot, { backgroundColor: colors.textMuted }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  avatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEmoji: { fontSize: 20 },
  avatarLogo: { width: 28, height: 28 },
  avatarTinyLogo: { width: 18, height: 18 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  glucosePill: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    minWidth: 70,
  },
  glucosePillValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  glucosePillUnit: { fontSize: 10, fontFamily: "Inter_400Regular" },
  glucosePillTrend: { fontSize: 14, fontFamily: "Inter_700Bold" },
  glucosePillLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },

  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  bubbleWrapper: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 4 },
  userBubbleWrapper: { justifyContent: "flex-end" },
  aiBubbleWrapper: { justifyContent: "flex-start" },
  avatarTiny: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  bubble: { maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, gap: 4 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular" },

  thinkingRow: { flexDirection: "row", gap: 5, paddingVertical: 4 },
  thinkingDot: { width: 8, height: 8, borderRadius: 4, opacity: 0.6 },

  errorBubble: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },

  suggestionsRow: { paddingVertical: 8, borderTopWidth: 1 },
  suggestionChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  suggestionText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  inputField: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
