import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from "expo-router";
import { MapPin, BedDouble, Wallet, CalendarDays, Send, Home } from "lucide-react-native";
import {
  fetchLead,
  fetchLeadMessages,
  sendLeadMessage,
  markLeadMessagesRead,
  type ApiLeadDetail,
  type ApiLeadMessage,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

const PARTNER_ACTIVE = ["assigned", "in_progress", "pending_closure", "closed_won"];
const CAN_CHAT = [...PARTNER_ACTIVE, "pending_review"];

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [lead, setLead] = useState<ApiLeadDetail | null>(null);
  const [messages, setMessages] = useState<ApiLeadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const leadId = Number(id);

  const load = useCallback(() => {
    if (!user || Number.isNaN(leadId)) {
      setLoading(false);
      setError(!user ? false : true);
      return;
    }
    Promise.all([fetchLead(leadId), fetchLeadMessages(leadId).catch(() => [])])
      .then(([l, m]) => {
        setLead(l);
        setMessages(m);
        markLeadMessagesRead(leadId).catch(() => {});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [leadId, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Poll for new messages while the screen is focused — there's no websocket,
  // and refetching only on focus meant a reply sent while the screen was
  // already open would never appear until the user navigated away and back.
  useFocusEffect(
    useCallback(() => {
      if (!user || Number.isNaN(leadId)) return;
      const interval = setInterval(() => {
        fetchLeadMessages(leadId)
          .then((fresh) => {
            setMessages((prev) => {
              if (fresh.length === prev.length) return prev;
              markLeadMessagesRead(leadId).catch(() => {});
              return fresh;
            });
          })
          .catch(() => {});
      }, 5000);
      return () => clearInterval(interval);
    }, [leadId, user]),
  );

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const msg = await sendLeadMessage(leadId, content);
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      // ignore — keep draft so the user can retry
    } finally {
      setSending(false);
    }
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("leadDetail.loading") }} />
        <Text className="text-center text-base text-muted-foreground">{t("leadDetail.signInToView")}</Text>
        <Pressable onPress={() => router.push("/auth/login")} className="rounded-xl bg-primary px-6 py-3">
          <Text className="text-sm font-semibold text-primary-foreground">{t("leadDetail.signIn")}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error || !lead) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-sm text-muted-foreground">{t("leadDetail.notFound")}</Text>
        <View className="flex-row gap-2">
          <Pressable onPress={load} className="rounded-xl border border-border px-6 py-3">
            <Text className="text-sm font-semibold text-foreground">{t("common.retry")}</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/")} className="rounded-xl bg-primary px-6 py-3">
            <Text className="text-sm font-semibold text-primary-foreground">{t("leadDetail.goHome")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const accepted = lead.assignments.find((a) => a.status === "accepted");
  const canChat = CAN_CHAT.includes(lead.status);
  const isPartner = PARTNER_ACTIVE.includes(lead.status);
  const placeholder = isPartner
    ? t("leadDetail.messagePlaceholderPartner")
    : lead.status === "pending_review"
      ? t("leadDetail.messagePlaceholderTeam")
      : t("leadDetail.messagePlaceholderWaiting");

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: `${lead.area_name}, ${lead.city}` }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView ref={scrollRef} contentContainerClassName="gap-4 p-4">
          {/* Status banner */}
          <View className="gap-1 rounded-xl border border-border bg-card p-4">
            <Text className="text-base font-bold text-foreground">
              {t(`leadDetail.statusInfo.${lead.status}.label`)}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t(`leadDetail.statusInfo.${lead.status}.description`)}
            </Text>
          </View>

          {/* Requirements */}
          <View className="gap-3 rounded-xl border border-border bg-card p-4">
            <Text className="text-sm font-semibold text-foreground">{t("leadDetail.yourRequirements")}</Text>
            <Row icon={<MapPin size={16} color={colors.mutedForeground} />} label={t("leadDetail.location")} value={`${lead.area_name}, ${lead.city}`} />
            {lead.bedrooms_needed != null && (
              <Row
                icon={<BedDouble size={16} color={colors.mutedForeground} />}
                label={t("leadDetail.bedrooms")}
                value={t("leadDetail.bedroomsValue", { count: lead.bedrooms_needed })}
              />
            )}
            <Row
              icon={<Wallet size={16} color={colors.mutedForeground} />}
              label={t("leadDetail.budget")}
              value={lead.max_budget ? t("leadDetail.perMonth", { amount: formatSAR(lead.max_budget) }) : t("myLeads.budgetFlexible")}
            />
            {lead.move_in_date && (
              <Row icon={<CalendarDays size={16} color={colors.mutedForeground} />} label={t("leadDetail.moveIn")} value={lead.move_in_date} />
            )}
          </View>

          {/* Partner / matching */}
          {accepted ? (
            <View className="gap-1 rounded-xl border p-4" style={{ borderColor: colors.success, backgroundColor: "rgba(21,128,61,0.06)" }}>
              <Text className="text-sm font-semibold text-foreground">{t("leadDetail.partnerAssigned")}</Text>
              <Text className="text-sm text-muted-foreground">{t("leadDetail.partnerAssignedDesc", { area: lead.area_name })}</Text>
            </View>
          ) : lead.status === "open" ? (
            <View className="gap-1 rounded-xl border border-border bg-card p-4">
              <Text className="text-sm font-semibold text-foreground">{t("leadDetail.matchingInProgress")}</Text>
              <Text className="text-sm text-muted-foreground">{t("leadDetail.matchingInProgressDesc", { area: lead.area_name })}</Text>
            </View>
          ) : null}

          {/* Suggested properties */}
          {lead.suggestions.length > 0 && (
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">{t("leadDetail.suggestedProperties")}</Text>
              {lead.suggestions.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => s.property_id && router.push(`/property/${s.property_id}`)}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <View className="size-9 items-center justify-center rounded-lg bg-muted">
                    <Home size={16} color={colors.mutedForeground} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {s.property_title ?? t("leadDetail.propertyFallback", { id: s.property_id ?? s.id })}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {s.bedrooms ? t("leadDetail.bedroomsPrefix", { count: s.bedrooms }) : ""}
                      {s.monthly_rent ? t("leadDetail.perMonth", { amount: formatSAR(s.monthly_rent) }) : ""}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* Chat */}
          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">
              {isPartner ? t("leadDetail.chatWithPartner") : t("leadDetail.messagesFromMyHome")}
            </Text>
            {messages.length === 0 ? (
              <View className="rounded-xl border border-dashed border-border p-4">
                <Text className="text-center text-xs text-muted-foreground">
                  {canChat ? t("leadDetail.partnerWillMessage") : t("leadDetail.chatOpensOnceAccepted")}
                </Text>
              </View>
            ) : (
              messages.map((m) => {
                const mine = m.sender_role === "customer";
                return (
                  <View
                    key={m.id}
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${mine ? "self-end bg-primary" : "self-start border border-border bg-card"}`}
                  >
                    {!mine && (
                      <Text className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                        {m.sender_role === "mediator" ? t("leadDetail.partnerLabel") : t("leadDetail.maskanTeamLabel")}
                      </Text>
                    )}
                    <Text className={`text-sm ${mine ? "text-primary-foreground" : "text-foreground"}`}>{m.content}</Text>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>

        {/* Input */}
        <View className="flex-row items-center gap-2 border-t border-border bg-background px-3 py-2.5">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            editable={canChat}
            placeholder={placeholder}
            placeholderTextColor={colors.neutral400}
            className="flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground"
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={!canChat || !draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={t("advisor.send")}
            className="size-11 items-center justify-center rounded-full bg-primary"
            style={{ opacity: !canChat || !draft.trim() || sending ? 0.4 : 1 }}
          >
            <Send size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-sm text-muted-foreground">{label}</Text>
      </View>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}
