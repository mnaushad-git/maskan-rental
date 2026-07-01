import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Compass,
  Facebook,
  GitCompare,
  Home,
  Instagram,
  Linkedin,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Twitter,
  Users,
} from "lucide-react";
import { TopNav, Logo } from "@/components/maskan/TopNav";
import heroImg from "@/assets/hero-villa.jpg";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/maskan/SearchBar";
import { PropertyCard } from "@/components/maskan/PropertyCard";
import { Badge } from "@/components/maskan/Badges";
import { ScoreRing, ScoreBar } from "@/components/maskan/ScoreIndicator";
import {
  fetchProperties,
  fetchAreas,
  fetchAreaIntelligenceList,
  fetchAnalyticsSummary,
  fetchPublicPartners,
  mapApiProperty,
  type ApiAreaSummary,
  type ApiAreaIntelligenceSummary,
  type ApiPartnerPublic,
} from "@/lib/api/maskan";
import {
  featuredAreas,
  cities,
  aiQuickQuestions,
  formatSAR,
} from "@/lib/maskan-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Maskan — Find the Right Home with AI Rental Intelligence" },
      {
        name: "description",
        content:
          "Discover rental properties across Saudi Arabia. Compare areas, evaluate rental value, and find homes that match your lifestyle with Maskan's AI advisor.",
      },
      { property: "og:title", content: "Maskan — AI Rental Intelligence" },
      {
        property: "og:description",
        content:
          "Compare areas, evaluate rental value, and discover homes that match your lifestyle.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [liveAreas, setLiveAreas] = useState<ApiAreaSummary[]>([]);
  const [intelList, setIntelList] = useState<ApiAreaIntelligenceSummary[]>([]);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [featuredPartners, setFeaturedPartners] = useState<ApiPartnerPublic[]>([]);

  useEffect(() => {
    fetchAreas().then(setLiveAreas).catch(() => {});
    fetchAreaIntelligenceList().then(setIntelList).catch(() => {});
    fetchAnalyticsSummary().then(s => setTotalUsers(s.total_users)).catch(() => {});
    fetchPublicPartners().then(p => setFeaturedPartners(p.slice(0, 4))).catch(() => {});
  }, []);

  const cityCounts = useMemo(() => {
    // Normalise "Al Khobar" → "Khobar" to match static cities list
    const ALIAS: Record<string, string> = { "Al Khobar": "Khobar" };
    const m: Record<string, number> = {};
    liveAreas.forEach((a) => {
      const city = ALIAS[a.city] ?? a.city;
      m[city] = (m[city] ?? 0) + a.property_count;
    });
    return m;
  }, [liveAreas]);

  const liveRents = useMemo(() => {
    const m: Record<string, number> = {};
    liveAreas.forEach((a) => { m[a.name] = Math.round(a.average_rent * 12); });
    return m;
  }, [liveAreas]);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <Hero totalListings={liveAreas.reduce((s, a) => s + a.property_count, 0)} totalUsers={totalUsers} />
      <CitySelector liveCounts={cityCounts} />
      <AiQuickQuestions />
      <FeaturedAreas liveRents={liveRents} intelList={intelList} />
      <FeaturedProperties />
      <FeaturedPartners partners={featuredPartners} />
      <LeadCTA />
      <HowItWorks />
      <Footer />
    </div>
  );
}

/* --------------------------------- Hero ---------------------------------- */
function Hero({ totalListings, totalUsers }: { totalListings: number; totalUsers: number | null }) {
  return (
    <section id="search" className="relative overflow-hidden">
      <div className="container-page grid grid-cols-1 gap-8 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12 lg:py-20">
        <div>
          <Badge tone="ai" className="mb-4">
            <Sparkles className="size-3.5" /> Powered by Maskan AI
          </Badge>
          <h1 className="font-display text-2xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-[3.4rem] lg:leading-[1.05]">
            Find the right home with{" "}
            <span className="text-primary">AI rental intelligence</span>.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:mt-4 sm:text-base lg:text-lg">
            Compare areas, evaluate rental value, and discover homes that match your lifestyle —
            across Riyadh, Jeddah, Dammam, Khobar and Madinah.
          </p>

          <div className="mt-5 flex flex-col gap-2.5 sm:mt-6 sm:flex-row sm:flex-wrap sm:gap-3">
            <Button variant="hero" size="lg" className="w-full sm:w-auto" asChild>
              <Link to="/search">
                <Search /> Find properties
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
              <Link to="/advisor">
                <Sparkles /> Ask AI Advisor
              </Link>
            </Button>
          </div>

          <div className="mt-6">
            <SearchBar />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <span className="size-2 rounded-full bg-success" />
              {totalListings > 0 ? totalListings.toLocaleString() : "—"} verified listings
            </span>
            <span className="inline-flex items-center gap-2">
              <Users className="size-4" />
              {totalUsers !== null ? `${totalUsers.toLocaleString()} renters` : "Trusted by renters"}
            </span>
          </div>
        </div>

        {/* Hero image — hidden on small screens to keep the hero compact */}
        <div className="relative hidden md:block">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-elevated">
            <img
              src={heroImg}
              alt="Modern villa in Riyadh"
              width={1600}
              height={1100}
              className="aspect-[4/3] w-full object-cover"
            />
            <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/20 bg-background/85 p-4 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <ScoreRing score={96} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    Najdi Modern Villa — Al Yasmin
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3.5" /> Riyadh · 5BR · 480 m²
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-xs text-muted-foreground">From</div>
                  <div className="text-sm font-bold">SAR {formatSAR(235000)}/yr</div>
                </div>
              </div>
            </div>
          </div>

          <div className="absolute -start-6 top-10 hidden w-64 rounded-2xl border border-border bg-card p-4 shadow-elevated lg:block">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ai">
              <Sparkles className="size-3.5" /> AI Insight
            </div>
            <p className="text-sm">
              Rents in <span className="font-semibold">Al Yasmin</span> are 8% below similar
              districts. Good time to negotiate.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ City Selector ---------------------------- */
function CitySelector({ liveCounts }: { liveCounts: Record<string, number> }) {
  const navigate = useNavigate();
  const loaded = Object.keys(liveCounts).length > 0;

  return (
    <section className="border-y border-border bg-surface">
      <div className="container-page flex flex-col gap-3 py-5 md:flex-row md:items-center md:justify-between md:gap-5 md:py-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
            <Compass className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Browse by city</div>
            <div className="text-xs text-muted-foreground">
              Live listings across Saudi Arabia
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cities.map((c) => {
            const count = liveCounts[c.name] ?? 0;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => void navigate({ to: "/search", search: { city: c.name } })}
                className="group flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-all hover:border-primary hover:bg-primary hover:text-primary-foreground"
              >
                <MapPin className="size-3.5" />
                {c.name}
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground group-hover:bg-primary-foreground/15 group-hover:text-primary-foreground">
                  {loaded ? count.toLocaleString() : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- AI Quick Q's ----------------------------- */
function AiQuickQuestions() {
  const navigate = useNavigate();

  function askQuestion(q: string) {
    void navigate({ to: "/advisor", search: { q } as never });
  }

  return (
    <section id="ai" className="container-page py-10 sm:py-16">
      <div className="flex items-end justify-between gap-6">
        <div>
          <Badge tone="ai" className="mb-3">
            <Sparkles className="size-3.5" /> AI Advisor
          </Badge>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
            Ask Maskan AI anything
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Get instant, data-backed answers about neighborhoods, fair pricing and the best fit for
            your family.
          </p>
        </div>
        <Button variant="ai" className="hidden md:inline-flex" asChild>
          <Link to="/advisor">
            <Sparkles /> Open AI Advisor
          </Link>
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {aiQuickQuestions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => askQuestion(q)}
            className="group flex h-full flex-col justify-between gap-6 rounded-2xl border border-border bg-card p-5 text-start shadow-card transition-all hover:-translate-y-0.5 hover:border-ai/40 hover:shadow-elevated"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-xl bg-ai-soft text-ai">
                <Sparkles className="size-4" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quick question
              </span>
            </div>
            <p className="text-base font-semibold leading-snug tracking-tight">{q}</p>
            <div className="flex items-center justify-between text-sm font-semibold text-ai">
              Ask AI <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- Featured Areas ---------------------------- */
function FeaturedAreas({
  liveRents,
  intelList,
}: {
  liveRents: Record<string, number>;
  intelList: ApiAreaIntelligenceSummary[];
}) {
  return (
    <section id="areas" className="bg-surface">
      <div className="container-page py-10 sm:py-16">
        <div className="flex items-end justify-between gap-6">
          <div>
            <Badge tone="primary" className="mb-3">
              <Compass className="size-3.5" /> Featured areas
            </Badge>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
              Top neighborhoods in Riyadh
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              AI-scored areas based on family suitability, amenities and rental value.
            </p>
          </div>
          <Button variant="ghost" className="hidden md:inline-flex" asChild>
            <Link to="/areas">
              Explore all areas <ArrowRight />
            </Link>
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {featuredAreas.map((a) => {
            const avgRent = liveRents[a.name] ?? a.avgRent;
            const intel = intelList.find((i) => i.area_name === a.name);
            const areaScore = Math.round(intel?.area_score ?? a.areaScore);
            const familyScore = Math.round(intel?.family_score ?? a.familyScore);
            const rentalValueScore = Math.round(intel?.lifestyle_score ?? a.rentalValueScore);
            return (
              <Link
                key={a.name}
                to="/areas"
                className="group flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-1 hover:shadow-elevated"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-display text-lg font-bold tracking-tight">{a.name}</h3>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {a.city}
                    </p>
                  </div>
                  <ScoreRing score={areaScore} />
                </div>

                <div className="space-y-3">
                  <ScoreBar label="Area score" value={areaScore} />
                  <ScoreBar label="Family score" value={familyScore} />
                  <ScoreBar label="Rental value" value={rentalValueScore} />
                </div>

                <div className="rounded-xl bg-surface px-3 py-2.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Avg. rent:</span> SAR{" "}
                  {formatSAR(avgRent)}/yr
                </div>

                <div className="flex items-center gap-2 text-xs font-medium text-ai">
                  <Sparkles className="size-3.5" /> {a.highlight}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Featured Properties ------------------------- */
function FeaturedProperties() {
  const [properties, setProperties] = useState<ReturnType<typeof mapApiProperty>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProperties() {
      try {
        const data = await fetchProperties();
        if (!cancelled) {
          setProperties(data.map(mapApiProperty));
        }
      } catch {
        if (!cancelled) {
          setProperties([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProperties();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="container-page py-10 sm:py-16">
      <div className="flex items-end justify-between gap-6">
        <div>
          <Badge tone="secondary" className="mb-3">
            <Home className="size-3.5" /> Featured properties
          </Badge>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
            Handpicked homes this week
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Verified listings ranked by Maskan AI for match quality and rental value.
          </p>
        </div>
        <Button variant="ghost" className="hidden md:inline-flex" asChild>
          <Link to="/search">
            View all properties <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {properties.slice(0, 6).map((p) => (
          <PropertyCard key={p.id} p={p} />
        ))}
      </div>

      {!loading && properties.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">No live properties available yet.</p>
      )}
    </section>
  );
}

/* --------------------------- Featured Partners ---------------------------- */
const PARTNER_COLORS = [
  "bg-primary text-primary-foreground",
  "bg-emerald-600 text-white",
  "bg-violet-600 text-white",
  "bg-amber-600 text-white",
  "bg-rose-600 text-white",
  "bg-sky-600 text-white",
];

function partnerInitials(p: ApiPartnerPublic) {
  const name = p.agency_name ?? `P${p.id}`;
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function FeaturedPartners({ partners }: { partners: ApiPartnerPublic[] }) {
  if (partners.length === 0) return null;

  return (
    <section className="container-page py-10 sm:py-16">
      <div className="flex items-end justify-between gap-6">
        <div>
          <Badge tone="primary" className="mb-3">
            <Briefcase className="size-3.5" /> Verified partners
          </Badge>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
            Meet our partners
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Licensed real estate agents covering every district. Submit a lead and get matched within 24 hours.
          </p>
        </div>
        <Button variant="ghost" className="hidden md:inline-flex" asChild>
          <Link to="/partners">
            View all partners <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {partners.map((p) => {
          const displayName = p.agency_name ?? `Partner #${p.id}`;
          const partnerCities = Array.from(new Set(p.areas.map((a) => a.city)));
          return (
            <div
              key={p.id}
              className="relative flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated cursor-pointer"
            >
              {/* Invisible overlay makes the whole card navigate to the agent profile */}
              <Link
                to="/agent/$id"
                params={{ id: String(p.id) }}
                className="absolute inset-0 rounded-2xl"
                aria-label={`View ${displayName}'s profile`}
              />
              <div className="flex items-center gap-3">
                {p.profile_image_url ? (
                  <img
                    src={p.profile_image_url}
                    alt={displayName}
                    className="size-12 rounded-xl object-cover"
                  />
                ) : (
                  <div
                    className={`grid size-12 shrink-0 place-items-center rounded-xl text-base font-bold ${PARTNER_COLORS[p.id % PARTNER_COLORS.length]}`}
                  >
                    {partnerInitials(p)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-sm">{displayName}</div>
                  {p.is_verified && (
                    <div className="flex items-center gap-1 text-[11px] text-success font-medium">
                      <ShieldCheck className="size-3" /> Verified
                    </div>
                  )}
                </div>
              </div>

              {p.bio && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{p.bio}</p>
              )}

              <div className="flex flex-wrap gap-1 mt-auto">
                {partnerCities.map((city) => (
                  <span
                    key={city}
                    className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-foreground"
                  >
                    <MapPin className="inline size-2.5 mr-0.5" />{city}
                  </span>
                ))}
                {p.areas.length > 0 && (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                    {p.areas.length} district{p.areas.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center md:hidden">
        <Button variant="outline" asChild>
          <Link to="/partners">
            View all partners <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}

/* ----------------------------- Lead CTA ---------------------------------- */
function LeadCTA() {
  return (
    <section className="bg-surface border-y border-border">
      <div className="container-page py-10 sm:py-14">
        <div className="mx-auto max-w-3xl rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-background p-5 shadow-card sm:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <Badge tone="primary" className="mb-3">
                <Briefcase className="size-3.5" /> Partner matching
              </Badge>
              <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl md:text-3xl">
                Can't find the right property?
              </h2>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground sm:text-base">
                Submit a free lead request — licensed partners covering your district will reach out within 24 hours with matching options.
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                {[
                  "Free to submit — no account required",
                  "Partners cover 40+ districts across Saudi Arabia",
                  "Your contact details stay private until you're matched",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3 shrink-0">
              <Button variant="hero" size="lg" asChild>
                <Link to="/lead/new" search={{ area: "", city: "Riyadh" }}>
                  <Briefcase /> Submit a lead request
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/advisor">
                  <Sparkles /> Or ask AI Advisor
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ How it Works ----------------------------- */
function HowItWorks() {
  const steps = [
    {
      icon: Search,
      title: "Search",
      desc: "Browse verified listings or describe what you need in plain language — Maskan AI understands.",
    },
    {
      icon: GitCompare,
      title: "Compare",
      desc: "Side-by-side area scores, rental value and lifestyle fit, powered by real market signals.",
    },
    {
      icon: CheckCircle2,
      title: "Decide",
      desc: "Get an AI fairness check on the rent, then connect with verified agents — confidently.",
    },
  ];

  return (
    <section className="bg-surface">
      <div className="container-page py-10 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <Badge tone="neutral" className="mb-3">
            How Maskan works
          </Badge>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
            From search to signed lease — in 3 steps
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            A smarter rental journey, built around Saudi renters.
          </p>
        </div>

        <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="relative flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6"
            >
              <div className="flex items-center justify-between">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
                  <s.icon className="size-5" />
                </div>
                <span className="font-display text-3xl font-bold text-surface-2">
                  0{i + 1}
                </span>
              </div>
              <h3 className="font-display text-xl font-bold tracking-tight">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="hero" size="lg" className="flex-1 sm:flex-none" asChild>
            <Link to="/search">
              <Search /> Find properties
            </Link>
          </Button>
          <Button variant="outline" size="lg" className="flex-1 sm:flex-none" asChild>
            <Link to="/advisor">
              <Sparkles /> Ask AI Advisor
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- Footer -------------------------------- */
function Footer() {
  const cols = [
    {
      h: "Discover",
      l: [
        { label: "Search", to: "/search" },
        { label: "Explore Areas", to: "/areas" },
        { label: "AI Advisor", to: "/advisor" },
        { label: "Partners", to: "/partners" },
        { label: "Saved homes", to: "/saved" },
        { label: "Compare", to: "/compare" },
        { label: "Score Methodology", to: "/methodology" },
      ],
    },
    {
      h: "Cities",
      l: [
        { label: "Riyadh", to: "/search" },
        { label: "Jeddah", to: "/search" },
        { label: "Dammam", to: "/search" },
        { label: "Khobar", to: "/search" },
        { label: "Madinah", to: "/search" },
      ],
    },
  ] as const;

  return (
    <footer id="list" className="border-t border-border bg-background">
      <div className="container-page py-10 sm:py-14">
        <div className="grid gap-8 grid-cols-2 md:grid-cols-5">
          <div className="col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Maskan is the AI-powered rental intelligence platform for Saudi Arabia. Smarter
              search, fair pricing, better homes.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {[Twitter, Instagram, Linkedin, Facebook].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label="Social"
                  className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.h}>
              <div className="mb-3 text-sm font-semibold">{c.h}</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {c.l.map((i) => (
                  <li key={i.label}>
                    <Link to={i.to} className="hover:text-foreground">
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border bg-surface">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <Building2 className="size-3.5" />© {new Date().getFullYear()} Maskan. All rights
            reserved.
          </div>
          <div>Made for Saudi Arabia · Arabic support coming soon</div>
        </div>
      </div>
    </footer>
  );
}
