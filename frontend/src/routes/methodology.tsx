import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  GraduationCap,
  Heart,
  Home,
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

export const Route = createFileRoute("/methodology")({
  head: () => ({
    meta: [
      { title: "Score Methodology — Maskan" },
      {
        name: "description",
        content:
          "Learn how Maskan calculates area scores: what data we use, how each score is weighted, when data refreshes, and what the scores mean.",
      },
    ],
  }),
  component: MethodologyPage,
});

// ── Score definitions ──────────────────────────────────────────────────────

const SCORES = [
  {
    key: "area",
    label: "Area Score",
    icon: MapPin,
    color: "bg-primary/10 text-primary",
    tagline: "Overall neighbourhood quality",
    description:
      "A composite of the four individual scores below, weighted to reflect what renters value most in a Saudi neighbourhood.",
    weights: [
      { label: "School quality & availability", pct: 30 },
      { label: "Healthcare access", pct: 25 },
      { label: "Commute to city centre", pct: 25 },
      { label: "Amenities & lifestyle", pct: 20 },
    ],
    sources: ["Maskan area intelligence: schools, hospitals, restaurants, gyms, mosques, malls, parks"],
    radius: null,
  },
  {
    key: "school",
    label: "School Score",
    icon: School,
    color: "bg-secondary/10 text-secondary",
    tagline: "Education access for families",
    description:
      "Measures how many quality schools are within a short drive, and whether the area has international / bilingual options — critical for expat and mixed families.",
    weights: [
      { label: "Average community rating of nearby schools (rescaled from 3–5 → 45–95)", pct: 75 },
      { label: "Number of schools within 3 km (up to +18 pts)", pct: 18 },
      { label: "Presence of international / bilingual schools (bonus up to +10 pts)", pct: 10 },
    ],
    sources: [
      "Maskan platform data: schools",
      "Keyword detection for: International, American, British, French, German, Pakistani, Indian",
    ],
    radius: "3 km radius",
  },
  {
    key: "healthcare",
    label: "Healthcare Score",
    icon: Hospital,
    color: "bg-success/10 text-success",
    tagline: "Medical access & quality",
    description:
      "Reflects how well-served the area is for health emergencies and routine care — number of hospitals and clinics nearby, their ratings, and whether major specialty centres are present.",
    weights: [
      { label: "Average community rating of nearby hospitals/clinics (rescaled)", pct: 75 },
      { label: "Number of hospitals/clinics within 3 km (up to +15 pts)", pct: 15 },
      { label: "Specialty / named hospital bonus (King Fahad, Saudi German, etc.)", pct: 15 },
    ],
    sources: [
      "Maskan platform data: hospitals & clinics",
      "Keyword detection for: Specialist, Medical Center, King, National, Saudi German",
    ],
    radius: "3 km radius",
  },
  {
    key: "traffic",
    label: "Traffic Score",
    icon: TrafficCone,
    color: "bg-warning/10 text-warning",
    tagline: "Commute ease to city centre",
    description:
      "Measures estimated peak-hour driving time from the district centre to the main business hub (KAFD / Olaya for Riyadh, Al Corniche for Jeddah, Al Khobar road for Dammam). Riyadh-tuned thresholds acknowledge the city's car-centric layout.",
    weights: [
      { label: "≤ 15 min", pct: 95 },
      { label: "≤ 20 min", pct: 88 },
      { label: "≤ 30 min", pct: 78 },
      { label: "≤ 40 min", pct: 65 },
      { label: "≤ 50 min", pct: 50 },
      { label: "≤ 60 min", pct: 35 },
      { label: "> 60 min", pct: 20 },
    ],
    sources: ["Maskan commute intelligence (peak-hour estimates, updated nightly)"],
    radius: "Point-to-point to city centre",
    weightsLabel: "Score by commute time",
  },
  {
    key: "family",
    label: "Family Score",
    icon: Users,
    color: "bg-ai-soft text-ai",
    tagline: "How well the area suits families",
    description:
      "A family-specific composite that weighs schools and healthcare more heavily than commute, and counts parks and green spaces as a meaningful factor alongside malls and restaurants.",
    weights: [
      { label: "School Score", pct: 35 },
      { label: "Healthcare Score", pct: 30 },
      { label: "Lifestyle score (amenities + parks)", pct: 20 },
      { label: "Traffic Score", pct: 15 },
    ],
    sources: ["Derived from the four individual scores above"],
    radius: null,
  },
];

const LIFESTYLE_FACTORS = [
  { icon: ShoppingBag, label: "Restaurants",       cap: "22 pts", note: "2 km, up to 22 pts"       },
  { icon: Heart,       label: "Gyms",              cap: "15 pts", note: "2 km, up to 15 pts"       },
  { icon: GraduationCap, label: "Mosques",         cap: "8 pts",  note: "1.5 km, capped low — present everywhere in Riyadh" },
  { icon: ShoppingBag, label: "Shopping Malls",    cap: "25 pts", note: "5 km, up to 25 pts"       },
  { icon: Trees,       label: "Parks & Green Spaces", cap: "15 pts", note: "3 km, up to 15 pts"   },
];

const BANDS = [
  { min: 85, max: 100, label: "Excellent",      color: "bg-success text-success-foreground",  note: "Premium district, top-tier services" },
  { min: 75, max: 84,  label: "Strong",          color: "bg-primary text-primary-foreground",  note: "Well-served area, strong fundamentals" },
  { min: 65, max: 74,  label: "Good",            color: "bg-info text-info-foreground",         note: "Solid neighbourhood, may lack some premium facilities" },
  { min: 50, max: 64,  label: "Below average",   color: "bg-warning text-warning-foreground",  note: "Fewer nearby services or longer commute" },
  { min: 0,  max: 49,  label: "Limited data",    color: "bg-muted text-muted-foreground",      note: "New development or limited platform coverage" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

function MethodologyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/areas"
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Area Intelligence
          </Link>
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Home className="size-4" />
            </span>
            <span className="text-base font-bold tracking-tight">Maskan</span>
          </Link>
          <Button size="sm" variant="outline" asChild>
            <Link to="/areas">Explore areas</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:px-6">

        {/* Hero */}
        <div className="mb-12 text-center">
          <Badge tone="ai" className="mb-4">
            <Sparkles className="size-3.5" /> Score methodology
          </Badge>
          <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
            How Maskan scores areas
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            Every score you see is calculated from live data collected and maintained by the{" "}
            <strong className="text-foreground">Maskan platform intelligence</strong> engine. No editorial
            guesses. No sponsorships. Refreshed every night at midnight.
          </p>
        </div>

        {/* Data freshness banner */}
        <div className="mb-12 flex flex-wrap items-start gap-4 rounded-2xl border border-border bg-surface-2/50 p-5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <RefreshCw className="size-5" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-sm font-semibold">Data freshness</div>
            <p className="text-sm text-muted-foreground">
              Scores are recalculated every night at <strong className="text-foreground">00:00 AST (Arabia Standard Time)</strong> by
              refreshing Maskan's area intelligence for each district. The "Last refreshed" date
              on every property and area page shows exactly when the data was last updated.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1">
              <Clock className="size-3.5" /> Refreshed nightly
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1">
              <Building2 className="size-3.5" /> 16 districts covered
            </span>
          </div>
        </div>

        {/* Score guide bands */}
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold tracking-tight">What the numbers mean</h2>
          <div className="grid gap-3 sm:grid-cols-5">
            {BANDS.map((b) => (
              <div key={b.label} className="rounded-xl border border-border bg-card p-4 text-center">
                <div className="mx-auto mb-2">
                  <ScoreRing score={Math.round((b.min + b.max) / 2)} size={52} />
                </div>
                <div className={cn("mb-1 rounded-full px-2 py-0.5 text-[11px] font-bold", b.color)}>{b.label}</div>
                <div className="text-[11px] text-muted-foreground">{b.min}–{b.max === 100 ? "100" : b.max}</div>
                <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{b.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Individual score cards */}
        <section className="mb-12">
          <h2 className="mb-6 text-xl font-bold tracking-tight">Score breakdown</h2>
          <div className="space-y-5">
            {SCORES.map((s) => (
              <div key={s.key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <div className="flex items-start gap-4 border-b border-border bg-surface-2/40 px-6 py-5">
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", s.color)}>
                    <s.icon className="size-5" />
                  </span>
                  <div>
                    <div className="text-lg font-bold tracking-tight">{s.label}</div>
                    <div className="text-sm text-muted-foreground">{s.tagline}</div>
                  </div>
                </div>
                <div className="grid gap-6 px-6 py-5 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                    {s.radius && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Search radius:</span> {s.radius}
                      </p>
                    )}
                    <div className="mt-4 space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Data sources
                      </div>
                      {s.sources.map((src) => (
                        <div key={src} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                          {src}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.weightsLabel ?? "Composition / weights"}
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
          <h2 className="mb-2 text-xl font-bold tracking-tight">Lifestyle score — what's included</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            The lifestyle score feeds into both Area Score (20%) and Family Score (20%). It is built
            from five place categories tracked by Maskan's area intelligence, each capped to prevent a single factor from
            dominating. Mosque count is intentionally capped low — mosques are present in every
            Riyadh block, so count is not a differentiator.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {LIFESTYLE_FACTORS.map((f) => (
              <div key={f.label} className="rounded-xl border border-border bg-card p-4 text-center">
                <div className="mx-auto mb-2 grid size-10 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
                  <f.icon className="size-5" />
                </div>
                <div className="text-sm font-semibold">{f.label}</div>
                <div className="mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  max {f.cap}
                </div>
                <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{f.note}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Limitations */}
        <section className="mb-12 rounded-2xl border border-warning/40 bg-warning/5 p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <h2 className="mb-3 text-lg font-bold tracking-tight">Known limitations</h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">Gated compounds &amp; diplomatic enclaves</strong> — places like Diplomatic Quarter (DQ) have limited publicly listed places because most facilities are private and inside the walls. Scores may understate the actual quality of living.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">New developments</strong> — recently built districts may have fewer listed places until businesses are added to the platform. Scores will improve automatically as coverage grows.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">Rating data</strong> — community ratings reflect public reviews and may not capture the full quality of a facility. We rescale ratings from the typical [3.0–5.0] cluster to a [45–95] range to avoid compressing all areas into a narrow band.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <strong className="text-foreground">Commute time</strong> — calculated at the time the nightly refresh runs (midnight). Rush-hour times may differ. Estimates are based on typical peak-hour conditions for each district.
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
              <MapPin className="mr-1.5 size-4" /> Explore area scores
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/search">
              <Building2 className="mr-1.5 size-4" /> Browse properties
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
