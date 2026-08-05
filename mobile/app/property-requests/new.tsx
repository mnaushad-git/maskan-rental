import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { X, Plus, Sparkles } from "lucide-react-native";
import {
  createPropertyRequest,
  createPropertyRequestFromText,
  updatePropertyRequest,
  fetchPropertyRequest,
  requestPropertyRequestClarifications,
  answerPropertyRequestClarification,
  previewPropertyRequestMatches,
  fetchPropertyRequestAreaSuggestions,
  activatePropertyRequest,
  type ApiPropertyRequest,
  type ApiClarification,
  type ApiPropertyRequestMatch,
  type ApiAreaSuggestion,
  type PropertyRequestInput,
  type PropertyRequestFieldName,
  type MediatorPreference,
  type AlertFrequency,
} from "@/lib/api/maskan";
import { districtsByCity } from "@/lib/maskan-search-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { colors } from "@/lib/colors";
import { cityLabel } from "./index";

type Mode = "describe" | "form";

type FormState = {
  title: string;
  description: string;
  transactionType: "rent" | "sale" | null;
  propertyCategory: string | null;
  city: string | null;
  preferredDistricts: string[];
  excludedDistricts: string[];
  minPrice: string;
  maxPrice: string;
  bedroomsMin: string;
  bedroomsMax: string;
  bathroomsMin: string;
  bathroomsMax: string;
  minArea: string;
  maxArea: string;
  furnishing: string | null;
  requiredAmenities: string[];
  preferredAmenities: string[];
  propertyAgePreference: string;
  availabilityDate: string;
  moveInDate: string;
  rentalPaymentFrequency: string | null;
  mediatorPreference: MediatorPreference;
  verifiedOnly: boolean;
  maxCommuteMinutes: string;
  commuteDestinationName: string;
  schoolPreference: boolean;
  hospitalPreference: boolean;
  lifestylePreferences: string[];
  familySize: string;
  householdType: string;
  accessibilityRequirements: string[];
  petPreference: string;
  notes: string;
  alertFrequency: AlertFrequency;
  matchingEnabled: boolean;
  mediatorResponsesEnabled: boolean;
};

const DEFAULT_FORM: FormState = {
  title: "",
  description: "",
  transactionType: null,
  propertyCategory: null,
  city: null,
  preferredDistricts: [],
  excludedDistricts: [],
  minPrice: "",
  maxPrice: "",
  bedroomsMin: "",
  bedroomsMax: "",
  bathroomsMin: "",
  bathroomsMax: "",
  minArea: "",
  maxArea: "",
  furnishing: null,
  requiredAmenities: [],
  preferredAmenities: [],
  propertyAgePreference: "",
  availabilityDate: "",
  moveInDate: "",
  rentalPaymentFrequency: null,
  mediatorPreference: "either",
  verifiedOnly: false,
  maxCommuteMinutes: "",
  commuteDestinationName: "",
  schoolPreference: false,
  hospitalPreference: false,
  lifestylePreferences: [],
  familySize: "",
  householdType: "",
  accessibilityRequirements: [],
  petPreference: "",
  notes: "",
  alertFrequency: "instant",
  matchingEnabled: true,
  mediatorResponsesEnabled: true,
};

export const PRIORITY_FIELDS: PropertyRequestFieldName[] = [
  "transaction_type",
  "city",
  "max_price",
  "min_price",
  "bedrooms_min",
  "bedrooms_max",
  "bathrooms_min",
  "bathrooms_max",
  "min_area_sq_m",
  "max_area_sq_m",
  "furnishing",
  "property_category",
  "verified_only",
  "preferred_districts",
];

export const FIELD_LABEL_KEY: Record<PropertyRequestFieldName, string> = {
  transaction_type: "propertyRequest.form.transactionType",
  city: "propertyRequest.form.city",
  max_price: "propertyRequest.form.maxPrice",
  min_price: "propertyRequest.form.minPrice",
  bedrooms_min: "propertyRequest.form.bedroomsMin",
  bedrooms_max: "propertyRequest.form.bedroomsMax",
  bathrooms_min: "propertyRequest.form.bathroomsMin",
  bathrooms_max: "propertyRequest.form.bathroomsMax",
  min_area_sq_m: "propertyRequest.form.minArea",
  max_area_sq_m: "propertyRequest.form.maxArea",
  furnishing: "propertyRequest.form.furnishing",
  property_category: "propertyRequest.form.propertyCategory",
  verified_only: "propertyRequest.form.verifiedOnly",
  preferred_districts: "propertyRequest.form.preferredDistricts",
};

const PROPERTY_CATEGORIES = ["Apartment", "Villa", "Townhouse", "Studio", "Penthouse"];
const FURNISHING_OPTIONS = ["Furnished", "Semi-furnished", "Unfurnished"];
const PAYMENT_FREQUENCIES = ["annual", "semi_annual", "quarterly", "monthly"];
const PAYMENT_FREQUENCY_KEY: Record<string, string> = {
  annual: "property.rentCalculator.annual",
  semi_annual: "property.rentCalculator.semiAnnual",
  quarterly: "property.rentCalculator.quarterly",
  monthly: "property.rentCalculator.monthly",
};
const CITIES = ["Riyadh", "Jeddah", "Dammam", "Khobar", "Madinah"];

type SectionKey =
  | "basics"
  | "location"
  | "budget"
  | "specs"
  | "lifestyle"
  | "commute"
  | "facilities"
  | "priorities"
  | "alerts"
  | "privacy";

const SECTIONS: SectionKey[] = [
  "basics",
  "location",
  "budget",
  "specs",
  "lifestyle",
  "commute",
  "facilities",
  "priorities",
  "alerts",
  "privacy",
];

function numOrUndef(s: string): number | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function buildPayload(form: FormState, priorities: Partial<Record<PropertyRequestFieldName, "must" | "nice" | "flex">>, locale: "en" | "ar"): PropertyRequestInput {
  const must_have_fields = PRIORITY_FIELDS.filter((f) => priorities[f] === "must");
  const nice_to_have_fields = PRIORITY_FIELDS.filter((f) => priorities[f] === "nice");
  const flexible_fields = PRIORITY_FIELDS.filter((f) => priorities[f] === "flex");
  return {
    title: form.title.trim() || "Untitled request",
    description: form.description.trim() || undefined,
    locale,
    transaction_type: form.transactionType,
    property_category: form.propertyCategory,
    city: form.city,
    preferred_districts: form.preferredDistricts,
    excluded_districts: form.excludedDistricts,
    min_price: numOrUndef(form.minPrice) ?? null,
    max_price: numOrUndef(form.maxPrice) ?? null,
    bedrooms_min: numOrUndef(form.bedroomsMin) ?? null,
    bedrooms_max: numOrUndef(form.bedroomsMax) ?? null,
    bathrooms_min: numOrUndef(form.bathroomsMin) ?? null,
    bathrooms_max: numOrUndef(form.bathroomsMax) ?? null,
    min_area_sq_m: numOrUndef(form.minArea) ?? null,
    max_area_sq_m: numOrUndef(form.maxArea) ?? null,
    furnishing: form.furnishing,
    required_amenities: form.requiredAmenities,
    preferred_amenities: form.preferredAmenities,
    property_age_preference: form.propertyAgePreference.trim() || undefined,
    availability_date: form.availabilityDate.trim() || undefined,
    move_in_date: form.moveInDate.trim() || undefined,
    rental_payment_frequency: form.rentalPaymentFrequency,
    mediator_preference: form.mediatorPreference,
    verified_only: form.verifiedOnly,
    max_commute_minutes: numOrUndef(form.maxCommuteMinutes) ?? null,
    commute_destination_name: form.commuteDestinationName.trim() || undefined,
    school_preference: form.schoolPreference,
    hospital_preference: form.hospitalPreference,
    lifestyle_preferences: form.lifestylePreferences,
    family_size: numOrUndef(form.familySize) ?? null,
    household_type: form.householdType.trim() || undefined,
    accessibility_requirements: form.accessibilityRequirements,
    pet_preference: form.petPreference.trim() || undefined,
    notes: form.notes.trim() || undefined,
    must_have_fields,
    nice_to_have_fields,
    flexible_fields,
    matching_enabled: form.matchingEnabled,
    mediator_responses_enabled: form.mediatorResponsesEnabled,
    alert_frequency: form.alertFrequency,
  };
}

function formFromApi(r: ApiPropertyRequest): FormState {
  return {
    title: r.title ?? "",
    description: r.description ?? "",
    transactionType: r.transaction_type ?? null,
    propertyCategory: r.property_category ?? null,
    city: r.city ?? null,
    preferredDistricts: r.preferred_districts ?? [],
    excludedDistricts: r.excluded_districts ?? [],
    minPrice: r.min_price != null ? String(r.min_price) : "",
    maxPrice: r.max_price != null ? String(r.max_price) : "",
    bedroomsMin: r.bedrooms_min != null ? String(r.bedrooms_min) : "",
    bedroomsMax: r.bedrooms_max != null ? String(r.bedrooms_max) : "",
    bathroomsMin: r.bathrooms_min != null ? String(r.bathrooms_min) : "",
    bathroomsMax: r.bathrooms_max != null ? String(r.bathrooms_max) : "",
    minArea: r.min_area_sq_m != null ? String(r.min_area_sq_m) : "",
    maxArea: r.max_area_sq_m != null ? String(r.max_area_sq_m) : "",
    furnishing: r.furnishing ?? null,
    requiredAmenities: r.required_amenities ?? [],
    preferredAmenities: r.preferred_amenities ?? [],
    propertyAgePreference: r.property_age_preference ?? "",
    availabilityDate: r.availability_date ?? "",
    moveInDate: r.move_in_date ?? "",
    rentalPaymentFrequency: r.rental_payment_frequency ?? null,
    mediatorPreference: r.mediator_preference ?? "either",
    verifiedOnly: r.verified_only ?? false,
    maxCommuteMinutes: r.max_commute_minutes != null ? String(r.max_commute_minutes) : "",
    commuteDestinationName: r.commute_destination_name ?? "",
    schoolPreference: r.school_preference ?? false,
    hospitalPreference: r.hospital_preference ?? false,
    lifestylePreferences: r.lifestyle_preferences ?? [],
    familySize: r.family_size != null ? String(r.family_size) : "",
    householdType: r.household_type ?? "",
    accessibilityRequirements: r.accessibility_requirements ?? [],
    petPreference: r.pet_preference ?? "",
    notes: r.notes ?? "",
    alertFrequency: r.alert_frequency ?? "instant",
    matchingEnabled: r.matching_enabled ?? true,
    mediatorResponsesEnabled: r.mediator_responses_enabled ?? true,
  };
}

function priorityFromApi(r: ApiPropertyRequest): Partial<Record<PropertyRequestFieldName, "must" | "nice" | "flex">> {
  const map: Partial<Record<PropertyRequestFieldName, "must" | "nice" | "flex">> = {};
  for (const f of r.must_have_fields ?? []) map[f] = "must";
  for (const f of r.nice_to_have_fields ?? []) map[f] = "nice";
  for (const f of r.flexible_fields ?? []) map[f] = "flex";
  return map;
}

function FieldLabel({ children }: { children: string }) {
  return <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</Text>;
}

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "phone-pad";
  multiline?: boolean;
}) {
  return (
    <View className="gap-1">
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : undefined}
        className="rounded-xl border border-border px-4 py-3 text-foreground"
      />
    </View>
  );
}

function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <View className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          onSubmitEditing={add}
          className="flex-1 rounded-xl border border-border px-4 py-3 text-foreground"
        />
        <Pressable onPress={add} className="size-11 items-center justify-center rounded-xl bg-primary">
          <Plus size={18} color="#FFFFFF" />
        </Pressable>
      </View>
      {values.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {values.map((v) => (
            <View key={v} className="flex-row items-center gap-1.5 rounded-full bg-surface-2 py-1.5 pe-2 ps-3">
              <Text className="text-xs font-medium text-foreground">{v}</Text>
              <Pressable onPress={() => onChange(values.filter((x) => x !== v))} hitSlop={6}>
                <X size={12} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Text className="text-[11px] text-muted-foreground">{t("propertyRequest.form.add")}: ↵</Text>
    </View>
  );
}

export default function NewPropertyRequestScreen() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const editing = !!editId;

  const [mode, setMode] = useState<Mode>(editing ? "form" : "describe");
  const [requestId, setRequestId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [priorities, setPriorities] = useState<Partial<Record<PropertyRequestFieldName, "must" | "nice" | "flex">>>({});
  const [step, setStep] = useState(0);
  const [loadingExisting, setLoadingExisting] = useState(editing);

  useEffect(() => {
    if (!editId) return;
    const numId = Number(editId);
    if (Number.isNaN(numId)) {
      setLoadingExisting(false);
      return;
    }
    fetchPropertyRequest(numId)
      .then((r) => {
        setRequestId(r.id);
        setForm(formFromApi(r));
        setPriorities(priorityFromApi(r));
      })
      .catch(() => {
        toast(t("propertyRequest.detail.loadFailed"), "error");
      })
      .finally(() => setLoadingExisting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Describe-mode state
  const [describeText, setDescribeText] = useState("");
  const [describeSubmitting, setDescribeSubmitting] = useState(false);
  const [describeResult, setDescribeResult] = useState<{ confidence: number; missing: string[] } | null>(null);
  const [clarifications, setClarifications] = useState<ApiClarification[]>([]);
  const [clarificationsLoading, setClarificationsLoading] = useState(false);
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({});
  const [answeringId, setAnsweringId] = useState<number | null>(null);
  const [describeError, setDescribeError] = useState<string | null>(null);

  // Review-step state
  const [savingDraft, setSavingDraft] = useState(false);
  const [previewMatches, setPreviewMatches] = useState<ApiPropertyRequestMatch[]>([]);
  const [areaSuggestions, setAreaSuggestions] = useState<ApiAreaSuggestion[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function cyclePriority(field: PropertyRequestFieldName, value: "must" | "nice" | "flex") {
    setPriorities((prev) => ({ ...prev, [field]: prev[field] === value ? undefined : value }));
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("propertyRequest.list.newRequest") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("leadNew.signInGate.heading")}</Text>
        <Text className="text-center text-sm text-muted-foreground">{t("leadNew.signInGate.desc")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("leadNew.signInGate.cta")}</Button>
      </SafeAreaView>
    );
  }

  if (loadingExisting) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: t("propertyRequest.detail.criteria.edit") }} />
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  async function submitDescribe() {
    if (!describeText.trim() || describeSubmitting) return;
    setDescribeSubmitting(true);
    setDescribeError(null);
    try {
      const res = await createPropertyRequestFromText(describeText.trim(), lang);
      setRequestId(res.draft.id);
      setForm(formFromApi(res.draft));
      setPriorities(priorityFromApi(res.draft));
      setDescribeResult({ confidence: res.ai_confidence, missing: res.missing_fields });
      if (res.clarifying_questions.length > 0) {
        setClarificationsLoading(true);
        try {
          const cl = await requestPropertyRequestClarifications(res.draft.id);
          setClarifications(cl);
        } catch {
          /* clarifications are a nice-to-have here — user can still continue to review */
        } finally {
          setClarificationsLoading(false);
        }
      }
    } catch {
      setDescribeError(t("propertyRequest.new.describe.failedToSubmit"));
    } finally {
      setDescribeSubmitting(false);
    }
  }

  async function submitAnswer(c: ApiClarification) {
    if (!requestId) return;
    const answer = (answerDrafts[c.id] ?? "").trim();
    if (!answer) return;
    setAnsweringId(c.id);
    try {
      const updated = await answerPropertyRequestClarification(requestId, c.id, answer);
      setClarifications((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch {
      toast(t("propertyRequest.new.describe.failedToAnswer"), "error");
    } finally {
      setAnsweringId(null);
    }
  }

  async function ensureSaved(): Promise<number | null> {
    setSavingDraft(true);
    setReviewError(null);
    try {
      const payload = buildPayload(form, priorities, lang);
      if (requestId) {
        const updated = await updatePropertyRequest(requestId, payload);
        setForm(formFromApi(updated));
        return updated.id;
      }
      const created = await createPropertyRequest(payload);
      setRequestId(created.id);
      setForm(formFromApi(created));
      return created.id;
    } catch {
      setReviewError(t("propertyRequest.new.review.failedToCreate"));
      return null;
    } finally {
      setSavingDraft(false);
    }
  }

  async function goToReview() {
    if (editing) {
      const id = await ensureSaved();
      if (id) {
        toast(t("propertyRequest.new.review.updated"), "success");
        router.replace(`/property-requests/${id}`);
      }
      return;
    }
    const id = await ensureSaved();
    setStep(SECTIONS.length);
    if (!id) return;
    setPreviewLoading(true);
    try {
      const [matches, areas] = await Promise.all([
        previewPropertyRequestMatches(id).catch(() => []),
        fetchPropertyRequestAreaSuggestions(id).catch(() => []),
      ]);
      setPreviewMatches(matches);
      setAreaSuggestions(areas);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleActivate() {
    if (!requestId || activating) return;
    setActivating(true);
    setReviewError(null);
    try {
      await activatePropertyRequest(requestId);
      toast(t("propertyRequest.new.review.activated"), "success");
      router.replace(`/property-requests/${requestId}`);
    } catch {
      setReviewError(t("propertyRequest.new.review.failedToActivate"));
    } finally {
      setActivating(false);
    }
  }

  async function handleSaveDraft() {
    const id = await ensureSaved();
    if (id) router.replace(`/property-requests/${id}`);
  }

  const districts = form.city ? districtsByCity[form.city] ?? [] : [];

  function renderSection(key: SectionKey) {
    switch (key) {
      case "basics":
        return (
          <View className="gap-4">
            <TextField
              label={t("propertyRequest.form.title")}
              value={form.title}
              onChangeText={(v) => update("title", v)}
              placeholder={t("propertyRequest.form.titlePlaceholder")}
            />
            <TextField
              label={t("propertyRequest.form.description")}
              value={form.description}
              onChangeText={(v) => update("description", v)}
              placeholder={t("propertyRequest.form.descriptionPlaceholder")}
              multiline
            />
            <View className="gap-1.5">
              <FieldLabel>{t("propertyRequest.form.transactionType")}</FieldLabel>
              <View className="flex-row gap-2">
                <Chip selected={form.transactionType === "rent"} onPress={() => update("transactionType", "rent")}>
                  {t("propertyRequest.form.rent")}
                </Chip>
                <Chip selected={form.transactionType === "sale"} onPress={() => update("transactionType", "sale")}>
                  {t("propertyRequest.form.sale")}
                </Chip>
              </View>
            </View>
            <View className="gap-1.5">
              <FieldLabel>{t("propertyRequest.form.propertyCategory")}</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {PROPERTY_CATEGORIES.map((c) => (
                  <Chip
                    key={c}
                    selected={form.propertyCategory === c}
                    onPress={() => update("propertyCategory", form.propertyCategory === c ? null : c)}
                  >
                    {t(`propertyTypes.${c}`)}
                  </Chip>
                ))}
              </View>
            </View>
          </View>
        );
      case "location":
        return (
          <View className="gap-4">
            <View className="gap-1.5">
              <FieldLabel>{t("propertyRequest.form.city")}</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {CITIES.map((c) => (
                  <Chip
                    key={c}
                    selected={form.city === c}
                    onPress={() => update("city", form.city === c ? null : c)}
                  >
                    {cityLabel(c, t)}
                  </Chip>
                ))}
              </View>
            </View>
            {districts.length > 0 && (
              <View className="gap-1.5">
                <FieldLabel>{t("propertyRequest.form.preferredDistricts")}</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {districts.map((d) => {
                    const selected = form.preferredDistricts.includes(d);
                    return (
                      <Chip
                        key={d}
                        selected={selected}
                        onPress={() =>
                          update(
                            "preferredDistricts",
                            selected ? form.preferredDistricts.filter((x) => x !== d) : [...form.preferredDistricts, d],
                          )
                        }
                      >
                        {d}
                      </Chip>
                    );
                  })}
                </View>
              </View>
            )}
            <TagInput
              label={t("propertyRequest.form.excludedDistricts")}
              values={form.excludedDistricts}
              onChange={(v) => update("excludedDistricts", v)}
              placeholder={t("propertyRequest.form.excludedDistrictsPlaceholder")}
            />
          </View>
        );
      case "budget":
        return (
          <View className="gap-4">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField
                  label={t("propertyRequest.form.minPrice")}
                  value={form.minPrice}
                  onChangeText={(v) => update("minPrice", v)}
                  keyboardType="numeric"
                />
              </View>
              <View className="flex-1">
                <TextField
                  label={t("propertyRequest.form.maxPrice")}
                  value={form.maxPrice}
                  onChangeText={(v) => update("maxPrice", v)}
                  keyboardType="numeric"
                />
              </View>
            </View>
            {form.transactionType !== "sale" && (
              <View className="gap-1.5">
                <FieldLabel>{t("propertyRequest.form.paymentFrequency")}</FieldLabel>
                <View className="flex-row flex-wrap gap-2">
                  {PAYMENT_FREQUENCIES.map((f) => (
                    <Chip
                      key={f}
                      selected={form.rentalPaymentFrequency === f}
                      onPress={() => update("rentalPaymentFrequency", form.rentalPaymentFrequency === f ? null : f)}
                    >
                      {t(PAYMENT_FREQUENCY_KEY[f])}
                    </Chip>
                  ))}
                </View>
              </View>
            )}
          </View>
        );
      case "specs":
        return (
          <View className="gap-4">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField label={t("propertyRequest.form.bedroomsMin")} value={form.bedroomsMin} onChangeText={(v) => update("bedroomsMin", v)} keyboardType="numeric" />
              </View>
              <View className="flex-1">
                <TextField label={t("propertyRequest.form.bedroomsMax")} value={form.bedroomsMax} onChangeText={(v) => update("bedroomsMax", v)} keyboardType="numeric" />
              </View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField label={t("propertyRequest.form.bathroomsMin")} value={form.bathroomsMin} onChangeText={(v) => update("bathroomsMin", v)} keyboardType="numeric" />
              </View>
              <View className="flex-1">
                <TextField label={t("propertyRequest.form.bathroomsMax")} value={form.bathroomsMax} onChangeText={(v) => update("bathroomsMax", v)} keyboardType="numeric" />
              </View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField label={t("propertyRequest.form.minArea")} value={form.minArea} onChangeText={(v) => update("minArea", v)} keyboardType="numeric" />
              </View>
              <View className="flex-1">
                <TextField label={t("propertyRequest.form.maxArea")} value={form.maxArea} onChangeText={(v) => update("maxArea", v)} keyboardType="numeric" />
              </View>
            </View>
            <View className="gap-1.5">
              <FieldLabel>{t("propertyRequest.form.furnishing")}</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {FURNISHING_OPTIONS.map((f) => (
                  <Chip key={f} selected={form.furnishing === f} onPress={() => update("furnishing", form.furnishing === f ? null : f)}>
                    {t(`furnishing.${f}`)}
                  </Chip>
                ))}
              </View>
            </View>
            <TextField
              label={t("propertyRequest.form.propertyAge")}
              value={form.propertyAgePreference}
              onChangeText={(v) => update("propertyAgePreference", v)}
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField
                  label={t("propertyRequest.form.availabilityDate")}
                  value={form.availabilityDate}
                  onChangeText={(v) => update("availabilityDate", v)}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View className="flex-1">
                <TextField
                  label={t("propertyRequest.form.moveInDate")}
                  value={form.moveInDate}
                  onChangeText={(v) => update("moveInDate", v)}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>
            <TagInput
              label={t("propertyRequest.form.requiredAmenities")}
              values={form.requiredAmenities}
              onChange={(v) => update("requiredAmenities", v)}
              placeholder={t("propertyRequest.form.requiredAmenitiesPlaceholder")}
            />
            <TagInput
              label={t("propertyRequest.form.preferredAmenities")}
              values={form.preferredAmenities}
              onChange={(v) => update("preferredAmenities", v)}
              placeholder={t("propertyRequest.form.preferredAmenitiesPlaceholder")}
            />
          </View>
        );
      case "lifestyle":
        return (
          <View className="gap-4">
            <TagInput
              label={t("propertyRequest.form.lifestylePreferences")}
              values={form.lifestylePreferences}
              onChange={(v) => update("lifestylePreferences", v)}
              placeholder={t("propertyRequest.form.lifestylePreferencesPlaceholder")}
            />
            <TextField label={t("propertyRequest.form.familySize")} value={form.familySize} onChangeText={(v) => update("familySize", v)} keyboardType="numeric" />
            <TextField
              label={t("propertyRequest.form.householdType")}
              value={form.householdType}
              onChangeText={(v) => update("householdType", v)}
              placeholder={t("propertyRequest.form.householdTypePlaceholder")}
            />
            <TextField
              label={t("propertyRequest.form.petPreference")}
              value={form.petPreference}
              onChangeText={(v) => update("petPreference", v)}
              placeholder={t("propertyRequest.form.petPreferencePlaceholder")}
            />
            <TextField
              label={t("propertyRequest.form.notes")}
              value={form.notes}
              onChangeText={(v) => update("notes", v)}
              placeholder={t("propertyRequest.form.notesPlaceholder")}
              multiline
            />
          </View>
        );
      case "commute":
        return (
          <View className="gap-4">
            <TextField
              label={t("propertyRequest.form.maxCommute")}
              value={form.maxCommuteMinutes}
              onChangeText={(v) => update("maxCommuteMinutes", v)}
              keyboardType="numeric"
            />
            <TextField
              label={t("propertyRequest.form.commuteDestination")}
              value={form.commuteDestinationName}
              onChangeText={(v) => update("commuteDestinationName", v)}
              placeholder={t("propertyRequest.form.commuteDestinationPlaceholder")}
            />
            <Text className="text-[11px] text-muted-foreground">{t("propertyRequest.form.commuteNote")}</Text>
          </View>
        );
      case "facilities":
        return (
          <View className="gap-4">
            <View className="flex-row items-center justify-between rounded-xl border border-border px-4 py-3">
              <Text className="flex-1 text-sm font-medium text-foreground">{t("propertyRequest.form.schoolPreference")}</Text>
              <Switch value={form.schoolPreference} onValueChange={(v) => update("schoolPreference", v)} trackColor={{ true: colors.primary }} />
            </View>
            <View className="flex-row items-center justify-between rounded-xl border border-border px-4 py-3">
              <Text className="flex-1 text-sm font-medium text-foreground">{t("propertyRequest.form.hospitalPreference")}</Text>
              <Switch value={form.hospitalPreference} onValueChange={(v) => update("hospitalPreference", v)} trackColor={{ true: colors.primary }} />
            </View>
            <TagInput
              label={t("propertyRequest.form.accessibilityRequirements")}
              values={form.accessibilityRequirements}
              onChange={(v) => update("accessibilityRequirements", v)}
              placeholder={t("propertyRequest.form.accessibilityRequirementsPlaceholder")}
            />
          </View>
        );
      case "priorities":
        return (
          <View className="gap-4">
            <Text className="text-xs text-muted-foreground">{t("propertyRequest.form.priorityIntro")}</Text>
            {PRIORITY_FIELDS.map((f) => (
              <View key={f} className="gap-2 rounded-xl border border-border p-3">
                <Text className="text-sm font-medium text-foreground">{t(FIELD_LABEL_KEY[f])}</Text>
                <View className="flex-row gap-2">
                  <Chip selected={priorities[f] === "must"} onPress={() => cyclePriority(f, "must")}>
                    {t("propertyRequest.form.mustHave")}
                  </Chip>
                  <Chip selected={priorities[f] === "nice"} onPress={() => cyclePriority(f, "nice")}>
                    {t("propertyRequest.form.niceToHave")}
                  </Chip>
                  <Chip selected={priorities[f] === "flex"} onPress={() => cyclePriority(f, "flex")}>
                    {t("propertyRequest.form.flexible")}
                  </Chip>
                </View>
              </View>
            ))}
          </View>
        );
      case "alerts":
        return (
          <View className="gap-1.5">
            <FieldLabel>{t("propertyRequest.form.alertFrequency")}</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {(["instant", "daily", "weekly", "off"] as AlertFrequency[]).map((f) => (
                <Chip key={f} selected={form.alertFrequency === f} onPress={() => update("alertFrequency", f)}>
                  {t(`propertyRequest.form.alert${f === "instant" ? "Instant" : f === "daily" ? "Daily" : f === "weekly" ? "Weekly" : "Off"}`)}
                </Chip>
              ))}
            </View>
          </View>
        );
      case "privacy":
        return (
          <View className="gap-4">
            <View className="gap-1.5">
              <FieldLabel>{t("propertyRequest.form.mediatorPreference")}</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                <Chip selected={form.mediatorPreference === "owner_only"} onPress={() => update("mediatorPreference", "owner_only")}>
                  {t("propertyRequest.form.mediatorPreferenceOwnerOnly")}
                </Chip>
                <Chip selected={form.mediatorPreference === "mediator_only"} onPress={() => update("mediatorPreference", "mediator_only")}>
                  {t("propertyRequest.form.mediatorPreferenceMediatorOnly")}
                </Chip>
                <Chip selected={form.mediatorPreference === "either"} onPress={() => update("mediatorPreference", "either")}>
                  {t("propertyRequest.form.mediatorPreferenceEither")}
                </Chip>
              </View>
            </View>
            <View className="flex-row items-center justify-between rounded-xl border border-border px-4 py-3">
              <Text className="flex-1 text-sm font-medium text-foreground">{t("propertyRequest.form.verifiedOnly")}</Text>
              <Switch value={form.verifiedOnly} onValueChange={(v) => update("verifiedOnly", v)} trackColor={{ true: colors.primary }} />
            </View>
            <View className="flex-row items-center justify-between rounded-xl border border-border px-4 py-3">
              <Text className="flex-1 text-sm font-medium text-foreground">{t("propertyRequest.form.matchingEnabled")}</Text>
              <Switch value={form.matchingEnabled} onValueChange={(v) => update("matchingEnabled", v)} trackColor={{ true: colors.primary }} />
            </View>
            <View className="flex-row items-center justify-between rounded-xl border border-border px-4 py-3">
              <Text className="flex-1 text-sm font-medium text-foreground">{t("propertyRequest.form.mediatorResponsesEnabled")}</Text>
              <Switch value={form.mediatorResponsesEnabled} onValueChange={(v) => update("mediatorResponsesEnabled", v)} trackColor={{ true: colors.primary }} />
            </View>
          </View>
        );
      default:
        return null;
    }
  }

  const inReview = step >= SECTIONS.length;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: editing ? t("propertyRequest.detail.criteria.edit") : t("propertyRequest.list.newRequest") }} />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        <View className="gap-2 p-4 pb-0">
          <Text className="text-lg font-bold text-foreground">
            {editing ? t("propertyRequest.detail.criteria.edit") : t("propertyRequest.new.heading")}
          </Text>
          <Text className="text-sm text-muted-foreground">{t("propertyRequest.new.subtitle")}</Text>
          {!editing && (
          <View className="mt-2 flex-row gap-2 rounded-2xl border border-border bg-card p-1.5">
            <Pressable
              onPress={() => setMode("describe")}
              className="flex-1 items-center rounded-xl py-2.5"
              style={mode === "describe" ? { backgroundColor: colors.primarySoft } : undefined}
            >
              <Text className={`text-xs font-semibold ${mode === "describe" ? "text-primary" : "text-muted-foreground"}`}>
                {t("propertyRequest.new.modeDescribe")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("form")}
              className="flex-1 items-center rounded-xl py-2.5"
              style={mode === "form" ? { backgroundColor: colors.primarySoft } : undefined}
            >
              <Text className={`text-xs font-semibold ${mode === "form" ? "text-primary" : "text-muted-foreground"}`}>
                {t("propertyRequest.new.modeForm")}
              </Text>
            </Pressable>
          </View>
          )}
        </View>

        {mode === "describe" ? (
          <ScrollView contentContainerClassName="gap-4 p-4">
            <TextField
              label=""
              value={describeText}
              onChangeText={setDescribeText}
              placeholder={t("propertyRequest.new.describe.placeholder")}
              multiline
            />
            {describeError && <Text style={{ color: colors.destructive }} className="text-sm">{describeError}</Text>}
            <Button loading={describeSubmitting} disabled={!describeText.trim()} onPress={submitDescribe}>
              {describeSubmitting ? t("propertyRequest.new.describe.submitting") : t("propertyRequest.new.describe.submit")}
            </Button>

            {describeResult && (
              <View className="gap-3 rounded-2xl border border-border bg-card p-4">
                <View className="flex-row items-center gap-2">
                  <Sparkles size={16} color={colors.ai} />
                  <Text className="text-sm font-bold text-foreground">{t("propertyRequest.new.describe.resultHeading")}</Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                  {t("propertyRequest.new.describe.confidence", { pct: Math.round(describeResult.confidence * 100) })}
                </Text>
                {describeResult.missing.length > 0 && (
                  <View className="gap-1">
                    <Text className="text-xs font-semibold text-foreground">{t("propertyRequest.new.describe.missingFieldsHeading")}</Text>
                    <Text className="text-xs text-muted-foreground">{describeResult.missing.join(", ")}</Text>
                  </View>
                )}

                {clarificationsLoading && <ActivityIndicator color={colors.primary} />}
                {clarifications.length > 0 && (
                  <View className="gap-3">
                    <Text className="text-xs font-semibold text-foreground">{t("propertyRequest.new.describe.clarifyingQuestionsHeading")}</Text>
                    {clarifications.map((c) => (
                      <View key={c.id} className="gap-2 rounded-xl bg-surface p-3">
                        <Text className="text-sm text-foreground">{c.question}</Text>
                        {c.status === "answered" ? (
                          <Text className="text-xs text-success">{c.answer}</Text>
                        ) : (
                          <View className="flex-row gap-2">
                            <TextInput
                              value={answerDrafts[c.id] ?? ""}
                              onChangeText={(v) => setAnswerDrafts((prev) => ({ ...prev, [c.id]: v }))}
                              placeholder={t("propertyRequest.new.describe.answerPlaceholder")}
                              placeholderTextColor={colors.mutedForeground}
                              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-foreground"
                            />
                            <Button size="sm" loading={answeringId === c.id} onPress={() => submitAnswer(c)}>
                              {t("propertyRequest.new.describe.answerSubmit")}
                            </Button>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                <View className="flex-row gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onPress={() => setMode("form")}>
                    {t("propertyRequest.new.describe.editInForm")}
                  </Button>
                  <Button className="flex-1" onPress={goToReview}>
                    {t("propertyRequest.new.describe.continueToReview")}
                  </Button>
                </View>
              </View>
            )}
          </ScrollView>
        ) : inReview ? (
          <ScrollView contentContainerClassName="gap-4 p-4">
            <Text className="text-base font-bold text-foreground">{t("propertyRequest.new.review.heading")}</Text>
            <Text className="text-sm text-muted-foreground">{t("propertyRequest.new.review.subtitle")}</Text>

            <View className="gap-2 rounded-xl border border-border p-3">
              <Text className="text-xs font-semibold text-foreground">{t("propertyRequest.new.review.mustHaveHeading")}</Text>
              <Text className="text-xs text-muted-foreground">
                {PRIORITY_FIELDS.filter((f) => priorities[f] === "must").map((f) => t(FIELD_LABEL_KEY[f])).join(", ") ||
                  t("propertyRequest.new.review.noneTagged")}
              </Text>
              <Text className="text-xs font-semibold text-foreground">{t("propertyRequest.new.review.niceToHaveHeading")}</Text>
              <Text className="text-xs text-muted-foreground">
                {PRIORITY_FIELDS.filter((f) => priorities[f] === "nice").map((f) => t(FIELD_LABEL_KEY[f])).join(", ") ||
                  t("propertyRequest.new.review.noneTagged")}
              </Text>
              <Text className="text-xs font-semibold text-foreground">{t("propertyRequest.new.review.flexibleHeading")}</Text>
              <Text className="text-xs text-muted-foreground">
                {PRIORITY_FIELDS.filter((f) => priorities[f] === "flex").map((f) => t(FIELD_LABEL_KEY[f])).join(", ") ||
                  t("propertyRequest.new.review.noneTagged")}
              </Text>
            </View>

            {previewLoading ? (
              <View className="items-center gap-2 py-6">
                <ActivityIndicator color={colors.primary} />
                <Text className="text-xs text-muted-foreground">{t("propertyRequest.new.review.loadingPreview")}</Text>
              </View>
            ) : (
              <>
                <View className="gap-2">
                  <Text className="text-sm font-bold text-foreground">{t("propertyRequest.new.review.previewMatchesHeading")}</Text>
                  {previewMatches.length === 0 ? (
                    <Text className="text-xs text-muted-foreground">{t("propertyRequest.new.review.previewMatchesEmpty")}</Text>
                  ) : (
                    <Text className="text-xs text-muted-foreground">
                      {t(previewMatches.length === 1 ? "propertyRequest.list.matchesSingular" : "propertyRequest.list.matchesPlural", {
                        count: previewMatches.length,
                      })}
                    </Text>
                  )}
                </View>
                <View className="gap-2">
                  <Text className="text-sm font-bold text-foreground">{t("propertyRequest.new.review.areaSuggestionsHeading")}</Text>
                  {areaSuggestions.length === 0 ? (
                    <Text className="text-xs text-muted-foreground">{t("propertyRequest.new.review.areaSuggestionsEmpty")}</Text>
                  ) : (
                    areaSuggestions.slice(0, 5).map((a) => (
                      <View key={`${a.area_name}-${a.city}`} className="flex-row items-center justify-between rounded-xl border border-border px-3 py-2">
                        <Text className="text-xs font-medium text-foreground">
                          {a.area_name}, {cityLabel(a.city, t)}
                        </Text>
                        <Text className="text-xs text-muted-foreground">{t(`propertyRequest.areaSuggestionLabels.${a.label}`)}</Text>
                      </View>
                    ))
                  )}
                </View>
              </>
            )}

            {reviewError && <Text style={{ color: colors.destructive }} className="text-sm">{reviewError}</Text>}

            <View className="gap-2 pt-2">
              <Button loading={activating} onPress={handleActivate}>
                {activating ? t("propertyRequest.new.review.activating") : t("propertyRequest.new.review.activate")}
              </Button>
              <Button variant="outline" loading={savingDraft} onPress={handleSaveDraft}>
                {savingDraft ? t("propertyRequest.new.review.savingDraft") : t("propertyRequest.new.review.saveDraft")}
              </Button>
              <Button variant="ghost" onPress={() => setStep(SECTIONS.length - 1)}>
                {t("propertyRequest.form.back")}
              </Button>
            </View>
          </ScrollView>
        ) : (
          <>
            <View className="px-4 pt-3">
              <Text className="text-xs font-semibold text-muted-foreground">
                {step + 1}/{SECTIONS.length} · {t(`propertyRequest.new.form.sections.${SECTIONS[step]}`)}
              </Text>
            </View>
            <ScrollView contentContainerClassName="gap-4 p-4">{renderSection(SECTIONS[step])}</ScrollView>
            <View className="flex-row gap-3 border-t border-border p-4">
              {step > 0 && (
                <Button variant="outline" className="flex-1" onPress={() => setStep((s) => s - 1)}>
                  {t("propertyRequest.form.back")}
                </Button>
              )}
              {step < SECTIONS.length - 1 ? (
                <Button className="flex-1" onPress={() => setStep((s) => s + 1)}>
                  {t("propertyRequest.form.next")}
                </Button>
              ) : (
                <Button className="flex-1" loading={savingDraft || previewLoading} onPress={goToReview}>
                  {editing
                    ? savingDraft
                      ? t("propertyRequest.new.review.savingChanges")
                      : t("propertyRequest.new.review.saveChanges")
                    : t("propertyRequest.form.next")}
                </Button>
              )}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
