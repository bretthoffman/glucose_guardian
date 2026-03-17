import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import {
  FlatList,
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

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

function getAIResponse(
  question: string,
  latestGlucose: number | null
): string {
  const q = question.toLowerCase();
  const glucose = latestGlucose;

  if (q.includes("low") || q.includes("dizzy") || q.includes("shaky")) {
    return "Your blood sugar may be low. Try fast-acting carbs like 4oz of juice, regular soda, or 4 glucose tablets. Wait 15 minutes, then recheck. If symptoms continue, tell an adult right away!";
  }
  if (q.includes("high") || q.includes("thirsty") || q.includes("pee")) {
    return "Those can be signs of high blood sugar. Drink water and check with your care team about a correction dose. Make sure to stay hydrated!";
  }
  if (q.includes("snack") || q.includes("eat") || q.includes("hungry")) {
    return "Great time to think about carbs! Try to choose snacks you know the carb count for. Low-carb options like cheese, nuts, or veggies are great if your glucose is in range.";
  }
  if (q.includes("exercise") || q.includes("play") || q.includes("sport")) {
    return "Exercise is amazing for your health! It can lower blood sugar. Check your glucose before and after activity, and keep a fast-acting carb snack nearby just in case.";
  }
  if (q.includes("insulin") || q.includes("dose") || q.includes("shot")) {
    return "Always check with your parent or doctor before adjusting insulin. Use the Insulin tab to calculate your meal dose, but confirm with your care team!";
  }
  if (q.includes("normal") || q.includes("range") || q.includes("target")) {
    return "For most kids, a blood sugar between 80-180 mg/dL is the target range. Your doctor may have set a specific range for you. Ask them if you're not sure!";
  }
  if (q.includes("feel") || q.includes("feeling")) {
    if (glucose !== null) {
      if (glucose < 70)
        return `Your glucose reading of ${glucose} mg/dL is low. That could explain why you're not feeling great. Have some juice or fast-acting carbs right away!`;
      if (glucose > 180)
        return `Your glucose is ${glucose} mg/dL which is a bit high. Drink some water and let your parent know. It might be a good time for a correction.`;
      return `Your last reading was ${glucose} mg/dL which looks good! If you're still feeling off, let an adult know.`;
    }
    return "How you're feeling is always important! If you feel strange, check your glucose and tell an adult. Don't ignore your symptoms.";
  }
  if (q.includes("what is") && q.includes("glucose")) {
    return "Glucose is a type of sugar that gives your body energy. When you have diabetes, your body needs help managing glucose levels — that's what insulin does!";
  }
  if (q.includes("help") || q.includes("what can you")) {
    return "I can help you understand your glucose readings, remind you about carb counting, answer questions about how you're feeling, and give tips on snacks and exercise. What would you like to know?";
  }

  return "That's a great question! Always talk to your parent or doctor for medical decisions. I'm here to help you understand diabetes basics and support your day-to-day management. Is there something specific I can help with?";
}

const SUGGESTIONS = [
  "My sugar feels low",
  "What should I snack on?",
  "Can I exercise now?",
  "Am I in range?",
];

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { latestReading } = useGlucose();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "0",
      role: "assistant",
      text: "Hi! I'm your Gluco Guardian assistant. Ask me anything about your glucose, meals, or how you're feeling today!",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: msg,
      timestamp: new Date(),
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput("");
    setIsThinking(true);

    setTimeout(() => {
      const reply = getAIResponse(msg, latestReading?.glucose ?? null);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [aiMsg, ...prev]);
      setIsThinking(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 900 + Math.random() * 400);
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
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={[styles.avatarSmall, { backgroundColor: COLORS.primary + "20" }]}>
          <Feather name="message-circle" size={18} color={COLORS.primary} />
        </View>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Gluco Assistant
          </Text>
          <Text style={[styles.headerSub, { color: COLORS.success }]}>
            Online
          </Text>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        inverted
        contentContainerStyle={[
          styles.list,
          { paddingBottom: 12 },
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          isThinking ? (
            <View style={[styles.bubble, styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ThinkingDots colors={colors} />
            </View>
          ) : null
        }
        renderItem={({ item }) => <MessageBubble message={item} colors={colors} />}
      />

      <View
        style={[
          styles.suggestionsRow,
          { borderTopColor: colors.border },
        ]}
      >
        <FlatList
          horizontal
          data={SUGGESTIONS}
          keyExtractor={(s) => s}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              style={[
                styles.suggestionChip,
                { backgroundColor: colors.backgroundTertiary, borderColor: colors.border },
              ]}
              onPress={() => send(item)}
            >
              <Text style={[styles.suggestionText, { color: colors.text }]}>
                {item}
              </Text>
            </Pressable>
          )}
        />
      </View>

      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: bottomPadding + 58,
          },
        ]}
      >
        <TextInput
          style={[
            styles.inputField,
            { backgroundColor: colors.card, color: colors.text, borderColor: colors.border },
          ]}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your glucose..."
          placeholderTextColor={colors.textMuted}
          returnKeyType="send"
          onSubmitEditing={() => send()}
          multiline
          maxLength={300}
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: input.trim() ? COLORS.primary : colors.backgroundTertiary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          onPress={() => send()}
          disabled={!input.trim() || isThinking}
        >
          <Feather
            name="send"
            size={18}
            color={input.trim() ? "#fff" : colors.textMuted}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({
  message,
  colors,
}: {
  message: Message;
  colors: (typeof Colors)["light"];
}) {
  const isUser = message.role === "user";
  return (
    <View
      style={[
        styles.bubbleWrapper,
        isUser ? styles.userBubbleWrapper : styles.aiBubbleWrapper,
      ]}
    >
      {!isUser && (
        <View style={[styles.avatarTiny, { backgroundColor: COLORS.primary + "20" }]}>
          <Feather name="shield" size={12} color={COLORS.primary} />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: COLORS.primary }]
            : [
                styles.aiBubble,
                { backgroundColor: colors.card, borderColor: colors.border },
              ],
        ]}
      >
        <Text
          style={[
            styles.bubbleText,
            { color: isUser ? "#fff" : colors.text },
          ]}
        >
          {message.text}
        </Text>
      </View>
    </View>
  );
}

function ThinkingDots({ colors }: { colors: (typeof Colors)["light"] }) {
  return (
    <View style={styles.thinkingRow}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[styles.thinkingDot, { backgroundColor: colors.textMuted }]}
        />
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
    paddingHorizontal: 20,
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
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  headerSub: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  bubbleWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 6,
  },
  userBubbleWrapper: {
    justifyContent: "flex-end",
  },
  aiBubbleWrapper: {
    justifyContent: "flex-start",
  },
  avatarTiny: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  userBubble: {
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  thinkingRow: {
    flexDirection: "row",
    gap: 5,
    paddingVertical: 4,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.6,
  },
  suggestionsRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  suggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  suggestionText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
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
