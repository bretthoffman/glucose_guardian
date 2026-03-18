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
import { getEffectiveTrend } from "@/utils/trend";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

function glucoseColor(g: number, low = 80, high = 180): string {
  if (g < 70 || g > 300) return COLORS.danger;
  if (g < low || g > high) return COLORS.warning;
  return COLORS.success;
}

function glucoseLabel(g: number, low = 80, high = 180): string {
  if (g < 70) return "Low";
  if (g < low) return "Below Range";
  if (g <= high) return "In Range";
  if (g <= 300) return "Above Range";
  return "High";
}

function buildParentSuggestions(
  glucose: number | null,
  name: string,
  high: number
): string[] {
  if (glucose === null) {
    return [
      `How should I manage ${name}'s levels?`,
      "What do carb ratios mean?",
      "When should I give a correction?",
      "How do I read the trend arrows?",
    ];
  }
  if (glucose < 70) {
    return [
      `${name}'s sugar is low — what do I do?`,
      "How much fast-acting sugar to give?",
      "When should I call the doctor?",
      "Is it safe to let them sleep?",
    ];
  }
  if (glucose > 250) {
    return [
      `${name}'s glucose is very high`,
      "Should I give a correction dose now?",
      "Could this be ketoacidosis?",
      "What could have caused this spike?",
    ];
  }
  if (glucose > high) {
    return [
      `${name} is above range — correction?`,
      "How long to come back down?",
      "Is activity safe at this level?",
      "Should I log this in their report?",
    ];
  }
  return [
    `${name}'s levels look good — tips?`,
    "What's the ideal overnight range?",
    "How do I adjust for exercise?",
    "Generate a doctor report",
  ];
}

function buildSuggestions(
  glucose: number | null,
  name: string,
  high: number,
  isKidMode = false,
): string[] {
  if (isKidMode) {
    if (glucose === null) {
      return [
        "I don't feel great 😟",
        "What is blood sugar? 🤔",
        "Can I eat candy? 🍬",
        "Why do I need shots? 💉",
      ];
    }
    if (glucose < 70) {
      return [
        "I need juice right now! 🧃",
        "I feel shaky 😟",
        "When will I feel better? 😢",
        "Should I tell an adult? 🙋",
      ];
    }
    if (glucose > 250) {
      return [
        "My sugar is really high 😮",
        "Should I drink water? 💧",
        "I don't feel good 😓",
        "Should I tell someone? 🙋",
      ];
    }
    if (glucose > high) {
      return [
        "My sugar went up 📈",
        "Can I go for a walk? 🚶",
        "What should I drink? 💧",
        "Will I feel okay? 😊",
      ];
    }
    return [
      "How am I doing? 😊",
      "What can I snack on? 🥨",
      "Can I go play? 🏃",
      "Am I doing a good job? 🌟",
    ];
  }

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
  if (glucose > high) {
    return [
      "Why is my sugar high?",
      "What can I do to bring it down?",
      "Can I still exercise?",
      "Will this affect how I feel?",
    ];
  }
  return [
    "My sugar feels a bit low",
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
  const { profile, ageYears, alertPrefs, isChildMode, caregiverSession } = useAuth();
  const { prompt, fromParent } = useLocalSearchParams<{ prompt?: string; fromParent?: string }>();
  const promptSentRef = useRef<string | null>(null);

  const name = profile?.childName ?? "there";
  const parentName = profile?.parentName?.trim() || null;
  const speakingToParent =
    fromParent === "true" ||
    caregiverSession ||
    (profile?.accountRole === "parent" && !isChildMode);

  const trend = getEffectiveTrend(history);
  const glucose = latestReading?.glucose ?? null;
  const low = alertPrefs.lowThreshold;
  const high = alertPrefs.highThreshold;
  const isKidMode = !speakingToParent && ageYears !== null && ageYears < 18;

  const suggestions = speakingToParent
    ? buildParentSuggestions(glucose, name, high)
    : buildSuggestions(glucose, name, high, isKidMode);

  function buildGreeting(speakingAsParent: boolean): string {
    const inRange = glucose != null && glucose >= low && glucose <= high;
    const trendingDown = trend.label.toLowerCase().includes("fall");
    if (speakingAsParent) {
      const greeting = caregiverSession ? "Hi, Caregiver!" : parentName ? `Hi ${parentName}!` : "Hi there!";
      return glucose != null
        ? `${greeting} ${name}'s glucose is at ${glucose} mg/dL right now and ${trend.label} ${trend.arrow} — ${inRange ? "looking good." : glucose < 70 ? "that's a low, act quickly." : "worth keeping an eye on."} How can I help you manage ${name}'s care today?`
        : `${greeting} I'm Glucose Guardian — ${name}'s AI diabetes companion. I can walk you through glucose readings, insulin calculations, and anything else you need for ${name}'s care. What's on your mind?`;
    } else if (isKidMode) {
      if (glucose == null) {
        return `Hey ${name}! 👋 I'm Glucose Guardian, your diabetes buddy! I'm here to help you feel your best every day. How are you feeling right now? 😊`;
      }
      if (glucose < 70) {
        return `Hey ${name}! Your sugar is a little low right now 😟 — you should grab some juice or a snack right away! 🧃 Tell an adult too, okay?`;
      }
      if (trendingDown) {
        return `Hey ${name}! Your sugar is going down 📉 — let's eat a small snack before it gets too low! 🥨 You'll feel so much better!`;
      }
      if (glucose > 250) {
        return `Hey ${name}! Your sugar is really high right now 😮 — drink some water 💧 and go tell a grown-up. It'll come back down!`;
      }
      if (glucose > high) {
        return `Hey ${name}! Your sugar went up a little 📈. Try drinking some water 💧 and maybe go for a short walk! 🚶 How are you feeling?`;
      }
      return `Hey ${name}! 🌟 Your sugar looks great right now — you're doing an awesome job! How are you feeling today? 😊`;
    } else {
      return glucose != null
        ? `Hey ${name}! Your glucose is at ${glucose} mg/dL right now and ${trend.label} ${trend.arrow} — ${inRange ? "looking solid!" : glucose < 70 ? "let's get that up, okay?" : "let's keep an eye on it."} What's on your mind?`
        : `Hey ${name}! I'm Glucose Guardian, your diabetes sidekick. I can see your glucose readings, help with carb counts, and just chat when you need someone who gets it. What's up?`;
    }
  }

  const [messages, setMessages] = useState<Message[]>(() => [
    { id: "0", role: "assistant", text: buildGreeting(speakingToParent), timestamp: new Date() },
  ]);

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const conversationRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const prevSpeakingToParent = useRef(speakingToParent);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (prevSpeakingToParent.current === speakingToParent) return;
    prevSpeakingToParent.current = speakingToParent;
    const newGreet: Message = {
      id: Date.now().toString(),
      role: "assistant",
      text: buildGreeting(speakingToParent),
      timestamp: new Date(),
    };
    setMessages([newGreet]);
    conversationRef.current = [];
    setInput("");
    setError(null);
  }, [speakingToParent]);

  useEffect(() => {
    if (prompt && prompt !== promptSentRef.current) {
      promptSentRef.current = prompt;
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
            parentName: parentName ?? undefined,
            accountRole: profile?.accountRole,
            speakingToParent,
            isChildMode,
            caregiverSession: caregiverSession || undefined,
            ageYears: ageYears,
            weightLbs: profile?.weightLbs,
            diabetesType: profile?.diabetesType,
            currentGlucose: glucose,
            trendArrow: trend.arrow,
            trendLabel: trend.label,
            recentReadings: recentHistory,
            targetRange: { low, high },
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
          <Text style={[styles.headerSub, { color: COLORS.success }]}>
            {speakingToParent ? `Managing ${name}'s care` : "Your AI diabetes companion"}
          </Text>
        </View>
        {glucose != null && (
          <View style={[styles.glucosePill, { backgroundColor: glucoseColor(glucose, low, high) + "18", borderColor: glucoseColor(glucose, low, high) + "40" }]}>
            <Text style={[styles.glucosePillValue, { color: glucoseColor(glucose, low, high) }]}>
              {glucose} <Text style={styles.glucosePillUnit}>mg/dL</Text>
            </Text>
            <Text style={[styles.glucosePillTrend, { color: glucoseColor(glucose, low, high) }]}>{trend.arrow}</Text>
            <Text style={[styles.glucosePillLabel, { color: glucoseColor(glucose, low, high) }]}>{glucoseLabel(glucose, low, high)}</Text>
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
        renderItem={({ item }) => <MessageBubble message={item} colors={colors} isKidMode={isKidMode} />}
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
          placeholder={isKidMode ? "Tell me how you're feeling... 😊" : "Ask Glucose Guardian anything..."}
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

function MessageBubble({
  message,
  colors,
  isKidMode = false,
}: {
  message: Message;
  colors: (typeof Colors)["light"];
  isKidMode?: boolean;
}) {
  const isUser = message.role === "user";
  const isAI = !isUser;
  return (
    <View style={[styles.bubbleWrapper, isUser ? styles.userBubbleWrapper : styles.aiBubbleWrapper]}>
      {isAI && (
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
          isKidMode && styles.kidBubble,
        ]}
      >
        <Text
          style={[
            isKidMode ? styles.kidBubbleText : styles.bubbleText,
            { color: isUser ? "#fff" : colors.text },
            isKidMode && isAI && { fontFamily: "Inter_700Bold" },
          ]}
        >
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
  kidBubbleText: { fontSize: 19, fontFamily: "Inter_600SemiBold", lineHeight: 28 },
  kidBubble: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 22 },
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
