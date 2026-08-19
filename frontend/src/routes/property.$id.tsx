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
  CheckCircle2,
  Eye,
  FileText,
  GitCompare,
  GraduationCap,
  Handshake,
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
  Star,
  Trees,
  TrendingDown,
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
import { PropertyTrustSection } from "@/components/maskan/PropertyTrustCenter";
import {
  fetchProperty,
  fetchSimilarProperties,
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
  submitFinancingInterest,
  fetchRentalScore,
  fetchPropertyIntelligence,
  fetchPropertyAiSummary,
  createViewing,
  fetchMyViewings,
  VIEWING_INACTIVE_STATUSES,
  createNegotiation,
  fetchActiveNegotiation,
  type ApiAreaIntelligence,
  type ApiAvailabilityInsight,
  type ApiFinancingInterest,
  type ApiPropertyIntelligence,
  type ApiPropertyNegotiation,
  type ApiPropertyViewing,
  type ApiRentTrendPoint,
  type PropertyIntelligenceCriteria,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR, type Property } from "@/lib/maskan-data";
import { PHASE1_FLAGS } from "@/lib/phase1-flags";
import prop1 from "@/assets/prop-1.jpg";
import prop2 from "@/assets/prop-2.jpg";
import prop3 from "@/assets/prop-3.jpg";
import prop4 from "@/assets/prop-4.jpg";
import heroImg from "@/assets/hero-villa.jpg";

export const Route = createFileRoute("/property/$id")({
  head: () => ({
    meta: [
      { title: "Property Details — myMakan" },
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
  const [areaIntel, setAreaIntel] = useState<ApiAreaIntelligence | null>(null);
  const [areaAvgMonthly, setAreaAvgMonthly] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // myMakan Property Intelligence — fetched separately, after the core
  // property data has already rendered, so a slow/failed call never blocks
  // the rest of the page (Prompt 7).
  const [intelligence, setIntelligence] = useState<ApiPropertyIntelligence | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(true);
  const [intelligenceError, setIntelligenceError] = useState(false);

  // Contact modal + saved state, lifted here (rather than kept local to
  // ActionsCard) so the new Intelligence hero's "Contact Agent" button, and
  // Smart Questions' "Send to Agent" action, can trigger the same
  // modal/saved-record flow instead of duplicating it.
  const { user } = useAuth();
  const [savedRecordId, setSavedRecordId] = useState<number | null>(null);
  const [showContact, setShowContact] = useState(false);
  const [contactPrefillMessage, setContactPrefillMessage] = useState<string | null>(null);
  const [showDecisionSheet, setShowDecisionSheet] = useState(false);

  // Visit & Viewing Management (Prompt 7) — the logged-in customer's own
  // active (non-cancelled/completed) viewing for this exact property, if
  // any. Drives the Schedule Viewing CTA (disabled/redirected when one
  // already exists, per brief §18) and the status banner below the gallery.
  const [showScheduleViewing, setShowScheduleViewing] = useState(false);
  const [myActiveViewing, setMyActiveViewing] = useState<ApiPropertyViewing | null>(null);

  // AI Negotiation & Offer Management (Prompt 7) — "Make an Offer" vs "View
  // Negotiation" entry point. `isPublished` tracks the RAW backend status
  // ("Published") rather than the mapped UI Property.status (which already
  // collapses everything else to "Available"/"Reserved" and has no
  // "Published" literal at all — see mapApiProperty in lib/api/maskan.ts),
  // captured straight off the ApiProperty response in loadAll() below, per
  // brief §3's "do not show for inactive/unavailable properties".
  const [isPublished, setIsPublished] = useState(true);
  const [activeNegotiation, setActiveNegotiation] = useState<ApiPropertyNegotiation | null>(null);
  const [showMakeOffer, setShowMakeOffer] = useState(false);
  const [offerPrefillViewingId, setOfferPrefillViewingId] = useState<number | undefined>(undefined);

  function openContact(prefill?: string) {
    setContactPrefillMessage(prefill ?? null);
    setShowContact(true);
  }

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
        const propertyData = await fetchProperty(propertyId);
        if (cancelled) return;
        const mapped = mapApiProperty(propertyData);
        setProperty(mapped);
        setIsPublished(propertyData.status === "Published");

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

  // Property Intelligence — fetched only once the core property is loaded,
  // in its own effect/loading state so a slow or failing call never blocks
  // the rest of the page.
  useEffect(() => {
    let cancelled = false;
    if (!property) return;
    setIntelligenceLoading(true);
    setIntelligenceError(false);
    fetchPropertyIntelligence(Number(property.id), consumeHomeFinderCriteria())
      .then((data) => {
        if (cancelled) return;
        setIntelligence(data);
      })
      .catch(() => {
        if (cancelled) return;
        setIntelligence(null);
        setIntelligenceError(true);
      })
      .finally(() => {
        if (!cancelled) setIntelligenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [property?.id]);

  useEffect(() => {
    if (!user || !property) return;
    fetchSavedProperties(user.id)
      .then((list) => {
        const match = list.find((s) => String(s.property_id) === String(property.id));
        setSavedRecordId(match ? match.id : null);
      })
      .catch(() => {});
  }, [user, property?.id]);

  useEffect(() => {
    if (!user || !property) return;
    let cancelled = false;
    fetchMyViewings()
      .then((list) => {
        if (cancelled) return;
        const active = list.find(
          (v) =>
            String(v.property_id) === String(property.id) &&
            !(VIEWING_INACTIVE_STATUSES as readonly string[]).includes(v.status),
        );
        setMyActiveViewing(active ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, property?.id]);

  // The caller's own active (non-terminal) negotiation for this property, if
  // any — drives the "Make an Offer" vs "View Negotiation" CTA (brief §3).
  // A 404 (no active negotiation) is the expected/common case, not an
  // error — same soft-fail idiom fetchAreaIntelligence/fetchMyViewings use.
  useEffect(() => {
    if (!user || !property) return;
    let cancelled = false;
    fetchActiveNegotiation(Number(property.id))
      .then((negotiation) => {
        if (!cancelled) setActiveNegotiation(negotiation);
      })
      .catch(() => {
        if (!cancelled) setActiveNegotiation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, property?.id]);

  // Retargeted "Ask AI about negotiation" hook from a completed viewing's
  // detail screen (viewings.$id.tsx) — opens the Make an Offer flow
  // pre-filled with viewing_id instead of deep-linking to /advisor. Uses the
  // same sessionStorage handoff idiom as storeAdvisorCtx/
  // consumeHomeFinderCriteria above (write-once-before-navigating,
  // read-once-and-clear here).
  useEffect(() => {
    if (!property) return;
    const viewingId = consumeOfferHandoff();
    if (viewingId != null) {
      setOfferPrefillViewingId(viewingId);
      setShowMakeOffer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.id]);

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

  // Lifted here (rather than kept local to ActionsCard) so the Prompt 10
  // mobile sticky action bar's "Save" button can reuse the exact same
  // save/unsave logic instead of duplicating it. A function expression
  // (not a hoisted function declaration) so TS keeps `property` narrowed
  // to non-null from the guard above.
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

      {myActiveViewing && (
        <div className="container-page pt-6">
          <ViewingStatusBanner viewing={myActiveViewing} onMessageMediator={() => openContact()} />
        </div>
      )}

      <div className="container-page grid grid-cols-1 gap-10 pb-32 lg:pb-16 lg:grid-cols-[1.7fr_1fr]">
        <main className="space-y-10">
          <Summary property={property} />
          <PropertyTrustSection
            propertyId={Number(property.id)}
            intelligence={intelligence}
            mediatorId={property.mediatorId}
            mediatorName={property.agent}
          />
          <IntelligenceHero
            property={property}
            intelligence={intelligence}
            loading={intelligenceLoading}
            error={intelligenceError}
            onOpenContact={() => openContact()}
            onOpenWhyThisProperty={() => setShowDecisionSheet(true)}
          />
          <PersonalizedFitSection intelligence={intelligence} />
          <DecisionScoreCard intelligence={intelligence} />
          <PriceIntelligenceCard intelligence={intelligence} isSale={isSale} />
          <AtAGlanceCard intelligence={intelligence} />
          <SimilarPropertiesSection intelligence={intelligence} currentId={property.id} />
          <AreaIntelligenceEmbed areaIntel={areaIntel} intelligence={intelligence} district={property.district} />
          <SmartQuestionsSection intelligence={intelligence} onSendToAgent={openContact} />
          <NegotiationInsightCard property={property} intelligence={intelligence} onUseInContact={openContact} />
          <AskMyMakanQuickQuestions property={property} isSale={isSale} />
          {/* Rent Now Pay Later is a financing feature — Hide-Phase1 (see
              docs/implementation/mymakan-phase1.md "Feature flags"); the
              backend's /financing router is already unregistered by
              default, so leaving this visible would just lead to a
              broken call. */}
          {!isSale && PHASE1_FLAGS.financing && <RentNowPayLaterBanner property={property} />}
          <PropertyFeatures property={property} />
          <DescriptionSection property={property} />
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
          {/* Short-term/nightly booking is Hide-Phase1 (short_stay/booking) —
              the backend's /bookings router is already unregistered by
              default, so this would just hit a 404 if shown. */}
          {!isSale && PHASE1_FLAGS.booking && <ShortTermBooking property={property} />}
          <RentPayments property={property} />
          <AreaSummary property={property} />
          <NearbyPlaces areaIntel={areaIntel} district={property.district} />
          <ListingDetailsPanel property={property} />
          <ComparableListings currentId={property.id} />
          <AiSummary
            property={property}
            areaIntel={areaIntel}
            areaAvgMonthly={effectiveAreaAvgMonthly}
          />
        </main>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <ActionsCard
            property={property}
            savedRecordId={savedRecordId}
            setSavedRecordId={setSavedRecordId}
            showContact={showContact}
            setShowContact={(show) => {
              setShowContact(show);
              if (!show) setContactPrefillMessage(null);
            }}
            contactPrefillMessage={contactPrefillMessage}
            onToggleSave={() => void handleToggleSave()}
            activeViewing={myActiveViewing}
            onScheduleViewing={() => setShowScheduleViewing(true)}
            isPublished={isPublished}
            activeNegotiation={activeNegotiation}
            onMakeOffer={() => {
              setOfferPrefillViewingId(undefined);
              setShowMakeOffer(true);
            }}
          />
          <LandlordCard
            agentName={property.agent}
            agentPhone={property.agentPhone}
            agentWhatsapp={property.agentWhatsapp}
            agentProfileImage={property.agentProfileImage}
            mediatorId={property.mediatorId}
            mediatorRating={property.mediatorRating}
            mediatorReviewCount={property.mediatorReviewCount}
          />
          {/* Advertises the Ejar-equivalent digital rental contract feature
              (Hide-Phase1, see frontend/src/lib/phase1-flags.ts). */}
          {PHASE1_FLAGS.contracts && <RegisterLeaseBanner property={property} />}
        </aside>
      </div>

      {showDecisionSheet && (
        <DecisionSheet
          intelligence={intelligence}
          onAskAI={() => {
            storeAdvisorCtx(property);
          }}
          propertyId={Number(property.id)}
          onClose={() => setShowDecisionSheet(false)}
        />
      )}

      {showScheduleViewing && !myActiveViewing && (
        <ScheduleViewingModal
          property={property}
          onClose={() => setShowScheduleViewing(false)}
          onSuccess={(viewing) => {
            setMyActiveViewing(viewing);
            setShowScheduleViewing(false);
          }}
        />
      )}

      {/* Gated on showMakeOffer alone — NOT `!activeNegotiation`. The CTA
          that opens this modal already only appears when there's no active
          negotiation (see ActionsCard below), but the modal's own onSuccess
          callback SETS activeNegotiation on a successful submit; gating the
          modal's render on `!activeNegotiation` would unmount it (and wipe
          out its post-submit confirmation state) the instant submission
          succeeds, before the customer ever sees it. */}
      {showMakeOffer && (
        <MakeOfferModal
          property={property}
          intelligence={intelligence}
          initialViewingId={offerPrefillViewingId}
          onClose={() => {
            setShowMakeOffer(false);
            setOfferPrefillViewingId(undefined);
          }}
          onSuccess={(negotiation) => setActiveNegotiation(negotiation)}
        />
      )}

      {/* Mobile sticky action bar — fixed at bottom, hidden on desktop
          (Prompt 10): primary Contact Agent, secondary Save / Ask AI — all
          three reuse the exact handlers ActionsCard/IntelligenceHero already
          use, no new logic. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2">
          <Button variant="hero" className="flex-1" onClick={() => openContact()}>
            <Phone className="size-4" /> {tProp("actions.contactLandlord")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={savedRecordId !== null ? tProp("actions.saved") : tProp("actions.save")}
            aria-pressed={savedRecordId !== null}
            onClick={() => void handleToggleSave()}
          >
            <Heart className={cn("size-4", savedRecordId !== null && "fill-destructive text-destructive")} />
          </Button>
          <Button variant="ai" size="icon" aria-label={tProp("actions.askAI")} asChild>
            <Link
              to="/advisor"
              search={{ propertyId: Number(property.id) }}
              onClick={() => storeAdvisorCtx(property)}
            >
              <Sparkles className="size-4" />
            </Link>
          </Button>
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
    ...(property.livingRooms != null
      ? [
          {
            icon: <Sofa className="size-4" />,
            label: tProp("summary.livingRooms"),
            value: property.livingRooms,
          },
        ]
      : []),
    {
      icon: <Maximize className="size-4" />,
      label: tProp("summary.area"),
      value: `${property.area} m²`,
    },
    ...(property.furnished
      ? [
          {
            icon: <Sofa className="size-4" />,
            label: tProp("summary.furnishing"),
            value: property.furnished,
          },
        ]
      : []),
    {
      icon: <Calendar className="size-4" />,
      label: tProp("summary.buildingAge"),
      value:
        !property.propertyAgeYears
          ? tProp("summary.new")
          : tProp("summary.years", { count: property.propertyAgeYears }),
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
            {property.commissionPercent != null && (
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                {tProp("summary.plusCommission", { percent: property.commissionPercent })}
              </span>
            )}
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

/* --------------------------- myMakan Intelligence -------------------------- */
// Prompt 7: hero + Decision Score + Price Intelligence. Comparables/Area/
// Smart Questions/Negotiation sections are built in Prompts 8-9.

const CLASSIFICATION_KEYS: Record<string, string> = {
  "Excellent Value": "excellentValue",
  "Good Value": "goodValue",
  Fair: "fair",
  "Above Market": "aboveMarket",
  "Significantly Above Market": "significantlyAboveMarket",
};

function classificationKey(classification: string): string {
  return CLASSIFICATION_KEYS[classification] ?? "fair";
}

function classificationTone(classification: string): "success" | "neutral" | "warning" | "destructive" {
  if (classification === "Excellent Value" || classification === "Good Value") return "success";
  if (classification === "Fair") return "neutral";
  if (classification === "Above Market") return "warning";
  return "destructive";
}

function IntelligenceHero({
  property,
  intelligence,
  loading,
  error,
  onOpenContact,
  onOpenWhyThisProperty,
}: {
  property: Property;
  intelligence: ApiPropertyIntelligence | null;
  loading: boolean;
  error: boolean;
  onOpenContact: () => void;
  onOpenWhyThisProperty: () => void;
}) {
  const tProp = usePropT();
  const isSale = property.listingType === "sale";
  const pi = intelligence?.price_intelligence;

  if (error) return null; // never block the rest of the page on a failed call

  return (
    <section className="rounded-2xl border border-ai/20 bg-ai/5 p-6 shadow-card md:p-8">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="size-4 text-ai" />
        <span className="text-xs font-semibold uppercase tracking-wide text-ai">
          {tProp("intelligence.badge")}
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ) : !intelligence ? (
        <p className="text-sm text-muted-foreground">{tProp("intelligence.unavailable")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <ScoreRing score={intelligence.decision_score} size={48} />
            {intelligence.personalized_fit && (
              <Badge tone="ai">
                {tProp("intelligence.matchLabel", {
                  percent: Math.round(
                    (intelligence.personalized_fit.priorities_matched /
                      Math.max(1, intelligence.personalized_fit.priorities_total)) *
                      100,
                  ),
                })}
              </Badge>
            )}
            {pi?.classification && (
              <Badge tone={classificationTone(pi.classification)}>
                {tProp(`intelligence.priceIntelligence.classification.${classificationKey(pi.classification)}`)}
              </Badge>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-6">
            <div>
              <div className="text-xs text-muted-foreground">
                {isSale ? tProp("intelligence.askingPrice") : tProp("intelligence.askingRent")}
              </div>
              <div className="text-xl font-bold tracking-tight">
                {/* pi.asking_price is the same figure the fair range below was computed
                    against (monthly for rent, total for sale) — deliberately NOT
                    property.price (annual for rent) here, so the two numbers in this
                    card are always expressed in the same unit. */}
                SAR {formatSAR(pi?.asking_price ?? property.price)}
                {!isSale && <span className="ms-1 text-xs font-normal text-muted-foreground">{tProp("perMonthShort")}</span>}
              </div>
            </div>
            {pi?.sufficient_data && pi.fair_range_low != null && pi.fair_range_high != null && (
              <div>
                <div className="text-xs text-muted-foreground">
                  {tProp("intelligence.priceIntelligence.fairRange")}
                </div>
                <div className="text-sm font-semibold">
                  SAR {formatSAR(Math.round(pi.fair_range_low))} – SAR {formatSAR(Math.round(pi.fair_range_high))}
                  {!isSale && <span className="ms-1 text-xs font-normal text-muted-foreground">{tProp("perMonthShort")}</span>}
                </div>
              </div>
            )}
          </div>

          {intelligence.personalized_fit && (
            <p className="mt-3 text-sm text-muted-foreground">{intelligence.personalized_fit.summary}</p>
          )}

          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button size="sm" variant="outline" onClick={onOpenWhyThisProperty}>
              {tProp("intelligence.actions.whyThisProperty")}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/compare">
                <GitCompare className="size-4" /> {tProp("intelligence.actions.compare")}
              </Link>
            </Button>
            <Button size="sm" variant="ai" asChild>
              <Link
                to="/advisor"
                search={{ propertyId: Number(property.id) }}
                onClick={() => storeAdvisorCtx(property)}
              >
                <Sparkles className="size-4" /> {tProp("intelligence.actions.askMyMakan")}
              </Link>
            </Button>
            <Button size="sm" variant="hero" onClick={onOpenContact}>
              <Phone className="size-4" /> {tProp("intelligence.actions.contactAgent")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

const DECISION_SCORE_DIMENSIONS = [
  "price_value",
  "location_fit",
  "property_fit",
  "amenities",
  "area",
  "listing_confidence",
] as const;

function DecisionScoreCard({ intelligence }: { intelligence: ApiPropertyIntelligence | null }) {
  const tProp = usePropT();
  if (!intelligence) return null;
  const dims = DECISION_SCORE_DIMENSIONS.filter((key) => intelligence.component_scores[key]);
  if (dims.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex items-center gap-4">
        <ScoreRing score={intelligence.decision_score} size={56} />
        <div>
          <h2 className="text-lg font-bold">{tProp("intelligence.decisionScore.title")}</h2>
          <p className="text-sm text-muted-foreground">{tProp("intelligence.decisionScore.subtitle")}</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {dims.map((key) => (
          <ScoreBar
            key={key}
            label={tProp(`intelligence.decisionScore.dimensions.${key}`)}
            value={intelligence.component_scores[key].score}
          />
        ))}
      </div>
      {intelligence.omitted_score_dimensions.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">{tProp("intelligence.decisionScore.omittedNote")}</p>
      )}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function PriceIntelligenceCard({
  intelligence,
  isSale,
}: {
  intelligence: ApiPropertyIntelligence | null;
  isSale: boolean;
}) {
  const tProp = usePropT();
  if (!intelligence) return null;
  const pi = intelligence.price_intelligence;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="text-lg font-bold">
        {isSale ? tProp("intelligence.priceIntelligence.titleBuy") : tProp("intelligence.priceIntelligence.titleRent")}
      </h2>

      {!pi.sufficient_data ? (
        <p className="mt-3 text-sm text-muted-foreground">{tProp("intelligence.priceIntelligence.insufficientData")}</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {pi.classification && (
              <Badge tone={classificationTone(pi.classification)}>
                {tProp(`intelligence.priceIntelligence.classification.${classificationKey(pi.classification)}`)}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {tProp("intelligence.priceIntelligence.comparableCount", { count: pi.comparable_count })}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {!isSale ? (
              // Every figure here is monthly (the unit price_intelligence.py compares
              // rent listings on) — labelled explicitly so it's never read as the
              // page's usual annual rent figure.
              <>
                <MiniStat
                  label={tProp("intelligence.askingRent")}
                  value={`SAR ${formatSAR(pi.asking_price ?? 0)} ${tProp("perMonthShort")}`}
                />
                {pi.fair_range_low != null && pi.fair_range_high != null && (
                  <MiniStat
                    label={tProp("intelligence.priceIntelligence.fairRange")}
                    value={`SAR ${formatSAR(Math.round(pi.fair_range_low))} – ${formatSAR(Math.round(pi.fair_range_high))} ${tProp("perMonthShort")}`}
                  />
                )}
                {pi.market_midpoint != null && (
                  <MiniStat
                    label={tProp("intelligence.priceIntelligence.marketMidpoint")}
                    value={`SAR ${formatSAR(Math.round(pi.market_midpoint))} ${tProp("perMonthShort")}`}
                  />
                )}
              </>
            ) : (
              <>
                <MiniStat label={tProp("intelligence.askingPrice")} value={`SAR ${formatSAR(pi.asking_price ?? 0)}`} />
                {pi.price_per_sqm != null && (
                  <MiniStat
                    label={tProp("intelligence.priceIntelligence.pricePerSqm")}
                    value={`SAR ${formatSAR(Math.round(pi.price_per_sqm))}`}
                  />
                )}
                {pi.comparable_median_price_per_sqm != null && (
                  <MiniStat
                    label={tProp("intelligence.priceIntelligence.comparableMedianPricePerSqm")}
                    value={`SAR ${formatSAR(Math.round(pi.comparable_median_price_per_sqm))}`}
                  />
                )}
                {pi.estimated_value_low != null && pi.estimated_value_high != null && (
                  <MiniStat
                    label={tProp("intelligence.priceIntelligence.estimatedValueRange")}
                    value={`SAR ${formatSAR(Math.round(pi.estimated_value_low))} – ${formatSAR(Math.round(pi.estimated_value_high))}`}
                  />
                )}
              </>
            )}
          </div>
          {pi.factors_used.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {tProp("intelligence.priceIntelligence.factorsUsed")}:{" "}
              {pi.factors_used.map((f) => tProp(`intelligence.priceIntelligence.factors.${f}`)).join(", ")}
            </p>
          )}
          {isSale && (
            <p className="mt-3 text-xs text-muted-foreground">{tProp("intelligence.priceIntelligence.disclaimerBuy")}</p>
          )}
        </>
      )}
    </section>
  );
}

/* --------------------------- At a Glance (Prompt 8) ------------------------ */

function AtAGlanceCard({ intelligence }: { intelligence: ApiPropertyIntelligence | null }) {
  const tProp = usePropT();
  const [showWhy, setShowWhy] = useState(false);
  if (!intelligence) return null;
  const { strengths, considerations, things_to_verify, data_confidence } = intelligence;
  if (strengths.length === 0 && considerations.length === 0 && things_to_verify.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight">{tProp("intelligence.atAGlance.title")}</h2>
        <div className="flex items-center gap-2">
          <Badge tone={data_confidence.level === "High" ? "success" : "warning"}>
            {tProp(data_confidence.level === "High" ? "intelligence.dataConfidence.high" : "intelligence.dataConfidence.moderate")}
          </Badge>
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {tProp("intelligence.dataConfidence.why")}
          </button>
        </div>
      </div>
      {showWhy && <p className="mt-2 text-xs text-muted-foreground">{data_confidence.reason}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        {strengths.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-success">{tProp("intelligence.atAGlance.strengths")}</h3>
            <ul className="mt-3 space-y-2">
              {strengths.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="text-muted-foreground">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {considerations.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-warning">{tProp("intelligence.atAGlance.considerations")}</h3>
            <ul className="mt-3 space-y-2">
              {considerations.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span className="text-muted-foreground">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {things_to_verify.length > 0 && (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">{tProp("intelligence.atAGlance.thingsToVerify")}</h3>
          <ul className="mt-3 space-y-2">
            {things_to_verify.map((v) => (
              <li key={v} className="flex items-start gap-2 text-sm">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ----------------------- Similar Properties (Prompt 8) --------------------- */
// Distinct from the pre-existing `ComparableListings` below (which ranks by
// the older client-side rental-score heuristic) — this section is powered by
// Prompt 3's deterministic comparable-selection service (match-similarity %,
// value labels) via the intelligence payload's `comparable_summary`.
// Deferred behind an expand toggle (this file's existing readMore/readLess
// pattern) so the extra per-comparable property fetches only happen once the
// user actually asks to see them — keeps the initial render light.

const VALUE_LABEL_KEYS: Record<string, string> = {
  "Better Value": "betterValue",
  "Similar Price": "similarPrice",
  "Higher Price": "higherPrice",
};

function valueLabelTone(label: string): "success" | "neutral" | "warning" {
  if (label === "Better Value") return "success";
  if (label === "Higher Price") return "warning";
  return "neutral";
}

function SimilarPropertiesSection({
  intelligence,
  currentId,
}: {
  intelligence: ApiPropertyIntelligence | null;
  currentId: string;
}) {
  const tProp = usePropT();
  const [expanded, setExpanded] = useState(false);
  const [properties, setProperties] = useState<Record<number, Property>>({});
  const [loadingCards, setLoadingCards] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const items = intelligence?.comparable_summary.items ?? [];

  useEffect(() => {
    if (!expanded || items.length === 0) return;
    let cancelled = false;
    setLoadingCards(true);
    Promise.all(
      items.map((item) =>
        fetchProperty(item.property_id)
          .then((p) => [item.property_id, mapApiProperty(p)] as const)
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<number, Property> = {};
      for (const r of results) if (r) map[r[0]] = r[1];
      setProperties(map);
      setLoadingCards(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, items.length]);

  if (!intelligence || items.length === 0) return null;

  const toggleCompare = (id: string) =>
    setCompareIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 3 ? [...c, id] : c));

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">{tProp("intelligence.similarProperties.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tProp("intelligence.similarProperties.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? tProp("intelligence.similarProperties.hide") : tProp("intelligence.similarProperties.show")}
        </Button>
      </div>

      {expanded && (
        <>
          {loadingCards ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.slice(0, 3).map((item) => (
                <Skeleton key={item.property_id} className="h-80 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const p = properties[item.property_id];
                if (!p) return null;
                const compared = compareIds.includes(p.id);
                return (
                  <div key={item.property_id} className="space-y-2">
                    <PropertyCard p={p} />
                    <div className="flex items-center justify-between gap-2 px-1">
                      {item.value_label && (
                        <Badge tone={valueLabelTone(item.value_label)}>
                          {tProp(`intelligence.similarProperties.valueLabel.${VALUE_LABEL_KEYS[item.value_label] ?? "similarPrice"}`)}
                        </Badge>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleCompare(p.id)}
                        className={cn(
                          "text-xs font-semibold hover:underline",
                          compared ? "text-success" : "text-primary",
                        )}
                      >
                        {compared ? tProp("intelligence.similarProperties.added") : tProp("intelligence.similarProperties.compareWith")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {compareIds.length > 0 && (
            <div className="mt-5 flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <span className="text-sm font-medium">{compareIds.length + 1} {tProp("actions.compare")}</span>
              <Button size="sm" asChild>
                <Link to="/compare">
                  <GitCompare className="size-4" /> {tProp("actions.compare")}
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------------- Area Intelligence embed (Prompt 8) ----------------- */
// Reuses the SAME `areaIntel` (full ApiAreaIntelligence) already fetched by
// PropertyDetail's main effect — no second area-intelligence fetch — and the
// intelligence payload's own price_intelligence range as the "typical
// price/rent band," tying the two data sources together instead of
// duplicating the Area Intelligence backend or inventing a second summary.

function trendDirection(trend: ApiRentTrendPoint[]): "up" | "down" | "flat" | null {
  if (trend.length < 2) return null;
  const last = trend[trend.length - 1].avg_rent_annual;
  const prev = trend[trend.length - 2].avg_rent_annual;
  if (last > prev * 1.02) return "up";
  if (last < prev * 0.98) return "down";
  return "flat";
}

function AreaIntelligenceEmbed({
  areaIntel,
  intelligence,
  district,
}: {
  areaIntel: ApiAreaIntelligence | null;
  intelligence: ApiPropertyIntelligence | null;
  district: string;
}) {
  const tProp = usePropT();
  const [expanded, setExpanded] = useState(false);
  if (!areaIntel) return null;

  const trend = trendDirection(areaIntel.rent_trend);
  const pi = intelligence?.price_intelligence;
  const band =
    pi?.sufficient_data && pi.fair_range_low != null && pi.fair_range_high != null
      ? `SAR ${formatSAR(Math.round(pi.fair_range_low))} – ${formatSAR(Math.round(pi.fair_range_high))}`
      : pi?.sufficient_data && pi.estimated_value_low != null && pi.estimated_value_high != null
        ? `SAR ${formatSAR(Math.round(pi.estimated_value_low))} – ${formatSAR(Math.round(pi.estimated_value_high))}`
        : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-xl font-bold tracking-tight">
          {tProp("intelligence.areaEmbed.titlePrefix")} {district}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/areas?area=${encodeURIComponent(district)}`}>
              <MapPin className="size-4" /> {tProp("intelligence.areaEmbed.exploreArea", { district })}
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? tProp("intelligence.areaEmbed.hide") : tProp("intelligence.areaEmbed.show")}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {areaIntel.lifestyle_score != null && (
              <MiniStat label={tProp("intelligence.areaEmbed.lifestyleScore")} value={`${Math.round(areaIntel.lifestyle_score)}/100`} />
            )}
            {areaIntel.school_score != null && (
              <MiniStat label={tProp("intelligence.areaEmbed.schoolScore")} value={`${Math.round(areaIntel.school_score)}/100`} />
            )}
            {areaIntel.healthcare_score != null && (
              <MiniStat label={tProp("intelligence.areaEmbed.healthcareScore")} value={`${Math.round(areaIntel.healthcare_score)}/100`} />
            )}
            {trend && (
              <MiniStat
                label={tProp("intelligence.areaEmbed.rentTrend")}
                value={trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
              />
            )}
          </div>
          {band && <MiniStat label={tProp("intelligence.areaEmbed.typicalBand")} value={band} />}
          <p className="text-sm leading-6 text-muted-foreground">
            {areaIntel.overview || tProp("intelligence.areaEmbed.noOverview")}
          </p>
        </div>
      )}
    </section>
  );
}

/* ------------------------ Personalized Fit (Prompt 9) ---------------------- */
// Renders only when `personalized_fit` is present in the intelligence
// response — i.e. the visitor arrived with AI Home Finder criteria (see
// `consumeHomeFinderCriteria` / the sessionStorage handoff in
// home-finder.tsx's MatchCard) or supplied criteria some other way. Never
// fabricates personalization when none exists.

const FIT_STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = {
  match: "success",
  moderate: "warning",
  miss: "destructive",
};

function PersonalizedFitSection({ intelligence }: { intelligence: ApiPropertyIntelligence | null }) {
  const tProp = usePropT();
  const fit = intelligence?.personalized_fit;
  if (!fit) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight">{tProp("intelligence.personalizedFit.title")}</h2>
        <span className="text-sm font-medium text-muted-foreground">{fit.summary}</span>
      </div>
      <ul className="mt-5 space-y-2">
        {fit.rows.map((row) => (
          <li
            key={row.label}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold">{row.label}</div>
              {row.detail && <div className="text-xs text-muted-foreground">{row.detail}</div>}
            </div>
            <Badge tone={FIT_STATUS_TONE[row.status] ?? "neutral"}>
              {tProp(`intelligence.personalizedFit.status.${row.status}`)}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* --------------------------- Decision Sheet (Prompt 9) --------------------- */
// A generalized "why this property" sheet driven by Property Intelligence
// data (strengths/considerations/things_to_verify) — kept as its own
// component here rather than reusing home-finder.tsx's `WhyThisPropertyModal`,
// which is driven by a different data shape (AI Home Finder match results,
// not Property Intelligence) and stays untouched. Documented per Prompt 9's
// "your call" allowance on shared-vs-separate.

function DecisionSheet({
  intelligence,
  propertyId,
  onAskAI,
  onClose,
}: {
  intelligence: ApiPropertyIntelligence | null;
  propertyId: number;
  onAskAI: () => void;
  onClose: () => void;
}) {
  const tProp = usePropT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isEmpty =
    !intelligence ||
    (intelligence.strengths.length === 0 &&
      intelligence.considerations.length === 0 &&
      intelligence.things_to_verify.length === 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ maxHeight: "min(92vh, 720px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            {intelligence && <ScoreRing score={intelligence.decision_score} size={44} />}
            <h3 className="font-display text-base font-bold">{tProp("intelligence.decisionSheet.title")}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isEmpty ? (
            <p className="text-sm text-muted-foreground">{tProp("intelligence.decisionSheet.empty")}</p>
          ) : (
            <>
              {intelligence!.strengths.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {tProp("intelligence.decisionSheet.whyItWorks")}
                  </p>
                  <ul className="space-y-1">
                    {intelligence!.strengths.map((s) => (
                      <li key={s} className="flex items-start gap-1.5 text-sm">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {intelligence!.considerations.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {tProp("intelligence.decisionSheet.tradeOffs")}
                  </p>
                  <ul className="space-y-1">
                    {intelligence!.considerations.map((c) => (
                      <li key={c} className="flex items-start gap-1.5 text-sm">
                        <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-warning" /> {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {intelligence!.things_to_verify.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {tProp("intelligence.decisionSheet.thingsToVerify")}
                  </p>
                  <ul className="space-y-1">
                    {intelligence!.things_to_verify.map((v) => (
                      <li key={v} className="flex items-start gap-1.5 text-sm">
                        <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> {v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <Button variant="ai" className="w-full gap-2" asChild>
            <Link to="/advisor" search={{ propertyId }} onClick={onAskAI}>
              <MessageCircle className="size-4" /> {tProp("intelligence.decisionSheet.askAI")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Smart Questions (Prompt 9) --------------------- */

function SmartQuestionsSection({
  intelligence,
  onSendToAgent,
}: {
  intelligence: ApiPropertyIntelligence | null;
  onSendToAgent: (message: string) => void;
}) {
  const tProp = usePropT();
  const [copied, setCopied] = useState(false);
  const questions = intelligence?.smart_questions ?? [];
  if (questions.length === 0) return null;

  const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(questionsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — no-op, button simply won't show "Copied!"
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{tProp("intelligence.smartQuestions.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{tProp("intelligence.smartQuestions.subtitle")}</p>
      <ol className="mt-4 list-inside list-decimal space-y-2 text-sm">
        {questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
          {copied ? tProp("intelligence.smartQuestions.copied") : tProp("intelligence.smartQuestions.copyQuestions")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onSendToAgent(questionsText)}>
          {tProp("intelligence.smartQuestions.sendToAgent")}
        </Button>
      </div>
    </section>
  );
}

/* ------------------------ Negotiation Insight (Prompt 9) ------------------- */

function NegotiationInsightCard({
  property,
  intelligence,
  onUseInContact,
}: {
  property: Property;
  intelligence: ApiPropertyIntelligence | null;
  onUseInContact: (message: string) => void;
}) {
  const tProp = usePropT();
  const { lang } = useLanguage();
  const [draft, setDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const negotiation = intelligence?.negotiation_intelligence;
  if (!negotiation) return null;

  async function handleDraft() {
    setDrafting(true);
    try {
      const resp = await fetchPropertyAiSummary(Number(property.id), lang === "ar" ? "ar" : "en", "negotiation_message");
      setDraft(resp.summary);
    } catch {
      setDraft(null);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{tProp("intelligence.negotiation.title")}</h2>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MiniStat label={tProp("intelligence.negotiation.askingPrice")} value={`SAR ${formatSAR(negotiation.asking_price)}`} />
        <MiniStat label={tProp("intelligence.negotiation.marketMidpoint")} value={`SAR ${formatSAR(Math.round(negotiation.market_midpoint))}`} />
        <MiniStat
          label={tProp("intelligence.negotiation.discussionRange")}
          value={`SAR ${formatSAR(Math.round(negotiation.discussion_range_low))} – ${formatSAR(Math.round(negotiation.discussion_range_high))}`}
        />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{negotiation.approach}</p>

      {draft === null ? (
        <Button variant="outline" size="sm" className="mt-5" disabled={drafting} onClick={() => void handleDraft()}>
          {drafting ? tProp("intelligence.negotiation.drafting") : tProp("intelligence.negotiation.draftMessage")}
        </Button>
      ) : (
        <div className="mt-5 rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold">{tProp("intelligence.negotiation.draftedTitle")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{tProp("intelligence.negotiation.draftedDesc")}</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
          />
          <Button size="sm" className="mt-3" onClick={() => onUseInContact(draft)}>
            {tProp("intelligence.negotiation.useInContact")}
          </Button>
        </div>
      )}
    </section>
  );
}

/* -------------------------- Ask myMakan (Prompt 9) -------------------------- */
// Property-aware quick questions into the existing AI Advisor, via the same
// sessionStorage handoff (`storeAdvisorCtx`) property.$id.tsx already uses
// for the hero's "Ask myMakan" button — not a new chat surface.

function AskMyMakanQuickQuestions({ property, isSale }: { property: Property; isSale: boolean }) {
  const tProp = usePropT();
  const baseKeys = ["fairPricing", "compromises", "compare", "whatToAsk", "familySuitability", "negotiateHelp", "areaInfo"] as const;
  const buyKeys = ["pricePerSqm", "rentalIncome"] as const;
  const keys = isSale ? [...baseKeys, ...buyKeys] : baseKeys;

  return (
    <section className="rounded-2xl border border-ai/20 bg-ai/5 p-6 shadow-card md:p-8">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-ai" />
        <h2 className="font-display text-xl font-bold tracking-tight">{tProp("intelligence.quickQuestions.title")}</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{tProp("intelligence.quickQuestions.subtitle")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {keys.map((key) => {
          const question = tProp(`intelligence.quickQuestions.${key}`, { district: property.district });
          return (
            <Link
              key={key}
              to="/advisor"
              search={{ propertyId: Number(property.id), q: question }}
              onClick={() => storeAdvisorCtx(property)}
              className="rounded-full border border-ai/30 bg-background px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-ai/10"
            >
              {question}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------ Rent now, pay later ----------------------------- */
function RentNowPayLaterBanner({ property }: { property: Property }) {
  const tProp = usePropT();
  const [showFinancing, setShowFinancing] = useState(false);
  const monthly = Math.round(property.price / 12);

  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div>
          <div className="text-sm font-semibold">{tProp("rentNowPayLater.title")}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {tProp("rentNowPayLater.subtitle", { amount: formatSAR(monthly) })}
          </p>
        </div>
        <Button onClick={() => setShowFinancing(true)}>{tProp("rentNowPayLater.cta")}</Button>
      </section>
      {showFinancing && (
        <FinancingModal property={property} onClose={() => setShowFinancing(false)} />
      )}
    </>
  );
}

/* --------------------------- Property Features ---------------------------- */
function PropertyFeatures({ property }: { property: Property }) {
  const tProp = usePropT();
  const items: { key: keyof Property["features"]; label: string }[] = [
    { key: "kitchen", label: tProp("features.kitchen") },
    { key: "water", label: tProp("features.water") },
    { key: "electricity", label: tProp("features.electricity") },
    { key: "privateRoof", label: tProp("features.privateRoof") },
    { key: "inVilla", label: tProp("features.inVilla") },
    { key: "twoEntrances", label: tProp("features.twoEntrances") },
    { key: "separateElectricalMeter", label: tProp("features.separateElectricalMeter") },
  ];
  const active = items.filter((i) => property.features[i.key]);
  if (active.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{tProp("features.title")}</h2>
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {active.map((i) => (
          <div key={i.key} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 shrink-0 text-success" /> {i.label}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ Description -------------------------------- */
const DESCRIPTION_PREVIEW_LENGTH = 320;

function DescriptionSection({ property }: { property: Property }) {
  const tProp = usePropT();
  const [expanded, setExpanded] = useState(false);
  const description = property.description ?? "";
  if (!description) return null;
  const isLong = description.length > DESCRIPTION_PREVIEW_LENGTH;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{tProp("description.title")}</h2>
      <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">
        {expanded || !isLong ? description : `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-semibold text-primary hover:underline"
        >
          {expanded ? tProp("readLess") : tProp("readMore")}
        </button>
      )}
    </section>
  );
}

/* ----------------------------- Rent Payments ------------------------------ */
function RentPayments({ property }: { property: Property }) {
  const tProp = usePropT();
  if (property.listingType === "sale") return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{tProp("rentPayments.title")}</h2>
      <div className="mt-4 flex items-center justify-between rounded-xl border border-border p-4">
        <span className="text-lg font-bold">SAR {formatSAR(property.price)}</span>
        <span className="text-sm text-muted-foreground">{tProp("rentPayments.yearly")}</span>
      </div>
    </section>
  );
}

/* ------------------------- Register lease contract ------------------------ */
function RegisterLeaseBanner({ property }: { property: Property }) {
  const tProp = usePropT();
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <FileText className="size-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">{tProp("registerLease.title")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{tProp("registerLease.desc")}</p>
          <Button size="sm" variant="outline" className="mt-3 w-full" asChild>
            <Link to="/lead/new" search={{ area: property.district, city: property.city }}>
              {tProp("registerLease.cta")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Listing details ------------------------------ */
function ListingDetailsPanel({ property }: { property: Property }) {
  const tProp = usePropT();
  const [tab, setTab] = useState<"main" | "additional">("main");

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{tProp("listingDetails.title")}</h2>
      <div className="mt-4 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("main")}
          className={cn(
            "border-b-2 px-1 pb-2 text-sm font-medium",
            tab === "main" ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
          )}
        >
          {tProp("listingDetails.mainTab")}
        </button>
        <button
          type="button"
          onClick={() => setTab("additional")}
          className={cn(
            "border-b-2 px-1 pb-2 text-sm font-medium",
            tab === "additional" ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
          )}
        >
          {tProp("listingDetails.additionalTab")}
        </button>
      </div>
      <div className="mt-4 space-y-2 text-sm">
        {tab === "main" ? (
          <>
            <Row icon={<Eye className="size-4" />} label={tProp("listingDetails.listingId")} value={`#${property.id}`} />
            <Row
              icon={<Calendar className="size-4" />}
              label={tProp("listingDetails.createdAt")}
              value={format(new Date(property.createdAt), "d MMM yyyy")}
            />
            <Row icon={<Eye className="size-4" />} label={tProp("listingDetails.views")} value={String(property.viewsCount)} />
            <Row
              icon={<Maximize className="size-4" />}
              label={tProp("listingDetails.deedArea")}
              value={property.deedArea != null ? `${property.deedArea} m²` : "—"}
            />
          </>
        ) : (
          <>
            <Row
              icon={<FileText className="size-4" />}
              label={tProp("listingDetails.licenseNumber")}
              value={property.licenseNumber ?? "—"}
            />
            <Row
              icon={<Calendar className="size-4" />}
              label={tProp("listingDetails.licenseExpiration")}
              value={
                property.licenseExpirationDate
                  ? format(new Date(property.licenseExpirationDate), "d MMM yyyy")
                  : "—"
              }
            />
            <Row
              icon={<Calendar className="size-4" />}
              label={tProp("listingDetails.lastUpdated")}
              value={format(new Date(property.updatedAt), "d MMM yyyy")}
            />
            <Row icon={<Building2 className="size-4" />} label={tProp("listingDetails.source")} value={tProp("listingDetails.sourceValue")} />
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
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
  // Deterministic composite — used for instant paint and as the offline
  // fallback if the AI rental-score call below fails or is unreachable.
  const fallbackScore = Math.round(
    0.25 * priceFairness + 0.25 * areaQuality + 0.2 * amenities + 0.15 * commute + 0.15 * family,
  );

  const [aiScore, setAiScore] = useState<{
    score: number;
    reasoning: string;
    generatedBy: "ai" | "fallback";
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRentalScore({
      listing_type: isSale ? "sale" : "rent",
      monthly_rent: isSale ? null : monthlyRent,
      sale_price: isSale ? property.price : null,
      bedrooms: property.bedrooms,
      area: property.district,
      city: property.city,
    })
      .then((res) => {
        if (!cancelled) {
          setAiScore({ score: res.score, reasoning: res.reasoning, generatedBy: res.generated_by });
        }
      })
      .catch(() => {
        // Network/API unreachable — the deterministic fallbackScore above stays displayed.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id]);

  const overall = aiScore?.score ?? fallbackScore;

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
            {aiScore && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {tProp(
                  aiScore.generatedBy === "ai"
                    ? "rentalIntelligence.aiGenerated"
                    : "rentalIntelligence.estimateGenerated",
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {aiScore?.generatedBy === "ai" && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-ai-soft/40 p-3 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-ai" />
          <span>{aiScore.reasoning}</span>
        </p>
      )}
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
function ComparableListings({ currentId }: { currentId: string }) {
  const tProp = usePropT();
  const [comps, setComps] = useState<Property[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchSimilarProperties(Number(currentId))
      .then((results) => {
        if (!cancelled) setComps(results.map(mapApiProperty));
      })
      .catch(() => !cancelled && setComps([]));
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  if (comps.length === 0) return null;

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
  initialMessage,
  onSaved,
  onClose,
}: {
  property: Property;
  savedRecordId: number | null;
  userId?: number;
  initialMessage?: string | null;
  onSaved: (newId: number) => void;
  onClose: () => void;
}) {
  const tProp = usePropT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    initialMessage || tProp("contactModal.inquiryDefault", { title: property.title }),
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

// ── Schedule Viewing (Prompt 7 — Visit & Viewing Management) ───────────────
// Business hours are fixed client-side (09:00-21:00 Riyadh time, 30-min
// slots) — there's no real mediator-availability data source yet (brief
// §4), which is exactly why every slot is labeled "Request a preferred
// time" rather than "Available Slot": submitting only creates a request the
// mediator still has to confirm or counter-propose.
const VIEWING_BUSINESS_HOURS_START = "09:00";
const VIEWING_BUSINESS_HOURS_END = "21:00";
const VIEWING_SLOT_MINUTES = 30;
const RIYADH_UTC_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh has no DST — fixed UTC+3

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Wall-clock time in Riyadh, independent of the visitor's actual device
// timezone — matches the brief's "Default timezone: Asia/Riyadh" instruction.
function riyadhNowMinutesOfDay(): { y: number; m: number; d: number; minutes: number } {
  const riyadh = new Date(Date.now() + RIYADH_UTC_OFFSET_MS);
  return {
    y: riyadh.getUTCFullYear(),
    m: riyadh.getUTCMonth(),
    d: riyadh.getUTCDate(),
    minutes: riyadh.getUTCHours() * 60 + riyadh.getUTCMinutes(),
  };
}

function buildViewingSlots(date: Date): string[] {
  const start = hhmmToMinutes(VIEWING_BUSINESS_HOURS_START);
  const end = hhmmToMinutes(VIEWING_BUSINESS_HOURS_END);
  const slots: string[] = [];
  for (let t = start; t + VIEWING_SLOT_MINUTES <= end; t += VIEWING_SLOT_MINUTES) {
    slots.push(minutesToHHMM(t));
  }
  const now = riyadhNowMinutesOfDay();
  const isToday = date.getFullYear() === now.y && date.getMonth() === now.m && date.getDate() === now.d;
  if (!isToday) return slots;
  return slots.filter((slot) => hhmmToMinutes(slot) > now.minutes);
}

// Combines the calendar's selected date (only its Y/M/D matters — the
// calendar's own time-of-day component is ignored) with a business-hours
// HH:MM into an ISO datetime carrying Riyadh's fixed +03:00 offset.
function toRiyadhISOString(date: Date, hhmm: string): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}T${hhmm}:00+03:00`;
}

type ViewingModalStep = "date" | "time" | "note" | "review";
const VIEWING_MODAL_STEPS: ViewingModalStep[] = ["date", "time", "note", "review"];

function ScheduleViewingModal({
  property,
  onClose,
  onSuccess,
}: {
  property: Property;
  onClose: () => void;
  onSuccess: (viewing: ApiPropertyViewing) => void;
}) {
  const tProp = usePropT();
  const [stepIndex, setStepIndex] = useState(0);
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = VIEWING_MODAL_STEPS[stepIndex];
  const today = startOfDay(new Date());
  const slots = useMemo(() => (date ? buildViewingSlots(date) : []), [date]);

  async function handleSubmit() {
    if (!date || !time) return;
    setSubmitting(true);
    setError(null);
    try {
      const requested_start_at = toRiyadhISOString(date, time);
      const requested_end_at = toRiyadhISOString(date, minutesToHHMM(hhmmToMinutes(time) + VIEWING_SLOT_MINUTES));
      const viewing = await createViewing({
        property_id: Number(property.id),
        requested_start_at,
        requested_end_at,
        timezone: "Asia/Riyadh",
        customer_note: note.trim() || undefined,
      });
      onSuccess(viewing);
    } catch (err) {
      setError(err instanceof Error ? err.message : tProp("viewing.modal.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (stepIndex < VIEWING_MODAL_STEPS.length - 1) setStepIndex(stepIndex + 1);
  }
  function goBack() {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  const stepTitle =
    step === "date"
      ? tProp("viewing.modal.stepDate")
      : step === "time"
        ? tProp("viewing.modal.stepTime")
        : step === "note"
          ? tProp("viewing.modal.stepNote")
          : tProp("viewing.modal.stepReview");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{tProp("viewing.modal.title")}</h2>
            <p className="text-xs text-muted-foreground">{stepTitle}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {step === "date" && (
          <div className="flex justify-center">
            <DateRangeCalendar
              mode="single"
              selected={date}
              onSelect={(d) => {
                setDate(d);
                setTime(null);
              }}
              disabled={{ before: today }}
            />
          </div>
        )}

        {step === "time" && (
          <div>
            <p className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-ai" /> {tProp("viewing.modal.preferredTimeHint")}
            </p>
            {slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tProp("viewing.modal.noSlotsToday")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setTime(slot)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-sm font-medium transition-colors",
                      time === slot
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "note" && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder={tProp("viewing.modal.notePlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
          />
        )}

        {step === "review" && date && time && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3 rounded-xl bg-surface p-3">
              {property.image && (
                <img src={property.image} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0">
                <div className="truncate font-semibold">{property.title}</div>
                <div className="truncate text-xs text-muted-foreground">{property.district}, {property.city}</div>
              </div>
            </div>
            <Row icon={<Building2 className="size-4" />} label={tProp("viewing.modal.reviewMediator")} value={property.agent} />
            <Row
              icon={<Calendar className="size-4" />}
              label={tProp("viewing.modal.reviewDateTime")}
              value={`${format(date, "MMM d, yyyy")}, ${time} (${tProp("viewing.modal.timezone")})`}
            />
            <div>
              <div className="mb-1 inline-flex items-center gap-2 text-muted-foreground">
                <MessageCircle className="size-4" /> {tProp("viewing.modal.reviewNote")}
              </div>
              <p className="text-sm">{note.trim() || tProp("viewing.modal.noNote")}</p>
            </div>
            <p className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              {tProp("viewing.modal.preferredTimeLabel")} — {tProp("viewing.modal.preferredTimeHint")}
            </p>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2.5">
          {stepIndex > 0 && (
            <Button variant="outline" className="flex-1" onClick={goBack} disabled={submitting}>
              {tProp("viewing.modal.back")}
            </Button>
          )}
          {step !== "review" ? (
            <Button
              variant="hero"
              className="flex-1"
              onClick={goNext}
              disabled={(step === "date" && !date) || (step === "time" && !time)}
            >
              {tProp("viewing.modal.next")}
            </Button>
          ) : (
            <Button variant="hero" className="flex-1" onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? tProp("viewing.modal.submitting") : tProp("viewing.modal.submit")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Make an Offer (Prompt 7 — AI Negotiation & Offer Management) ───────────
// Modal stepper mirroring ScheduleViewingModal's structure exactly: Offer
// Intelligence (reuses NegotiationInsightCard's already-fetched
// `intelligence.negotiation_intelligence` — no second fetch) -> Enter Amount
// -> optional Message (Draft with AI, reusing the same
// POST /properties/{id}/ai-summary?variant=negotiation_message call
// NegotiationInsightCard already makes) -> Review -> Submit. On success shows
// an inline confirmation state (mirrors ContactModal's own `sent` state)
// linking into /negotiations/$id (Prompt 8's screen, not yet a route file —
// see the plain <a> note on the "View Negotiation" button above).
type OfferModalStep = "intelligence" | "amount" | "message" | "review";
const OFFER_MODAL_STEPS: OfferModalStep[] = ["intelligence", "amount", "message", "review"];

function MakeOfferModal({
  property,
  intelligence,
  initialViewingId,
  onClose,
  onSuccess,
}: {
  property: Property;
  intelligence: ApiPropertyIntelligence | null;
  initialViewingId?: number;
  onClose: () => void;
  onSuccess: (negotiation: ApiPropertyNegotiation) => void;
}) {
  const tProp = usePropT();
  const { t, lang } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<ApiPropertyNegotiation | null>(null);

  const step = OFFER_MODAL_STEPS[stepIndex];
  const negotiationInsight = intelligence?.negotiation_intelligence ?? null;
  // Brief §4: when Price Intelligence doesn't have sufficient_data, show the
  // "make an offer based on your own preference" copy instead of a range —
  // never fabricate a market range from insufficient data.
  const hasSufficientData = intelligence?.price_intelligence?.sufficient_data ?? false;
  // Fallback (negotiation_intelligence unavailable/insufficient data): the
  // backend's original_listing_amount snapshot is Property.monthly_rent for
  // rent listings, NOT the annualized figure property.price displays as
  // "Annual rent" — same /12 conversion ActionsCard already uses for its
  // "~SAR X/month" hint, so the amount hint here stays unit-consistent with
  // what create_negotiation() actually compares the offer against.
  const listingPrice =
    negotiationInsight?.asking_price ??
    (property.listingType === "rent" ? Math.round(property.price / 12) : property.price);
  const amountNumber = Number(amount);
  // Review step's offer-vs-listing comparison (brief §23/§27 money
  // typography) — mirrors negotiations.$id.tsx's offerBlock delta line
  // exactly, same reused i18n keys, so the visual language carries straight
  // from Review into the Negotiation Detail screen the customer lands on
  // right after submitting.
  const reviewDiff = amountNumber - listingPrice;
  const reviewDiffPct = listingPrice ? (Math.abs(reviewDiff) / listingPrice) * 100 : 0;
  const reviewIsBelow = reviewDiff < 0;

  async function handleDraft() {
    setDrafting(true);
    try {
      const resp = await fetchPropertyAiSummary(Number(property.id), lang === "ar" ? "ar" : "en", "negotiation_message");
      setMessage(resp.summary);
    } catch {
      // Draft with AI is best-effort — leave the field as-is on failure,
      // never blocks the customer from typing/submitting their own message.
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmit() {
    if (!amountNumber || amountNumber <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createNegotiation(Number(property.id), {
        amount: amountNumber,
        message: message.trim() || undefined,
        viewing_id: initialViewingId,
      });
      setSubmitted(created);
      onSuccess(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : tProp("negotiation.modal.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (stepIndex < OFFER_MODAL_STEPS.length - 1) setStepIndex(stepIndex + 1);
  }
  function goBack() {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }

  const stepTitle =
    step === "intelligence"
      ? tProp("negotiation.modal.stepIntelligence")
      : step === "amount"
        ? tProp("negotiation.modal.stepAmount")
        : step === "message"
          ? tProp("negotiation.modal.stepMessage")
          : tProp("negotiation.modal.stepReview");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          <div className="py-2 text-center space-y-4">
            <div className="grid size-14 place-items-center rounded-full bg-success/15 mx-auto">
              <CheckCircle2 className="size-8 text-success" />
            </div>
            <h2 className="text-lg font-bold">{tProp("negotiation.modal.submittedTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {tProp("negotiation.modal.submittedDesc", {
                amount: formatSAR(Math.round(Number(submitted.current_offer_amount))),
              })}
            </p>
            {/* Typed Link — /negotiations/$id has existed since Prompt 8;
                this was left as a plain <a> at Prompt 7 time before that
                route file existed, closed in the Prompt 12 polish pass. */}
            <Button className="w-full" asChild>
              <Link to="/negotiations/$id" params={{ id: String(submitted.id) }}>
                {tProp("negotiation.modal.viewNegotiation")}
              </Link>
            </Button>
            <Button variant="outline" className="w-full" onClick={onClose}>
              {tProp("negotiation.modal.done")}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{tProp("negotiation.modal.title")}</h2>
                <p className="text-xs text-muted-foreground">{stepTitle}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>

            {step === "intelligence" && (
              <div className="space-y-4 text-sm">
                <MiniStat label={tProp("negotiation.modal.listingPrice")} value={`SAR ${formatSAR(Math.round(listingPrice))}`} />
                {negotiationInsight && hasSufficientData ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <MiniStat
                        label={tProp("intelligence.negotiation.marketMidpoint")}
                        value={`SAR ${formatSAR(Math.round(negotiationInsight.market_midpoint))}`}
                      />
                      <MiniStat
                        label={tProp("intelligence.negotiation.discussionRange")}
                        value={`SAR ${formatSAR(Math.round(negotiationInsight.discussion_range_low))} – ${formatSAR(Math.round(negotiationInsight.discussion_range_high))}`}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{negotiationInsight.approach}</p>
                  </>
                ) : (
                  <p className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                    {tProp("negotiation.modal.limitedData")}
                  </p>
                )}
              </div>
            )}

            {step === "amount" && (
              <div>
                <label className="mb-1 block text-sm font-medium">{tProp("negotiation.modal.amountLabel")}</label>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={String(Math.round(listingPrice))}
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {tProp("negotiation.modal.amountHint", { amount: formatSAR(Math.round(listingPrice)) })}
                </p>
              </div>
            )}

            {step === "message" && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium">{tProp("negotiation.modal.messageLabel")}</label>
                  <Button variant="ghost" size="sm" onClick={() => void handleDraft()} disabled={drafting}>
                    <Sparkles className="size-3.5" />
                    {drafting ? tProp("intelligence.negotiation.drafting") : tProp("negotiation.modal.draftWithAI")}
                  </Button>
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder={tProp("negotiation.modal.messagePlaceholder")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
                />
                <p className="mt-1 text-xs text-muted-foreground">{tProp("negotiation.modal.messageOptionalHint")}</p>
              </div>
            )}

            {step === "review" && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 rounded-xl bg-surface p-3">
                  {property.image && (
                    <img src={property.image} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{property.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {property.district}, {property.city}
                    </div>
                  </div>
                </div>
                {/* Offer vs. listing comparison — large money typography +
                    a below/above-listing delta line, not just two plain
                    rows (brief §23/§27 "one obvious next action" / money
                    typography — Prompt 12 polish pass). */}
                <div className="rounded-xl border border-border bg-surface p-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Wallet className="size-3.5" /> {tProp("negotiation.modal.reviewOffer")}
                      </div>
                      <div className="font-display text-xl font-bold tracking-tight">SAR {formatSAR(amountNumber || 0)}</div>
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="size-3.5" /> {tProp("negotiation.modal.reviewListingPrice")}
                      </div>
                      <div className="font-display text-xl font-bold tracking-tight text-muted-foreground">
                        SAR {formatSAR(Math.round(listingPrice))}
                      </div>
                    </div>
                  </div>
                  {listingPrice > 0 && amountNumber > 0 && (
                    <div
                      className={`mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium ${reviewIsBelow ? "text-success" : "text-warning"}`}
                    >
                      {reviewIsBelow ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}
                      {t(reviewIsBelow ? "negotiationDetail.offerBlock.belowListing" : "negotiationDetail.offerBlock.aboveListing", {
                        amount: formatSAR(Math.round(Math.abs(reviewDiff))),
                        percent: reviewDiffPct.toFixed(1),
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-1 inline-flex items-center gap-2 text-muted-foreground">
                    <MessageCircle className="size-4" /> {tProp("negotiation.modal.reviewMessage")}
                  </div>
                  <p className="text-sm">{message.trim() || tProp("negotiation.modal.noMessage")}</p>
                </div>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="mt-5 flex gap-2.5">
              {stepIndex > 0 && (
                <Button variant="outline" className="flex-1" onClick={goBack} disabled={submitting}>
                  {tProp("negotiation.modal.back")}
                </Button>
              )}
              {step !== "review" ? (
                <Button
                  variant="hero"
                  className="flex-1"
                  onClick={goNext}
                  disabled={step === "amount" && (!amountNumber || amountNumber <= 0)}
                >
                  {tProp("negotiation.modal.next")}
                </Button>
              ) : (
                <Button variant="hero" className="flex-1" onClick={() => void handleSubmit()} disabled={submitting}>
                  {submitting ? tProp("negotiation.modal.submitting") : tProp("negotiation.modal.submit")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatViewingDateTime(iso: string): string {
  return format(new Date(iso), "EEE, MMM d, h:mm a");
}

function ViewingStatusBanner({ viewing, onMessageMediator }: { viewing: ApiPropertyViewing; onMessageMediator: () => void }) {
  const tProp = usePropT();

  let title: string;
  let subtitle: string;
  if (viewing.status === "confirmed" && viewing.confirmed_start_at) {
    title = tProp("viewing.banner.confirmedTitle");
    subtitle = tProp("viewing.banner.confirmedSubtitle", { datetime: formatViewingDateTime(viewing.confirmed_start_at) });
  } else if (viewing.status === "reschedule_proposed") {
    title = tProp("viewing.banner.reschedulePendingTitle");
    subtitle = tProp("viewing.banner.reschedulePendingSubtitle");
  } else {
    title = tProp("viewing.banner.requestedTitle");
    subtitle = tProp("viewing.banner.requestedSubtitle");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Calendar className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/viewings/$id" params={{ id: String(viewing.id) }}>
            {tProp("viewing.banner.viewAppointment")}
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={onMessageMediator}>
          <MessageCircle className="size-4" /> {tProp("viewing.banner.messageMediator")}
        </Button>
        {/* TODO(Prompt 9): once the AI Viewing Checklist section exists on
            the viewing detail screen, deep-link straight to it instead of
            the screen's top. */}
        <Button variant="outline" size="sm" asChild>
          <Link to="/viewings/$id" params={{ id: String(viewing.id) }}>
            {tProp("viewing.banner.prepareForVisit")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ── Rent Financing Interest (stub — no real payment integration) ───────────

function FinancingModal({ property, onClose }: { property: Property; onClose: () => void }) {
  const tProp = usePropT();
  const { user } = useAuth();
  const [budget, setBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiFinancingInterest | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const statedBudget = Number(budget);
    if (!statedBudget || statedBudget <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const record = await submitFinancingInterest({
        property_id: Number(property.id),
        stated_budget: statedBudget,
      });
      setResult(record);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : tProp("financing.submitFailed"));
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
        {result ? (
          <div className="py-2 text-center space-y-4">
            <div className="grid size-14 place-items-center rounded-full bg-success/15 mx-auto">
              <CheckCircle2 className="size-8 text-success" />
            </div>
            <h2 className="text-lg font-bold">{tProp("financing.submittedTitle")}</h2>
            <p className="text-sm text-muted-foreground">{tProp("financing.submittedDesc")}</p>
            {result.ai_note && (
              <div className="rounded-xl border border-ai/20 bg-ai/8 p-4 text-left">
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-ai">
                  <Sparkles className="size-3.5" /> {tProp("financing.aiNoteTitle")}
                </p>
                <p className="text-sm text-foreground">{result.ai_note}</p>
              </div>
            )}
            <Button className="w-full" onClick={onClose}>
              {tProp("financing.done")}
            </Button>
          </div>
        ) : !user ? (
          <div className="py-4 text-center space-y-4">
            <h2 className="text-lg font-bold">{tProp("financing.signInTitle")}</h2>
            <p className="text-sm text-muted-foreground">{tProp("financing.signInDesc")}</p>
            <Button className="w-full" asChild>
              <Link to="/auth">{tProp("financing.signIn")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{tProp("financing.title")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{tProp("financing.subtitle")}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{tProp("financing.budgetLabel")}</label>
                <input
                  type="number"
                  min={1}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="8000"
                  required
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {tProp("financing.rentContext", { amount: formatSAR(Math.round(property.price / 12)) })}
                </p>
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
                disabled={!budget || Number(budget) <= 0 || submitting}
              >
                <Landmark className="size-4" />{" "}
                {submitting ? tProp("financing.submitting") : tProp("financing.submit")}
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

// AI Negotiation & Offer Management (Prompt 7) — same sessionStorage handoff
// idiom as storeAdvisorCtx above: viewings.$id.tsx's "Ask AI about
// negotiation" action writes the viewing id right before navigating to
// Property Detail; this reads it once and clears it so it never leaks into
// an unrelated later visit, then pre-fills + auto-opens the Make an Offer
// modal instead of deep-linking into /advisor.
function storeOfferHandoff(viewingId: number) {
  try {
    sessionStorage.setItem("maskan_offer_viewing_id", String(viewingId));
  } catch {
    // sessionStorage unavailable (private browsing edge case)
  }
}

function consumeOfferHandoff(): number | undefined {
  try {
    const raw = sessionStorage.getItem("maskan_offer_viewing_id");
    if (!raw) return undefined;
    sessionStorage.removeItem("maskan_offer_viewing_id");
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

// Prompt 9: personalized_fit only appears in the intelligence response when
// real criteria are supplied. Before this, no context survived navigation
// from AI Home Finder results to a property page at all — this is the
// minimal extension (same sessionStorage handoff idiom as
// `maskan_advisor_ctx` above: written once by home-finder.tsx's MatchCard
// right before navigating away, read once here and immediately cleared so
// it never leaks into an unrelated later visit).
function consumeHomeFinderCriteria(): PropertyIntelligenceCriteria | undefined {
  try {
    const raw = sessionStorage.getItem("maskan_home_finder_criteria");
    if (!raw) return undefined;
    sessionStorage.removeItem("maskan_home_finder_criteria");
    const c = JSON.parse(raw) as {
      max_price?: number | null;
      min_price?: number | null;
      bedrooms?: number | null;
      districts?: string[];
      required_amenities?: string[];
    };
    return {
      maxPrice: c.max_price ?? undefined,
      minPrice: c.min_price ?? undefined,
      bedrooms: c.bedrooms ?? undefined,
      districts: c.districts?.length ? c.districts : undefined,
      requiredAmenities: c.required_amenities?.length ? c.required_amenities : undefined,
    };
  } catch {
    return undefined;
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

      {/* Financing estimate + the affordability check below it (both derive
          from a mortgage monthlyPayment) are Hide-Phase1 — mortgage/financing
          is out of scope for myMakan Phase-1. Kept as existing code, not
          removed, per "do not invent new financing/mortgage UI" — this only
          hides what's already there. */}
      {PHASE1_FLAGS.financing && (
        <>
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
        </>
      )}
    </div>
  );
}

// ── Short-Term Stay Booking ─────────────────────────────────────────────────
// No per-listing nightly rate exists in the data model yet (myMakan only
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

function ActionsCard({
  property,
  savedRecordId,
  setSavedRecordId,
  showContact,
  setShowContact,
  contactPrefillMessage,
  onToggleSave,
  activeViewing,
  onScheduleViewing,
  isPublished,
  activeNegotiation,
  onMakeOffer,
}: {
  property: Property;
  savedRecordId: number | null;
  setSavedRecordId: (id: number | null) => void;
  showContact: boolean;
  setShowContact: (show: boolean) => void;
  contactPrefillMessage?: string | null;
  onToggleSave: () => void;
  activeViewing?: ApiPropertyViewing | null;
  onScheduleViewing?: () => void;
  isPublished?: boolean;
  activeNegotiation?: ApiPropertyNegotiation | null;
  onMakeOffer?: () => void;
}) {
  const { t } = useLanguage();
  const tProp = usePropT();
  const { user } = useAuth();
  const [showFinancing, setShowFinancing] = useState(false);

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
          {onScheduleViewing &&
            (activeViewing ? (
              <Button variant="outline" size="lg" className="w-full" asChild>
                <Link to="/viewings/$id" params={{ id: String(activeViewing.id) }}>
                  <Calendar className="size-4" /> {tProp("viewing.banner.viewAppointment")}
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="lg" className="w-full" onClick={onScheduleViewing}>
                <Calendar className="size-4" /> {tProp("actions.scheduleViewing")}
              </Button>
            ))}
          {/* Make an Offer / View Negotiation (Prompt 7) — hidden entirely
              for inactive/unavailable properties (brief §3). The "View
              Negotiation" link uses a plain <a> rather than the typed
              TanStack <Link>, because /negotiations/$id doesn't exist as a
              route file yet — Prompt 8 builds it next; switching this to
              <Link to="/negotiations/$id"> then is a trivial follow-up. */}
          {isPublished &&
            (activeNegotiation ? (
              <Button variant="outline" size="lg" className="w-full" asChild>
                <a href={`/negotiations/${activeNegotiation.id}`}>
                  <Handshake className="size-4" /> {tProp("actions.viewNegotiation")}
                </a>
              </Button>
            ) : (
              onMakeOffer && (
                <Button variant="outline" size="lg" className="w-full" onClick={onMakeOffer}>
                  <Handshake className="size-4" /> {tProp("actions.makeOffer")}
                </Button>
              )
            ))}
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
            <Button variant="outline" onClick={onToggleSave} aria-pressed={saved}>
              <Heart className={"size-4 " + (saved ? "fill-destructive text-destructive" : "")} />
              {saved ? tProp("actions.saved") : tProp("actions.save")}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/compare">
                <GitCompare className="size-4" /> {tProp("actions.compare")}
              </Link>
            </Button>
          </div>
          {!isSale && PHASE1_FLAGS.financing && (
            <Button variant="outline" className="w-full" onClick={() => setShowFinancing(true)}>
              <Landmark className="size-4" /> {tProp("actions.requestFinancing")}
            </Button>
          )}
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
          initialMessage={contactPrefillMessage}
          onSaved={(newId) => setSavedRecordId(newId)}
          onClose={() => setShowContact(false)}
        />
      )}

      {showFinancing && (
        <FinancingModal property={property} onClose={() => setShowFinancing(false)} />
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
  agentWhatsapp,
  agentProfileImage,
  mediatorId,
  mediatorRating,
  mediatorReviewCount,
}: {
  agentName: string;
  agentPhone: string | null;
  agentWhatsapp: string | null;
  agentProfileImage: string | null;
  mediatorId: number | null;
  mediatorRating: number | null;
  mediatorReviewCount: number;
}) {
  const { t } = useLanguage();
  const tProp = usePropT();
  const [showCall, setShowCall] = useState(false);
  const hasPhone = !!agentPhone;
  const whatsappNumber = agentWhatsapp ?? agentPhone;

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
            {mediatorRating != null ? (
              <Link
                to="/agent/$id"
                params={{ id: String(mediatorId) }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <Star className="size-3.5 fill-warning text-warning" /> {mediatorRating.toFixed(2)}{" "}
                <span className="underline">{tProp("landlord.reviews", { count: mediatorReviewCount })}</span>
              </Link>
            ) : (
              <div className="text-xs text-muted-foreground">{tProp("landlord.verifiedAgent")}</div>
            )}
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
            href={hasPhone ? whatsappLink(whatsappNumber!) : undefined}
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
          agentWhatsapp={whatsappNumber!}
          onClose={() => setShowCall(false)}
        />
      )}
    </>
  );
}

function PhoneModal({
  agentName,
  agentPhone,
  agentWhatsapp,
  onClose,
}: {
  agentName: string;
  agentPhone: string;
  agentWhatsapp: string;
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
          href={whatsappLink(agentWhatsapp)}
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
