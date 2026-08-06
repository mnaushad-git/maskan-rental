import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar as DateRangeCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Landmark,
  Lightbulb,
  MapPin,
  Maximize,
  MessageCircle,
  Phone,
  PiggyBank,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, RecommendationBadge, StatusBadge } from "@/components/maskan/Badges";
import { ScoreRing, ScoreBar } from "@/components/maskan/ScoreIndicator";
import { PropertyCard } from "@/components/maskan/PropertyCard";
import { WhatsAppIcon, whatsappLink } from "@/components/maskan/ContactButtons";
import {
  fetchProperties,
  fetchProperty,
  fetchAreas,
  fetchAreaIntelligence,
  fetchSavedProperties,
  saveProperty,
  deleteSavedProperty,
  updateSavedProperty,
  mapApiProperty,
  fetchAvailability,
  fetchBookingInsights,
  createBooking,
  type ApiAreaIntelligence,
  type ApiAvailabilityInsight,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
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
      {
        name: "description",
        content: "Rental intelligence, area scores, fair rent and AI insights for this property.",
      },
    ],
  }),
  component: PropertyDetail,
});

const GALLERY = [heroImg, prop1, prop2, prop3, prop4];

// Small helper so call sites can write tProp("backToResults") instead of t("property.backToResults").
function usePropT() {
  const { t } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => t(`property.${key}`, vars);
}

function PropertyDetail() {
  const { id } = Route.useParams();
  const { t } = useLanguage();
  const tProp = usePropT();
  const [property, setProperty] = useState<Property | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [areaIntel, setAreaIntel] = useState<ApiAreaIntelligence | null>(null);
  const [areaAvgMonthly, setAreaAvgMonthly] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSale = property?.listingType === "sale";
  // District rent averages don't mean anything against a one-time sale price —
  // only feed them into the score/comparison logic for rent listings.
  const effectiveAreaAvgMonthly = isSale ? null : areaAvgMonthly;

  useEffect(() => {
    let cancelled = false;
    const propertyId = Number(id);
    if (Number.isNaN(propertyId)) {
      setError(tProp("invalidId"));
      setLoading(false);
      return;
    }

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
          const match = areas.find((a) => a.name.toLowerCase() === mapped.district.toLowerCase());
          if (match) setAreaAvgMonthly(Math.round(match.average_rent));
        });
      } catch {
        if (!cancelled) setError(tProp("unableToLoad"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
    // tProp intentionally omitted — switching language shouldn't re-fetch the property.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="container-page py-8">
        <Skeleton className="aspect-[16/9] w-full rounded-2xl md:aspect-[21/9]" />
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <div className="flex gap-4">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (error || !property) {
    return (
      <div className="container-page py-12">
        <p className="text-sm text-destructive">{error ?? tProp("notFound")}</p>
        <Link to="/search" className="mt-4 inline-block text-sm text-primary">
          {tProp("backToSearch")}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container-page py-6">
        <Link
          to="/search"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {tProp("backToResults")}
        </Link>
      </div>

      <Gallery title={property.title} images={property.images} />

      <div className="container-page grid grid-cols-1 gap-10 pb-32 lg:pb-16 lg:grid-cols-[1.7fr_1fr]">
        <main className="space-y-10">
          <Summary property={property} />
          <RentalIntelligence
            property={property}
            areaIntel={areaIntel}
            areaAvgMonthly={effectiveAreaAvgMonthly}
          />
          {isSale ? (
            <PurchasePriceInsight property={property} />
          ) : (
            <FairRent property={property} areaAvgMonthly={areaAvgMonthly} />
          )}
          {isSale ? (
            <PurchaseCostBreakdown property={property} />
          ) : (
            <RentCalculator property={property} />
          )}
          {!isSale && <ShortTermBooking property={property} />}
          <AreaSummary property={property} />
          <NearbyPlaces areaIntel={areaIntel} district={property.district} />
          <ComparableListings currentId={property.id} properties={properties} />
          <AiSummary
            property={property}
            areaIntel={areaIntel}
            areaAvgMonthly={effectiveAreaAvgMonthly}
          />
        </main>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <ActionsCard property={property} />
          <LandlordCard
            agentName={property.agent}
            agentPhone={property.agentPhone}
            agentProfileImage={property.agentProfileImage}
            mediatorId={property.mediatorId}
          />
        </aside>
      </div>

      {/* Mobile sticky contact bar — fixed at bottom, hidden on desktop */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground">
              {isSale ? t("propertyCard.salePrice") : t("propertyCard.annualRent")}
            </div>
            <div className="truncate text-base font-bold tracking-tight">
              SAR {formatSAR(property.price)}
              {!isSale && (
                <span className="ms-1 text-xs font-normal text-muted-foreground">
                  / SAR {formatSAR(Math.round(property.price / 12))}
                  {tProp("perMonthShort")}
                </span>
              )}
            </div>
          </div>
          {property.agentPhone ? (
            <>
              <a
                href={whatsappLink(property.agentPhone)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-whatsapp px-4 py-2.5 text-sm font-semibold text-white"
              >
                <WhatsAppIcon className="size-4" />
                {t("propertyCard.whatsapp")}
              </a>
              <a
                href={`tel:${property.agentPhone}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold"
              >
                <Phone className="size-4" /> {t("propertyCard.call")}
              </a>
            </>
          ) : (
            <Link
              to="/lead/new"
              search={{ area: property.district, city: property.city }}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <MessageCircle className="size-4" /> {tProp("findAgent")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Gallery -------------------------------- */
function Gallery({ title, images: realImages }: { title: string; images: string[] }) {
  const tProp = usePropT();
  const [active, setActive] = useState(0);

  // Pad to at least 5 slots with placeholder images so the grid never looks sparse
  const PLACEHOLDERS = [heroImg, prop1, prop2, prop3, prop4];
  const images =
    realImages.length > 0
      ? [...realImages, ...PLACEHOLDERS].slice(0, Math.max(realImages.length, 5))
      : PLACEHOLDERS;

  return (
    <section className="container-page space-y-3">
      {/* Airbnb-style panel grid */}
      <div className="overflow-hidden rounded-2xl bg-border md:h-[480px]">
        <div className="grid h-full gap-px grid-cols-1 md:grid-cols-[2fr_1fr_1fr] md:grid-rows-2">
          {/* Main image – spans both rows on desktop */}
          <div className="relative overflow-hidden bg-surface-2 aspect-[4/3] md:aspect-auto md:row-span-2">
            <img key={active} src={images[active]} alt={title} className="size-full object-cover" />
            <div className="absolute start-4 top-4 flex gap-2">
              <RecommendationBadge label="Verified" />
              <RecommendationBadge label="Best Match" />
            </div>
            <div className="absolute bottom-4 end-4 inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold shadow-card backdrop-blur-sm">
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
                  {tProp("galleryMore", { count: images.length - 4 })}
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
  const { t } = useLanguage();
  const tProp = usePropT();
  const facts = [
    {
      icon: <BedDouble className="size-4" />,
      label: tProp("summary.bedrooms"),
      value: property.bedrooms,
    },
    {
      icon: <Bath className="size-4" />,
      label: tProp("summary.bathrooms"),
      value: property.bathrooms,
    },
    {
      icon: <Maximize className="size-4" />,
      label: tProp("summary.area"),
      value: `${property.area} m²`,
    },
    {
      icon: <Sofa className="size-4" />,
      label: tProp("summary.furnishing"),
      value: tProp("summary.semiFurnished"),
    },
    {
      icon: <Calendar className="size-4" />,
      label: tProp("summary.buildingAge"),
      value: tProp("summary.years", { count: 3 }),
    },
    {
      icon: <Car className="size-4" />,
      label: tProp("summary.parking"),
      value: tProp("summary.covered", { count: 2 }),
    },
  ];
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge status={property.status} />
            <Badge tone="neutral">{t(`propertyTypes.${property.type}`)}</Badge>
            <Badge tone="neutral">{tProp("summary.id", { id: property.id })}</Badge>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {property.title}
          </h1>
          <p className="mt-2 inline-flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-4" /> {property.district}, {property.city}
          </p>
        </div>
        <div className="text-end">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {property.listingType === "sale"
              ? t("propertyCard.salePrice")
              : t("propertyCard.annualRent")}
          </div>
          <div className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            SAR {formatSAR(property.price)}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            SAR {formatSAR(property.pricePerSqm)} / m²
          </div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-4 border-t border-border pt-6 md:grid-cols-3 lg:grid-cols-6">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {f.icon} {f.label}
            </div>
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
  property,
  areaIntel,
  areaAvgMonthly,
}: {
  property: Property;
  areaIntel: ApiAreaIntelligence | null;
  areaAvgMonthly: number | null;
}) {
  const { lang } = useLanguage();
  const tProp = usePropT();
  const isSale = property.listingType === "sale";
  const monthlyRent = isSale ? 0 : Math.round(property.price / 12);
  const priceFairness = computePriceFairness(monthlyRent, areaAvgMonthly);
  const areaQuality = Math.round(areaIntel?.area_score ?? 75);
  const amenities = Math.round(areaIntel?.lifestyle_score ?? 75);
  const commute = Math.round(areaIntel?.traffic_score ?? 75);
  const family = Math.round(areaIntel?.family_score ?? 75);
  const overall = Math.round(
    0.25 * priceFairness + 0.25 * areaQuality + 0.2 * amenities + 0.15 * commute + 0.15 * family,
  );

  const breakdown = [
    { label: tProp("rentalIntelligence.priceFairness"), value: priceFairness },
    { label: tProp("rentalIntelligence.areaQuality"), value: areaQuality },
    { label: tProp("rentalIntelligence.amenities"), value: amenities },
    { label: tProp("rentalIntelligence.commute"), value: commute },
    { label: tProp("rentalIntelligence.familySuitability"), value: family },
  ];

  const verdict =
    overall >= 85
      ? tProp("rentalIntelligence.verdictExcellent")
      : overall >= 75
        ? tProp("rentalIntelligence.verdictStrong")
        : overall >= 65
          ? tProp("rentalIntelligence.verdictFair")
          : tProp("rentalIntelligence.verdictBelow");

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Badge tone="ai" className="mb-3">
            <Sparkles className="size-3.5" />{" "}
            {tProp(isSale ? "rentalIntelligence.badgeSale" : "rentalIntelligence.badge")}
          </Badge>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {tProp(isSale ? "rentalIntelligence.titleSale" : "rentalIntelligence.title")}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {tProp(isSale ? "rentalIntelligence.subtitleSale" : "rentalIntelligence.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-4 rounded-2xl bg-surface px-5 py-4">
          <ScoreRing score={overall} size={84} />
          <div>
            <div className="text-3xl font-bold tracking-tight">
              {overall}
              <span className="text-base text-muted-foreground">/100</span>
            </div>
            <div className="text-xs font-semibold text-primary">{verdict}</div>
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {breakdown.map((b) => (
          <ScoreBar key={b.label} label={b.label} value={b.value} />
        ))}
      </div>
      {areaIntel && (
        <p className="mt-4 text-xs text-muted-foreground">
          {tProp("rentalIntelligence.lastRefreshed", {
            date: new Date(areaIntel.last_refreshed_at ?? "").toLocaleDateString(
              lang === "ar" ? "ar-SA-u-nu-latn" : "en-SA",
            ),
          })}
        </p>
      )}
    </section>
  );
}

/* ------------------------------- Fair Rent ------------------------------- */
function FairRent({
  property,
  areaAvgMonthly,
}: {
  property: Property;
  areaAvgMonthly: number | null;
}) {
  const tProp = usePropT();
  const current = Math.round(property.price / 12);

  if (areaAvgMonthly === null) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
        <h2 className="font-display text-2xl font-bold tracking-tight">
          {tProp("fairRent.title")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{tProp("fairRent.loadingComparison")}</p>
      </section>
    );
  }

  const min = Math.round(areaAvgMonthly * 0.85);
  const max = Math.round(areaAvgMonthly * 1.05);
  const isOverpriced = current > max;
  const isUndermarket = current < min;
  const verdict = isOverpriced
    ? tProp("fairRent.verdictOverpriced")
    : isUndermarket
      ? tProp("fairRent.verdictBelow")
      : tProp("fairRent.verdictFair");
  const tone = isOverpriced ? "warning" : isUndermarket ? "success" : "primary";
  const diff = current - max;
  const scaleMin = min - (max - min);
  const scaleMax = max + (max - min);
  const pct = Math.min(100, Math.max(0, ((current - scaleMin) / (scaleMax - scaleMin)) * 100));

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {tProp("fairRent.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tProp("fairRent.comparedTo", { district: property.district })}
          </p>
        </div>
        <Badge tone={tone} icon={<TrendingUp className="size-3.5" />}>
          {verdict}
        </Badge>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl bg-surface p-4">
          <div className="text-xs text-muted-foreground">{tProp("fairRent.currentRent")}</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">SAR {formatSAR(current)}</div>
          <div className="text-xs text-muted-foreground">{tProp("fairRent.perMonth")}</div>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <div className="text-xs text-muted-foreground">{tProp("fairRent.marketRange")}</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            SAR {formatSAR(min)} – {formatSAR(max)}
          </div>
          <div className="text-xs text-muted-foreground">{tProp("fairRent.perMonth")}</div>
        </div>
        {isOverpriced ? (
          <div className="rounded-xl bg-warning/10 p-4">
            <div className="text-xs text-warning-foreground">{tProp("fairRent.difference")}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-warning-foreground">
              +SAR {formatSAR(diff)}
            </div>
            <div className="text-xs text-warning-foreground">
              {tProp("fairRent.aboveFairMarket")}
            </div>
          </div>
        ) : isUndermarket ? (
          <div className="rounded-xl bg-success/10 p-4">
            <div className="text-xs text-success">{tProp("fairRent.savingsPotential")}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-success">
              SAR {formatSAR(-diff)}
              {tProp("perMonthShort")}
            </div>
            <div className="text-xs text-success">{tProp("fairRent.belowMarketAvg")}</div>
          </div>
        ) : (
          <div className="rounded-xl bg-primary-soft p-4">
            <div className="text-xs text-accent-foreground">{tProp("fairRent.status")}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-primary">
              {tProp("fairRent.verdictFair")}
            </div>
            <div className="text-xs text-muted-foreground">
              {tProp("fairRent.withinMarketRange")}
            </div>
          </div>
        )}
      </div>
      <div className="mt-8">
        <div className="relative h-2 w-full rounded-full bg-surface-2">
          <div
            className="absolute h-2 rounded-full bg-primary/70"
            style={{
              left: `${((min - scaleMin) / (scaleMax - scaleMin)) * 100}%`,
              right: `${100 - ((max - scaleMin) / (scaleMax - scaleMin)) * 100}%`,
            }}
          />
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct}%` }}
          >
            <div
              className={`size-4 rounded-full border-2 border-background shadow-card ${isOverpriced ? "bg-warning" : isUndermarket ? "bg-success" : "bg-primary"}`}
            />
          </div>
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>SAR {formatSAR(scaleMin)}</span>
          <span className="font-semibold text-primary">{tProp("fairRent.fairRange")}</span>
          <span>SAR {formatSAR(scaleMax)}</span>
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Purchase Price Insight ----------------------- */
function PurchasePriceInsight({ property }: { property: Property }) {
  const tProp = usePropT();
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-2xl font-bold tracking-tight">
        {tProp("purchaseInsight.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{tProp("purchaseInsight.subtitle")}</p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-surface p-4">
          <div className="text-xs text-muted-foreground">{tProp("purchaseInsight.totalPrice")}</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            SAR {formatSAR(property.price)}
          </div>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <div className="text-xs text-muted-foreground">
            {tProp("purchaseInsight.pricePerSqm")}
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            SAR {formatSAR(property.pricePerSqm)}
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {tProp("purchaseInsight.noComparableNote")}
      </p>
    </section>
  );
}

/* ----------------------------- Area Summary ------------------------------ */
function AreaSummary({ property }: { property: Property }) {
  const tProp = usePropT();

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {property.district} {tProp("areaSummary.titleSuffix")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{tProp("areaSummary.scoresLoading")}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/areas">
            <MapPin className="size-4" /> {tProp("areaSummary.exploreArea")}
          </a>
        </Button>
      </div>
    </section>
  );
}

/* ----------------------------- Nearby Places ----------------------------- */
function NearbyPlaces({
  areaIntel,
  district,
}: {
  areaIntel: ApiAreaIntelligence | null;
  district: string;
}) {
  const tProp = usePropT();
  if (!areaIntel) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
        <h2 className="font-display text-2xl font-bold tracking-tight">{tProp("nearby.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{tProp("nearby.loading")}</p>
      </section>
    );
  }

  const groups: Array<{
    title: string;
    icon: React.ReactNode;
    items: Array<{ name: string; distance: string; rating?: number }>;
  }> = [
    {
      title: tProp("nearby.schools"),
      icon: <School className="size-4" />,
      items: areaIntel.schools.slice(0, 3).map((s) => ({
        name: s.name,
        distance: `${s.distance_km} km`,
        rating: s.rating > 0 ? s.rating : undefined,
      })),
    },
    {
      title: tProp("nearby.hospitals"),
      icon: <Hospital className="size-4" />,
      items: areaIntel.hospitals.slice(0, 3).map((h) => ({
        name: h.name,
        distance: `${h.distance_km} km`,
        rating: h.rating > 0 ? h.rating : undefined,
      })),
    },
    {
      title: tProp("nearby.mosques"),
      icon: <GraduationCap className="size-4" />,
      items: (areaIntel.lifestyle.mosques?.places ?? []).slice(0, 3).map((m) => ({
        name: m.name,
        distance: `${m.distance_km} km`,
      })),
    },
    {
      title: tProp("nearby.malls"),
      icon: <ShoppingBag className="size-4" />,
      items: (areaIntel.lifestyle.malls?.places ?? []).slice(0, 3).map((m) => ({
        name: m.name,
        distance: `${m.distance_km} km`,
        rating: m.rating && m.rating > 0 ? m.rating : undefined,
      })),
    },
    {
      title: tProp("nearby.parks"),
      icon: <Trees className="size-4" />,
      items: (areaIntel.lifestyle.parks?.places ?? []).slice(0, 3).map((p) => ({
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
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {tProp("nearby.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tProp("nearby.realDistances", { district })}
          </p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="rounded-xl border border-border p-5">
            <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
              <span className="grid size-7 place-items-center rounded-md bg-primary-soft text-primary">
                {g.icon}
              </span>
              {g.title}
            </div>
            {g.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{tProp("nearby.noData")}</p>
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
function ComparableListings({
  currentId,
  properties,
}: {
  currentId: string;
  properties: Property[];
}) {
  const tProp = usePropT();
  const comps = properties.filter((p) => p.id !== currentId).slice(0, 5);
  return (
    <section>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            {tProp("comparable.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{tProp("comparable.subtitle")}</p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/search">{tProp("comparable.viewAll")}</Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {comps.slice(0, 3).map((p) => (
          <PropertyCard key={p.id} p={p} />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {comps.slice(3, 5).map((p) => (
          <PropertyCard key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- AI Summary -------------------------------- */
function AiSummary({
  property,
  areaIntel,
  areaAvgMonthly,
}: {
  property: Property;
  areaIntel: ApiAreaIntelligence | null;
  areaAvgMonthly: number | null;
}) {
  const { t } = useLanguage();
  const tProp = usePropT();
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
    ? tProp("aiSummary.priceOverpriced", { amount: formatSAR(priceDiff) })
    : isUndermarket
      ? tProp("aiSummary.priceUndermarket", { amount: formatSAR(priceDiff) })
      : tProp("aiSummary.priceFair");

  const familyText =
    familyScore >= 65
      ? tProp("aiSummary.familyExcellent")
      : familyScore >= 50
        ? tProp("aiSummary.familySolid")
        : tProp("aiSummary.familySingles");

  const commuteText = commute
    ? commute <= 20
      ? tProp("aiSummary.justMin", { min: commute })
      : commute <= 35
        ? tProp("aiSummary.commuteMin", { min: commute })
        : tProp("aiSummary.fromCentre", { min: commute })
    : null;

  const highlights = [
    familyScore >= 60 && tProp("aiSummary.highlightFamily"),
    schoolCount >= 3 && tProp("aiSummary.highlightSchools", { count: schoolCount }),
    commuteText && tProp("aiSummary.highlightCommute", { commute: commuteText }),
    !isOverpriced && tProp("aiSummary.highlightPriced"),
    tags.includes("Luxury") && tProp("aiSummary.highlightPremium"),
    tags.includes("Walkable") && tProp("aiSummary.highlightWalkable"),
  ].filter(Boolean) as string[];

  const titleVerdict = isOverpriced
    ? tProp("aiSummary.verdictAboveMarket")
    : isUndermarket
      ? tProp("aiSummary.verdictBelowMarket")
      : tProp("aiSummary.verdictFairMarket");

  return (
    <section
      id="ai"
      className="relative overflow-hidden rounded-2xl border border-ai/20 bg-gradient-to-br from-ai-soft via-card to-card p-6 shadow-elevated md:p-8"
    >
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-ai text-ai-foreground shadow-card">
          <Sparkles className="size-5" />
        </div>
        <div className="flex-1">
          <Badge tone="ai" className="mb-2">
            {tProp("aiSummary.badge")}
          </Badge>
          <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">
            {familyText} — {titleVerdict}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {tProp("aiSummary.descSentence", {
              type: t(`propertyTypes.${property.type}`),
              district: property.district,
              priceText,
            })}
            {areaIntel && (
              <>
                {" "}
                {tProp("aiSummary.scoresSentence", {
                  score: Math.round(areaIntel.area_score ?? 0),
                  family: Math.round(familyScore),
                  schoolPart:
                    schoolScore > 0
                      ? tProp("aiSummary.schoolScorePart", { score: Math.round(schoolScore) })
                      : "",
                })}
                {commuteText && tProp("aiSummary.locatedSentence", { commute: commuteText })}
              </>
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
              <Link
                to="/advisor"
                search={{ propertyId: Number(property.id) }}
                onClick={() => storeAdvisorCtx(property)}
              >
                <MessageCircle className="size-4" /> {tProp("aiSummary.askAI")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/advisor"
                search={{
                  propertyId: Number(property.id),
                  q:
                    property.listingType === "sale"
                      ? `What negotiation tips do you have for buying ${property.title} in ${property.district} at SAR ${property.price.toLocaleString()}?`
                      : `What negotiation tips do you have for renting ${property.title} in ${property.district} at SAR ${Math.round(property.price / 12).toLocaleString()}/month?`,
                }}
                onClick={() => storeAdvisorCtx(property)}
              >
                <TrendingUp className="size-4" /> {tProp("aiSummary.negotiationTips")}
              </Link>
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
  const tProp = usePropT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    tProp("contactModal.inquiryDefault", { title: property.title }),
  );
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
      setSubmitError(err instanceof Error ? err.message : tProp("contactModal.failedToSend"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {sent ? (
          <div className="py-6 text-center space-y-4">
            <div className="grid size-14 place-items-center rounded-full bg-success/15 mx-auto">
              <CheckCircle2 className="size-8 text-success" />
            </div>
            <h2 className="text-lg font-bold">{tProp("contactModal.inquirySent")}</h2>
            <p className="text-sm text-muted-foreground">
              {tProp("contactModal.agentWillContact")}
            </p>
            <Button className="w-full" onClick={onClose}>
              {tProp("contactModal.done")}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{tProp("contactModal.contactLandlord")}</h2>
                <p className="text-xs text-muted-foreground">{property.agent}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {tProp("contactModal.yourName")}
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ahmed Al-Saud"
                  required
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {tProp("contactModal.phoneNumber")}
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+966 5x xxx xxxx"
                  required
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {tProp("contactModal.message")}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
                />
              </div>
              {submitError && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                  {submitError}
                </p>
              )}
              <Button
                type="submit"
                variant="hero"
                size="lg"
                className="w-full"
                disabled={!name.trim() || !phone.trim() || submitting}
              >
                <Send className="size-4" />{" "}
                {submitting ? tProp("contactModal.sending") : tProp("contactModal.sendInquiry")}
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
  { key: "annual", count: 1 as const },
  { key: "semiAnnual", count: 2 as const },
  { key: "quarterly", count: 4 as const },
  { key: "monthly", count: 12 as const },
] as const;

function RentCalculator({ property }: { property: Property }) {
  const tProp = usePropT();
  const annualRent = property.price;
  const [freq, setFreq] = useState<1 | 2 | 4 | 12>(1);
  const [salaryInput, setSalaryInput] = useState("");

  const perPayment = Math.round(annualRent / freq);
  const deposit = Math.round(annualRent / 12); // 1 month
  const agencyFee = Math.round(annualRent * 0.025); // 2.5%
  const totalYear1 = annualRent + deposit + agencyFee;

  const monthlySalary = parseFloat(salaryInput.replace(/,/g, "")) || 0;
  const monthlyRent = annualRent / 12;
  const pct = monthlySalary > 0 ? (monthlyRent / monthlySalary) * 100 : null;

  const affordTone = pct === null ? null : pct <= 25 ? "success" : pct <= 33 ? "warning" : "danger";

  const affordMsg =
    pct === null
      ? null
      : pct <= 25
        ? tProp("rentCalculator.affordComfortable")
        : pct <= 33
          ? tProp("rentCalculator.affordBorderline")
          : tProp("rentCalculator.affordAbove");

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="grid size-9 place-items-center rounded-xl bg-primary-soft">
          <Calculator className="size-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-bold">{tProp("rentCalculator.title")}</h2>
          <p className="text-xs text-muted-foreground">{tProp("rentCalculator.subtitle")}</p>
        </div>
      </div>

      {/* Payment frequency selector */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("rentCalculator.paymentFrequency")}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FREQ_OPTIONS.map((f) => (
            <button
              key={f.count}
              type="button"
              onClick={() => setFreq(f.count)}
              className={cn(
                "rounded-xl border px-3 py-3 text-center transition-colors",
                freq === f.count
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-foreground hover:bg-surface-2",
              )}
            >
              <div className="text-sm font-semibold">{tProp(`rentCalculator.${f.key}`)}</div>
              <div
                className={cn(
                  "mt-0.5 text-[11px]",
                  freq === f.count ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {tProp(
                  f.count === 1
                    ? "rentCalculator.paymentPerYear"
                    : "rentCalculator.paymentsPerYear",
                  { count: f.count },
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Per-payment callout */}
      <div className="rounded-xl border border-primary/20 bg-primary/8 p-5 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("rentCalculator.perPayment")}
        </div>
        <div className="mt-1 text-4xl font-bold tracking-tight text-primary">
          SAR {formatSAR(perPayment)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {freq === 1
            ? tProp("rentCalculator.oneAnnualPayment")
            : tProp("rentCalculator.paymentsPerYearBreakdown", {
                count: freq,
                amount: formatSAR(perPayment),
              })}
        </div>
      </div>

      {/* First-year cost table */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("rentCalculator.firstYearCost")}
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {[
            { label: tProp("rentCalculator.annualRentLabel"), note: null, value: annualRent },
            {
              label: tProp("rentCalculator.securityDeposit"),
              note: tProp("rentCalculator.oneMonth"),
              value: deposit,
            },
            { label: tProp("rentCalculator.agencyFee"), note: "(2.5%)", value: agencyFee },
          ].map(({ label, note, value }) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-border px-4 py-3 text-sm last:border-0"
            >
              <span className="text-muted-foreground">
                {label} {note && <span className="text-xs">{note}</span>}
              </span>
              <span className="font-semibold tabular-nums">SAR {formatSAR(value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-surface px-4 py-3 text-sm font-bold">
            <span>{tProp("rentCalculator.totalFirstYear")}</span>
            <span className="text-primary tabular-nums">SAR {formatSAR(totalYear1)}</span>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {tProp("rentCalculator.estimatesDisclaimer")}
        </p>
      </div>

      {/* Affordability check */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("rentCalculator.affordabilityCheck")}
        </div>
        <div className="flex items-center gap-3">
          <label className="shrink-0 text-sm text-muted-foreground">
            {tProp("rentCalculator.monthlySalary")}
          </label>
          <div className="relative flex-1">
            <span className="absolute inset-y-0 start-3 flex items-center text-xs font-semibold text-muted-foreground">
              SAR
            </span>
            <input
              type="number"
              min={0}
              value={salaryInput}
              onChange={(e) => setSalaryInput(e.target.value)}
              placeholder={tProp("rentCalculator.salaryPlaceholder")}
              className="h-9 w-full rounded-lg border border-border bg-background ps-10 pe-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {pct !== null ? (
          <div
            className={cn(
              "mt-3 flex items-start gap-3 rounded-xl border p-4",
              affordTone === "success" && "border-success/30 bg-success/8",
              affordTone === "warning" && "border-warning/30 bg-warning/8",
              affordTone === "danger" && "border-destructive/30 bg-destructive/8",
            )}
          >
            <span
              className={cn(
                "mt-1 size-2.5 shrink-0 rounded-full",
                affordTone === "success" && "bg-success",
                affordTone === "warning" && "bg-warning",
                affordTone === "danger" && "bg-destructive",
              )}
            />
            <div>
              <div className="text-sm font-bold">
                {tProp("rentCalculator.pctOfIncome", { pct: pct.toFixed(1) })}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-xs",
                  affordTone === "success" && "text-success",
                  affordTone === "warning" && "text-warning",
                  affordTone === "danger" && "text-destructive",
                )}
              >
                {affordMsg}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {tProp("rentCalculator.enterSalaryPrompt")}
          </p>
        )}
      </div>
    </div>
  );
}

const DOWN_PAYMENT_OPTIONS = [10, 20, 30, 50] as const;
const RETT_RATE = 0.05; // KSA Real Estate Transaction Tax
const BROKER_RATE = 0.025;
const MORTGAGE_ANNUAL_RATE = 0.05;
const MORTGAGE_YEARS = 20;

function PurchaseCostBreakdown({ property }: { property: Property }) {
  const tProp = usePropT();
  const price = property.price;
  const [downPct, setDownPct] = useState<10 | 20 | 30 | 50>(20);
  const [salaryInput, setSalaryInput] = useState("");

  const downPayment = Math.round(price * (downPct / 100));
  const financedAmount = price - downPayment;
  const rett = Math.round(price * RETT_RATE);
  const brokerFee = Math.round(price * BROKER_RATE);
  const totalUpfront = downPayment + rett + brokerFee;

  const monthlyRate = MORTGAGE_ANNUAL_RATE / 12;
  const numPayments = MORTGAGE_YEARS * 12;
  const monthlyPayment =
    financedAmount > 0
      ? Math.round(
          (financedAmount * monthlyRate * (1 + monthlyRate) ** numPayments) /
            ((1 + monthlyRate) ** numPayments - 1),
        )
      : 0;

  const monthlySalary = parseFloat(salaryInput.replace(/,/g, "")) || 0;
  const pct = monthlySalary > 0 ? (monthlyPayment / monthlySalary) * 100 : null;

  const affordTone = pct === null ? null : pct <= 25 ? "success" : pct <= 33 ? "warning" : "danger";

  const affordMsg =
    pct === null
      ? null
      : pct <= 25
        ? tProp("rentCalculator.affordComfortable")
        : pct <= 33
          ? tProp("rentCalculator.affordBorderline")
          : tProp("purchaseAffordability.affordAbove");

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-6">
      <div className="flex items-center gap-2">
        <div className="grid size-9 place-items-center rounded-xl bg-primary-soft">
          <Landmark className="size-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-bold">{tProp("purchaseCost.title")}</h2>
          <p className="text-xs text-muted-foreground">{tProp("purchaseCost.subtitle")}</p>
        </div>
      </div>

      {/* Down payment selector */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("purchaseCost.downPayment")}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {DOWN_PAYMENT_OPTIONS.map((pctOpt) => (
            <button
              key={pctOpt}
              type="button"
              onClick={() => setDownPct(pctOpt)}
              className={cn(
                "rounded-xl border px-3 py-3 text-center transition-colors",
                downPct === pctOpt
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-foreground hover:bg-surface-2",
              )}
            >
              <div className="text-sm font-semibold">{pctOpt}%</div>
            </button>
          ))}
        </div>
      </div>

      {/* Down payment callout */}
      <div className="rounded-xl border border-primary/20 bg-primary/8 p-5 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("purchaseCost.downPaymentAmount")}
        </div>
        <div className="mt-1 text-4xl font-bold tracking-tight text-primary">
          SAR {formatSAR(downPayment)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {tProp("purchaseCost.financedAmount", { amount: formatSAR(financedAmount) })}
        </div>
      </div>

      {/* Upfront cost table */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("purchaseCost.upfrontCost")}
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {[
            { label: tProp("purchaseCost.downPaymentAmount"), note: null, value: downPayment },
            { label: tProp("purchaseCost.transferTax"), note: "(5%)", value: rett },
            { label: tProp("purchaseCost.brokerFee"), note: "(2.5%)", value: brokerFee },
          ].map(({ label, note, value }) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-border px-4 py-3 text-sm last:border-0"
            >
              <span className="text-muted-foreground">
                {label} {note && <span className="text-xs">{note}</span>}
              </span>
              <span className="font-semibold tabular-nums">SAR {formatSAR(value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-surface px-4 py-3 text-sm font-bold">
            <span>{tProp("purchaseCost.totalUpfront")}</span>
            <span className="text-primary tabular-nums">SAR {formatSAR(totalUpfront)}</span>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {tProp("purchaseCost.estimatesDisclaimer")}
        </p>
      </div>

      {/* Financing estimate */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("purchaseCost.financingEstimate")}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-surface p-4">
          <div>
            <div className="text-xs text-muted-foreground">
              {tProp("purchaseCost.estMonthlyPayment")}
            </div>
            <div className="mt-1 text-xl font-bold tracking-tight">
              SAR {formatSAR(monthlyPayment)}
            </div>
          </div>
          <PiggyBank className="size-6 text-muted-foreground" />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {tProp("purchaseCost.financingNote", {
            years: MORTGAGE_YEARS,
            rate: (MORTGAGE_ANNUAL_RATE * 100).toFixed(0),
          })}
        </p>
      </div>

      {/* Affordability check */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tProp("rentCalculator.affordabilityCheck")}
        </div>
        <div className="flex items-center gap-3">
          <label className="shrink-0 text-sm text-muted-foreground">
            {tProp("rentCalculator.monthlySalary")}
          </label>
          <div className="relative flex-1">
            <span className="absolute inset-y-0 start-3 flex items-center text-xs font-semibold text-muted-foreground">
              SAR
            </span>
            <input
              type="number"
              min={0}
              value={salaryInput}
              onChange={(e) => setSalaryInput(e.target.value)}
              placeholder={tProp("rentCalculator.salaryPlaceholder")}
              className="h-9 w-full rounded-lg border border-border bg-background ps-10 pe-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {pct !== null ? (
          <div
            className={cn(
              "mt-3 flex items-start gap-3 rounded-xl border p-4",
              affordTone === "success" && "border-success/30 bg-success/8",
              affordTone === "warning" && "border-warning/30 bg-warning/8",
              affordTone === "danger" && "border-destructive/30 bg-destructive/8",
            )}
          >
            <span
              className={cn(
                "mt-1 size-2.5 shrink-0 rounded-full",
                affordTone === "success" && "bg-success",
                affordTone === "warning" && "bg-warning",
                affordTone === "danger" && "bg-destructive",
              )}
            />
            <div>
              <div className="text-sm font-bold">
                {tProp("rentCalculator.pctOfIncome", { pct: pct.toFixed(1) })}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-xs",
                  affordTone === "success" && "text-success",
                  affordTone === "warning" && "text-warning",
                  affordTone === "danger" && "text-destructive",
                )}
              >
                {affordMsg}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {tProp("purchaseAffordability.enterSalaryPrompt")}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Short-Term Stay Booking ─────────────────────────────────────────────────
// No per-listing nightly rate exists in the data model yet (Maskan only
// tracks long-term monthly_rent) — the nightly rate shown here is an
// indicative estimate derived from it, using the same short-term premium
// heuristic as the AI pricing suggestion shown to landlords (see
// backend/app/api/routes/ai.py's pricing-suggestion endpoint).
function ShortTermBooking({ property }: { property: Property }) {
  const tProp = usePropT();
  const { user } = useAuth();
  const [range, setRange] = useState<DateRange | undefined>();
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [insight, setInsight] = useState<ApiAvailabilityInsight | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBookingInsights(Number(property.id))
      .then((data) => {
        if (!cancelled) setInsight(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [property.id]);

  // A stale availability/error result from a previous range must not survive
  // into a newly selected range.
  useEffect(() => {
    setAvailability(null);
    setError(null);
  }, [range?.from, range?.to]);

  const nightlyRate = Math.max(50, Math.round(((property.price / 12 / 30) * 1.6)));
  const nights = range?.from && range?.to ? differenceInCalendarDays(range.to, range.from) : 0;
  const totalPrice = nights > 0 ? nights * nightlyRate : 0;
  const today = startOfDay(new Date());

  async function handleCheck() {
    if (!range?.from || !range?.to) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetchAvailability(
        Number(property.id),
        format(range.from, "yyyy-MM-dd"),
        format(range.to, "yyyy-MM-dd"),
      );
      setAvailability(res.available);
    } catch (err) {
      setError(err instanceof Error ? err.message : tProp("booking.checkFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function handleBook() {
    if (!range?.from || !range?.to) return;
    setBooking(true);
    setError(null);
    try {
      await createBooking({
        property_id: Number(property.id),
        check_in: format(range.from, "yyyy-MM-dd"),
        check_out: format(range.to, "yyyy-MM-dd"),
        total_price: totalPrice,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tProp("booking.bookFailed"));
      setAvailability(false);
    } finally {
      setBooking(false);
    }
  }

  if (success && range?.from && range?.to) {
    return (
      <section className="rounded-2xl border border-success/30 bg-success/8 p-6 shadow-card md:p-8">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="size-6 shrink-0 text-success" />
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">
              {tProp("booking.confirmedTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tProp("booking.confirmedDesc", {
                checkIn: format(range.from, "MMM d, yyyy"),
                checkOut: format(range.to, "MMM d, yyyy"),
              })}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">{tProp("booking.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tProp("booking.subtitle")}</p>
        </div>
        <Badge tone="neutral">
          <Calendar className="size-3.5" /> SAR {formatSAR(nightlyRate)} {tProp("booking.perNight")}
        </Badge>
      </div>

      {insight && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-ai" /> {insight.note}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="justify-start">
              <Calendar className="size-4" />
              {range?.from && range?.to
                ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
                : tProp("booking.pickDates")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DateRangeCalendar
              mode="range"
              selected={range}
              onSelect={setRange}
              disabled={{ before: today }}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        <Button
          variant="outline"
          disabled={!range?.from || !range?.to || checking}
          onClick={() => void handleCheck()}
        >
          {checking ? tProp("booking.checking") : tProp("booking.checkAvailability")}
        </Button>
      </div>

      {nights > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-surface p-4 text-sm">
          <span className="text-muted-foreground">{tProp("booking.nightsTotal", { nights })}</span>
          <span className="font-bold tabular-nums">SAR {formatSAR(totalPrice)}</span>
        </div>
      )}

      {availability === true && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-success">
          <CheckCircle2 className="size-4" /> {tProp("booking.available")}
        </p>
      )}
      {availability === false && !error && (
        <p className="mt-3 text-sm font-semibold text-destructive">{tProp("booking.unavailable")}</p>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-5">
        {!user ? (
          <Button variant="hero" asChild>
            <Link to="/auth">{tProp("booking.signInToBook")}</Link>
          </Button>
        ) : (
          <Button variant="hero" disabled={availability !== true || booking} onClick={() => void handleBook()}>
            {booking ? tProp("booking.booking") : tProp("booking.bookNow")}
          </Button>
        )}
      </div>
    </section>
  );
}

// ── ActionsCard ───────────────────────────────────────────────────────────────

function ActionsCard({ property }: { property: Property }) {
  const { t } = useLanguage();
  const tProp = usePropT();
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
      try {
        await deleteSavedProperty(prev);
      } catch {
        setSavedRecordId(prev);
      }
    } else {
      setSavedRecordId(-1);
      try {
        const record = await saveProperty(user.id, Number(property.id));
        setSavedRecordId(record.id);
      } catch {
        setSavedRecordId(null);
      }
    }
  };

  const saved = savedRecordId !== null;
  const isSale = property.listingType === "sale";

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div>
          <div className="text-xs text-muted-foreground">
            {isSale ? t("propertyCard.salePrice") : t("propertyCard.annualRent")}
          </div>
          <div className="font-display text-2xl font-bold tracking-tight">
            SAR {formatSAR(property.price)}
          </div>
          {!isSale && (
            <div className="text-xs text-muted-foreground">
              {tProp("actions.perMonth", { amount: formatSAR(Math.round(property.price / 12)) })}
            </div>
          )}
        </div>
        <div className="mt-5 space-y-2.5">
          <Button variant="hero" size="lg" className="w-full" onClick={() => setShowContact(true)}>
            <Phone className="size-4" /> {tProp("actions.contactLandlord")}
          </Button>
          <Button variant="ai" size="lg" className="w-full" asChild>
            <Link
              to="/advisor"
              search={{ propertyId: Number(property.id) }}
              onClick={() => storeAdvisorCtx(property)}
            >
              <Sparkles className="size-4" /> {tProp("actions.askAI")}
            </Link>
          </Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline" onClick={() => void handleToggleSave()} aria-pressed={saved}>
              <Heart className={"size-4 " + (saved ? "fill-destructive text-destructive" : "")} />
              {saved ? tProp("actions.saved") : tProp("actions.save")}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/compare">
                <GitCompare className="size-4" /> {tProp("actions.compare")}
              </Link>
            </Button>
          </div>
          <Link
            to="/property-requests/new"
            className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-ai transition-colors hover:underline"
          >
            <Sparkles className="size-3.5" /> {t("propertyRequest.entryPoint.ctaShort")}
          </Link>
        </div>
        {!isSale && (
          <div className="mt-5 space-y-2 border-t border-border pt-5 text-sm">
            <Row
              icon={<Wallet className="size-4" />}
              label={tProp("actions.deposit")}
              value={tProp("actions.depositValue")}
            />
            <Row
              icon={<Calendar className="size-4" />}
              label={tProp("actions.available")}
              value={tProp("actions.immediately")}
            />
            <Row
              icon={<Building2 className="size-4" />}
              label={tProp("actions.lease")}
              value={tProp("actions.twelveMonths")}
            />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Lightbulb className="size-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">{tProp("actions.needHelp")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tProp("actions.submitLeadDesc", { district: property.district })}
            </p>
            <Button size="sm" className="mt-3 w-full" asChild>
              <Link to="/lead/new" search={{ area: property.district, city: property.city }}>
                {tProp("actions.submitLeadRequest")}
              </Link>
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
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        {icon} {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function agentInitials(name: string): string {
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "MA"
  );
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
  const { t } = useLanguage();
  const tProp = usePropT();
  const [showCall, setShowCall] = useState(false);
  const hasPhone = !!agentPhone;

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tProp("landlord.listedBy")}
        </div>

        {/* Agent info */}
        <div className="flex items-center gap-3">
          {agentProfileImage ? (
            <img
              src={agentProfileImage}
              alt={agentName}
              className="size-12 rounded-full object-cover"
            />
          ) : (
            <div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              {agentInitials(agentName)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{agentName}</div>
            <div className="text-xs text-muted-foreground">{tProp("landlord.verifiedAgent")}</div>
          </div>
          {mediatorId && (
            <Link
              to="/agent/$id"
              params={{ id: String(mediatorId) }}
              className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {tProp("landlord.profile")}
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
            title={hasPhone ? tProp("landlord.callAgent") : tProp("landlord.noPhone")}
          >
            <Phone className="size-4" /> {t("propertyCard.call")}
          </Button>
          <a
            href={hasPhone ? whatsappLink(agentPhone!) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => !hasPhone && e.preventDefault()}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              hasPhone
                ? "border-whatsapp bg-whatsapp/10 text-whatsapp-foreground hover:bg-whatsapp/20 dark:text-whatsapp"
                : "border-border text-muted-foreground opacity-40 cursor-not-allowed",
            )}
          >
            <WhatsAppIcon className="size-4" />
            {t("propertyCard.whatsapp")}
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
        <PhoneModal
          agentName={agentName}
          agentPhone={agentPhone!}
          onClose={() => setShowCall(false)}
        />
      )}
    </>
  );
}

function PhoneModal({
  agentName,
  agentPhone,
  onClose,
}: {
  agentName: string;
  agentPhone: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const tProp = usePropT();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl text-center space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid size-14 place-items-center rounded-full bg-primary-soft mx-auto">
          <Phone className="size-6 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">{tProp("landlord.callAgentTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {agentName} · {tProp("landlord.verifiedAgent")}
          </p>
        </div>
        <a
          href={`tel:${agentPhone}`}
          className="block rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {agentPhone}
        </a>
        <a
          href={whatsappLink(agentPhone)}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl border border-whatsapp bg-whatsapp/10 px-4 py-3 text-sm font-bold text-whatsapp-foreground hover:bg-whatsapp/20 transition-colors dark:text-whatsapp"
        >
          {tProp("landlord.openInWhatsapp")}
        </a>
        <Button variant="ghost" className="w-full" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
