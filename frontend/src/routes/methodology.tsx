import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import {
  Building2,
  Calculator,
  CheckCircle2,
  Clock,
  GraduationCap,
  Heart,
  Hospital,
  Info,
  MapPin,
  RefreshCw,
  School,
  ShoppingBag,
  Sparkles,
  TrafficCone,
  Trees,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { ScoreRing } from "@/components/maskan/ScoreIndicator";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/methodology")({
  head: () => ({
    meta: [
      { title: "Score Methodology — myMakan" },
      {
        name: "description",
        content:
          "Learn how myMakan calculates area scores: what data we use, how each score is weighted, when data refreshes, and what the scores mean.",
      },
    ],
  }),
  component: MethodologyPage,
});

// Small helper so call sites can write tMethod("heading") instead of t("methodology.heading").
function useMethodT() {
  const { t } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => t(`methodology.${key}`, vars);
}

// ── Score definitions ──────────────────────────────────────────────────────

function useScores(tM: (key: string, vars?: Record<string, string | number>) => string) {
  return [
    {
      key: "area",
      label: tM("scores.area.label"),
      icon: MapPin,
      color: "bg-primary/10 text-primary",
      tagline: tM("scores.area.tagline"),
      description: tM("scores.area.description"),
      weights: [
        { label: tM("scores.area.w1"), pct: 30 },
        { label: tM("scores.area.w2"), pct: 25 },
        { label: tM("scores.area.w3"), pct: 25 },
        { label: tM("scores.area.w4"), pct: 20 },
      ],
      sources: [tM("scores.area.src1")],
      radius: null as string | null,
    },
    {
      key: "school",
      label: tM("scores.school.label"),
      icon: School,
      color: "bg-secondary/10 text-secondary",
      tagline: tM("scores.school.tagline"),
      description: tM("scores.school.description"),
      weights: [
        { label: tM("scores.school.w1"), pct: 75 },
        { label: tM("scores.school.w2"), pct: 18 },
        { label: tM("scores.school.w3"), pct: 10 },
      ],
      sources: [tM("scores.school.src1"), tM("scores.school.src2")],
      radius: tM("scores.school.radius") as string | null,
    },
    {
      key: "healthcare",
      label: tM("scores.healthcare.label"),
      icon: Hospital,
      color: "bg-success/10 text-success",
      tagline: tM("scores.healthcare.tagline"),
      description: tM("scores.healthcare.description"),
      weights: [
        { label: tM("scores.healthcare.w1"), pct: 75 },
        { label: tM("scores.healthcare.w2"), pct: 15 },
        { label: tM("scores.healthcare.w3"), pct: 15 },
      ],
      sources: [tM("scores.healthcare.src1"), tM("scores.healthcare.src2")],
      radius: tM("scores.healthcare.radius") as string | null,
    },
    {
      key: "traffic",
      label: tM("scores.traffic.label"),
      icon: TrafficCone,
      color: "bg-warning/10 text-warning",
      tagline: tM("scores.traffic.tagline"),
      description: tM("scores.traffic.description"),
      weights: [
        { label: "≤ 15 min", pct: 95 },
        { label: "≤ 20 min", pct: 88 },
        { label: "≤ 30 min", pct: 78 },
        { label: "≤ 40 min", pct: 65 },
        { label: "≤ 50 min", pct: 50 },
        { label: "≤ 60 min", pct: 35 },
        { label: "> 60 min", pct: 20 },
      ],
      sources: [tM("scores.traffic.src1")],
      radius: tM("scores.traffic.radius") as string | null,
      weightsLabel: tM("scoreByCommuteTime"),
    },
    {
      key: "family",
      label: tM("scores.family.label"),
      icon: Users,
      color: "bg-ai-soft text-ai",
      tagline: tM("scores.family.tagline"),
      description: tM("scores.family.description"),
      weights: [
        { label: tM("scores.family.w1"), pct: 35 },
        { label: tM("scores.family.w2"), pct: 30 },
        { label: tM("scores.family.w3"), pct: 20 },
        { label: tM("scores.family.w4"), pct: 15 },
      ],
      sources: [tM("scores.family.src1")],
      radius: null as string | null,
    },
  ];
}

function useLifestyleFactors(tM: (key: string, vars?: Record<string, string | number>) => string) {
  return [
    {
      icon: ShoppingBag,
      label: tM("lifestyle.restaurants"),
      cap: "22 pts",
      note: tM("lifestyle.restaurantsNote"),
    },
    { icon: Heart, label: tM("lifestyle.gyms"), cap: "15 pts", note: tM("lifestyle.gymsNote") },
    {
      icon: GraduationCap,
      label: tM("lifestyle.mosques"),
      cap: "8 pts",
      note: tM("lifestyle.mosquesNote"),
    },
    {
      icon: ShoppingBag,
      label: tM("lifestyle.malls"),
      cap: "25 pts",
      note: tM("lifestyle.mallsNote"),
    },
    { icon: Trees, label: tM("lifestyle.parks"), cap: "15 pts", note: tM("lifestyle.parksNote") },
  ];
}

function useBands(tM: (key: string, vars?: Record<string, string | number>) => string) {
  return [
    {
      min: 85,
      max: 100,
      label: tM("bands.excellent"),
      color: "bg-success text-success-foreground",
      note: tM("bands.excellentNote"),
    },
    {
      min: 75,
      max: 84,
      label: tM("bands.strong"),
      color: "bg-primary text-primary-foreground",
      note: tM("bands.strongNote"),
    },
    {
      min: 65,
      max: 74,
      label: tM("bands.good"),
      color: "bg-info text-info-foreground",
      note: tM("bands.goodNote"),
    },
    {
      min: 50,
      max: 64,
      label: tM("bands.belowAverage"),
      color: "bg-warning text-warning-foreground",
      note: tM("bands.belowAverageNote"),
    },
    {
      min: 0,
      max: 49,
      label: tM("bands.limitedData"),
      color: "bg-muted text-muted-foreground",
      note: tM("bands.limitedDataNote"),
    },
  ];
}

// ── Page ──────────────────────────────────────────────────────────────────────

function MethodologyPage() {
  const tM = useMethodT();
  const SCORES = useScores(tM);
  const LIFESTYLE_FACTORS = useLifestyleFactors(tM);
  const BANDS = useBands(tM);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:px-6">
        {/* Hero */}
        <div className="mb-12 text-center">
          <Badge tone="ai" className="mb-4">
            <Sparkles className="size-3.5" /> {tM("badge")}
          </Badge>
          <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
            {tM("heading")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            {tM("heroDesc", { engine: tM("heroEngine") })}
          </p>
        </div>

        {/* Data freshness banner */}
        <div className="mb-12 flex flex-wrap items-start gap-4 rounded-2xl border border-border bg-surface-2/50 p-5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <RefreshCw className="size-5" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-sm font-semibold">{tM("dataFreshness")}</div>
            <p className="text-sm text-muted-foreground">
              {tM("dataFreshnessDesc", { time: tM("dataFreshnessTime") })}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1">
              <Clock className="size-3.5" /> {tM("refreshedNightly")}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1">
              <Building2 className="size-3.5" /> {tM("districtsCovered")}
            </span>
          </div>
        </div>

        {/* Score guide bands */}
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold tracking-tight">{tM("whatNumbersMean")}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            {BANDS.map((b) => (
              <div
                key={b.label}
                className="rounded-xl border border-border bg-card p-4 text-center"
              >
                <div className="mx-auto mb-2">
                  <ScoreRing score={Math.round((b.min + b.max) / 2)} size={52} />
                </div>
                <div className={cn("mb-1 rounded-full px-2 py-0.5 text-[11px] font-bold", b.color)}>
                  {b.label}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {b.min}–{b.max === 100 ? "100" : b.max}
                </div>
                <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{b.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Individual score cards */}
        <section className="mb-12">
          <h2 className="mb-6 text-xl font-bold tracking-tight">{tM("scoreBreakdown")}</h2>
          <div className="space-y-5">
            {SCORES.map((s) => (
              <div
                key={s.key}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
              >
                <div className="flex items-start gap-4 border-b border-border bg-surface-2/40 px-6 py-5">
                  <span
                    className={cn("grid size-10 shrink-0 place-items-center rounded-xl", s.color)}
                  >
                    <s.icon className="size-5" />
                  </span>
                  <div>
                    <div className="text-lg font-bold tracking-tight">{s.label}</div>
                    <div className="text-sm text-muted-foreground">{s.tagline}</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-6 px-6 py-5 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                    {s.radius && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{tM("searchRadius")}</span>{" "}
                        {s.radius}
                      </p>
                    )}
                    <div className="mt-4 space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {tM("dataSources")}
                      </div>
                      {s.sources.map((src) => (
                        <div
                          key={src}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                        >
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                          {src}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.weightsLabel ?? tM("compositionWeights")}
                    </div>
                    <ul className="mt-3 space-y-2">
                      {s.weights.map((w) => (
                        <li key={w.label} className="flex items-center gap-3 text-sm">
                          <span className="w-10 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-center text-xs font-bold text-primary">
                            {s.key === "traffic" ? `${w.pct}` : `${w.pct}%`}
                          </span>
                          <span className="text-muted-foreground">{w.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Lifestyle / amenities sub-breakdown */}
        <section className="mb-12">
          <h2 className="mb-2 text-xl font-bold tracking-tight">{tM("lifestyle.heading")}</h2>
          <p className="mb-5 text-sm text-muted-foreground">{tM("lifestyle.desc")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {LIFESTYLE_FACTORS.map((f) => (
              <div
                key={f.label}
                className="rounded-xl border border-border bg-card p-4 text-center"
              >
                <div className="mx-auto mb-2 grid size-10 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
                  <f.icon className="size-5" />
                </div>
                <div className="text-sm font-semibold">{f.label}</div>
                <div className="mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  {tM("lifestyle.max", { cap: f.cap })}
                </div>
                <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{f.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Rent Calculator methodology */}
        <section className="mb-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Calculator className="size-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">{tM("rentCalc.heading")}</h2>
              <p className="text-sm text-muted-foreground">{tM("rentCalc.desc")}</p>
            </div>
          </div>

          <div className="space-y-5">
            {/* Payment frequency */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="border-b border-border bg-surface-2/40 px-6 py-4">
                <div className="text-base font-bold">{tM("rentCalc.paymentFrequency")}</div>
                <div className="text-sm text-muted-foreground">
                  {tM("rentCalc.paymentFrequencyDesc")}
                </div>
              </div>
              <div className="overflow-hidden">
                {[
                  {
                    label: tM("rentCalc.annual"),
                    formula: "Annual rent ÷ 1",
                    note: tM("rentCalc.annualNote"),
                  },
                  {
                    label: tM("rentCalc.semiAnnual"),
                    formula: "Annual rent ÷ 2",
                    note: tM("rentCalc.semiAnnualNote"),
                  },
                  {
                    label: tM("rentCalc.quarterly"),
                    formula: "Annual rent ÷ 4",
                    note: tM("rentCalc.quarterlyNote"),
                  },
                  {
                    label: tM("rentCalc.monthly"),
                    formula: "Annual rent ÷ 12",
                    note: tM("rentCalc.monthlyNote"),
                  },
                ].map((r, i, arr) => (
                  <div
                    key={r.label}
                    className={cn(
                      "grid grid-cols-[120px_1fr_1fr] gap-4 px-6 py-3 text-sm",
                      i < arr.length - 1 && "border-b border-border",
                    )}
                  >
                    <span className="font-semibold">{r.label}</span>
                    <span className="font-mono text-xs text-primary">{r.formula}</span>
                    <span className="text-muted-foreground">{r.note}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* First-year cost table */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="border-b border-border bg-surface-2/40 px-6 py-4">
                <div className="text-base font-bold">{tM("rentCalc.firstYearCost")}</div>
                <div className="text-sm text-muted-foreground">
                  {tM("rentCalc.firstYearCostDesc")}
                </div>
              </div>
              <div className="overflow-hidden">
                {[
                  {
                    label: tM("rentCalc.annualRent"),
                    formula: "= listing price",
                    basis: tM("rentCalc.annualRentBasis"),
                  },
                  {
                    label: tM("rentCalc.securityDeposit"),
                    formula: "Annual rent ÷ 12",
                    basis: tM("rentCalc.securityDepositBasis"),
                  },
                  {
                    label: tM("rentCalc.agencyFee"),
                    formula: "Annual rent × 2.5%",
                    basis: tM("rentCalc.agencyFeeBasis"),
                  },
                  {
                    label: tM("rentCalc.vat"),
                    formula: "0%",
                    basis: tM("rentCalc.vatBasis"),
                  },
                ].map((r, i, arr) => (
                  <div
                    key={r.label}
                    className={cn(
                      "grid gap-1 px-6 py-4 text-sm",
                      i < arr.length - 1 && "border-b border-border",
                    )}
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-semibold">{r.label}</span>
                      <span className="font-mono text-xs text-primary">{r.formula}</span>
                    </div>
                    <div className="text-muted-foreground">{r.basis}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Affordability thresholds */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="border-b border-border bg-surface-2/40 px-6 py-4">
                <div className="text-base font-bold">{tM("rentCalc.affordabilityCheck")}</div>
                <div className="text-sm text-muted-foreground">
                  {tM("rentCalc.affordabilityDesc", { rule: tM("rentCalc.thirtyPercentRule") })}
                </div>
              </div>
              <div className="px-6 py-4">
                <div className="mb-4 rounded-xl border border-border bg-surface-2/40 p-4 font-mono text-sm">
                  <span className="text-muted-foreground">{tM("rentCalc.pctFormula")}</span>
                  <span className="text-primary">{tM("rentCalc.pctFormulaCalc")}</span>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      range: "≤ 25%",
                      tone: "success",
                      label: tM("rentCalc.comfortablyAffordable"),
                      note: tM("rentCalc.comfortablyAffordableNote"),
                    },
                    {
                      range: "25% – 33%",
                      tone: "warning",
                      label: tM("rentCalc.borderline"),
                      note: tM("rentCalc.borderlineNote"),
                    },
                    {
                      range: "> 33%",
                      tone: "danger",
                      label: tM("rentCalc.aboveBudget"),
                      note: tM("rentCalc.aboveBudgetNote"),
                    },
                  ].map((b) => (
                    <div key={b.range} className="flex items-start gap-4">
                      <span
                        className={cn(
                          "mt-0.5 shrink-0 rounded-full px-3 py-1 text-xs font-bold",
                          b.tone === "success" && "bg-success/15 text-success",
                          b.tone === "warning" && "bg-warning/15 text-warning",
                          b.tone === "danger" && "bg-destructive/15 text-destructive",
                        )}
                      >
                        {b.range}
                      </span>
                      <div>
                        <div className="text-sm font-semibold">{b.label}</div>
                        <div className="text-sm text-muted-foreground">{b.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  {tM("rentCalc.grossSalaryNote")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Limitations */}
        <section className="mb-12 rounded-2xl border border-warning/40 bg-warning/5 p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <h2 className="mb-3 text-lg font-bold tracking-tight">{tM("limitations.heading")}</h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">{tM("limitations.gated")}</strong> —{" "}
                    {tM("limitations.gatedDesc")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">{tM("limitations.newDev")}</strong> —{" "}
                    {tM("limitations.newDevDesc")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">{tM("limitations.ratingData")}</strong> —{" "}
                    {tM("limitations.ratingDataDesc")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">{tM("limitations.commuteTime")}</strong> —{" "}
                    {tM("limitations.commuteTimeDesc")}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="flex flex-wrap items-center justify-center gap-3 text-center">
          <Button asChild size="lg">
            <Link to="/areas">
              <MapPin className="me-1.5 size-4" /> {tM("exploreAreaScores")}
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/search">
              <Building2 className="me-1.5 size-4" /> {tM("browseProperties")}
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
