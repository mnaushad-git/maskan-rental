import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/maskan/TopNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { cities, formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";
import {
  activatePropertyRequest,
  createPropertyRequest,
  createPropertyRequestFromText,
  fetchAreaSuggestions,
  fetchAreas,
  fetchPropertyRequest,
  previewPropertyRequestMatches,
  requestPropertyRequestClarifications,
  answerPropertyRequestClarification,
  updatePropertyRequest,
  PROPERTY_REQUEST_FIELD_VOCAB,
  type AlertFrequency,
  type ApiAreaSuggestion,
  type ApiClarification,
  type ApiPropertyRequest,
  type ApiPropertyRequestFields,
  type ApiPropertyRequestMatch,
  type PropertyRequestFieldKey,
  type PropertyRequestMediatorPreference,
} from "@/lib/api/maskan";
import {
  areaSuggestionLabelText,
  areaSuggestionLabelTone,
  matchReasonLabel,
} from "@/lib/propertyRequestDisplay";
import { Badge } from "@/components/maskan/Badges";

export const Route = createFileRoute("/property-requests/new")({
  validateSearch: (s: Record<string, unknown>): { requestId?: number } => ({
    requestId: s.requestId != null ? Number(s.requestId) : undefined,
  }),
  head: () => ({ meta: [{ title: "Tell Maskan What You Need — Maskan" }] }),
  component: NewPropertyRequestPage,
});

type FormState = {
  title: string;
  description: string;
  transaction_type: "rent" | "sale" | "";
  property_category: string;
  city: string;
  preferred_districts: string[];
  excluded_districts: string[];
  min_price: string;
  max_price: string;
  bedrooms_min: string;
  bedrooms_max: string;
  bathrooms_min: string;
  bathrooms_max: string;
  min_area_sq_m: string;
  max_area_sq_m: string;
  furnishing: string;
  required_amenities: string[];
  preferred_amenities: string[];
  property_age_preference: string;
  availability_date: string;
  move_in_date: string;
  rental_payment_frequency: string;
  mediator_preference: PropertyRequestMediatorPreference;
  verified_only: boolean;
  max_commute_minutes: string;
  commute_destination_name: string;
  school_preference: boolean;
  hospital_preference: boolean;
  lifestyle_preferences: string[];
  family_size: string;
  household_type: string;
  accessibility_requirements: string[];
  pet_preference: string;
  notes: string;
  must_have_fields: PropertyRequestFieldKey[];
  flexible_fields: PropertyRequestFieldKey[];
  alert_frequency: AlertFrequency;
  matching_enabled: boolean;
  mediator_responses_enabled: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  transaction_type: "",
  property_category: "",
  city: "",
  preferred_districts: [],
  excluded_districts: [],
  min_price: "",
  max_price: "",
  bedrooms_min: "",
  bedrooms_max: "",
  bathrooms_min: "",
  bathrooms_max: "",
  min_area_sq_m: "",
  max_area_sq_m: "",
  furnishing: "",
  required_amenities: [],
  preferred_amenities: [],
  property_age_preference: "",
  availability_date: "",
  move_in_date: "",
  rental_payment_frequency: "",
  mediator_preference: "either",
  verified_only: false,
  max_commute_minutes: "",
  commute_destination_name: "",
  school_preference: false,
  hospital_preference: false,
  lifestyle_preferences: [],
  family_size: "",
  household_type: "",
  accessibility_requirements: [],
  pet_preference: "",
  notes: "",
  must_have_fields: [],
  flexible_fields: [],
  alert_frequency: "instant",
  matching_enabled: true,
  mediator_responses_enabled: true,
};

function numOrUndef(s: string): number | undefined {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function apiToForm(api: ApiPropertyRequest): FormState {
  return {
    title: api.title,
    description: api.description ?? "",
    transaction_type: api.transaction_type ?? "",
    property_category: api.property_category ?? "",
    city: api.city ?? "",
    preferred_districts: api.preferred_districts ?? [],
    excluded_districts: api.excluded_districts ?? [],
    min_price: api.min_price != null ? String(api.min_price) : "",
    max_price: api.max_price != null ? String(api.max_price) : "",
    bedrooms_min: api.bedrooms_min != null ? String(api.bedrooms_min) : "",
    bedrooms_max: api.bedrooms_max != null ? String(api.bedrooms_max) : "",
    bathrooms_min: api.bathrooms_min != null ? String(api.bathrooms_min) : "",
    bathrooms_max: api.bathrooms_max != null ? String(api.bathrooms_max) : "",
    min_area_sq_m: api.min_area_sq_m != null ? String(api.min_area_sq_m) : "",
    max_area_sq_m: api.max_area_sq_m != null ? String(api.max_area_sq_m) : "",
    furnishing: api.furnishing ?? "",
    required_amenities: api.required_amenities ?? [],
    preferred_amenities: api.preferred_amenities ?? [],
    property_age_preference: api.property_age_preference ?? "",
    availability_date: api.availability_date ?? "",
    move_in_date: api.move_in_date ?? "",
    rental_payment_frequency: api.rental_payment_frequency ?? "",
    mediator_preference: api.mediator_preference ?? "either",
    verified_only: api.verified_only ?? false,
    max_commute_minutes: api.max_commute_minutes != null ? String(api.max_commute_minutes) : "",
    commute_destination_name: api.commute_destination_name ?? "",
    school_preference: api.school_preference ?? false,
    hospital_preference: api.hospital_preference ?? false,
    lifestyle_preferences: api.lifestyle_preferences ?? [],
    family_size: api.family_size != null ? String(api.family_size) : "",
    household_type: api.household_type ?? "",
    accessibility_requirements: api.accessibility_requirements ?? [],
    pet_preference: api.pet_preference ?? "",
    notes: api.notes ?? "",
    must_have_fields: (api.must_have_fields ?? []) as PropertyRequestFieldKey[],
    flexible_fields: (api.flexible_fields ?? []) as PropertyRequestFieldKey[],
    alert_frequency: api.alert_frequency ?? "instant",
    matching_enabled: api.matching_enabled ?? true,
    mediator_responses_enabled: api.mediator_responses_enabled ?? true,
  };
}

function formToPayload(f: FormState): ApiPropertyRequestFields {
  return {
    title: f.title.trim() || "Untitled request",
    description: f.description.trim() || null,
    transaction_type: f.transaction_type || null,
    property_category: f.property_category || null,
    city: f.city || null,
    preferred_districts: f.preferred_districts,
    excluded_districts: f.excluded_districts,
    min_price: numOrUndef(f.min_price) ?? null,
    max_price: numOrUndef(f.max_price) ?? null,
    bedrooms_min: numOrUndef(f.bedrooms_min) ?? null,
    bedrooms_max: numOrUndef(f.bedrooms_max) ?? null,
    bathrooms_min: numOrUndef(f.bathrooms_min) ?? null,
    bathrooms_max: numOrUndef(f.bathrooms_max) ?? null,
    min_area_sq_m: numOrUndef(f.min_area_sq_m) ?? null,
    max_area_sq_m: numOrUndef(f.max_area_sq_m) ?? null,
    furnishing: f.furnishing || null,
    required_amenities: f.required_amenities,
    preferred_amenities: f.preferred_amenities,
    property_age_preference: f.property_age_preference.trim() || null,
    availability_date: f.availability_date || null,
    move_in_date: f.move_in_date || null,
    rental_payment_frequency: f.rental_payment_frequency || null,
    mediator_preference: f.mediator_preference,
    verified_only: f.verified_only,
    max_commute_minutes: numOrUndef(f.max_commute_minutes) ?? null,
    commute_destination_name: f.commute_destination_name.trim() || null,
    school_preference: f.school_preference,
    hospital_preference: f.hospital_preference,
    lifestyle_preferences: f.lifestyle_preferences,
    family_size: numOrUndef(f.family_size) ?? null,
    household_type: f.household_type.trim() || null,
    accessibility_requirements: f.accessibility_requirements,
    pet_preference: f.pet_preference.trim() || null,
    notes: f.notes.trim() || null,
    must_have_fields: f.must_have_fields,
    flexible_fields: f.flexible_fields,
    alert_frequency: f.alert_frequency,
    matching_enabled: f.matching_enabled,
    mediator_responses_enabled: f.mediator_responses_enabled,
  };
}

// ── Small reusable bits ──────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-sm font-medium">{children}</label>;
}

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  }
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary">
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function DistrictPicker({
  values,
  onChange,
  options,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <select
        value=""
        onChange={(e) => {
          if (e.target.value && !values.includes(e.target.value))
            onChange([...values, e.target.value]);
        }}
        className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
      >
        <option value="">{placeholder}</option>
        {options
          .filter((o) => !values.includes(o))
          .sort((a, b) => a.localeCompare(b))
          .map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
      </select>
    </div>
  );
}

function StepShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

const STEP_KEYS = [
  "basics",
  "locationBudget",
  "specs",
  "lifestyle",
  "priorities",
  "review",
] as const;
type StepKey = (typeof STEP_KEYS)[number];

function NewPropertyRequestPage() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { requestId: initialRequestId } = Route.useSearch();

  const [mode, setMode] = useState<"intro" | "wizard">(initialRequestId ? "wizard" : "intro");
  const [describeMode, setDescribeMode] = useState<"describe" | "form">("describe");
  const [describeText, setDescribeText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [draftResult, setDraftResult] = useState<{
    ai_confidence: number;
    missing_fields: string[];
    clarifying_questions: string[];
  } | null>(null);
  const [clarifications, setClarifications] = useState<ApiClarification[]>([]);
  const [loadingClarifications, setLoadingClarifications] = useState(false);

  const [requestId, setRequestId] = useState<number | null>(initialRequestId ?? null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [areas, setAreas] = useState<{ name: string; city: string }[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(!!initialRequestId);

  const [saving, setSaving] = useState(false);
  const [previewMatches, setPreviewMatches] = useState<ApiPropertyRequestMatch[] | null>(null);
  const [areaSuggestions, setAreaSuggestions] = useState<ApiAreaSuggestion[] | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    fetchAreas()
      .then((res) => setAreas(res.map((a) => ({ name: a.name, city: a.city }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!initialRequestId) return;
    fetchPropertyRequest(initialRequestId)
      .then((api) => {
        setForm(apiToForm(api));
        setRequestId(api.id);
      })
      .catch(() => toast.error(t("propertyRequest.new.review.errorGeneric")))
      .finally(() => setLoadingInitial(false));
  }, [initialRequestId]); // eslint-disable-line react-hooks/exhaustive-deps

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleAnalyze() {
    if (!describeText.trim() || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const res = await createPropertyRequestFromText(describeText.trim(), lang);
      setRequestId(res.draft.id);
      setForm((prev) => ({
        ...apiToForm(res.draft),
        title: apiToForm(res.draft).title || prev.title,
      }));
      setDraftResult({
        ai_confidence: res.ai_confidence,
        missing_fields: res.missing_fields,
        clarifying_questions: res.clarifying_questions,
      });
    } catch {
      setAnalyzeError(t("propertyRequest.new.describe.errorGeneric"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGetClarifications() {
    if (!requestId) return;
    setLoadingClarifications(true);
    try {
      const res = await requestPropertyRequestClarifications(requestId);
      setClarifications(res);
    } catch {
      toast.error(t("propertyRequest.new.review.errorGeneric"));
    } finally {
      setLoadingClarifications(false);
    }
  }

  async function handleAnswerClarification(clarificationId: number, answer: string) {
    if (!requestId || !answer.trim()) return;
    try {
      const updated = await answerPropertyRequestClarification(
        requestId,
        clarificationId,
        answer.trim(),
      );
      setClarifications((prev) => prev.map((c) => (c.id === clarificationId ? updated : c)));
    } catch {
      toast.error(t("propertyRequest.new.review.errorGeneric"));
    }
  }

  function startWizard() {
    setMode("wizard");
    setStep(0);
  }

  function toggleFieldPriority(field: PropertyRequestFieldKey, kind: "must" | "flexible") {
    setForm((f) => {
      const must = new Set(f.must_have_fields);
      const flex = new Set(f.flexible_fields);
      if (kind === "must") {
        if (must.has(field)) must.delete(field);
        else {
          must.add(field);
          flex.delete(field);
        }
      } else {
        if (flex.has(field)) flex.delete(field);
        else {
          flex.add(field);
          must.delete(field);
        }
      }
      return { ...f, must_have_fields: Array.from(must), flexible_fields: Array.from(flex) };
    });
  }

  async function persistAndLoadReview() {
    setLoadingReview(true);
    try {
      const payload = formToPayload(form);
      let id = requestId;
      if (id) {
        await updatePropertyRequest(id, payload);
      } else {
        const created = await createPropertyRequest(payload);
        id = created.id;
        setRequestId(id);
      }
      const [matches, suggestions] = await Promise.all([
        previewPropertyRequestMatches(id!).catch(() => []),
        fetchAreaSuggestions(id!).catch(() => []),
      ]);
      setPreviewMatches(matches);
      setAreaSuggestions(suggestions);
    } catch {
      toast.error(t("propertyRequest.new.review.errorGeneric"));
    } finally {
      setLoadingReview(false);
    }
  }

  function goToStep(next: number) {
    if (next >= STEP_KEYS.length) return;
    if (next < 0) {
      if (initialRequestId) navigate({ to: "/property-requests" });
      else setMode("intro");
      return;
    }
    setStep(next);
    if (STEP_KEYS[next] === "review") void persistAndLoadReview();
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      const payload = formToPayload(form);
      if (requestId) await updatePropertyRequest(requestId, payload);
      else await createPropertyRequest(payload);
      navigate({ to: "/property-requests" });
    } catch {
      toast.error(t("propertyRequest.new.review.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (!requestId) return;
    setActivating(true);
    try {
      await updatePropertyRequest(requestId, formToPayload(form));
      await activatePropertyRequest(requestId);
      navigate({ to: "/property-requests/$id", params: { id: String(requestId) } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("limit"))
        toast.error(t("propertyRequest.new.review.errorLimit"));
      else if (!form.transaction_type || !form.city)
        toast.error(t("propertyRequest.new.review.errorMissingFields"));
      else toast.error(t("propertyRequest.new.review.errorGeneric"));
    } finally {
      setActivating(false);
    }
  }

  const districtOptions = useMemo(
    () => areas.filter((a) => !form.city || a.city === form.city).map((a) => a.name),
    [areas, form.city],
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
          <Sparkles className="size-10 text-primary" />
          <h1 className="text-xl font-bold">{t("propertyRequest.list.signInToView")}</h1>
          <Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>
        </div>
      </div>
    );
  }

  if (loadingInitial) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="px-4 py-10">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8">
            <Badge tone="ai" className="mb-3">
              <Sparkles className="size-3" /> {t("propertyRequest.entryPoint.ctaShort")}
            </Badge>
            <h1 className="text-2xl font-bold">{t("propertyRequest.new.heading")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("propertyRequest.new.subtitle")}
            </p>
          </div>

          {mode === "intro" && (
            <div className="space-y-6">
              <div className="flex gap-2 rounded-xl bg-surface-2 p-1">
                <button
                  type="button"
                  onClick={() => setDescribeMode("describe")}
                  className={cn(
                    "flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                    describeMode === "describe" ? "bg-card shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {t("propertyRequest.new.modeToggle.describe")}
                </button>
                <button
                  type="button"
                  onClick={() => setDescribeMode("form")}
                  className={cn(
                    "flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                    describeMode === "form" ? "bg-card shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {t("propertyRequest.new.modeToggle.form")}
                </button>
              </div>

              {describeMode === "describe" ? (
                <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card">
                  <textarea
                    rows={5}
                    value={describeText}
                    onChange={(e) => setDescribeText(e.target.value)}
                    placeholder={t("propertyRequest.new.describe.placeholder")}
                    className="w-full resize-none rounded-xl border border-border bg-background px-3.5 py-3 text-sm outline-none focus:border-primary"
                  />
                  {analyzeError && <p className="text-sm text-destructive">{analyzeError}</p>}
                  <Button
                    onClick={() => void handleAnalyze()}
                    disabled={!describeText.trim() || analyzing}
                    className="w-full"
                  >
                    {analyzing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {analyzing
                      ? t("propertyRequest.new.describe.analyzing")
                      : t("propertyRequest.new.describe.submit")}
                  </Button>

                  {draftResult && (
                    <div className="space-y-4 border-t border-border pt-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">
                          {t("propertyRequest.new.describe.resultHeading")}
                        </h3>
                        <span className="rounded-full bg-ai/10 px-2.5 py-1 text-xs font-semibold text-ai">
                          {t("propertyRequest.new.describe.confidence", {
                            pct: Math.round(draftResult.ai_confidence * 100),
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground">{form.title}</p>
                      {draftResult.missing_fields.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                            {t("propertyRequest.new.describe.missingFieldsHeading")}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {draftResult.missing_fields.map((f) => (
                              <span
                                key={f}
                                className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {draftResult.clarifying_questions.length > 0 && (
                        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                          <p className="text-sm font-semibold">
                            {t("propertyRequest.new.clarify.heading")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("propertyRequest.new.clarify.desc")}
                          </p>
                          {clarifications.length === 0 ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleGetClarifications()}
                              disabled={loadingClarifications}
                            >
                              {loadingClarifications ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : null}
                              {loadingClarifications
                                ? t("propertyRequest.new.clarify.loadingQuestions")
                                : t("propertyRequest.new.clarify.getQuestions")}
                            </Button>
                          ) : (
                            <div className="space-y-3">
                              {clarifications.map((c) => (
                                <ClarificationRow
                                  key={c.id}
                                  clarification={c}
                                  onAnswer={(ans) => void handleAnswerClarification(c.id, ans)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <Button onClick={startWizard} variant="outline" className="w-full">
                        {t("propertyRequest.new.describe.continueToForm")}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Button onClick={startWizard} className="w-full">
                  {t("propertyRequest.new.modeToggle.form")}
                </Button>
              )}
            </div>
          )}

          {mode === "wizard" && (
            <div className="space-y-6">
              <StepProgress step={step} />

              {STEP_KEYS[step] === "basics" && (
                <StepShell title={t("propertyRequest.new.sections.basics")}>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.title")}</FieldLabel>
                    <Input
                      value={form.title}
                      onChange={(e) => update("title", e.target.value)}
                      placeholder={t("propertyRequest.new.fields.titlePlaceholder")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.transactionType")}</FieldLabel>
                      <select
                        value={form.transaction_type}
                        onChange={(e) =>
                          update(
                            "transaction_type",
                            e.target.value as FormState["transaction_type"],
                          )
                        }
                        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                      >
                        <option value="">
                          {t("propertyRequest.new.fields.propertyCategoryAny")}
                        </option>
                        <option value="rent">
                          {t("propertyRequest.new.fields.transactionTypeRent")}
                        </option>
                        <option value="sale">
                          {t("propertyRequest.new.fields.transactionTypeSale")}
                        </option>
                      </select>
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.propertyCategory")}</FieldLabel>
                      <select
                        value={form.property_category}
                        onChange={(e) => update("property_category", e.target.value)}
                        className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                      >
                        <option value="">
                          {t("propertyRequest.new.fields.propertyCategoryAny")}
                        </option>
                        {["Apartment", "Villa", "Penthouse", "Townhouse", "Studio"].map((p) => (
                          <option key={p} value={p}>
                            {t(`propertyTypes.${p}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.description")}</FieldLabel>
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(e) => update("description", e.target.value)}
                      placeholder={t("propertyRequest.new.fields.descriptionPlaceholder")}
                      className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </StepShell>
              )}

              {STEP_KEYS[step] === "locationBudget" && (
                <StepShell title={t("propertyRequest.new.sections.location")}>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.city")}</FieldLabel>
                    <select
                      value={form.city}
                      onChange={(e) => update("city", e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">{t("propertyRequest.new.fields.cityAny")}</option>
                      {cities.map((c) => (
                        <option key={c.name} value={c.name}>
                          {t(`cities.${c.name}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.preferredDistricts")}</FieldLabel>
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      {t("propertyRequest.new.fields.preferredDistrictsHelp")}
                    </p>
                    <DistrictPicker
                      values={form.preferred_districts}
                      onChange={(v) => update("preferred_districts", v)}
                      options={districtOptions}
                      placeholder={t("propertyRequest.new.fields.preferredDistricts")}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.excludedDistricts")}</FieldLabel>
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      {t("propertyRequest.new.fields.excludedDistrictsHelp")}
                    </p>
                    <DistrictPicker
                      values={form.excluded_districts}
                      onChange={(v) => update("excluded_districts", v)}
                      options={districtOptions}
                      placeholder={t("propertyRequest.new.fields.excludedDistricts")}
                    />
                  </div>
                  <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("propertyRequest.new.sections.budget")}
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.minPrice")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.min_price}
                        onChange={(e) => update("min_price", e.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.maxPrice")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.max_price}
                        onChange={(e) => update("max_price", e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.paymentFrequency")}</FieldLabel>
                    <select
                      value={form.rental_payment_frequency}
                      onChange={(e) => update("rental_payment_frequency", e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">
                        {t("propertyRequest.new.fields.paymentFrequencyAny")}
                      </option>
                      <option value="monthly">monthly</option>
                      <option value="quarterly">quarterly</option>
                      <option value="annually">annually</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.mediatorPreference")}</FieldLabel>
                    <select
                      value={form.mediator_preference}
                      onChange={(e) =>
                        update(
                          "mediator_preference",
                          e.target.value as PropertyRequestMediatorPreference,
                        )
                      }
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="either">
                        {t("propertyRequest.new.fields.mediatorPreferenceEither")}
                      </option>
                      <option value="owner_only">
                        {t("propertyRequest.new.fields.mediatorPreferenceOwnerOnly")}
                      </option>
                      <option value="mediator_only">
                        {t("propertyRequest.new.fields.mediatorPreferenceMediatorOnly")}
                      </option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.verified_only}
                      onChange={(e) => update("verified_only", e.target.checked)}
                      className="size-4 rounded border-border"
                    />
                    {t("propertyRequest.new.fields.verifiedOnly")}
                  </label>
                </StepShell>
              )}

              {STEP_KEYS[step] === "specs" && (
                <StepShell title={t("propertyRequest.new.sections.specs")}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.bedroomsMin")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.bedrooms_min}
                        onChange={(e) => update("bedrooms_min", e.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.bedroomsMax")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.bedrooms_max}
                        onChange={(e) => update("bedrooms_max", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.bathroomsMin")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.bathrooms_min}
                        onChange={(e) => update("bathrooms_min", e.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.bathroomsMax")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.bathrooms_max}
                        onChange={(e) => update("bathrooms_max", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.minArea")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.min_area_sq_m}
                        onChange={(e) => update("min_area_sq_m", e.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.maxArea")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.max_area_sq_m}
                        onChange={(e) => update("max_area_sq_m", e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.furnishing")}</FieldLabel>
                    <select
                      value={form.furnishing}
                      onChange={(e) => update("furnishing", e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">{t("propertyRequest.new.fields.furnishingAny")}</option>
                      {["Furnished", "Semi-furnished", "Unfurnished"].map((f) => (
                        <option key={f} value={f}>
                          {t(`furnishing.${f}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.propertyAge")}</FieldLabel>
                    <Input
                      value={form.property_age_preference}
                      onChange={(e) => update("property_age_preference", e.target.value)}
                      placeholder={t("propertyRequest.new.fields.propertyAgePlaceholder")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.availabilityDate")}</FieldLabel>
                      <Input
                        type="date"
                        value={form.availability_date}
                        onChange={(e) => update("availability_date", e.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.moveInDate")}</FieldLabel>
                      <Input
                        type="date"
                        value={form.move_in_date}
                        onChange={(e) => update("move_in_date", e.target.value)}
                      />
                    </div>
                  </div>
                </StepShell>
              )}

              {STEP_KEYS[step] === "lifestyle" && (
                <StepShell title={t("propertyRequest.new.sections.lifestyle")}>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.requiredAmenities")}</FieldLabel>
                    <TagInput
                      values={form.required_amenities}
                      onChange={(v) => update("required_amenities", v)}
                      placeholder={t("propertyRequest.new.fields.requiredAmenitiesPlaceholder")}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.preferredAmenities")}</FieldLabel>
                    <TagInput
                      values={form.preferred_amenities}
                      onChange={(v) => update("preferred_amenities", v)}
                      placeholder={t("propertyRequest.new.fields.preferredAmenitiesPlaceholder")}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.lifestylePreferences")}</FieldLabel>
                    <TagInput
                      values={form.lifestyle_preferences}
                      onChange={(v) => update("lifestyle_preferences", v)}
                      placeholder={t("propertyRequest.new.fields.lifestylePreferencesPlaceholder")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.school_preference}
                        onChange={(e) => update("school_preference", e.target.checked)}
                        className="size-4 rounded border-border"
                      />
                      {t("propertyRequest.new.fields.schoolPreference")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.hospital_preference}
                        onChange={(e) => update("hospital_preference", e.target.checked)}
                        className="size-4 rounded border-border"
                      />
                      {t("propertyRequest.new.fields.hospitalPreference")}
                    </label>
                  </div>
                  <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("propertyRequest.new.sections.commute")}
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.maxCommute")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.max_commute_minutes}
                        onChange={(e) => update("max_commute_minutes", e.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.commuteDestination")}</FieldLabel>
                      <Input
                        value={form.commute_destination_name}
                        onChange={(e) => update("commute_destination_name", e.target.value)}
                        placeholder={t("propertyRequest.new.fields.commuteDestinationPlaceholder")}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.familySize")}</FieldLabel>
                      <Input
                        type="number"
                        min={0}
                        value={form.family_size}
                        onChange={(e) => update("family_size", e.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>{t("propertyRequest.new.fields.householdType")}</FieldLabel>
                      <Input
                        value={form.household_type}
                        onChange={(e) => update("household_type", e.target.value)}
                        placeholder={t("propertyRequest.new.fields.householdTypePlaceholder")}
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.accessibility")}</FieldLabel>
                    <TagInput
                      values={form.accessibility_requirements}
                      onChange={(v) => update("accessibility_requirements", v)}
                      placeholder={t("propertyRequest.new.fields.accessibilityPlaceholder")}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.petPreference")}</FieldLabel>
                    <Input
                      value={form.pet_preference}
                      onChange={(e) => update("pet_preference", e.target.value)}
                      placeholder={t("propertyRequest.new.fields.petPreferencePlaceholder")}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.notes")}</FieldLabel>
                    <textarea
                      rows={3}
                      value={form.notes}
                      onChange={(e) => update("notes", e.target.value)}
                      placeholder={t("propertyRequest.new.fields.notesPlaceholder")}
                      className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </StepShell>
              )}

              {STEP_KEYS[step] === "priorities" && (
                <StepShell title={t("propertyRequest.new.sections.priorities")}>
                  <p className="text-sm text-muted-foreground">
                    {t("propertyRequest.new.priorities.desc")}
                  </p>
                  <div className="space-y-2">
                    {PROPERTY_REQUEST_FIELD_VOCAB.map((field) => {
                      const isMust = form.must_have_fields.includes(field);
                      const isFlex = form.flexible_fields.includes(field);
                      return (
                        <div
                          key={field}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5"
                        >
                          <span className="text-sm">
                            {t(`propertyRequest.new.fieldVocab.${field}`)}
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleFieldPriority(field, "must")}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                                isMust
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border text-muted-foreground hover:bg-surface",
                              )}
                            >
                              {t("propertyRequest.new.priorities.mustHave")}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleFieldPriority(field, "flexible")}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                                isFlex
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border text-muted-foreground hover:bg-surface",
                              )}
                            >
                              {t("propertyRequest.new.priorities.flexible")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("propertyRequest.new.sections.alerts")}
                  </h2>
                  <div>
                    <FieldLabel>{t("propertyRequest.new.fields.alertFrequency")}</FieldLabel>
                    <select
                      value={form.alert_frequency}
                      onChange={(e) => update("alert_frequency", e.target.value as AlertFrequency)}
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                    >
                      {(["instant", "daily", "weekly", "off"] as AlertFrequency[]).map((f) => (
                        <option key={f} value={f}>
                          {t(`propertyRequest.new.alertFrequency.${f}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.matching_enabled}
                      onChange={(e) => update("matching_enabled", e.target.checked)}
                      className="size-4 rounded border-border"
                    />
                    {t("propertyRequest.new.fields.matchingEnabled")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.mediator_responses_enabled}
                      onChange={(e) => update("mediator_responses_enabled", e.target.checked)}
                      className="size-4 rounded border-border"
                    />
                    {t("propertyRequest.new.fields.mediatorResponsesEnabled")}
                  </label>
                </StepShell>
              )}

              {STEP_KEYS[step] === "review" && (
                <StepShell title={t("propertyRequest.new.sections.review")}>
                  <p className="text-sm text-muted-foreground">
                    {t("propertyRequest.new.review.desc")}
                  </p>
                  {loadingReview ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />{" "}
                      {t("propertyRequest.new.review.loadingPreview")}
                    </div>
                  ) : (
                    <>
                      <div>
                        <h3 className="mb-2 text-sm font-bold">
                          {t("propertyRequest.new.review.previewHeading")}
                        </h3>
                        {!previewMatches || previewMatches.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            {t("propertyRequest.new.review.previewEmpty")}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {previewMatches.slice(0, 5).map((m, i) => (
                              <div key={i} className="rounded-xl border border-border p-3 text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">
                                    {t("propertyRequest.detail.matches.matchScore", {
                                      pct: Math.round(m.match_score * 100),
                                    })}
                                  </span>
                                </div>
                                {m.match_reasons.length > 0 && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {m.match_reasons
                                      .slice(0, 2)
                                      .map((r) => matchReasonLabel(t, r))
                                      .join(" · ")}
                                  </p>
                                )}
                              </div>
                            ))}
                            <p className="text-[11px] text-muted-foreground">
                              {t("propertyRequest.new.review.previewNote")}
                            </p>
                          </div>
                        )}
                      </div>
                      <div>
                        <h3 className="mb-2 text-sm font-bold">
                          {t("propertyRequest.new.review.areaSuggestionsHeading")}
                        </h3>
                        {!areaSuggestions || areaSuggestions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            {t("propertyRequest.new.review.areaSuggestionsEmpty")}
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {areaSuggestions.slice(0, 4).map((a) => (
                              <div
                                key={a.area_name}
                                className="rounded-xl border border-border p-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold">{a.area_name}</span>
                                  <Badge
                                    tone={areaSuggestionLabelTone(a.label)}
                                    className="shrink-0"
                                  >
                                    {areaSuggestionLabelText(t, a.label)}
                                  </Badge>
                                </div>
                                {a.typical_price_range && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {t("propertyRequest.detail.areaSuggestions.typicalPrice", {
                                      range: `${a.typical_price_range[0] != null ? formatSAR(a.typical_price_range[0]) : "—"} – ${a.typical_price_range[1] != null ? formatSAR(a.typical_price_range[1]) : "—"}`,
                                    })}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </StepShell>
              )}

              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={() => goToStep(step - 1)}
                  disabled={saving || activating}
                >
                  <ArrowLeft className="size-4 rtl:hidden" />
                  <ArrowRight className="size-4 ltr:hidden" />{" "}
                  {t("propertyRequest.new.review.back")}
                </Button>
                {STEP_KEYS[step] === "review" ? (
                  <div className="flex flex-1 justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void handleSaveDraft()}
                      disabled={saving || activating}
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
                      {t("propertyRequest.new.review.saveDraft")}
                    </Button>
                    <Button onClick={() => void handleActivate()} disabled={activating || saving}>
                      {activating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      {activating
                        ? t("propertyRequest.new.review.activating")
                        : t("propertyRequest.new.review.activate")}
                    </Button>
                  </div>
                ) : (
                  <Button className="ms-auto" onClick={() => goToStep(step + 1)}>
                    {t("propertyRequest.new.review.next")}{" "}
                    <ArrowRight className="size-4 rtl:hidden" />
                    <ArrowLeft className="size-4 ltr:hidden" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepProgress({ step }: { step: number }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-1.5">
      {STEP_KEYS.map((key, i) => (
        <div key={key} className="flex flex-1 flex-col items-center gap-1.5">
          <div
            className={cn("h-1.5 w-full rounded-full", i <= step ? "bg-primary" : "bg-border")}
          />
          <span
            className={cn(
              "hidden text-[10px] font-medium sm:block",
              i === step ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {t(`propertyRequest.new.steps.${key}`)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ClarificationRow({
  clarification,
  onAnswer,
}: {
  clarification: ApiClarification;
  onAnswer: (answer: string) => void;
}) {
  const { t } = useLanguage();
  const [answer, setAnswer] = useState(clarification.answer ?? "");
  const answered = clarification.status === "answered";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-sm font-medium">{clarification.question}</p>
      {answered ? (
        <p className="mt-1.5 text-xs text-success">
          {t("propertyRequest.new.clarify.answered")}: {clarification.answer}
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <Input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t("propertyRequest.new.clarify.answerPlaceholder")}
            className="h-9"
          />
          <Button size="sm" onClick={() => onAnswer(answer)} disabled={!answer.trim()}>
            {t("propertyRequest.new.clarify.submitAnswer")}
          </Button>
        </div>
      )}
    </div>
  );
}
