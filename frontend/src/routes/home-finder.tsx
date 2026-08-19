import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  GitCompare,
  Loader2,
  Map as MapIcon,
  MessageCircle,
  Plus,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PropertyCard } from "@/components/maskan/PropertyCard";
import { PropertyMapView } from "@/components/maskan/PropertyMapView";
import { ScoreRing } from "@/components/maskan/ScoreIndicator";
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
import { cities as CITY_LIST, formatSAR } from "@/lib/maskan-data";
import type { Property } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

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
const PROPERTY_TYPES = ["Apartment", "Villa", "Penthouse", "Townhouse"] as const;

function storeAdvisorCtx(property: Property) {
  try {
    sessionStorage.setItem("maskan_advisor_ctx", JSON.stringify(property));
  } catch {
    // sessionStorage unavailable (private browsing edge case)
  }
}

export const Route = createFileRoute("/home-finder")({
  validateSearch: (s: Record<string, unknown>): { q?: string; transactionType?: "rent" | "sale" } => ({
    q: typeof s.q === "string" ? s.q : undefined,
    transactionType: s.transactionType === "sale" ? "sale" : s.transactionType === "rent" ? "rent" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "AI Home Finder — myMakan" },
      {
        name: "description",
        content:
          "Describe what you're looking for in plain language and myMakan AI finds and ranks the best matching properties.",
      },
    ],
  }),
  component: HomeFinderPage,
});

type Step = "input" | "understood" | "results";

function HomeFinderPage() {
  const { q, transactionType } = Route.useSearch();
  const { user } = useAuth();
  const { t, lang } = useLanguage();

  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState(q ?? "");
  const [hint, setHint] = useState<"rent" | "sale" | undefined>(transactionType);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<ApiHomeFinderCriteria>(EMPTY_HOME_FINDER_CRITERIA);
  const [clarifyingQuestions, setClarifyingQuestions] = useState<string[]>([]);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
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
    if (q) void handleInterpret(q);
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
    setSearchError(null);
    try {
      const resp = await searchHomeFinder({
        criteria: nextCriteria,
        limit: 20,
        query_text: text.trim() || undefined,
      });
      setResults(resp.results);
      setCategories(resp.categories);
      setEmptyResult(resp.empty_result);
      setStep("results");
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : t("homeFinder.results.errorFailed"));
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
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-6">
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
            error={searchError}
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
          />
        )}
      </div>

      {compareIds.length > 0 && step === "results" && (
        <CompareBar count={compareIds.length} onClear={() => setCompareIds([])} />
      )}

      {whyResult && <WhyThisPropertyModal result={whyResult} criteria={criteria} onClose={() => setWhyResult(null)} />}
    </div>
  );
}

// ── Step 1: free-text input ─────────────────────────────────────────────────

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
    <div className="mx-auto max-w-2xl py-6">
      <div className="mb-6 flex items-center gap-2 text-ai">
        <Sparkles className="size-5" />
        <span className="text-xs font-bold uppercase tracking-wider">{t("homeFinder.input.heading")}</span>
      </div>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("homeFinder.entryTitle")}</h1>
      <p className="mt-2 text-muted-foreground">{t("homeFinder.input.subheading")}</p>

      <div className="mt-6 grid grid-cols-2 gap-2">
        {(["rent", "sale"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setHint(v)}
            className={cn(
              "rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors",
              hint === v
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-surface-2",
            )}
          >
            {v === "rent" ? t("homeFinder.input.rent") : t("homeFinder.input.buy")}
          </button>
        ))}
      </div>

      <Textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("homeFinder.input.placeholder")}
        className="mt-4 text-base"
      />

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <Button
        variant="ai"
        size="lg"
        className="mt-4 w-full gap-2"
        disabled={interpreting || !text.trim()}
        onClick={onSubmit}
      >
        {interpreting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {interpreting ? t("homeFinder.input.thinking") : t("homeFinder.input.submit")}
      </Button>

      <div className="mt-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("homeFinder.examplesTitle")}
        </p>
        <div className="flex flex-col gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-xl border border-border bg-card px-4 py-3 text-start text-sm text-foreground shadow-card transition-colors hover:bg-surface-2"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("homeFinder.history.heading")}
          </p>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => onSelectHistory(h)}
                className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground shadow-card hover:bg-surface-2"
              >
                {h.query_text}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-3 text-sm text-muted-foreground">
        <Link to="/search" className="font-semibold text-foreground hover:underline">
          {t("homeFinder.searchNormally")}
        </Link>
      </div>
    </div>
  );
}

// ── Step 2: "myMakan understood" — editable structured criteria ────────────

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-surface text-foreground hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function CriterionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function UnderstoodStep({
  criteria,
  setCriteria,
  clarifyingQuestions,
  searching,
  error,
  onFindMatches,
  onModify,
}: {
  criteria: ApiHomeFinderCriteria;
  setCriteria: (c: ApiHomeFinderCriteria) => void;
  clarifyingQuestions: string[];
  searching: boolean;
  error: string | null;
  onFindMatches: () => void;
  onModify: () => void;
}) {
  const { t } = useLanguage();
  const [districtInput, setDistrictInput] = useState("");

  function update(patch: Partial<ApiHomeFinderCriteria>) {
    setCriteria({ ...criteria, ...patch });
  }

  function addDistrict() {
    const v = districtInput.trim();
    if (v && !criteria.districts.includes(v)) update({ districts: [...criteria.districts, v] });
    setDistrictInput("");
  }

  function toggleAmenity(key: string, list: "required_amenities" | "preferred_amenities") {
    const other = list === "required_amenities" ? "preferred_amenities" : "required_amenities";
    const current = criteria[list];
    if (current.includes(key)) {
      update({ [list]: current.filter((k) => k !== key) } as Partial<ApiHomeFinderCriteria>);
    } else {
      update({
        [list]: [...current, key],
        [other]: criteria[other].filter((k) => k !== key),
      } as Partial<ApiHomeFinderCriteria>);
    }
  }

  function togglePreference(key: string) {
    update({
      preferences: criteria.preferences.includes(key)
        ? criteria.preferences.filter((k) => k !== key)
        : [...criteria.preferences, key],
    });
  }

  return (
    <div className="mx-auto max-w-3xl py-6">
      <div className="mb-6 flex items-center gap-2 text-ai">
        <Sparkles className="size-5" />
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {t("homeFinder.understood.heading")}
        </h1>
      </div>

      {clarifyingQuestions.length > 0 && (
        <div className="mb-6 rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <p className="mb-1 text-sm font-semibold text-foreground">{t("homeFinder.understood.clarifyingQuestions")}</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {clarifyingQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CriterionCard label={t("homeFinder.understood.purpose")}>
          <div className="flex gap-2">
            {(["rent", "sale"] as const).map((v) => (
              <Chip key={v} active={criteria.transaction_type === v} onClick={() => update({ transaction_type: v })}>
                {v === "rent" ? t("homeFinder.understood.rentLabel") : t("homeFinder.understood.saleLabel")}
              </Chip>
            ))}
          </div>
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.city")}>
          <select
            value={criteria.city ?? ""}
            onChange={(e) => update({ city: e.target.value || null })}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">{t("homeFinder.understood.anyProperty")}</option>
            {CITY_LIST.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.budget")}>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder={t("homeFinder.understood.anyBudget")}
              value={criteria.max_price ?? ""}
              onChange={(e) => update({ max_price: e.target.value ? Number(e.target.value) : null })}
              className="h-9"
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {criteria.max_price
              ? criteria.transaction_type === "sale"
                ? t("homeFinder.understood.upTo", { amount: formatSAR(criteria.max_price) })
                : t("homeFinder.understood.upToPerYear", { amount: formatSAR(criteria.max_price) })
              : t("homeFinder.understood.anyBudget")}
          </p>
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.bedrooms")}>
          <Input
            type="number"
            min={0}
            value={criteria.bedrooms ?? ""}
            onChange={(e) => update({ bedrooms: e.target.value ? Number(e.target.value) : null })}
            className="h-9"
          />
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.preferredAreas")}>
          <div className="flex flex-wrap gap-1.5">
            {criteria.districts.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium"
              >
                {d}
                <button type="button" onClick={() => update({ districts: criteria.districts.filter((x) => x !== d) })}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <Input
              value={districtInput}
              onChange={(e) => setDistrictInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDistrict();
                }
              }}
              placeholder={t("homeFinder.understood.addDistrict")}
              className="h-8 text-xs"
            />
            <Button type="button" size="sm" variant="outline" onClick={addDistrict}>
              <Plus className="size-3.5" />
            </Button>
          </div>
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.commute")}>
          <Input
            value={criteria.commute_destination ?? ""}
            onChange={(e) => update({ commute_destination: e.target.value || null })}
            placeholder="KAFD"
            className="h-9"
          />
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.propertyType")}>
          <select
            value={criteria.property_type ?? ""}
            onChange={(e) => update({ property_type: e.target.value || null })}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">{t("homeFinder.understood.anyProperty")}</option>
            {PROPERTY_TYPES.map((pt) => (
              <option key={pt} value={pt}>
                {t(`propertyTypes.${pt}`)}
              </option>
            ))}
          </select>
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.mustHave")}>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_AMENITIES.map((a) => (
              <Chip key={a} active={criteria.required_amenities.includes(a)} onClick={() => toggleAmenity(a, "required_amenities")}>
                {t(`homeFinder.amenities.${a}`)}
              </Chip>
            ))}
          </div>
          {criteria.unsupported_requests.length > 0 && (
            <div className="mt-2">
              <div className="flex flex-wrap gap-1.5">
                {criteria.unsupported_requests.map((u) => (
                  <span key={u} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted-foreground">
                    {u}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("homeFinder.understood.notTracked")}</p>
            </div>
          )}
        </CriterionCard>

        <CriterionCard label={t("homeFinder.understood.lifestyle")}>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_PREFERENCES.map((p) => (
              <Chip key={p} active={criteria.preferences.includes(p)} onClick={() => togglePreference(p)}>
                {t(`homeFinder.preferences.${p}`)}
              </Chip>
            ))}
          </div>
        </CriterionCard>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex items-center gap-3">
        <Button variant="ghost" onClick={onModify}>
          <ArrowLeft className="size-4" /> {t("homeFinder.understood.modify")}
        </Button>
        <Button variant="ai" size="lg" className="flex-1 gap-2" disabled={searching} onClick={onFindMatches}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t("homeFinder.understood.findMatches")}
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: results ─────────────────────────────────────────────────────────

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
}) {
  const { t } = useLanguage();

  const categoryEntries: Array<{ key: keyof ApiHomeFinderCategories; label: string }> = [
    { key: "best_overall", label: t("homeFinder.results.categories.bestOverall") },
    { key: "best_value", label: t("homeFinder.results.categories.bestValue") },
    { key: "best_location", label: t("homeFinder.results.categories.bestLocation") },
    { key: "best_family", label: t("homeFinder.results.categories.bestFamily") },
  ];

  const mapProperties = results.map((r) => mapApiSearchProperty(r.property)).map((p, i) => ({
    ...p,
    matchScore: results[i].match_score,
    reasons: results[i].reasons,
  }));

  return (
    <div className="py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onNewSearch}
            className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> {t("homeFinder.results.newSearch")}
          </button>
          <h1 className="font-display text-2xl font-bold tracking-tight">{t("homeFinder.results.heading")}</h1>
          <p className="text-sm text-muted-foreground">{t("homeFinder.results.matchesCount", { count: results.length })}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setView(view === "list" ? "map" : "list")} className="gap-1.5">
          <MapIcon className="size-4" />
          {view === "list" ? t("homeFinder.results.viewOnMap") : t("homeFinder.results.backToList")}
        </Button>
      </div>

      {lastChanges.length > 0 && (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary-soft p-3 text-sm">
          <p className="mb-1 font-semibold text-foreground">{t("homeFinder.results.updatedSearch")}</p>
          {lastChanges.map((c, i) => (
            <p key={i} className="text-muted-foreground">
              {c.field}: {c.from} → {c.to}
            </p>
          ))}
        </div>
      )}

      {emptyResult && (
        <div className="mb-6 rounded-2xl border border-warning/30 bg-warning/10 p-5">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <TriangleAlert className="size-4 text-warning" /> {t("homeFinder.empty.heading")}
          </p>
          {emptyResult.restrictive_reasons.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">{emptyResult.message}</p>
          )}
          {emptyResult.suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {emptyResult.suggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => onApplySuggestion(s.criteria_patch)}
                  className="rounded-xl border border-border bg-card px-3 py-2 text-start text-xs shadow-card hover:bg-surface-2"
                >
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-muted-foreground">
                    {t("homeFinder.empty.possibleProperties", { count: s.estimated_count })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {categoryEntries
            .filter((c) => categories[c.key] != null)
            .map((c) => {
              const r = results.find((x) => x.property.id === categories[c.key]);
              if (!r) return null;
              return (
                <a
                  key={c.key}
                  href={`#hf-${r.property.id}`}
                  className="rounded-full border border-ai/30 bg-ai-soft px-3 py-1.5 text-xs font-semibold text-ai"
                >
                  {c.label}
                </a>
              );
            })}
        </div>
      )}

      {view === "map" ? (
        <PropertyMapView properties={mapProperties} showMatchInfo />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => (
            <div key={r.property.id} id={`hf-${r.property.id}`}>
              <MatchCard
                result={r}
                criteria={criteria}
                inCompare={compareIds.includes(String(r.property.id))}
                onToggleCompare={() => onToggleCompare(String(r.property.id))}
                onOpenWhy={() => onOpenWhy(r)}
              />
            </div>
          ))}
        </div>
      )}

      {!searching && results.length === 0 && !emptyResult && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("homeFinder.results.loading")}</p>
      )}

      <div className="sticky bottom-4 z-30 mx-auto mt-8 max-w-xl">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-elevated">
          <Input
            value={refineInstruction}
            onChange={(e) => setRefineInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRefine();
              }
            }}
            placeholder={t("homeFinder.results.refinePlaceholder")}
            className="h-10 flex-1 border-0 shadow-none focus-visible:ring-0"
          />
          <Button size="sm" disabled={refining || !refineInstruction.trim()} onClick={onRefine}>
            {refining ? <Loader2 className="size-4 animate-spin" /> : t("homeFinder.results.refineSubmit")}
          </Button>
        </div>
      </div>
    </div>
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
  const uiProperty = mapApiProperty(result.property);

  function askAiQuestion(): string {
    const parts: string[] = [];
    if (criteria.bedrooms) parts.push(`${criteria.bedrooms}-bedroom`);
    parts.push(criteria.property_type ?? "property");
    if (criteria.city) parts.push(`in ${criteria.city}`);
    return `I'm looking for a ${parts.join(" ")}. Tell me more about ${uiProperty.title} — is it a good fit for me?`;
  }

  return (
    <div
      className="relative"
      onClick={() => {
        // Prompt 9 (myMakan Property Intelligence): the only way criteria
        // survives navigation to the property page, so its "How it fits
        // your needs" section can render — mirrors the storeAdvisorCtx
        // sessionStorage handoff pattern used for the AI Advisor below.
        try {
          sessionStorage.setItem("maskan_home_finder_criteria", JSON.stringify(criteria));
        } catch {
          // sessionStorage unavailable (private browsing edge case)
        }
      }}
    >
      <div className="absolute start-3 top-3 z-10 rounded-full bg-background/95 p-0.5 shadow-card backdrop-blur">
        <ScoreRing score={result.match_score} size={44} />
      </div>
      <PropertyCard p={uiProperty} />
      <div className="-mt-px space-y-2 rounded-b-2xl border border-t-0 border-border bg-card p-4">
        {result.reasons.slice(0, 3).map((r) => (
          <p key={r} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> {r}
          </p>
        ))}
        {result.trade_offs[0] && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {result.trade_offs[0]}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onOpenWhy}>
            {t("homeFinder.results.whyThisProperty")}
          </Button>
          <Button variant={inCompare ? "secondary" : "outline"} size="sm" onClick={onToggleCompare} className="gap-1">
            <GitCompare className="size-3.5" />
            {inCompare ? t("homeFinder.results.added") : t("homeFinder.results.compare")}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/advisor"
              search={{ propertyId: result.property.id, q: askAiQuestion() }}
              onClick={() => storeAdvisorCtx(uiProperty)}
            >
              <MessageCircle className="size-3.5" /> {t("homeFinder.results.askAI")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompareBar({ count, onClear }: { count: number; onClear: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="sticky bottom-4 z-40 mx-auto w-full max-w-3xl px-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-elevated">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
            <GitCompare className="size-4" />
          </div>
          <div className="text-sm font-semibold">{count} selected</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="size-3.5" />
          </Button>
          {count >= 2 && (
            <Button variant="hero" size="sm" asChild>
              <Link to="/compare">{t("homeFinder.results.compare")}</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── "Why this property?" ────────────────────────────────────────────────────

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const priceInsight = (() => {
    if (criteria.max_price == null) return null;
    const within = uiProperty.price <= criteria.max_price;
    return within
      ? `Within your budget (SAR ${formatSAR(uiProperty.price)} vs your SAR ${formatSAR(criteria.max_price)} max).`
      : `Above your budget (SAR ${formatSAR(uiProperty.price)} vs your SAR ${formatSAR(criteria.max_price)} max).`;
  })();

  function askAiQuestion(): string {
    return `Tell me more about ${uiProperty.title} in ${uiProperty.district} — is it a good fit for what I'm looking for?`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ maxHeight: "min(92vh, 720px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-display text-base font-bold">{t("homeFinder.results.whyThisProperty")}</h3>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={result.match_score} size={64} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("homeFinder.whyModal.match")}</p>
              <p className="font-display text-2xl font-bold">{result.match_score}%</p>
            </div>
          </div>

          <p className="mt-4 text-sm text-foreground">
            {loading ? t("homeFinder.whyModal.loading") : summary}
          </p>

          {result.reasons.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("homeFinder.whyModal.strongPoints")}
              </p>
              <ul className="space-y-1">
                {result.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-1.5 text-sm">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.trade_offs.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("homeFinder.whyModal.tradeOffs")}
              </p>
              <ul className="space-y-1">
                {result.trade_offs.map((r) => (
                  <li key={r} className="flex items-start gap-1.5 text-sm">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {areaIntel && (
            <div className="mt-4 rounded-xl border border-border bg-surface p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("homeFinder.whyModal.areaInsight")}
              </p>
              <p className="text-sm text-foreground">
                {areaIntel.area_name}: {areaIntel.area_score != null ? Math.round(areaIntel.area_score) : "—"}/100
                {areaIntel.family_score != null ? ` · Family ${Math.round(areaIntel.family_score)}/100` : ""}
                {areaIntel.school_score != null ? ` · Schools ${Math.round(areaIntel.school_score)}/100` : ""}
              </p>
              {areaIntel.overview && <p className="mt-1 text-xs text-muted-foreground">{areaIntel.overview}</p>}
            </div>
          )}

          {priceInsight && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("homeFinder.whyModal.priceInsight")}
              </p>
              <p className="text-sm text-foreground">{priceInsight}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <Button variant="ai" className="w-full gap-2" asChild>
            <Link to="/advisor" search={{ propertyId: result.property.id, q: askAiQuestion() }} onClick={() => storeAdvisorCtx(uiProperty)}>
              <MessageCircle className="size-4" /> {t("homeFinder.whyModal.continueToAdvisor")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
