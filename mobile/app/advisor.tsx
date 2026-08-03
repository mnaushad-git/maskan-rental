import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Send, Sparkles, Plus, Square, RotateCcw } from "lucide-react-native";
import Markdown from "react-native-markdown-display";
import { streamAdvisorChat } from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";

type ChatMessage = { role: "user" | "assistant"; content: string };

// Style the AI's markdown to match the app: compact spacing, green links/accents,
// slate body text. Internal links (e.g. /areas?…) are non-navigating on mobile.
const mdStyles = {
  body: { color: "#2B211A", fontSize: 14, lineHeight: 20 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  heading1: { fontSize: 18, fontWeight: "700" as const, color: "#2B211A", marginTop: 4, marginBottom: 6 },
  heading2: { fontSize: 16, fontWeight: "700" as const, color: "#2B211A", marginTop: 4, marginBottom: 6 },
  heading3: { fontSize: 15, fontWeight: "700" as const, color: "#2B211A", marginTop: 4, marginBottom: 4 },
  strong: { fontWeight: "700" as const },
  link: { color: "#2563EB", fontWeight: "600" as const },
  bullet_list: { marginBottom: 4 },
  ordered_list: { marginBottom: 4 },
  list_item: { marginBottom: 2 },
  code_inline: { backgroundColor: "#F5EAD9", color: "#2B211A", borderRadius: 4, paddingHorizontal: 4, fontFamily: "monospace" },
  fence: { backgroundColor: "#F5EAD9", borderRadius: 8, padding: 10 },
  table: { borderWidth: 1, borderColor: "#E7D9C4", borderRadius: 8, marginBottom: 8 },
  th: { padding: 6, fontWeight: "700" as const, backgroundColor: "#FDF6EC" },
  td: { padding: 6, borderColor: "#E7D9C4" },
  tr: { borderBottomWidth: 1, borderColor: "#E7D9C4" },
  blockquote: { backgroundColor: "#FDF6EC", borderLeftColor: "#2563EB", borderLeftWidth: 3, paddingHorizontal: 10, paddingVertical: 4 },
};

export default function AdvisorScreen() {
  const { t } = useLanguage();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  // The cancel fn streamAdvisorChat returns — captured so Stop and unmount
  // cleanup can abort an in-flight request instead of leaking it.
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => abortRef.current?.();
  }, []);

  const suggestions = [
    t("advisor.suggested.q1"),
    t("advisor.suggested.q2"),
    t("advisor.suggested.q3"),
    t("advisor.suggested.q4"),
  ];

  function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    // Append the user message plus an empty assistant bubble we stream into.
    const assistantIndex = messages.length + 1;
    setMessages([...messages, { role: "user", content }, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    setLastFailedMessage(null);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

    let errored = false;
    abortRef.current = streamAdvisorChat(content, history, {
      onDelta: (delta) => {
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[assistantIndex]) copy[assistantIndex] = { role: "assistant", content: copy[assistantIndex].content + delta };
          return copy;
        });
        scrollRef.current?.scrollToEnd({ animated: false });
      },
      onDone: () => {
        setBusy(false);
        abortRef.current = null;
        // If nothing streamed (e.g. immediate failure), show the fallback.
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[assistantIndex] && copy[assistantIndex].content === "" && !errored) {
            copy[assistantIndex] = { role: "assistant", content: t("advisor.errorReachingAI") };
            setLastFailedMessage(content);
          }
          return copy;
        });
      },
      onError: () => {
        errored = true;
        setBusy(false);
        abortRef.current = null;
        setLastFailedMessage(content);
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[assistantIndex]) copy[assistantIndex] = { role: "assistant", content: t("advisor.errorReachingAI") };
          return copy;
        });
      },
    });
  }

  function stop() {
    abortRef.current?.();
    abortRef.current = null;
    setBusy(false);
  }

  function handleLinkPress(url: string): boolean {
    if (url.startsWith("/")) {
      router.push(url as never);
      return false; // handled ourselves — don't let the library also try Linking.openURL
    }
    return true; // external link — let the library open it normally
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: t("nav.aiAdvisor"),
          headerRight: () =>
            messages.length > 0 ? (
              <Pressable onPress={() => setMessages([])} className="flex-row items-center gap-1 pr-1">
                <Plus size={16} color="#2563EB" />
                <Text className="text-sm font-medium text-primary">{t("advisor.newChat")}</Text>
              </Pressable>
            ) : null,
        }}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView ref={scrollRef} contentContainerClassName="gap-3 p-4">
          {messages.length === 0 ? (
            <View className="gap-4 pt-6">
              <View className="items-center gap-2">
                <View className="size-14 items-center justify-center rounded-2xl bg-primary/10">
                  <Sparkles size={26} color="#2563EB" />
                </View>
                <Text className="text-center text-lg font-bold text-foreground">{t("advisor.emptyState.title")}</Text>
                <Text className="text-center text-sm text-muted-foreground">{t("advisor.emptyState.desc")}</Text>
              </View>
              <View className="gap-2">
                {suggestions.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => send(q)}
                    className="rounded-xl border border-border bg-card p-3.5"
                  >
                    <Text className="text-sm text-foreground">{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m, i) => {
              if (m.role === "assistant" && m.content === "") return null;
              return (
                <View
                  key={i}
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${m.role === "user" ? "self-end bg-primary" : "self-start border border-border bg-card"}`}
                >
                  {m.role === "user" ? (
                    <Text className="text-sm leading-5 text-primary-foreground">{m.content}</Text>
                  ) : (
                    <Markdown style={mdStyles} onLinkPress={handleLinkPress}>
                      {m.content}
                    </Markdown>
                  )}
                </View>
              );
            })
          )}
          {busy && messages[messages.length - 1]?.content === "" && (
            <View className="self-start rounded-2xl border border-border bg-card px-4 py-3">
              <ActivityIndicator color="#2563EB" size="small" />
            </View>
          )}
          {!busy && lastFailedMessage && (
            <Pressable
              onPress={() => send(lastFailedMessage)}
              accessibilityRole="button"
              accessibilityLabel={t("advisor.retry")}
              className="mt-1 flex-row items-center gap-1.5 self-start rounded-full border border-border bg-card px-3.5 py-2"
            >
              <RotateCcw size={14} color="#2563EB" />
              <Text className="text-sm font-medium text-primary">{t("advisor.retry")}</Text>
            </Pressable>
          )}
        </ScrollView>

        <View className="gap-1 border-t border-border bg-background px-3 py-2.5">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t("advisor.inputPlaceholder")}
              placeholderTextColor="#A8A29E"
              className="flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground"
              multiline
            />
            {busy ? (
              <Pressable
                onPress={stop}
                accessibilityRole="button"
                accessibilityLabel={t("advisor.stop")}
                className="size-11 items-center justify-center rounded-full bg-destructive"
              >
                <Square size={16} color="#FFFFFF" fill="#FFFFFF" />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => send(draft)}
                disabled={!draft.trim()}
                accessibilityRole="button"
                accessibilityLabel={t("advisor.send")}
                className="size-11 items-center justify-center rounded-full bg-primary"
                style={{ opacity: !draft.trim() ? 0.4 : 1 }}
              >
                <Send size={18} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
          <Text className="px-1 text-[11px] text-muted-foreground">{t("advisor.footerDisclaimer")}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
