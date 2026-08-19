import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  CheckCircle2,
  GitCompare,
  Map as MapIcon,
  MessageCircle,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react-native";
import {
  EMPTY_HOME_FINDER_CRITERIA,
  explainHomeFinderMatch,
  fetchAreaIntelligence,
  fetchHomeFinderHistory,
  interpretHomeFinderQuery,
  mapApiProperty,
  mapApiSearchProperty,
  refineHomeFinderCriteria,
  searchHomeFinder,
  type ApiAreaIntelligence,
  type ApiHomeFinderCategories,
  type ApiHomeFinderCriteria,
  type ApiHomeFinderCriteriaChange,
  type ApiHomeFinderEmptyResult,
  type ApiHomeFinderHistoryItem,
  type ApiHomeFinderResult,
} from "@/lib/api/maskan";
import { districtsByCity } from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";
import type { Property } from "@/lib/maskan-data";
import { PropertyCard } from "@/components/PropertyCard";
import { PropertyMapView } from "@/components/PropertyMapView";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

const CITIES = ["Riyadh", "Jeddah", "Dammam", "Khobar", "Madinah"];
const PROPERTY_TYPES = ["Apartment", "Villa", "Penthouse", "Townhouse"] as const;
const SUPPORTED_AMENITIES = [
  "furnished",
  "elevator",
  "air_conditioning",
  "kitchen_equipped",
  "water_included",
  "electricity_included",
  "private_roof",
  "villa_style",
  "two_entrances",
  "separate_electrical_meter",
] as const;
const SUPPORTED_PREFERENCES = [
  "family_friendly",
  "near_schools",
  "near_healthcare",
  "quiet_area",
  "investment_potential",
] as const;

type Step = "input" | "understood" | "results";

export default function HomeFinderScreen() {
  const params = useLocalSearchParams<{ q?: string; transactionType?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLanguage();

  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState(params.q ?? "");
  const [hint, setHint] = useState<"rent" | "sale" | undefined>(
    params.transactionType === "sale" ? "sale" : params.transactionType === "rent" ? "rent" : undefined,
  );
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<ApiHomeFinderCriteria>(EMPTY_HOME_FINDER_CRITERIA);
  const [clarifyingQuestions, setClarifyingQuestions] = useState<string[]>([]);

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ApiHomeFinderResult[]>([]);
  const [categories, setCategories] = useState<ApiHomeFinderCategories>({});
  const [emptyResult, setEmptyResult] = useState<ApiHomeFinderEmptyResult | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const [refineInstruction, setRefineInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [lastChanges, setLastChanges] = useState<ApiHomeFinderCriteriaChange[]>([]);

  const [whyResult, setWhyResult] = useState<ApiHomeFinderResult | null>(null);
  const [history, setHistory] = useState<ApiHomeFinderHistoryItem[]>([]);

  useEffect(() => {
    if (user) fetchHomeFinderHistory().then(setHistory).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (params.q) void handleInterpret(params.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInterpret(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    setInterpreting(true);
    setInterpretError(null);
    try {
      const resp = await interpretHomeFinderQuery({
        text: trimmed,
        locale: lang === "ar" ? "ar" : "en",
        transaction_type_hint: hint ?? null,
      });
      setCriteria(resp.criteria);
      setClarifyingQuestions(resp.clarifying_questions);
      setStep("understood");
    } catch (err) {
      setInterpretError(err instanceof Error ? err.message : t("homeFinder.input.errorFailed"));
    } finally {
      setInterpreting(false);
    }
  }

  async function runSearch(nextCriteria: ApiHomeFinderCriteria) {
    setSearching(true);
    try {
      const resp = await searchHomeFinder({ criteria: nextCriteria, limit: 20, query_text: text.trim() || undefined });
      setResults(resp.results);
      setCategories(resp.categories);
      setEmptyResult(resp.empty_result);
      setStep("results");
    } finally {
      setSearching(false);
    }
  }

  async function handleRefine() {
    const instruction = refineInstruction.trim();
    if (!instruction) return;
    setRefining(true);
    try {
      const resp = await refineHomeFinderCriteria({ criteria, instruction, locale: lang === "ar" ? "ar" : "en" });
      setCriteria(resp.criteria);
      setRefineInstruction("");
      if (resp.changes.length > 0) {
        setLastChanges(resp.changes);
        await runSearch(resp.criteria);
      }
    } finally {
      setRefining(false);
    }
  }

  function applySuggestion(patch: ApiHomeFinderCriteria) {
    setCriteria(patch);
    setLastChanges([]);
    void runSearch(patch);
  }

  const toggleCompare = (id: string) =>
    setCompareIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 3 ? [...c, id] : c));

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        {step === "input" && (
          <InputStep
            text={text}
            setText={setText}
            hint={hint}
            setHint={setHint}
            interpreting={interpreting}
            error={interpretError}
            onSubmit={() => void handleInterpret(text)}
            history={history}
            onSelectHistory={(h) => {
              setText(h.query_text);
              setCriteria(h.criteria);
              setClarifyingQuestions([]);
              setStep("understood");
            }}
          />
        )}
        {step === "understood" && (
          <UnderstoodStep
            criteria={criteria}
            setCriteria={setCriteria}
            clarifyingQuestions={clarifyingQuestions}
            searching={searching}
            onFindMatches={() => void runSearch(criteria)}
            onModify={() => setStep("input")}
          />
        )}
        {step === "results" && (
          <ResultsStep
            criteria={criteria}
            results={results}
            categories={categories}
            emptyResult={emptyResult}
            view={view}
            setView={setView}
            compareIds={compareIds}
            onToggleCompare={toggleCompare}
            refineInstruction={refineInstruction}
            setRefineInstruction={setRefineInstruction}
            onRefine={() => void handleRefine()}
            refining={refining}
            lastChanges={lastChanges}
            onApplySuggestion={applySuggestion}
            onOpenWhy={setWhyResult}
            onNewSearch={() => {
              setStep("input");
              setResults([]);
              setLastChanges([]);
            }}
            searching={searching}
            onGoToCompare={() => router.push("/compare")}
          />
        )}
      </KeyboardAvoidingView>

      {whyResult && (
        <WhyThisPropertyModal result={whyResult} criteria={criteria} onClose={() => setWhyResult(null)} />
      )}
    </SafeAreaView>
  );
}

// ── Step 1 ───────────────────────────────────────────────────────────────

function InputStep({
  text,
  setText,
  hint,
  setHint,
  interpreting,
  error,
  onSubmit,
  history,
  onSelectHistory,
}: {
  text: string;
  setText: (v: string) => void;
  hint: "rent" | "sale" | undefined;
  setHint: (v: "rent" | "sale" | undefined) => void;
  interpreting: boolean;
  error: string | null;
  onSubmit: () => void;
  history: ApiHomeFinderHistoryItem[];
  onSelectHistory: (h: ApiHomeFinderHistoryItem) => void;
}) {
  const { t } = useLanguage();
  const examples =
    hint === "sale"
      ? [t("homeFinder.examples.sale1"), t("homeFinder.examples.sale2")]
      : [t("homeFinder.examples.rent1"), t("homeFinder.examples.rent2")];

  return (
    <ScrollView contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
      <View className="flex-row items-center gap-2">
        <Sparkles size={18} color={colors.ai} />
        <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("homeFinder.input.heading")}
        </Text>
      </View>
      <Text className="text-2xl font-bold tracking-tight text-foreground">{t("homeFinder.entryTitle")}</Text>
      <Text className="text-muted-foreground">{t("homeFinder.input.subheading")}</Text>

      <SegmentedControl
        options={[
          { value: "rent", label: t("homeFinder.input.rent") },
          { value: "sale", label: t("homeFinder.input.buy") },
        ]}
        value={hint ?? "rent"}
        onChange={(v) => setHint(v)}
      />

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t("homeFinder.input.placeholder")}
        placeholderTextColor={colors.mutedForeground}
        multiline
        numberOfLines={5}
        className="min-h-[110px] rounded-xl border border-border px-4 py-3 text-base text-foreground"
        textAlignVertical="top"
      />

      {error && <Text className="text-sm text-destructive">{error}</Text>}

      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={interpreting}
        disabled={!text.trim()}
        icon={!interpreting ? <Sparkles size={18} color="#FFFFFF" /> : undefined}
        onPress={onSubmit}
      >
        {interpreting ? t("homeFinder.input.thinking") : t("homeFinder.input.submit")}
      </Button>

      <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("homeFinder.examplesTitle")}
      </Text>
      {examples.map((ex) => (
        <Pressable
          key={ex}
          onPress={() => setText(ex)}
          className="rounded-xl border border-border bg-card px-4 py-3"
        >
          <Text className="text-sm text-foreground">{ex}</Text>
        </Pressable>
      ))}

      {history.length > 0 && (
        <>
          <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("homeFinder.history.heading")}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {history.map((h) => (
              <Pressable
                key={h.id}
                onPress={() => onSelectHistory(h)}
                className="rounded-full border border-border bg-card px-3 py-1.5"
              >
                <Text className="text-xs font-medium text-foreground">{h.query_text}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Link href="/search" asChild>
        <Pressable className="mt-2 items-center py-2">
          <Text className="text-sm font-semibold text-foreground">{t("homeFinder.searchNormally")}</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

// ── Step 2 ───────────────────────────────────────────────────────────────

function CriterionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-4">
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}

function UnderstoodStep({
  criteria,
  setCriteria,
  clarifyingQuestions,
  searching,
  onFindMatches,
  onModify,
}: {
  criteria: ApiHomeFinderCriteria;
  setCriteria: (c: ApiHomeFinderCriteria) => void;
  clarifyingQuestions: string[];
  searching: boolean;
  onFindMatches: () => void;
  onModify: () => void;
}) {
  const { t } = useLanguage();

  function update(patch: Partial<ApiHomeFinderCriteria>) {
    setCriteria({ ...criteria, ...patch });
  }

  function toggleAmenity(key: string) {
    update({
      required_amenities: criteria.required_amenities.includes(key)
        ? criteria.required_amenities.filter((k) => k !== key)
        : [...criteria.required_amenities, key],
    });
  }

  function togglePreference(key: string) {
    update({
      preferences: criteria.preferences.includes(key)
        ? criteria.preferences.filter((k) => k !== key)
        : [...criteria.preferences, key],
    });
  }

  function toggleDistrict(d: string) {
    update({
      districts: criteria.districts.includes(d)
        ? criteria.districts.filter((x) => x !== d)
        : [...criteria.districts, d],
    });
  }

  const districtOptions = districtsByCity[criteria.city ?? "Riyadh"] ?? [];

  return (
    <ScrollView contentContainerClassName="gap-4 p-5">
      <View className="flex-row items-center gap-2">
        <Sparkles size={18} color={colors.ai} />
        <Text className="text-xl font-bold tracking-tight text-foreground">{t("homeFinder.understood.heading")}</Text>
      </View>

      {clarifyingQuestions.length > 0 && (
        <View className="gap-1 rounded-2xl border border-warning bg-warning/10 p-4">
          <Text className="text-sm font-semibold text-foreground">{t("homeFinder.understood.clarifyingQuestions")}</Text>
          {clarifyingQuestions.map((q) => (
            <Text key={q} className="text-sm text-muted-foreground">
              • {q}
            </Text>
          ))}
        </View>
      )}

      <CriterionCard label={t("homeFinder.understood.purpose")}>
        <SegmentedControl
          options={[
            { value: "rent", label: t("homeFinder.understood.rentLabel") },
            { value: "sale", label: t("homeFinder.understood.saleLabel") },
          ]}
          value={criteria.transaction_type ?? "rent"}
          onChange={(v) => update({ transaction_type: v })}
        />
      </CriterionCard>

      <CriterionCard label={t("homeFinder.understood.city")}>
        <View className="flex-row flex-wrap gap-2">
          {CITIES.map((c) => (
            <Chip key={c} selected={criteria.city === c} onPress={() => update({ city: c, districts: [] })}>
              {c}
            </Chip>
          ))}
        </View>
      </CriterionCard>

      <CriterionCard label={t("homeFinder.understood.budget")}>
        <TextInput
          value={criteria.max_price != null ? String(criteria.max_price) : ""}
          onChangeText={(v) => update({ max_price: v ? Number(v) : null })}
          placeholder={t("homeFinder.understood.anyBudget")}
          keyboardType="numeric"
          placeholderTextColor={colors.mutedForeground}
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
        <Text className="text-xs text-muted-foreground">
          {criteria.max_price
            ? criteria.transaction_type === "sale"
              ? t("homeFinder.understood.upTo", { amount: formatSAR(criteria.max_price) })
              : t("homeFinder.understood.upToPerYear", { amount: formatSAR(criteria.max_price) })
            : t("homeFinder.understood.anyBudget")}
        </Text>
      </CriterionCard>

      <CriterionCard label={t("homeFinder.understood.bedrooms")}>
        <TextInput
          value={criteria.bedrooms != null ? String(criteria.bedrooms) : ""}
          onChangeText={(v) => update({ bedrooms: v ? Number(v) : null })}
          keyboardType="numeric"
          placeholderTextColor={colors.mutedForeground}
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
      </CriterionCard>

      {districtOptions.length > 0 && (
        <CriterionCard label={t("homeFinder.understood.preferredAreas")}>
          <View className="flex-row flex-wrap gap-2">
            {districtOptions.map((d) => (
              <Chip key={d} selected={criteria.districts.includes(d)} onPress={() => toggleDistrict(d)}>
                {d}
              </Chip>
            ))}
          </View>
        </CriterionCard>
      )}

      <CriterionCard label={t("homeFinder.understood.commute")}>
        <TextInput
          value={criteria.commute_destination ?? ""}
          onChangeText={(v) => update({ commute_destination: v || null })}
          placeholder="KAFD"
          placeholderTextColor={colors.mutedForeground}
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
      </CriterionCard>

      <CriterionCard label={t("homeFinder.understood.propertyType")}>
        <View className="flex-row flex-wrap gap-2">
          {PROPERTY_TYPES.map((pt) => (
            <Chip key={pt} selected={criteria.property_type === pt} onPress={() => update({ property_type: pt })}>
              {t(`propertyTypes.${pt}`)}
            </Chip>
          ))}
        </View>
      </CriterionCard>

      <CriterionCard label={t("homeFinder.understood.mustHave")}>
        <View className="flex-row flex-wrap gap-2">
          {SUPPORTED_AMENITIES.map((a) => (
            <Chip key={a} selected={criteria.required_amenities.includes(a)} onPress={() => toggleAmenity(a)}>
              {t(`homeFinder.amenities.${a}`)}
            </Chip>
          ))}
        </View>
        {criteria.unsupported_requests.length > 0 && (
          <Text className="text-xs text-muted-foreground">
            {criteria.unsupported_requests.join(", ")} — {t("homeFinder.understood.notTracked")}
          </Text>
        )}
      </CriterionCard>

      <CriterionCard label={t("homeFinder.understood.lifestyle")}>
        <View className="flex-row flex-wrap gap-2">
          {SUPPORTED_PREFERENCES.map((p) => (
            <Chip key={p} selected={criteria.preferences.includes(p)} onPress={() => togglePreference(p)}>
              {t(`homeFinder.preferences.${p}`)}
            </Chip>
          ))}
        </View>
      </CriterionCard>

      <View className="flex-row gap-3 pb-6">
        <Button variant="outline" icon={<ArrowLeft size={16} color={colors.foreground} />} onPress={onModify}>
          {t("homeFinder.understood.modify")}
        </Button>
        <View className="flex-1">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={searching}
            icon={!searching ? <Sparkles size={18} color="#FFFFFF" /> : undefined}
            onPress={onFindMatches}
          >
            {t("homeFinder.understood.findMatches")}
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

// ── Step 3 ───────────────────────────────────────────────────────────────

function ResultsStep({
  criteria,
  results,
  categories,
  emptyResult,
  view,
  setView,
  compareIds,
  onToggleCompare,
  refineInstruction,
  setRefineInstruction,
  onRefine,
  refining,
  lastChanges,
  onApplySuggestion,
  onOpenWhy,
  onNewSearch,
  searching,
  onGoToCompare,
}: {
  criteria: ApiHomeFinderCriteria;
  results: ApiHomeFinderResult[];
  categories: ApiHomeFinderCategories;
  emptyResult: ApiHomeFinderEmptyResult | null;
  view: "list" | "map";
  setView: (v: "list" | "map") => void;
  compareIds: string[];
  onToggleCompare: (id: string) => void;
  refineInstruction: string;
  setRefineInstruction: (v: string) => void;
  onRefine: () => void;
  refining: boolean;
  lastChanges: ApiHomeFinderCriteriaChange[];
  onApplySuggestion: (patch: ApiHomeFinderCriteria) => void;
  onOpenWhy: (r: ApiHomeFinderResult) => void;
  onNewSearch: () => void;
  searching: boolean;
  onGoToCompare: () => void;
}) {
  const { t } = useLanguage();
  const mapProperties = results.map((r) => {
    const p = mapApiSearchProperty(r.property);
    return { ...p, matchScore: r.match_score, reasons: r.reasons };
  });

  if (searching) {
    return (
      <View className="flex-1 items-center justify-center gap-3">
        <ActivityIndicator color={colors.primary} />
        <Text className="text-sm text-muted-foreground">{t("homeFinder.results.loading")}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-4 p-5">
      <Pressable onPress={onNewSearch} className="flex-row items-center gap-1">
        <ArrowLeft size={14} color={colors.mutedForeground} />
        <Text className="text-xs text-muted-foreground">{t("homeFinder.results.newSearch")}</Text>
      </Pressable>
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-xl font-bold tracking-tight text-foreground">{t("homeFinder.results.heading")}</Text>
          <Text className="text-sm text-muted-foreground">
            {t("homeFinder.results.matchesCount", { count: results.length })}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          icon={<MapIcon size={16} color={colors.foreground} />}
          onPress={() => setView(view === "list" ? "map" : "list")}
        >
          {view === "list" ? t("homeFinder.results.viewOnMap") : t("homeFinder.results.backToList")}
        </Button>
      </View>

      {lastChanges.length > 0 && (
        <View className="gap-1 rounded-xl border border-primary/30 bg-primary/10 p-3">
          <Text className="text-sm font-semibold text-foreground">{t("homeFinder.results.updatedSearch")}</Text>
          {lastChanges.map((c, i) => (
            <Text key={i} className="text-sm text-muted-foreground">
              {c.field}: {c.from} → {c.to}
            </Text>
          ))}
        </View>
      )}

      {emptyResult && (
        <View className="gap-2 rounded-2xl border border-warning bg-warning/10 p-4">
          <View className="flex-row items-center gap-2">
            <TriangleAlert size={16} color={colors.warning} />
            <Text className="flex-1 font-semibold text-foreground">{t("homeFinder.empty.heading")}</Text>
          </View>
          {emptyResult.suggestions.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => onApplySuggestion(s.criteria_patch)}
              className="rounded-xl border border-border bg-card px-3 py-2"
            >
              <Text className="text-xs font-semibold text-foreground">{s.label}</Text>
              <Text className="text-xs text-muted-foreground">
                {t("homeFinder.empty.possibleProperties", { count: s.estimated_count })}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {view === "map" ? (
        <View style={{ height: 420 }}>
          <PropertyMapView properties={mapProperties} />
        </View>
      ) : (
        results.map((r) => (
          <MatchCard
            key={r.property.id}
            result={r}
            criteria={criteria}
            inCompare={compareIds.includes(String(r.property.id))}
            onToggleCompare={() => onToggleCompare(String(r.property.id))}
            onOpenWhy={() => onOpenWhy(r)}
          />
        ))
      )}

      {compareIds.length >= 2 && (
        <Button variant="secondary" fullWidth icon={<GitCompare size={16} color={colors.secondaryForeground} />} onPress={onGoToCompare}>
          {`${t("homeFinder.results.compare")} (${compareIds.length})`}
        </Button>
      )}

      <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-card p-2">
        <TextInput
          value={refineInstruction}
          onChangeText={setRefineInstruction}
          placeholder={t("homeFinder.results.refinePlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          className="flex-1 px-2 py-2 text-foreground"
        />
        <Button variant="primary" size="sm" loading={refining} disabled={!refineInstruction.trim()} onPress={onRefine}>
          {t("homeFinder.results.refineSubmit")}
        </Button>
      </View>
    </ScrollView>
  );
}

function MatchCard({
  result,
  criteria,
  inCompare,
  onToggleCompare,
  onOpenWhy,
}: {
  result: ApiHomeFinderResult;
  criteria: ApiHomeFinderCriteria;
  inCompare: boolean;
  onToggleCompare: () => void;
  onOpenWhy: () => void;
}) {
  const { t } = useLanguage();
  const uiProperty: Property = { ...mapApiProperty(result.property), matchScore: result.match_score };

  function askAiQuestion(): string {
    const parts: string[] = [];
    if (criteria.bedrooms) parts.push(`${criteria.bedrooms}-bedroom`);
    parts.push(criteria.property_type ?? "property");
    if (criteria.city) parts.push(`in ${criteria.city}`);
    return `I'm looking for a ${parts.join(" ")}. Tell me more about ${uiProperty.title} — is it a good fit for me?`;
  }

  return (
    <View className="gap-0">
      <PropertyCard p={uiProperty} />
      <View className="gap-2 rounded-b-2xl border border-t-0 border-border bg-card p-4">
        {result.reasons.slice(0, 3).map((r) => (
          <View key={r} className="flex-row items-start gap-1.5">
            <CheckCircle2 size={14} color={colors.success} />
            <Text className="flex-1 text-xs text-muted-foreground">{r}</Text>
          </View>
        ))}
        {result.trade_offs[0] && (
          <View className="flex-row items-start gap-1.5">
            <TriangleAlert size={14} color={colors.warning} />
            <Text className="flex-1 text-xs text-muted-foreground">{result.trade_offs[0]}</Text>
          </View>
        )}
        <View className="mt-1 flex-row flex-wrap gap-2">
          <Button variant="outline" size="sm" onPress={onOpenWhy}>
            {t("homeFinder.results.whyThisProperty")}
          </Button>
          <Button
            variant={inCompare ? "secondary" : "outline"}
            size="sm"
            icon={<GitCompare size={14} color={inCompare ? colors.secondaryForeground : colors.foreground} />}
            onPress={onToggleCompare}
          >
            {inCompare ? t("homeFinder.results.added") : t("homeFinder.results.compare")}
          </Button>
          <Link href={{ pathname: "/advisor", params: { propertyId: result.property.id, q: askAiQuestion() } }} asChild>
            <Button variant="ghost" size="sm" icon={<MessageCircle size={14} color={colors.foreground} />}>
              {t("homeFinder.results.askAI")}
            </Button>
          </Link>
        </View>
      </View>
    </View>
  );
}

// ── Why this property? ──────────────────────────────────────────────────

function WhyThisPropertyModal({
  result,
  criteria,
  onClose,
}: {
  result: ApiHomeFinderResult;
  criteria: ApiHomeFinderCriteria;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const uiProperty = mapApiProperty(result.property);
  const [summary, setSummary] = useState<string | null>(null);
  const [areaIntel, setAreaIntel] = useState<ApiAreaIntelligence | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      explainHomeFinderMatch({ criteria, property_id: result.property.id }),
      fetchAreaIntelligence(result.property.area, result.property.city),
    ]).then(([explainRes, areaRes]) => {
      if (cancelled) return;
      if (explainRes.status === "fulfilled") setSummary(explainRes.value.summary);
      if (areaRes.status === "fulfilled") setAreaIntel(areaRes.value);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.property.id]);

  const priceInsight = (() => {
    if (criteria.max_price == null) return null;
    const within = uiProperty.price <= criteria.max_price;
    return within
      ? `Within your budget (SAR ${formatSAR(uiProperty.price)} vs your SAR ${formatSAR(criteria.max_price)} max).`
      : `Above your budget (SAR ${formatSAR(uiProperty.price)} vs your SAR ${formatSAR(criteria.max_price)} max).`;
  })();

  return (
    <BottomSheet visible onClose={onClose}>
      <ScrollView contentContainerClassName="gap-3 p-5" style={{ maxHeight: 560 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-bold text-foreground">{t("homeFinder.results.whyThisProperty")}</Text>
          <Pressable onPress={onClose}>
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <Text className="text-2xl font-bold text-foreground">{`${result.match_score}% ${t("homeFinder.whyModal.match")}`}</Text>

        <Text className="text-sm text-foreground">{loading ? t("homeFinder.whyModal.loading") : summary}</Text>

        {result.reasons.length > 0 && (
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("homeFinder.whyModal.strongPoints")}
            </Text>
            {result.reasons.map((r) => (
              <View key={r} className="flex-row items-start gap-1.5">
                <CheckCircle2 size={14} color={colors.success} />
                <Text className="flex-1 text-sm text-foreground">{r}</Text>
              </View>
            ))}
          </View>
        )}

        {result.trade_offs.length > 0 && (
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("homeFinder.whyModal.tradeOffs")}
            </Text>
            {result.trade_offs.map((r) => (
              <View key={r} className="flex-row items-start gap-1.5">
                <TriangleAlert size={14} color={colors.warning} />
                <Text className="flex-1 text-sm text-foreground">{r}</Text>
              </View>
            ))}
          </View>
        )}

        {areaIntel && (
          <View className="gap-1 rounded-xl border border-border bg-surface p-3">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("homeFinder.whyModal.areaInsight")}
            </Text>
            <Text className="text-sm text-foreground">
              {areaIntel.area_name}: {areaIntel.area_score != null ? Math.round(areaIntel.area_score) : "—"}/100
            </Text>
            {areaIntel.overview && <Text className="text-xs text-muted-foreground">{areaIntel.overview}</Text>}
          </View>
        )}

        {priceInsight && (
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("homeFinder.whyModal.priceInsight")}
            </Text>
            <Text className="text-sm text-foreground">{priceInsight}</Text>
          </View>
        )}

        <Link
          href={{
            pathname: "/advisor",
            params: { propertyId: result.property.id, q: `Tell me more about ${uiProperty.title} — is it a good fit for me?` },
          }}
          asChild
        >
          <Button variant="primary" fullWidth icon={<MessageCircle size={16} color="#FFFFFF" />} onPress={onClose}>
            {t("homeFinder.whyModal.continueToAdvisor")}
          </Button>
        </Link>
      </ScrollView>
    </BottomSheet>
  );
}
