import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  Building2,
  Calculator,
  Calendar,
  Car,
  CheckCircle2,
  GitCompare,
  GraduationCap,
  Heart,
  Hospital,
  Lightbulb,
  MapPin,
  Maximize,
  MessageCircle,
  Phone,
  School,
  Send,
  ShoppingBag,
  Sofa,
  Sparkles,
  Trees,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, RecommendationBadge, StatusBadge } from "@/components/maskan/Badges";
import { ScoreRing, ScoreBar } from "@/components/maskan/ScoreIndicator";
import { PropertyCard } from "@/components/maskan/PropertyCard";
import {
  fetchProperties, fetchProperty, fetchAreas, fetchAreaIntelligence,
  fetchSavedProperties, saveProperty, deleteSavedProperty, updateSavedProperty, mapApiProperty,
  computePropertyScore,
  type ApiAreaIntelligence,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { formatSAR, type Property } from "@/lib/maskan-data";
import prop1 from "@/assets/prop-1.jpg";
import prop2 from "@/assets/prop-2.jpg";
import prop3 from "@/assets/prop-3.jpg";
import prop4 from "@/assets/prop-4.jpg";
import heroImg from "@/assets/hero-villa.jpg";

export const Route = createFileRoute("/property/$id")({
  head: () => ({
    meta: [
      { title: "Property Details — Maskan" },
      { name: "description", content: "Rental intelligence, area scores, fair rent and AI insights for this property." },
    ],
  }),
  component: PropertyDetail,
});

const GALLERY = [heroImg, prop1, prop2, prop3, prop4];

function PropertyDetail() {
  const { id } = Route.useParams();
  const [property, setProperty] = useState<Property | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [areaIntel, setAreaIntel] = useState<ApiAreaIntelligence | null>(null);
  const [areaAvgMonthly, setAreaAvgMonthly] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const propertyScore = useMemo(
    () => property
      ? computePropertyScore(property.price / 12, property.bedrooms, areaIntel?.area_score, areaAvgMonthly ?? undefined)
      : 72,
    [property, areaIntel, areaAvgMonthly],
  );

  useEffect(() => {
    let cancelled = false;
    const propertyId = Number(id);
    if (Number.isNaN(propertyId)) { setError("Invalid property id."); setLoading(false); return; }

    async function loadAll() {
      try {
        setLoading(true);
        setError(null);
        const [propertyData, propertiesData] = await Promise.all([
          fetchProperty(propertyId),
          fetchProperties(),
        ]);
        if (cancelled) return;
        const mapped = mapApiProperty(propertyData);
        setProperty(mapped);
        setProperties(propertiesData.map(mapApiProperty));

        // Now load area-specific data in parallel (non-blocking)
        Promise.all([
          fetchAreaIntelligence(mapped.district, mapped.city).catch(() => null),
          fetchAreas().catch(() => []),
        ]).then(([intel, areas]) => {
          if (cancelled) return;
          setAreaIntel(intel);
          const match = areas.find(a => a.name.toLowerCase() === mapped.district.toLowerCase());
          if (match) setAreaAvgMonthly(Math.round(match.average_rent));
        });
      } catch {
        if (!cancelled) setError("Unable to load this property.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="container-page py-12 text-sm text-muted-foreground">Loading property...</div>;
  if (error || !property) {
    return (
      <div className="container-page py-12">
        <p className="text-sm text-destructive">{error ?? "Property not found."}</p>
        <Link to="/search" className="mt-4 inline-block text-sm text-primary">Back to search</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container-page py-6">
        <Link to="/search" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to results
        </Link>
      </div>

      <Gallery title={property.title} images={property.images} />

      <div className="container-page grid grid-cols-1 gap-10 pb-32 lg:pb-16 lg:grid-cols-[1.7fr_1fr]">
        <main className="space-y-10">
          <Summary property={property} />
          <RentalIntelligence property={property} areaIntel={areaIntel} areaAvgMonthly={areaAvgMonthly} />
          <FairRent property={property} areaAvgMonthly={areaAvgMonthly} />
          <RentCalculator property={property} />
          <AreaSummary property={property} areaIntel={areaIntel} />
          <NearbyPlaces areaIntel={areaIntel} district={property.district} />
          <ComparableListings currentId={property.id} properties={properties} />
          <AiSummary property={property} areaIntel={areaIntel} areaAvgMonthly={areaAvgMonthly} />
        </main>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <ActionsCard property={property} propertyScore={propertyScore} />
          <LandlordCard agentName={property.agent} agentPhone={property.agentPhone} agentProfileImage={property.agentProfileImage} mediatorId={property.mediatorId} />
        </aside>
      </div>

      {/* Mobile sticky contact bar — fixed at bottom, hidden on desktop */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground">Annual rent</div>
            <div className="truncate text-base font-bold tracking-tight">
              SAR {formatSAR(property.price)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                / SAR {formatSAR(Math.round(property.price / 12))}/mo
              </span>
            </div>
          </div>
          {property.agentPhone ? (
            <>
              <a
                href={`https://wa.me/${property.agentPhone.replace(/\D/g, "").replace(/^0/, "966")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white"
              >
                <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                WhatsApp
              </a>
              <a
                href={`tel:${property.agentPhone}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold"
              >
                <Phone className="size-4" /> Call
              </a>
            </>
          ) : (
            <Link
              to="/lead/new"
              search={{ area: property.district, city: property.city }}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <MessageCircle className="size-4" /> Find agent
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Gallery -------------------------------- */
function Gallery({ title, images: realImages }: { title: string; images: string[] }) {
  const [active, setActive] = useState(0);

  // Pad to at least 5 slots with placeholder images so the grid never looks sparse
  const PLACEHOLDERS = [heroImg, prop1, prop2, prop3, prop4];
  const images = realImages.length > 0
    ? [...realImages, ...PLACEHOLDERS].slice(0, Math.max(realImages.length, 5))
    : PLACEHOLDERS;

  return (
    <section className="container-page space-y-3">
      {/* Airbnb-style panel grid */}
      <div className="overflow-hidden rounded-2xl bg-border md:h-[480px]">
        <div className="grid h-full gap-px grid-cols-1 md:grid-cols-[2fr_1fr_1fr] md:grid-rows-2">
          {/* Main image – spans both rows on desktop */}
          <div className="relative overflow-hidden bg-surface-2 aspect-[4/3] md:aspect-auto md:row-span-2">
            <img
              key={active}
              src={images[active]}
              alt={title}
              className="size-full object-cover"
            />
            <div className="absolute left-4 top-4 flex gap-2">
              <RecommendationBadge label="Verified" />
              <RecommendationBadge label="Best Match" />
            </div>
            <div className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold shadow-card backdrop-blur-sm">
              <Maximize className="size-3.5" /> {active + 1} / {images.length}
            </div>
          </div>

          {/* 4 side panels (2 × 2) – hidden on mobile */}
          {images.slice(1, 5).map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i + 1)}
              className={cn(
                "relative hidden overflow-hidden bg-surface-2 transition-opacity hover:opacity-85 md:block",
                active === i + 1 && "ring-2 ring-inset ring-primary",
              )}
            >
              <img src={src} alt="" className="size-full object-cover" />
              {i === 3 && images.length > 5 && (
                <div className="absolute inset-0 grid place-items-center bg-foreground/50 text-sm font-semibold text-white backdrop-blur-[1px]">
                  +{images.length - 4} more
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable thumbnail strip — all images, works on every device */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((src, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "h-16 w-24 shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-150",
              active === i
                ? "border-primary opacity-100 scale-[1.06] shadow-sm"
                : "border-transparent opacity-60 hover:opacity-90 hover:border-border",
            )}
          >
            <img src={src} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- Summary -------------------------------- */
function Summary({ property }: { property: Property }) {
  const facts = [
    { icon: <BedDouble className="size-4" />, label: "Bedrooms", value: property.bedrooms },
    { icon: <Bath className="size-4" />, label: "Bathrooms", value: property.bathrooms },
    { icon: <Maximize className="size-4" />, label: "Area", value: `${property.area} m²` },
    { icon: <Sofa className="size-4" />, label: "Furnishing", value: "Semi-furnished" },
    { icon: <Calendar className="size-4" />, label: "Building age", value: "3 years" },
    { icon: <Car className="size-4" />, label: "Parking", value: "2 covered" },
  ];
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge status={property.status} />
            <Badge tone="neutral">{property.type}</Badge>
            <Badge tone="neutral">ID {property.id}</Badge>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{property.title}</h1>
          <p className="mt-2 inline-flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-4" /> {property.district}, {property.city}
          </p>
        </div>
        <div className="text-end">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Annual rent</div>
          <div className="font-display text-3xl font-bold tracking-tight md:text-4xl">SAR {formatSAR(property.price)}</div>
          <div className="mt-1 text-sm text-muted-foreground">SAR {formatSAR(property.pricePerSqm)} / m²</div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-4 border-t border-border pt-6 md:grid-cols-3 lg:grid-cols-6">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{f.icon} {f.label}</div>
            <div className="mt-1 truncate text-sm font-semibold">{f.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------- Rental Intelligence --------------------------- */
function computePriceFairness(monthlyRent: number, areaAvg: number | null): number {
  if (!areaAvg) return 75;
  const ratio = monthlyRent / areaAvg;
  if (ratio < 0.85) return 97;
  if (ratio < 0.95) return 88;
  if (ratio < 1.05) return 82;
  if (ratio < 1.15) return 68;
  return 52;
}

function RentalIntelligence({
  property, areaIntel, areaAvgMonthly,
}: { property: Property; areaIntel: ApiAreaIntelligence | null; areaAvgMonthly: number | null }) {
  const monthlyRent = Math.round(property.price / 12);
  const priceFairness = computePriceFairness(monthlyRent, areaAvgMonthly);
  const areaQuality = Math.round(areaIntel?.area_score ?? 75);
  const amenities = Math.round(areaIntel?.lifestyle_score ?? 75);
  const commute = Math.round(areaIntel?.traffic_score ?? 75);
  const family = Math.round(areaIntel?.family_score ?? 75);
  const overall = Math.round(0.25 * priceFairness + 0.25 * areaQuality + 0.20 * amenities + 0.15 * commute + 0.15 * family);

  const breakdown = [
    { label: "Price Fairness", value: priceFairness },
    { label: "Area Quality", value: areaQuality },
    { label: "Amenities", value: amenities },
    { label: "Commute", value: commute },
    { label: "Family Suitability", value: family },
  ];

  const verdict = overall >= 85 ? "Excellent value" : overall >= 75 ? "Strong value" : overall >= 65 ? "Fair value" : "Below average";

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Badge tone="ai" className="mb-3"><Sparkles className="size-3.5" /> Maskan AI Rental Intelligence</Badge>
          <h2 className="font-display text-2xl font-bold tracking-tight">Rental Score</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Composite of price fairness, area quality, amenities, commute, and family fit — from Maskan platform intelligence.
          </p>
        </div>
        <div className="flex items-center gap-4 rounded-2xl bg-surface px-5 py-4">
          <ScoreRing score={overall} size={84} />
          <div>
            <div className="text-3xl font-bold tracking-tight">{overall}<span className="text-base text-muted-foreground">/100</span></div>
            <div className="text-xs font-semibold text-primary">{verdict}</div>
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {breakdown.map((b) => <ScoreBar key={b.label} label={b.label} value={b.value} />)}
      </div>
      {areaIntel && (
        <p className="mt-4 text-xs text-muted-foreground">
          Maskan platform scores · Last refreshed {new Date(areaIntel.last_refreshed_at ?? "").toLocaleDateString("en-SA")}
        </p>
      )}
    </section>
  );
}

/* ------------------------------- Fair Rent ------------------------------- */
function FairRent({ property, areaAvgMonthly }: { property: Property; areaAvgMonthly: number | null }) {
  const current = Math.round(property.price / 12);

  if (areaAvgMonthly === null) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
        <h2 className="font-display text-2xl font-bold tracking-tight">Fair Rent Analysis</h2>
        <p className="mt-2 text-sm text-muted-foreground">Loading market comparison…</p>
      </section>
    );
  }

  const min = Math.round(areaAvgMonthly * 0.85);
  const max = Math.round(areaAvgMonthly * 1.05);
  const isOverpriced = current > max;
  const isUndermarket = current < min;
  const verdict = isOverpriced ? "Slightly Overpriced" : isUndermarket ? "Below Market" : "Fair Price";
  const tone = isOverpriced ? "warning" : isUndermarket ? "success" : "primary";
  const diff = current - max;
  const scaleMin = min - (max - min);
  const scaleMax = max + (max - min);
  const pct = Math.min(100, Math.max(0, ((current - scaleMin) / (scaleMax - scaleMin)) * 100));

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Fair Rent Analysis</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Compared to similar listings in {property.district} over the last 90 days.
          </p>
        </div>
        <Badge tone={tone} icon={<TrendingUp className="size-3.5" />}>{verdict}</Badge>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl bg-surface p-4">
          <div className="text-xs text-muted-foreground">Current rent</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">SAR {formatSAR(current)}</div>
          <div className="text-xs text-muted-foreground">/ month</div>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <div className="text-xs text-muted-foreground">Market range</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">SAR {formatSAR(min)} – {formatSAR(max)}</div>
          <div className="text-xs text-muted-foreground">/ month</div>
        </div>
        {isOverpriced ? (
          <div className="rounded-xl bg-warning/10 p-4">
            <div className="text-xs text-warning-foreground">Difference</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-warning-foreground">+SAR {formatSAR(diff)}</div>
            <div className="text-xs text-warning-foreground">above fair market</div>
          </div>
        ) : isUndermarket ? (
          <div className="rounded-xl bg-success/10 p-4">
            <div className="text-xs text-success">Savings potential</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-success">SAR {formatSAR(-diff)}/mo</div>
            <div className="text-xs text-success">below market average</div>
          </div>
        ) : (
          <div className="rounded-xl bg-primary-soft p-4">
            <div className="text-xs text-accent-foreground">Status</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-primary">Fair Price</div>
            <div className="text-xs text-muted-foreground">within market range</div>
          </div>
        )}
      </div>
      <div className="mt-8">
        <div className="relative h-2 w-full rounded-full bg-surface-2">
          <div className="absolute h-2 rounded-full bg-primary/70"
            style={{ left: `${((min - scaleMin) / (scaleMax - scaleMin)) * 100}%`, right: `${100 - ((max - scaleMin) / (scaleMax - scaleMin)) * 100}%` }} />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pct}%` }}>
            <div className={`size-4 rounded-full border-2 border-background shadow-card ${isOverpriced ? "bg-warning" : isUndermarket ? "bg-success" : "bg-primary"}`} />
          </div>
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>SAR {formatSAR(scaleMin)}</span>
          <span className="font-semibold text-primary">Fair range</span>
          <span>SAR {formatSAR(scaleMax)}</span>
        </div>
      </div>
    </section>
  );
}

const SCORE_WHAT_IT_COVERS: Record<string, string> = {
  "Area Score":       "Schools (30%) · Healthcare (25%) · Commute (25%) · Amenities (20%)",
  "School Score":     "Rating & count of schools within 3 km · Bonus for international schools",
  "Traffic Score":    "Peak-hour drive time to city centre (KAFD / Olaya district)",
  "Healthcare Score": "Rating & count of hospitals/clinics within 3 km · Specialty centre bonus",
  "Family Score":     "Schools (35%) · Healthcare (30%) · Amenities & parks (20%) · Commute (15%)",
};

/* ----------------------------- Area Summary ------------------------------ */
function AreaSummary({ property, areaIntel }: { property: Property; areaIntel: ApiAreaIntelligence | null }) {
  const scores = areaIntel ? [
    { label: "Area Score",       value: Math.round(areaIntel.area_score ?? 75) },
    { label: "School Score",     value: Math.round(areaIntel.school_score ?? 75) },
    { label: "Traffic Score",    value: Math.round(areaIntel.traffic_score ?? 75) },
    { label: "Healthcare Score", value: Math.round(areaIntel.healthcare_score ?? 75) },
    { label: "Family Score",     value: Math.round(areaIntel.family_score ?? 75) },
  ] : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">{property.district} — Area Insights</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {areaIntel ? `Maskan platform scores · ${areaIntel.commute_minutes_to_center} min commute to city centre` : "How this district scores across the things renters care about most."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><a href="/areas">Explore area</a></Button>
          <Button variant="ghost" size="sm" asChild><Link to="/methodology">How scores work</Link></Button>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(scores ?? [
          { label: "Area Score", value: 75 },
          { label: "School Score", value: 75 },
          { label: "Traffic Score", value: 75 },
          { label: "Healthcare Score", value: 75 },
          { label: "Family Score", value: 75 },
        ]).map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-4 text-center">
            <div className="mx-auto"><ScoreRing score={s.value} size={64} /></div>
            <div className="mt-2 text-sm font-semibold">{s.label}</div>
            <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
              {SCORE_WHAT_IT_COVERS[s.label]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- Nearby Places ----------------------------- */
function NearbyPlaces({ areaIntel, district }: { areaIntel: ApiAreaIntelligence | null; district: string }) {
  if (!areaIntel) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
        <h2 className="font-display text-2xl font-bold tracking-tight">Nearby Places</h2>
        <p className="mt-2 text-sm text-muted-foreground">Loading nearby places from Maskan…</p>
      </section>
    );
  }

  const groups: Array<{ title: string; icon: React.ReactNode; items: Array<{ name: string; distance: string; rating?: number }> }> = [
    {
      title: "Schools",
      icon: <School className="size-4" />,
      items: areaIntel.schools.slice(0, 3).map(s => ({
        name: s.name,
        distance: `${s.distance_km} km`,
        rating: s.rating > 0 ? s.rating : undefined,
      })),
    },
    {
      title: "Hospitals & Clinics",
      icon: <Hospital className="size-4" />,
      items: areaIntel.hospitals.slice(0, 3).map(h => ({
        name: h.name,
        distance: `${h.distance_km} km`,
        rating: h.rating > 0 ? h.rating : undefined,
      })),
    },
    {
      title: "Mosques",
      icon: <GraduationCap className="size-4" />,
      items: (areaIntel.lifestyle.mosques.places ?? []).slice(0, 3).map(m => ({
        name: m.name,
        distance: `${m.distance_km} km`,
      })),
    },
    {
      title: "Shopping Malls",
      icon: <ShoppingBag className="size-4" />,
      items: (areaIntel.lifestyle.malls.places ?? []).slice(0, 3).map(m => ({
        name: m.name,
        distance: `${m.distance_km} km`,
        rating: m.rating && m.rating > 0 ? m.rating : undefined,
      })),
    },
    {
      title: "Parks & Green Spaces",
      icon: <Trees className="size-4" />,
      items: (areaIntel.lifestyle.parks?.places ?? []).slice(0, 3).map(p => ({
        name: p.name,
        distance: `${p.distance_km} km`,
        rating: p.rating && p.rating > 0 ? p.rating : undefined,
      })),
    },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Nearby Places</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Real distances from {district} · via Maskan area intelligence
          </p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="rounded-xl border border-border p-5">
            <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
              <span className="grid size-7 place-items-center rounded-md bg-primary-soft text-primary">{g.icon}</span>
              {g.title}
            </div>
            {g.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data available for this area.</p>
            ) : (
              <ul className="space-y-2.5">
                {g.items.map((item) => (
                  <li key={item.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-foreground">{item.name}</span>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {item.rating && <span className="text-amber-500">★ {item.rating}</span>}
                      <span className="font-medium">{item.distance}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------- Comparable Listings -------------------------- */
function ComparableListings({ currentId, properties }: { currentId: string; properties: Property[] }) {
  const comps = properties.filter((p) => p.id !== currentId).slice(0, 5);
  return (
    <section>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Comparable Listings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Similar homes ranked by AI rental value.</p>
        </div>
        <Button variant="ghost" size="sm" asChild><Link to="/search">View all</Link></Button>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {comps.slice(0, 3).map((p) => <PropertyCard key={p.id} p={p} />)}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {comps.slice(3, 5).map((p) => <PropertyCard key={p.id} p={p} />)}
      </div>
    </section>
  );
}

/* ----------------------------- AI Summary -------------------------------- */
function AiSummary({ property, areaIntel, areaAvgMonthly }: {
  property: Property;
  areaIntel: ApiAreaIntelligence | null;
  areaAvgMonthly: number | null;
}) {
  const monthlyRent = Math.round(property.price / 12);
  const familyScore = areaIntel?.family_score ?? 0;
  const schoolScore = areaIntel?.school_score ?? 0;
  const commute = areaIntel?.commute_minutes_to_center;
  const schoolCount = areaIntel?.schools?.length ?? 0;
  const tags = areaIntel?.tags ?? [];

  const isOverpriced = areaAvgMonthly ? monthlyRent > Math.round(areaAvgMonthly * 1.05) : false;
  const isUndermarket = areaAvgMonthly ? monthlyRent < Math.round(areaAvgMonthly * 0.85) : false;
  const priceDiff = areaAvgMonthly ? Math.abs(monthlyRent - areaAvgMonthly) : 0;

  const priceText = isOverpriced
    ? `priced approximately SAR ${formatSAR(priceDiff)}/month above the local market average`
    : isUndermarket
    ? `priced SAR ${formatSAR(priceDiff)}/month below market — excellent value`
    : "priced within the fair market range for this district";

  const familyText = familyScore >= 65
    ? "an excellent choice for families"
    : familyScore >= 50
    ? "a solid choice for most renters"
    : "suitable for singles or couples";

  const commuteText = commute
    ? commute <= 20
      ? `just ${commute} min to the city centre`
      : commute <= 35
      ? `${commute} min commute to the city centre`
      : `${commute} min from the city centre`
    : null;

  const highlights = [
    familyScore >= 60 && "Family-friendly community with strong area scores",
    schoolCount >= 3 && `${schoolCount} schools within the district`,
    commuteText && `Commute: ${commuteText}`,
    !isOverpriced && "Competitively priced for the area",
    tags.includes("Luxury") && "Premium district location",
    tags.includes("Walkable") && "Walkable neighbourhood",
  ].filter(Boolean) as string[];

  const titleVerdict = isOverpriced ? "slightly above market" : isUndermarket ? "below market price" : "fair market price";

  return (
    <section id="ai" className="relative overflow-hidden rounded-2xl border border-ai/20 bg-gradient-to-br from-ai-soft via-card to-card p-6 shadow-elevated md:p-8">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-ai text-ai-foreground shadow-card">
          <Sparkles className="size-5" />
        </div>
        <div className="flex-1">
          <Badge tone="ai" className="mb-2">Maskan AI Summary</Badge>
          <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">
            {familyText} — {titleVerdict}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            This {property.type.toLowerCase()} in <strong className="text-foreground">{property.district}</strong> is {priceText}.
            {areaIntel && (
              <> The area scores <strong className="text-foreground">{Math.round(areaIntel.area_score ?? 0)}/100</strong> overall with a family score of <strong className="text-foreground">{Math.round(familyScore)}</strong>
              {schoolScore > 0 && <> and school score of <strong className="text-foreground">{Math.round(schoolScore)}</strong></>}.
              {commuteText && <> Located <strong className="text-foreground">{commuteText}</strong>.</>}</>
            )}
            {areaIntel?.market_notes?.[0] && <> {areaIntel.market_notes[0]}</>}
          </p>

          {highlights.length > 0 && (
            <ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {highlights.slice(0, 4).map((r) => (
                <li key={r} className="inline-flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-success" /> {r}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="ai" size="sm" asChild>
              <Link to="/advisor" search={{ propertyId: Number(property.id) }} onClick={() => storeAdvisorCtx(property)}><MessageCircle className="size-4" /> Ask AI about this home</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/advisor" search={{ propertyId: Number(property.id), q: `What negotiation tips do you have for renting ${property.title} in ${property.district} at SAR ${Math.round(property.price / 12).toLocaleString()}/month?` }} onClick={() => storeAdvisorCtx(property)}><TrendingUp className="size-4" /> Negotiation tips</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Actions --------------------------------- */
function ContactModal({
  property,
  savedRecordId,
  userId,
  onSaved,
  onClose,
}: {
  property: Property;
  savedRecordId: number | null;
  userId?: number;
  onSaved: (newId: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(`Hi, I'm interested in ${property.title}. Please contact me.`);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (savedRecordId !== null && savedRecordId > 0) {
        // Property already saved — only update status, leave notes/viewing_at untouched
        await updateSavedProperty(savedRecordId, { status: "sent" });
      } else if (userId != null) {
        // Property not saved yet — auto-save it, then set status
        const record = await saveProperty(userId, Number(property.id));
        onSaved(record.id);
        await updateSavedProperty(record.id, { status: "sent" });
      }
      setSent(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to send inquiry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <div className="py-6 text-center space-y-4">
            <div className="grid size-14 place-items-center rounded-full bg-success/15 mx-auto">
              <CheckCircle2 className="size-8 text-success" />
            </div>
            <h2 className="text-lg font-bold">Inquiry sent!</h2>
            <p className="text-sm text-muted-foreground">The agent will contact you within 1 hour.</p>
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Contact landlord</h2>
                <p className="text-xs text-muted-foreground">{property.agent}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}><X className="size-4" /></Button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Your name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed Al-Saud" required
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone number</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 5x xxx xxxx" required
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Message</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none" />
              </div>
              {submitError && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                  {submitError}
                </p>
              )}
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={!name.trim() || !phone.trim() || submitting}>
                <Send className="size-4" /> {submitting ? "Sending…" : "Send inquiry"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function storeAdvisorCtx(property: Property) {
  try {
    sessionStorage.setItem("maskan_advisor_ctx", JSON.stringify(property));
  } catch {
    // sessionStorage unavailable (private browsing edge case)
  }
}

// ── Rent Calculator ──────────────────────────────────────────────────────────

const FREQ_OPTIONS = [
  { label: "Annual",      count: 1,  sub: "1 payment / yr"  },
  { label: "Semi-annual", count: 2,  sub: "2 payments / yr" },
  { label: "Quarterly",   count: 4,  sub: "4 payments / yr" },
  { label: "Monthly",     count: 12, sub: "12 payments / yr" },
] as const;

function RentCalculator({ property }: { property: Property }) {
  const annualRent = property.price;
  const [freq, setFreq] = useState<1 | 2 | 4 | 12>(1);
  const [salaryInput, setSalaryInput] = useState("");

  const perPayment   = Math.round(annualRent / freq);
  const deposit      = Math.round(annualRent / 12);          // 1 month
  const agencyFee    = Math.round(annualRent * 0.025);       // 2.5%
  const totalYear1   = annualRent + deposit + agencyFee;

  const monthlySalary = parseFloat(salaryInput.replace(/,/g, "")) || 0;
  const monthlyRent   = annualRent / 12;
  const pct           = monthlySalary > 0 ? (monthlyRent / monthlySalary) * 100 : null;

  const affordTone =
    pct === null      ? null
    : pct <= 25       ? "success"
    : pct <= 33       ? "warning"
    :                   "danger";

  const affordMsg =
    pct === null      ? null
    : pct <= 25       ? "Comfortably affordable — well within the 30% guideline"
    : pct <= 33       ? "Borderline — slightly above the recommended 30% of income"
    :                   "Above budget — rent exceeds 33% of monthly income";

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="grid size-9 place-items-center rounded-xl bg-primary-soft">
          <Calculator className="size-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-bold">Rent Calculator</h2>
          <p className="text-xs text-muted-foreground">Payments, first-year costs &amp; affordability</p>
        </div>
      </div>

      {/* Payment frequency selector */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Payment frequency
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FREQ_OPTIONS.map(f => (
            <button
              key={f.count}
              type="button"
              onClick={() => setFreq(f.count)}
              className={cn(
                "rounded-xl border px-3 py-3 text-center transition-colors",
                freq === f.count
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-foreground hover:bg-surface-2",
              )}
            >
              <div className="text-sm font-semibold">{f.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{f.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Per-payment callout */}
      <div className="rounded-xl border border-primary/20 bg-primary/8 p-5 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Per payment</div>
        <div className="mt-1 text-4xl font-bold tracking-tight text-primary">
          SAR {formatSAR(perPayment)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {freq === 1
            ? "One annual payment"
            : `${freq} × SAR ${formatSAR(perPayment)} per year`}
        </div>
      </div>

      {/* First-year cost table */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          First-year cost estimate
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {[
            { label: "Annual rent",                    note: null,         value: annualRent  },
            { label: "Security deposit",               note: "(1 month)",  value: deposit     },
            { label: "Agency / broker fee",            note: "(2.5%)",     value: agencyFee   },
          ].map(({ label, note, value }) => (
            <div key={label} className="flex items-center justify-between border-b border-border px-4 py-3 text-sm last:border-0">
              <span className="text-muted-foreground">
                {label} {note && <span className="text-xs">{note}</span>}
              </span>
              <span className="font-semibold tabular-nums">SAR {formatSAR(value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-surface px-4 py-3 text-sm font-bold">
            <span>Total — first year</span>
            <span className="text-primary tabular-nums">SAR {formatSAR(totalYear1)}</span>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Estimates only. Deposit and fees vary by landlord and broker. VAT on residential rentals in KSA is 0%.
        </p>
      </div>

      {/* Affordability check */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Affordability check
        </div>
        <div className="flex items-center gap-3">
          <label className="shrink-0 text-sm text-muted-foreground">Monthly salary</label>
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-muted-foreground">SAR</span>
            <input
              type="number"
              min={0}
              value={salaryInput}
              onChange={e => setSalaryInput(e.target.value)}
              placeholder="e.g. 20000"
              className="h-9 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {pct !== null ? (
          <div className={cn(
            "mt-3 flex items-start gap-3 rounded-xl border p-4",
            affordTone === "success"  && "border-success/30 bg-success/8",
            affordTone === "warning"  && "border-warning/30 bg-warning/8",
            affordTone === "danger"   && "border-destructive/30 bg-destructive/8",
          )}>
            <span className={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              affordTone === "success"  && "bg-success",
              affordTone === "warning"  && "bg-warning",
              affordTone === "danger"   && "bg-destructive",
            )} />
            <div>
              <div className="text-sm font-bold">{pct.toFixed(1)}% of your monthly income</div>
              <div className={cn(
                "mt-0.5 text-xs",
                affordTone === "success"  && "text-success",
                affordTone === "warning"  && "text-warning",
                affordTone === "danger"   && "text-destructive",
              )}>
                {affordMsg}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Enter your gross monthly salary to see how this rent fits your budget.
          </p>
        )}
      </div>
    </div>
  );
}

// ── ActionsCard ───────────────────────────────────────────────────────────────

function ActionsCard({ property, propertyScore }: { property: Property; propertyScore?: number }) {
  const { user } = useAuth();
  const [savedRecordId, setSavedRecordId] = useState<number | null>(null);
  const [showContact, setShowContact] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchSavedProperties(user.id)
      .then((list) => {
        const match = list.find((s) => String(s.property_id) === String(property.id));
        setSavedRecordId(match ? match.id : null);
      })
      .catch(() => {});
  }, [user, property.id]);

  const handleToggleSave = async () => {
    if (!user) return;
    if (savedRecordId !== null) {
      const prev = savedRecordId;
      setSavedRecordId(null);
      try { await deleteSavedProperty(prev); } catch { setSavedRecordId(prev); }
    } else {
      setSavedRecordId(-1);
      try {
        const record = await saveProperty(user.id, Number(property.id));
        setSavedRecordId(record.id);
      } catch { setSavedRecordId(null); }
    }
  };

  const saved = savedRecordId !== null;

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Annual rent</div>
            <div className="font-display text-2xl font-bold tracking-tight">SAR {formatSAR(property.price)}</div>
            <div className="text-xs text-muted-foreground">~ SAR {formatSAR(Math.round(property.price / 12))}/month</div>
          </div>
          <ScoreRing score={propertyScore ?? property.matchScore} />
        </div>
        <div className="mt-5 space-y-2.5">
          <Button variant="hero" size="lg" className="w-full" onClick={() => setShowContact(true)}>
            <Phone className="size-4" /> Contact landlord
          </Button>
          <Button variant="ai" size="lg" className="w-full" asChild>
            <Link to="/advisor" search={{ propertyId: Number(property.id) }} onClick={() => storeAdvisorCtx(property)}><Sparkles className="size-4" /> Ask AI</Link>
          </Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline" onClick={() => void handleToggleSave()} aria-pressed={saved}>
              <Heart className={"size-4 " + (saved ? "fill-destructive text-destructive" : "")} />
              {saved ? "Saved" : "Save"}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/compare"><GitCompare className="size-4" /> Compare</Link>
            </Button>
          </div>
        </div>
        <div className="mt-5 space-y-2 border-t border-border pt-5 text-sm">
          <Row icon={<Wallet className="size-4" />} label="Deposit" value="SAR 5,500" />
          <Row icon={<Calendar className="size-4" />} label="Available" value="Immediately" />
          <Row icon={<Building2 className="size-4" />} label="Lease" value="12 months" />
        </div>
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Lightbulb className="size-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Need help finding the right home?</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Submit a lead and a licensed partner covering {property.district} will reach out within 24 hours.
            </p>
            <Button size="sm" className="mt-3 w-full" asChild>
              <Link to="/lead/new" search={{ area: property.district, city: property.city }}>Submit a lead request</Link>
            </Button>
          </div>
        </div>
      </div>

      {showContact && (
        <ContactModal
          property={property}
          savedRecordId={savedRecordId}
          userId={user?.id}
          onSaved={(newId) => setSavedRecordId(newId)}
          onClose={() => setShowContact(false)}
        />
      )}
    </>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2 text-muted-foreground">{icon} {label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function waUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? "966" + digits.slice(1) : digits;
  return `https://wa.me/${normalized}`;
}

function agentInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase() || "MA";
}

function LandlordCard({
  agentName,
  agentPhone,
  agentProfileImage,
  mediatorId,
}: {
  agentName: string;
  agentPhone: string | null;
  agentProfileImage: string | null;
  mediatorId: number | null;
}) {
  const [showCall, setShowCall] = useState(false);
  const hasPhone = !!agentPhone;

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Listed by</div>

        {/* Agent info */}
        <div className="flex items-center gap-3">
          {agentProfileImage ? (
            <img src={agentProfileImage} alt={agentName} className="size-12 rounded-full object-cover" />
          ) : (
            <div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              {agentInitials(agentName)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{agentName}</div>
            <div className="text-xs text-muted-foreground">Maskan Verified Agent</div>
          </div>
          {mediatorId && (
            <Link
              to="/agent/$id"
              params={{ id: String(mediatorId) }}
              className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              Profile
            </Link>
          )}
        </div>

        {/* CTA buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => hasPhone && setShowCall(true)}
            disabled={!hasPhone}
            title={hasPhone ? "Call agent" : "No phone number on file"}
          >
            <Phone className="size-4" /> Call
          </Button>
          <a
            href={hasPhone ? waUrl(agentPhone!) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => !hasPhone && e.preventDefault()}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              hasPhone
                ? "border-[#25D366] bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366]/20 dark:text-[#25D366]"
                : "border-border text-muted-foreground opacity-40 cursor-not-allowed",
            )}
          >
            <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            WhatsApp
          </a>
        </div>

        {/* Phone number row */}
        {hasPhone && (
          <a
            href={`tel:${agentPhone}`}
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2.5 text-sm font-semibold text-foreground hover:bg-surface-2 transition-colors"
          >
            <Phone className="size-4 text-muted-foreground" />
            {agentPhone}
          </a>
        )}
      </div>

      {showCall && (
        <PhoneModal agentName={agentName} agentPhone={agentPhone!} onClose={() => setShowCall(false)} />
      )}
    </>
  );
}

function PhoneModal({ agentName, agentPhone, onClose }: { agentName: string; agentPhone: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl text-center space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="grid size-14 place-items-center rounded-full bg-primary-soft mx-auto">
          <Phone className="size-6 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Call Agent</h2>
          <p className="text-xs text-muted-foreground mt-1">{agentName} · Maskan Verified</p>
        </div>
        <a
          href={`tel:${agentPhone}`}
          className="block rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {agentPhone}
        </a>
        <a
          href={waUrl(agentPhone)}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl border border-[#25D366] bg-[#25D366]/10 px-4 py-3 text-sm font-bold text-[#128C7E] hover:bg-[#25D366]/20 transition-colors dark:text-[#25D366]"
        >
          Open in WhatsApp
        </a>
        <Button variant="ghost" className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
