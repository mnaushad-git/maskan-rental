import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, RefreshControl, findNodeHandle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Markdown from "react-native-markdown-display";
import {
  MapPin,
  Sparkles,
  Send,
  Bookmark,
  X,
  PhoneCall,
  ExternalLink,
  Pause,
  Play,
  XCircle,
  CheckCircle2,
  Pencil,
} from "lucide-react-native";
import {
  fetchPropertyRequest,
  fetchPropertyRequestMatches,
  fetchPropertyRequestActivity,
  fetchPropertyRequestAreaSuggestions,
  fetchPropertyRequestNoMatchDiagnostics,
  dismissPropertyRequestMatch,
  savePropertyRequestMatch,
  contactPropertyRequestMatch,
  pausePropertyRequest,
  resumePropertyRequest,
  closePropertyRequest,
  fulfillPropertyRequest,
  deletePropertyRequest,
  updatePropertyRequest,
  propertyRequestAiAgent,
  fetchProperty,
  type ApiPropertyRequest,
  type ApiPropertyRequestMatch,
  type ApiPropertyRequestActivity,
  type ApiAreaSuggestion,
  type ApiNoMatchDiagnostic,
  type ApiProperty,
  type AlertFrequency,
  type PropertyRequestFieldName,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ErrorState } from "@/components/ErrorState";
import { PropertyRequestStatusBadge } from "@/components/Badges";
import { ScoreRing } from "@/components/ScoreIndicator";
import { colors } from "@/lib/colors";
import { mdStyles } from "../advisor";
import { cityLabel } from "./index";
import { FIELD_LABEL_KEY, PRIORITY_FIELDS } from "./new";

type ChatMessage = { role: "user" | "assistant"; content: string };

function tOrHumanize(
  t: (key: string, vars?: Record<string, string | number>) => string,
  key: string,
  code: string,
  vars?: Record<string, string | number>,
): string {
  const translated = t(key, vars);
  if (translated === key) return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return translated;
}

function fieldValueDisplay(
  field: PropertyRequestFieldName,
  r: ApiPropertyRequest,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  switch (field) {
    case "transaction_type":
      return r.transaction_type ? t(`listingCategories.${r.transaction_type}`) : "—";
    case "city":
      return r.city ? cityLabel(r.city, t) : "—";
    case "max_price":
      return r.max_price != null ? `SAR ${formatSAR(r.max_price)}` : "—";
    case "min_price":
      return r.min_price != null ? `SAR ${formatSAR(r.min_price)}` : "—";
    case "bedrooms_min":
      return r.bedrooms_min != null ? String(r.bedrooms_min) : "—";
    case "bedrooms_max":
      return r.bedrooms_max != null ? String(r.bedrooms_max) : "—";
    case "bathrooms_min":
      return r.bathrooms_min != null ? String(r.bathrooms_min) : "—";
    case "bathrooms_max":
      return r.bathrooms_max != null ? String(r.bathrooms_max) : "—";
    case "min_area_sq_m":
      return r.min_area_sq_m != null ? `${r.min_area_sq_m} m²` : "—";
    case "max_area_sq_m":
      return r.max_area_sq_m != null ? `${r.max_area_sq_m} m²` : "—";
    case "furnishing":
      return r.furnishing ? t(`furnishing.${r.furnishing}`) : "—";
    case "property_category":
      return r.property_category ? t(`propertyTypes.${r.property_category}`) : "—";
    case "verified_only":
      return r.verified_only ? t("propertyRequest.form.verifiedOnly") : "—";
    case "preferred_districts":
      return (r.preferred_districts ?? []).length ? r.preferred_districts!.join(", ") : "—";
    default:
      return "—";
  }
}

function CriteriaGroup({
  title,
  fields,
  request,
}: {
  title: string;
  fields: PropertyRequestFieldName[];
  request: ApiPropertyRequest;
}) {
  const { t } = useLanguage();
  if (fields.length === 0) return null;
  return (
    <View className="gap-2 rounded-xl border border-border p-3">
      <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</Text>
      {fields.map((f) => (
        <View key={f} className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">{t(FIELD_LABEL_KEY[f])}</Text>
          <Text className="text-sm font-medium text-foreground">{fieldValueDisplay(f, request, t)}</Text>
        </View>
      ))}
    </View>
  );
}

function MatchCard({
  match,
  property,
  highlighted,
  onSave,
  onDismiss,
  onContact,
  registerRef,
}: {
  match: ApiPropertyRequestMatch;
  property: ApiProperty | undefined;
  highlighted: boolean;
  onSave: () => void;
  onDismiss: () => void;
  onContact: () => void;
  registerRef?: (node: View | null) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState<"save" | "dismiss" | "contact" | null>(null);

  async function run(kind: "save" | "dismiss" | "contact", fn: () => void) {
    setBusy(kind);
    try {
      fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <View
      ref={registerRef}
      className="gap-3 rounded-2xl border p-4"
      style={{ borderColor: highlighted ? colors.primary : colors.border, borderWidth: highlighted ? 2 : 1 }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text numberOfLines={1} className="text-sm font-bold text-foreground">
            {property?.title ?? `#${match.property_id}`}
          </Text>
          {property && (
            <Text className="text-xs text-muted-foreground">
              {property.area}, {property.city} · SAR {formatSAR(property.listing_type === "sale" ? property.sale_price ?? 0 : (property.monthly_rent ?? 0) * 12)}
              {property.listing_type !== "sale" ? t("propertyCard.perYear") : ""}
            </Text>
          )}
          {match.status !== "new" && (
            <Text className="text-[11px] text-muted-foreground">
              {t(`propertyRequest.detail.matches.${match.status === "contacted" ? "contacted" : match.status === "saved" ? "saved" : match.status === "dismissed" ? "dismissed" : "newBadge"}`)}
            </Text>
          )}
        </View>
        <ScoreRing score={Math.round(match.match_score * 100)} size={48} />
      </View>

      {match.match_reasons.length > 0 && (
        <View className="gap-1">
          <Text className="text-[11px] font-semibold text-muted-foreground">{t("propertyRequest.detail.matches.reasonsHeading")}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {match.match_reasons.map((r, i) => (
              <View key={i} className="rounded-full bg-success/10 px-2 py-1">
                <Text className="text-[11px] font-medium text-success">
                  {tOrHumanize(t, `propertyRequest.matchReasons.${r.code}`, r.code, r as Record<string, string | number>)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {match.trade_offs.length > 0 && (
        <View className="gap-1">
          <Text className="text-[11px] font-semibold text-muted-foreground">{t("propertyRequest.detail.matches.tradeOffsHeading")}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {match.trade_offs.map((r, i) => (
              <View key={i} className="rounded-full bg-warning/15 px-2 py-1">
                <Text className="text-[11px] font-medium text-warning-foreground">
                  {tOrHumanize(t, `propertyRequest.tradeOffs.${r.code}`, r.code, r as Record<string, string | number>)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className="flex-row flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" onPress={() => router.push(`/property/${match.property_id}`)} icon={<ExternalLink size={13} color={colors.foreground} />}>
          {t("propertyRequest.detail.matches.viewProperty")}
        </Button>
        <Button size="sm" variant={match.status === "saved" ? "secondary" : "outline"} loading={busy === "save"} onPress={() => run("save", onSave)} icon={<Bookmark size={13} color={match.status === "saved" ? "#FFFFFF" : colors.foreground} />}>
          {t(match.status === "saved" ? "propertyRequest.detail.matches.saved" : "propertyRequest.detail.matches.save")}
        </Button>
        <Button size="sm" variant="outline" loading={busy === "contact"} onPress={() => run("contact", onContact)} icon={<PhoneCall size={13} color={colors.foreground} />}>
          {t(match.status === "contacted" ? "propertyRequest.detail.matches.contacted" : "propertyRequest.detail.matches.contact")}
        </Button>
        {match.status !== "dismissed" && (
          <Button size="sm" variant="ghost" loading={busy === "dismiss"} onPress={() => run("dismiss", onDismiss)} icon={<X size={13} color={colors.mutedForeground} />}>
            {t("propertyRequest.detail.matches.dismiss")}
          </Button>
        )}
      </View>
    </View>
  );
}

export default function PropertyRequestDetailScreen() {
  const { id, matchId } = useLocalSearchParams<{ id: string; matchId?: string }>();
  const { t } = useLanguage();
  const router = useRouter();
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);
  const highlightRef = useRef<View>(null);

  const reqId = Number(id);

  const [request, setRequest] = useState<ApiPropertyRequest | null>(null);
  const [matches, setMatches] = useState<ApiPropertyRequestMatch[]>([]);
  const [matchProperties, setMatchProperties] = useState<Record<number, ApiProperty>>({});
  const [areaSuggestions, setAreaSuggestions] = useState<ApiAreaSuggestion[]>([]);
  const [activity, setActivity] = useState<ApiPropertyRequestActivity[]>([]);
  const [noMatchDiagnostics, setNoMatchDiagnostics] = useState<ApiNoMatchDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const load = useCallback(
    (isRefresh: boolean) => {
      if (Number.isNaN(reqId)) {
        setLoading(false);
        setError(true);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);
      fetchPropertyRequest(reqId)
        .then(async (req) => {
          setRequest(req);
          const [matchList, areas, acts] = await Promise.all([
            fetchPropertyRequestMatches(reqId).catch(() => []),
            fetchPropertyRequestAreaSuggestions(reqId).catch(() => []),
            fetchPropertyRequestActivity(reqId).catch(() => []),
          ]);
          setMatches(matchList);
          setAreaSuggestions(areas);
          setActivity(acts);
          if (matchList.length > 0) {
            const props = await Promise.all(matchList.map((m) => fetchProperty(m.property_id).catch(() => null)));
            const dict: Record<number, ApiProperty> = {};
            matchList.forEach((m, i) => {
              const p = props[i];
              if (p) dict[m.property_id] = p;
            });
            setMatchProperties(dict);
            setNoMatchDiagnostics([]);
          } else {
            setMatchProperties({});
            const diag = await fetchPropertyRequestNoMatchDiagnostics(reqId).catch(() => []);
            setNoMatchDiagnostics(diag);
          }
        })
        .catch(() => setError(true))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [reqId],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reqId]),
  );

  useEffect(() => {
    if (!matchId || matches.length === 0) return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(scrollRef.current);
      if (highlightRef.current && node != null) {
        highlightRef.current.measureLayout(
          node,
          (_left: number, top: number) => scrollRef.current?.scrollTo({ y: Math.max(top - 24, 0), animated: true }),
          () => {},
        );
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [matchId, matches]);

  async function refreshMatch(matchIdNum: number, action: "save" | "dismiss" | "contact") {
    if (!request) return;
    try {
      const updated =
        action === "save"
          ? await savePropertyRequestMatch(request.id, matchIdNum)
          : action === "dismiss"
            ? await dismissPropertyRequestMatch(request.id, matchIdNum)
            : await contactPropertyRequestMatch(request.id, matchIdNum);
      setMatches((prev) => prev.map((m) => (m.id === matchIdNum ? updated : m)));
    } catch {
      toast(t("propertyRequest.detail.actions.failed"), "error");
    }
  }

  async function changeAlertFrequency(freq: AlertFrequency) {
    if (!request || freq === request.alert_frequency) return;
    try {
      const updated = await updatePropertyRequest(request.id, { alert_frequency: freq });
      setRequest(updated);
      toast(t("propertyRequest.detail.alertFrequency.updated"), "success");
    } catch {
      toast(t("propertyRequest.detail.actions.failed"), "error");
    }
  }

  async function runLifecycle(action: "pause" | "resume" | "close" | "fulfill" | "cancel") {
    if (!request) return;
    setActionBusy(true);
    try {
      if (action === "cancel") {
        await deletePropertyRequest(request.id);
        router.back();
        return;
      }
      const updated =
        action === "pause"
          ? await pausePropertyRequest(request.id)
          : action === "resume"
            ? await resumePropertyRequest(request.id)
            : action === "close"
              ? await closePropertyRequest(request.id)
              : await fulfillPropertyRequest(request.id);
      setRequest(updated);
    } catch {
      toast(t("propertyRequest.detail.actions.failed"), "error");
    } finally {
      setActionBusy(false);
    }
  }

  function confirmAction(action: "close" | "cancel" | "fulfill") {
    const key = action === "close" ? "closeConfirm" : action === "cancel" ? "cancelConfirm" : "fulfillConfirm";
    Alert.alert(t("propertyRequest.navTitle"), t(`propertyRequest.detail.actions.${key}`), [
      { text: t("propertyRequest.detail.actions.dismiss"), style: "cancel" },
      { text: t("propertyRequest.detail.actions.confirm"), style: "destructive", onPress: () => runLifecycle(action) },
    ]);
  }

  async function sendChat(text: string) {
    const content = text.trim();
    if (!content || chatBusy || !request) return;
    const history = chatMessages.map((m) => ({ role: m.role, content: m.content }));
    setChatMessages((prev) => [...prev, { role: "user", content }]);
    setChatDraft("");
    setChatBusy(true);
    try {
      const res = await propertyRequestAiAgent(request.id, content, history);
      setChatMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: t("propertyRequest.detail.aiAgent.errorReaching") }]);
    } finally {
      setChatBusy(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error || !request) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("propertyRequest.navTitle") }} />
        <ErrorState onRetry={() => load(false)} />
      </SafeAreaView>
    );
  }

  const isTerminal = ["fulfilled", "expired", "closed", "cancelled"].includes(request.status);
  const isDraftLike = request.status === "draft" || request.status === "awaiting_clarification";
  const isActiveLike = request.status === "active" || request.status === "matched" || request.status === "negotiating";
  const isPaused = request.status === "paused";
  const highlightedMatchId = matchId ? Number(matchId) : null;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: request.title }} />
      <ScrollView
        ref={scrollRef}
        contentContainerClassName="gap-4 p-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
      >
        <View className="gap-2">
          <View className="flex-row flex-wrap items-center gap-2">
            <PropertyRequestStatusBadge status={request.status} />
            {request.new_match_count > 0 && (
              <View className="rounded-full bg-ai-soft px-2.5 py-1">
                <Text className="text-[11px] font-semibold text-ai">
                  {t(request.new_match_count === 1 ? "propertyRequest.list.newMatchesSingular" : "propertyRequest.list.newMatchesPlural", {
                    count: request.new_match_count,
                  })}
                </Text>
              </View>
            )}
          </View>
          {request.description ? <Text className="text-sm text-muted-foreground">{request.description}</Text> : null}
        </View>

        {/* Criteria summary */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-foreground">{t("propertyRequest.detail.criteria.heading")}</Text>
            {!isTerminal && (
              <Pressable
                onPress={() => router.push(`/property-requests/new?editId=${request.id}`)}
                className="flex-row items-center gap-1"
              >
                <Pencil size={13} color={colors.primary} />
                <Text className="text-xs font-semibold text-primary">{t("propertyRequest.detail.criteria.edit")}</Text>
              </Pressable>
            )}
          </View>
          <CriteriaGroup title={t("propertyRequest.detail.criteria.mustHave")} fields={request.must_have_fields ?? []} request={request} />
          <CriteriaGroup title={t("propertyRequest.detail.criteria.niceToHave")} fields={request.nice_to_have_fields ?? []} request={request} />
          <CriteriaGroup title={t("propertyRequest.detail.criteria.flexible")} fields={request.flexible_fields ?? []} request={request} />
          <CriteriaGroup
            title={t("propertyRequest.new.form.sections.basics")}
            fields={PRIORITY_FIELDS.filter(
              (f) => !(request.must_have_fields ?? []).includes(f) && !(request.nice_to_have_fields ?? []).includes(f) && !(request.flexible_fields ?? []).includes(f),
            )}
            request={request}
          />
        </View>

        {/* Suggested areas */}
        <View className="gap-3">
          <Text className="text-base font-bold text-foreground">{t("propertyRequest.detail.areas.heading")}</Text>
          {areaSuggestions.length === 0 ? (
            <Text className="text-sm text-muted-foreground">{t("propertyRequest.detail.areas.empty")}</Text>
          ) : (
            areaSuggestions.map((a) => (
              <Pressable
                key={`${a.area_name}-${a.city}`}
                onPress={() => router.push(`/areas/${encodeURIComponent(a.area_name)}?city=${encodeURIComponent(a.city)}`)}
                className="gap-2 rounded-xl border border-border p-3"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1">
                    <MapPin size={13} color={colors.mutedForeground} />
                    <Text className="text-sm font-semibold text-foreground">
                      {a.area_name}, {cityLabel(a.city, t)}
                    </Text>
                  </View>
                  <View className="rounded-full bg-primary-soft px-2.5 py-1">
                    <Text className="text-[11px] font-semibold text-primary">{t(`propertyRequest.areaSuggestionLabels.${a.label}`)}</Text>
                  </View>
                </View>
                <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                  {a.typical_price_range && (a.typical_price_range[0] != null || a.typical_price_range[1] != null) && (
                    <Text className="text-xs text-muted-foreground">
                      {a.typical_price_range[0] != null && a.typical_price_range[1] != null
                        ? t("propertyRequest.detail.areas.typicalPrice", { min: formatSAR(a.typical_price_range[0]), max: formatSAR(a.typical_price_range[1]) })
                        : a.typical_price_range[0] != null
                          ? t("propertyRequest.detail.areas.typicalPriceMinOnly", { min: formatSAR(a.typical_price_range[0]) })
                          : t("propertyRequest.detail.areas.typicalPriceMaxOnly", { max: formatSAR(a.typical_price_range[1]!) })}
                    </Text>
                  )}
                  <Text className="text-xs text-muted-foreground">
                    {t("propertyRequest.detail.areas.estimatedAvailability", { count: a.estimated_availability })}
                  </Text>
                  {a.commute_estimate_minutes != null && (
                    <Text className="text-xs text-muted-foreground">
                      {t("propertyRequest.detail.areas.commuteEstimate", { minutes: Math.round(a.commute_estimate_minutes) })}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))
          )}
        </View>

        {/* Matches */}
        <View className="gap-3">
          <Text className="text-base font-bold text-foreground">{t("propertyRequest.detail.matches.heading")}</Text>
          {matches.length === 0 ? (
            <View className="gap-3">
              <Text className="text-sm text-muted-foreground">{t("propertyRequest.detail.matches.empty")}</Text>
              {noMatchDiagnostics.length > 0 && (
                <View className="gap-2 rounded-xl border border-warning/30 bg-surface-2 p-3">
                  <Text className="text-xs font-bold text-foreground">{t("propertyRequest.detail.noMatch.heading")}</Text>
                  <Text className="text-xs text-muted-foreground">{t("propertyRequest.detail.noMatch.desc")}</Text>
                  {noMatchDiagnostics.map((d) => (
                    <View key={d.field} className="flex-row items-center justify-between border-t border-border pt-2">
                      <Text className="text-xs font-medium text-foreground">
                        {(FIELD_LABEL_KEY as Record<string, string>)[d.field] ? t(FIELD_LABEL_KEY[d.field as PropertyRequestFieldName]) : d.field}
                      </Text>
                      <Text className="text-[11px] text-muted-foreground">
                        {t("propertyRequest.detail.noMatch.candidatesWithField", { count: d.candidates_with_field })} ·{" "}
                        {t("propertyRequest.detail.noMatch.candidatesIfRelaxed", { count: d.candidates_if_relaxed })}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : (
            matches.map((m) => (
              <MatchCard
                key={m.id ?? m.property_id}
                match={m}
                property={matchProperties[m.property_id]}
                highlighted={m.id != null && m.id === highlightedMatchId}
                registerRef={
                  m.id != null && m.id === highlightedMatchId
                    ? (node) => {
                        highlightRef.current = node;
                      }
                    : undefined
                }
                onSave={() => m.id != null && refreshMatch(m.id, "save")}
                onDismiss={() => m.id != null && refreshMatch(m.id, "dismiss")}
                onContact={() => m.id != null && refreshMatch(m.id, "contact")}
              />
            ))
          )}
        </View>

        {/* AI Property Agent */}
        <View className="gap-3 rounded-2xl border border-border bg-card p-4">
          <View className="flex-row items-center gap-2">
            <Sparkles size={16} color={colors.ai} />
            <Text className="text-sm font-bold text-foreground">{t("propertyRequest.detail.aiAgent.heading")}</Text>
          </View>
          {chatMessages.length === 0 && (
            <View className="gap-1.5">
              {[t("propertyRequest.detail.aiAgent.suggested1"), t("propertyRequest.detail.aiAgent.suggested2"), t("propertyRequest.detail.aiAgent.suggested3")].map(
                (q) => (
                  <Pressable key={q} onPress={() => sendChat(q)} className="rounded-lg border border-border bg-background px-3 py-2">
                    <Text className="text-xs text-foreground">{q}</Text>
                  </Pressable>
                ),
              )}
            </View>
          )}
          {chatMessages.map((m, i) => (
            <View key={i} className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${m.role === "user" ? "self-end bg-primary" : "self-start border border-border bg-background"}`}>
              {m.role === "user" ? (
                <Text className="text-sm leading-5 text-primary-foreground">{m.content}</Text>
              ) : (
                <Markdown style={mdStyles}>{m.content}</Markdown>
              )}
            </View>
          ))}
          {chatBusy && (
            <View className="flex-row items-center gap-2 self-start rounded-2xl border border-border bg-background px-3.5 py-2.5">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-xs text-muted-foreground">{t("propertyRequest.detail.aiAgent.thinking")}</Text>
            </View>
          )}
          <View className="flex-row items-center gap-2">
            <TextInput
              value={chatDraft}
              onChangeText={setChatDraft}
              placeholder={t("propertyRequest.detail.aiAgent.placeholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm text-foreground"
            />
            <Pressable
              onPress={() => sendChat(chatDraft)}
              disabled={!chatDraft.trim() || chatBusy}
              className="size-10 items-center justify-center rounded-full bg-primary"
              style={{ opacity: !chatDraft.trim() || chatBusy ? 0.4 : 1 }}
            >
              <Send size={16} color="#FFFFFF" />
            </Pressable>
          </View>
          <Text className="text-[11px] text-muted-foreground">{t("propertyRequest.detail.aiAgent.disclaimer")}</Text>
        </View>

        {/* Activity */}
        <View className="gap-2">
          <Text className="text-base font-bold text-foreground">{t("propertyRequest.detail.activity.heading")}</Text>
          {activity.length === 0 ? (
            <Text className="text-sm text-muted-foreground">{t("propertyRequest.detail.activity.empty")}</Text>
          ) : (
            activity.map((a) => (
              <View key={a.id} className="flex-row items-center justify-between border-b border-border py-2">
                <Text className="flex-1 text-xs text-foreground">
                  {tOrHumanize(t, `propertyRequest.activityTypes.${a.activity_type}`, a.activity_type)}
                </Text>
                <Text className="text-[11px] text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</Text>
              </View>
            ))
          )}
        </View>

        {/* Alert frequency */}
        <View className="gap-2">
          <Text className="text-base font-bold text-foreground">{t("propertyRequest.detail.alertFrequency.heading")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {(["instant", "daily", "weekly", "off"] as AlertFrequency[]).map((f) => (
              <Chip key={f} selected={request.alert_frequency === f} onPress={() => changeAlertFrequency(f)}>
                {t(`propertyRequest.detail.alertFrequency.${f}`)}
              </Chip>
            ))}
          </View>
        </View>

        {/* Lifecycle actions */}
        {!isTerminal && (
          <View className="flex-row flex-wrap gap-2 border-t border-border pt-4">
            {isDraftLike && (
              <Button size="sm" variant="destructive" loading={actionBusy} onPress={() => confirmAction("cancel")} icon={<XCircle size={14} color="#FFFFFF" />}>
                {t("propertyRequest.detail.actions.cancel")}
              </Button>
            )}
            {isActiveLike && (
              <>
                <Button size="sm" variant="outline" loading={actionBusy} onPress={() => runLifecycle("pause")} icon={<Pause size={14} color={colors.foreground} />}>
                  {t("propertyRequest.detail.actions.pause")}
                </Button>
                <Button size="sm" variant="outline" loading={actionBusy} onPress={() => confirmAction("fulfill")} icon={<CheckCircle2 size={14} color={colors.foreground} />}>
                  {t("propertyRequest.detail.actions.fulfilled")}
                </Button>
                <Button size="sm" variant="ghost" loading={actionBusy} onPress={() => confirmAction("close")} icon={<XCircle size={14} color={colors.mutedForeground} />}>
                  {t("propertyRequest.detail.actions.close")}
                </Button>
              </>
            )}
            {isPaused && (
              <>
                <Button size="sm" variant="outline" loading={actionBusy} onPress={() => runLifecycle("resume")} icon={<Play size={14} color={colors.foreground} />}>
                  {t("propertyRequest.detail.actions.resume")}
                </Button>
                <Button size="sm" variant="ghost" loading={actionBusy} onPress={() => confirmAction("close")} icon={<XCircle size={14} color={colors.mutedForeground} />}>
                  {t("propertyRequest.detail.actions.close")}
                </Button>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
