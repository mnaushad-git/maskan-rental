import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Linking, TextInput, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack, Link } from "expo-router";
import {
  BedDouble,
  Bath,
  Sofa,
  Maximize,
  Calendar,
  MapPin,
  Phone,
  MessageCircle,
  Heart,
  Share2,
  FileText,
  ChevronRight,
  CheckCircle2,
  Star,
  Eye,
  Landmark,
  Clock,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
  CalendarClock,
  Handshake,
} from "lucide-react-native";
import {
  fetchProperty,
  mapApiProperty,
  saveProperty,
  deleteSavedProperty,
  submitFinancingInterest,
  fetchPropertyIntelligence,
  fetchPropertyAiSummary,
  fetchMyViewings,
  fetchActiveNegotiation,
  VIEWING_INACTIVE_STATUSES,
  type ApiPropertyIntelligence,
  type ApiPropertyViewing,
  type ApiPropertyNegotiation,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import type { Property } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Accordion } from "@/components/ui/Accordion";
import { PropertyImageGallery } from "@/components/PropertyImageGallery";
import { PropertyAreaInsights } from "@/components/PropertyAreaInsights";
import { PropertySimilarListings } from "@/components/PropertySimilarListings";
import { PropertyLocationMap } from "@/components/PropertyLocationMap";
import { BookingCalendar } from "@/components/BookingCalendar";
import { PropertyCard } from "@/components/PropertyCard";
import { PropertyTrustSection } from "@/components/PropertyTrustBadge";
import { ScoreRing, ScoreBar } from "@/components/ScoreIndicator";
import { Badge } from "@/components/Badges";
import { whatsappLink } from "@/lib/whatsapp";
import { colors } from "@/lib/colors";
import type { ApiFinancingInterest } from "@/lib/api/maskan";

const DESCRIPTION_PREVIEW_LENGTH = 220;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const showToast = useToast();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [showFinancing, setShowFinancing] = useState(false);
  const [showDecisionSheet, setShowDecisionSheet] = useState(false);
  const saved = savedId !== null;

  // Property Intelligence — its own loading/error state, fetched only once
  // the core property is loaded, so a slow/failing call never blocks the
  // rest of the screen (mirrors the web app's property.$id.tsx).
  const [intelligence, setIntelligence] = useState<ApiPropertyIntelligence | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(true);
  const [intelligenceError, setIntelligenceError] = useState(false);

  // Visit & Viewing Management (Prompt 11) — the logged-in customer's own
  // active (non-cancelled/completed) viewing for this exact property, if
  // any. Mirrors the web app's property.$id.tsx.
  const [myActiveViewing, setMyActiveViewing] = useState<ApiPropertyViewing | null>(null);

  // AI Negotiation & Offer Management (Prompt 11) — "Make an Offer" vs "View
  // Negotiation" entry point. `isPublished` tracks the RAW backend status
  // ("Published") rather than the mapped UI Property.status, captured off
  // the ApiProperty response in load() below — mirrors the web app's
  // property.$id.tsx `isPublished` state exactly (brief §3's "do not show
  // for inactive/unavailable properties").
  const [isPublished, setIsPublished] = useState(true);
  const [activeNegotiation, setActiveNegotiation] = useState<ApiPropertyNegotiation | null>(null);

  const load = useCallback(() => {
    if (!id || Number.isNaN(Number(id))) {
      setError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    setSavedId(null);
    fetchProperty(Number(id))
      .then((raw) => {
        setProperty(mapApiProperty(raw));
        setIsPublished(raw.status === "Published");
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!property) return;
    let cancelled = false;
    setIntelligenceLoading(true);
    setIntelligenceError(false);
    fetchPropertyIntelligence(Number(property.id))
      .then((data) => {
        if (!cancelled) setIntelligence(data);
      })
      .catch(() => {
        if (!cancelled) {
          setIntelligence(null);
          setIntelligenceError(true);
        }
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
    let cancelled = false;
    fetchMyViewings()
      .then((list) => {
        if (cancelled) return;
        const active = list.find(
          (v) => String(v.property_id) === String(property.id) && !(VIEWING_INACTIVE_STATUSES as readonly string[]).includes(v.status),
        );
        setMyActiveViewing(active ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, property?.id]);

  // The caller's own active (non-terminal) negotiation for this property, if
  // any — drives the "Make an Offer" vs "View Negotiation" CTA below. A 404
  // (no active negotiation) is the expected/common case, not an error — same
  // soft-fail idiom the viewing effect above uses.
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

  async function handleToggleSave() {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    if (!property || saving) return;
    setSaving(true);
    if (saved) {
      const prevId = savedId;
      setSavedId(null);
      try {
        await deleteSavedProperty(prevId!);
      } catch {
        setSavedId(prevId);
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const result = await saveProperty(user.id, Number(property.id));
      setSavedId(result.id);
      showToast(t("property.actions.savedToFavorites"));
    } catch {
      // ignore duplicate-save errors
    } finally {
      setSaving(false);
    }
  }

  async function handleShare() {
    if (!property) return;
    try {
      await Share.share({ message: `${property.title} — SAR ${formatSAR(property.price)}` });
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Skeleton height={260} radius={20} />
        <Skeleton width="60%" height={24} />
        <Skeleton width="40%" height={16} />
        <View className="flex-row gap-2">
          <Skeleton width={70} height={28} radius={14} />
          <Skeleton width={70} height={28} radius={14} />
          <Skeleton width={70} height={28} radius={14} />
        </View>
        <Skeleton height={100} radius={16} />
      </SafeAreaView>
    );
  }

  if (error || !property) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background p-6">
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  const isSale = property.listingType === "sale";
  const waLink = property.agentWhatsapp
    ? whatsappLink(property.agentWhatsapp)
    : property.agentPhone
      ? whatsappLink(property.agentPhone)
      : undefined;
  const fullDescription = property.description ?? "";

  const handleContactAgent = () => {
    if (waLink) {
      Linking.openURL(waLink);
    } else if (property.agentPhone) {
      Linking.openURL(`tel:${property.agentPhone}`);
    } else {
      router.push("/lead/new");
    }
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: property.title }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        <View className="relative">
          <PropertyImageGallery images={property.images} />
          <View className="absolute end-4 top-4 flex-row gap-2">
            <IconButton onPress={handleShare} accessibilityLabel={t("property.actions.share")} className="border border-border bg-background/95">
              <Share2 size={18} color={colors.foreground} />
            </IconButton>
            <IconButton
              onPress={handleToggleSave}
              accessibilityLabel={t(saved ? "property.actions.saved" : "property.actions.save")}
              accessibilityState={{ selected: saved }}
              className="border border-border bg-background/95"
            >
              <Heart size={18} color={saved ? colors.destructive : colors.foreground} fill={saved ? colors.destructive : "none"} />
            </IconButton>
          </View>
        </View>

        <View className="gap-5 p-5">
          <View>
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 font-bold text-xl text-foreground">{property.title}</Text>
              <ScoreRing score={property.matchScore} size={44} />
            </View>
            <View className="mt-1 flex-row items-center gap-1">
              <MapPin size={14} color={colors.mutedForeground} />
              <Text className="text-sm text-muted-foreground">
                {property.district}, {property.city}
              </Text>
            </View>
          </View>

          {myActiveViewing ? (
            <ViewingStatusBanner viewing={myActiveViewing} onContactAgent={handleContactAgent} />
          ) : (
            user && (
              <Pressable
                onPress={() => router.push({ pathname: "/viewing/new", params: { propertyId: property.id } })}
                className="flex-row items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3.5"
              >
                <CalendarClock size={18} color={colors.primary} />
                <Text className="text-sm font-semibold text-foreground">{t("property.intelligence.actions.scheduleViewing")}</Text>
              </Pressable>
            )
          )}

          {/* Make an Offer / View Negotiation (Prompt 11) — hidden entirely
              for inactive/unavailable properties and signed-out visitors,
              mirrors the web app's ActionsCard. */}
          {isPublished &&
            user &&
            (activeNegotiation ? (
              <Pressable
                onPress={() => router.push(`/negotiations/${activeNegotiation.id}`)}
                className="flex-row items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3.5"
              >
                <Handshake size={18} color={colors.primary} />
                <Text className="text-sm font-semibold text-foreground">{t("property.actions.viewNegotiation")}</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.push({ pathname: "/negotiation/new", params: { propertyId: property.id } })}
                className="flex-row items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3.5"
              >
                <Handshake size={18} color={colors.primary} />
                <Text className="text-sm font-semibold text-foreground">{t("property.actions.makeOffer")}</Text>
              </Pressable>
            ))}

          {property.commissionPercent != null && (
            <Text className="-mt-3 text-xs text-muted-foreground">
              {t("property.summary.plusCommission", { percent: property.commissionPercent })}
            </Text>
          )}

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
            onOpenWhy={() => setShowDecisionSheet(true)}
            onContactAgent={handleContactAgent}
          />
          <PersonalizedFitSection intelligence={intelligence} />
          <DecisionScoreCard intelligence={intelligence} />
          <PriceIntelligenceCard intelligence={intelligence} isSale={isSale} />
          <AtAGlanceCard intelligence={intelligence} />
          <SimilarPropertiesSection intelligence={intelligence} />

          {!isSale && (
            <Pressable
              onPress={() => setShowFinancing(true)}
              className="flex-row items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
            >
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground">{t("property.rentNowPayLater.title")}</Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  {t("property.rentNowPayLater.subtitle", { amount: formatSAR(Math.round(property.price / 12)) })}
                </Text>
              </View>
              <Landmark size={20} color={colors.primary} />
            </Pressable>
          )}

          {/* Property Information */}
          <View className="flex-row flex-wrap gap-x-6 gap-y-4 border-y border-border py-4">
            <View className="flex-row items-center gap-1.5">
              <BedDouble size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">{property.bedrooms} {t("property.summary.bedrooms")}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Bath size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">{property.bathrooms} {t("property.summary.bathrooms")}</Text>
            </View>
            {property.livingRooms != null && (
              <View className="flex-row items-center gap-1.5">
                <Sofa size={18} color={colors.foreground} />
                <Text className="text-sm text-foreground">{property.livingRooms} {t("property.summary.livingRooms")}</Text>
              </View>
            )}
            <View className="flex-row items-center gap-1.5">
              <Maximize size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">{property.area} m²</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Calendar size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">
                {t("property.summary.buildingAge")}:{" "}
                {!property.propertyAgeYears
                  ? t("property.summary.new")
                  : t("property.summary.years", { count: property.propertyAgeYears })}
              </Text>
            </View>
          </View>

          {/* Property Features */}
          <PropertyFeaturesList property={property} />

          {/* Description */}
          {!!fullDescription && (
            <View>
              <Text className="text-sm leading-5 text-foreground">
                {descExpanded || fullDescription.length <= DESCRIPTION_PREVIEW_LENGTH
                  ? fullDescription
                  : `${fullDescription.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`}
              </Text>
              {fullDescription.length > DESCRIPTION_PREVIEW_LENGTH && (
                <Pressable onPress={() => setDescExpanded((v) => !v)} className="mt-1">
                  <Text className="text-sm font-semibold text-primary">
                    {descExpanded ? t("property.readLess") : t("property.readMore")}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Listed by */}
          <Pressable
            onPress={() => property.mediatorId && router.push(`/agent/${property.mediatorId}`)}
            disabled={!property.mediatorId}
            className="flex-row items-center justify-between rounded-xl border border-border p-4"
          >
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground">{t("property.landlord.listedBy")}</Text>
              <Text className="mt-1 text-sm text-muted-foreground">{property.agent}</Text>
              {property.mediatorRating != null && (
                <View className="mt-1 flex-row items-center gap-1">
                  <Star size={13} color={colors.warning} fill={colors.warning} />
                  <Text className="text-xs text-muted-foreground">
                    {property.mediatorRating.toFixed(2)} · {t("property.landlord.reviews", { count: property.mediatorReviewCount })}
                  </Text>
                </View>
              )}
            </View>
            {property.mediatorId ? <ChevronRight size={18} color={colors.neutral400} /> : null}
          </Pressable>

          {property.isBookable && (
            <BookingCalendar
              propertyId={Number(property.id)}
              monthlyRent={Math.round(property.price / 12)}
              nightlyRate={property.nightlyRate}
            />
          )}

          {property.isBookable && <UnitRules property={property} />}

          <PropertyAreaInsights district={property.district} city={property.city} />

          <PropertyLocationMap
            latitude={property.latitude}
            longitude={property.longitude}
            district={property.district}
            city={property.city}
            title={property.title}
          />

          {!isSale && (
            <View className="flex-row items-center justify-between rounded-xl border border-border p-4">
              <Text className="text-sm font-semibold text-foreground">{t("property.rentPayments.title")}</Text>
              <View className="items-end">
                <Text className="text-base font-bold text-foreground">SAR {formatSAR(property.price)}</Text>
                <Text className="text-xs text-muted-foreground">{t("property.rentPayments.yearly")}</Text>
              </View>
            </View>
          )}

          {/* Register lease contract */}
          <View className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5 size-8 items-center justify-center rounded-lg bg-primary">
                <FileText size={16} color="#FFFFFF" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground">{t("property.registerLease.title")}</Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">{t("property.registerLease.desc")}</Text>
                <Link href="/lead/new" asChild>
                  <Button variant="outline" size="sm" className="mt-3">
                    {t("property.registerLease.cta")}
                  </Button>
                </Link>
              </View>
            </View>
          </View>

          {/* Listing details */}
          <View className="rounded-xl border border-border p-4">
            <Text className="mb-1 text-sm font-semibold text-foreground">{t("property.listingDetails.title")}</Text>
            <Accordion title={t("property.listingDetails.mainTab")} defaultOpen>
              <DetailRow icon={<Eye size={16} color={colors.mutedForeground} />} label={t("property.listingDetails.listingId")} value={`#${property.id}`} />
              <DetailRow
                icon={<Calendar size={16} color={colors.mutedForeground} />}
                label={t("property.listingDetails.createdAt")}
                value={formatDate(property.createdAt)}
              />
              <DetailRow icon={<Eye size={16} color={colors.mutedForeground} />} label={t("property.listingDetails.views")} value={String(property.viewsCount)} />
              <DetailRow
                icon={<Maximize size={16} color={colors.mutedForeground} />}
                label={t("property.listingDetails.deedArea")}
                value={property.deedArea != null ? `${property.deedArea} m²` : "—"}
              />
            </Accordion>
            <Accordion title={t("property.listingDetails.additionalTab")}>
              <DetailRow icon={<FileText size={16} color={colors.mutedForeground} />} label={t("property.listingDetails.licenseNumber")} value={property.licenseNumber ?? "—"} />
              <DetailRow
                icon={<Calendar size={16} color={colors.mutedForeground} />}
                label={t("property.listingDetails.licenseExpiration")}
                value={property.licenseExpirationDate ? formatDate(property.licenseExpirationDate) : "—"}
              />
              <DetailRow
                icon={<Calendar size={16} color={colors.mutedForeground} />}
                label={t("property.listingDetails.lastUpdated")}
                value={formatDate(property.updatedAt)}
              />
              <DetailRow icon={<FileText size={16} color={colors.mutedForeground} />} label={t("property.listingDetails.source")} value={t("property.listingDetails.sourceValue")} />
            </Accordion>
          </View>

          <PropertySimilarListings excludeId={property.id} />

          <SmartQuestionsSection property={property} intelligence={intelligence} />
          <NegotiationInsightCard property={property} intelligence={intelligence} waLink={waLink} />
          <AskMyMakanQuickQuestions property={property} isSale={isSale} />
        </View>
      </ScrollView>

      <DecisionSheet
        visible={showDecisionSheet}
        intelligence={intelligence}
        property={property}
        onClose={() => setShowDecisionSheet(false)}
      />

      {/* Sticky bottom action bar — price + primary contact CTA stay reachable
          without scrolling back up, mirroring the web app's mobile sticky bar. */}
      <SafeAreaView edges={["bottom"]} className="border-t border-border bg-background/95 px-4 pt-3">
        <View className="flex-row items-center gap-3 pb-3">
          <View className="min-w-0 flex-1">
            <Text className="text-[11px] text-muted-foreground">
              {isSale ? t("propertyCard.salePrice") : t("propertyCard.annualRent")}
            </Text>
            <Text numberOfLines={1} className="text-base font-bold text-foreground">
              SAR {formatSAR(property.price)}
              {!isSale && <Text className="text-xs font-normal text-muted-foreground"> {t("propertyCard.perYear")}</Text>}
            </Text>
          </View>
          {property.agentPhone ? (
            <>
              <Pressable
                onPress={() => waLink && Linking.openURL(waLink)}
                className="flex-row items-center gap-1.5 rounded-xl px-4 py-2.5"
                style={{ backgroundColor: colors.whatsapp }}
              >
                <MessageCircle size={16} color="#FFFFFF" />
                <Text className="text-sm font-semibold text-white">{t("propertyCard.whatsapp")}</Text>
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL(`tel:${property.agentPhone}`)}
                className="flex-row items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5"
              >
                <Phone size={16} color={colors.foreground} />
                <Text className="text-sm font-semibold text-foreground">{t("propertyCard.call")}</Text>
              </Pressable>
            </>
          ) : (
            <Button onPress={() => router.push("/lead/new")} icon={<FileText size={16} color="#FFFFFF" />}>
              {t("property.actions.submitLeadRequest")}
            </Button>
          )}
          <IconButton onPress={handleToggleSave} accessibilityLabel={t(saved ? "property.actions.saved" : "property.actions.save")} className="border border-border bg-card">
            <Heart size={16} color={saved ? colors.destructive : colors.foreground} fill={saved ? colors.destructive : "none"} />
          </IconButton>
          <Link
            href={{ pathname: "/advisor", params: { q: `Tell me more about ${property.title} — is it a good fit for what I'm looking for?` } }}
            asChild
          >
            <IconButton accessibilityLabel={t("property.intelligence.actions.askMyMakan")} style={{ backgroundColor: colors.ai }}>
              <Sparkles size={16} color="#FFFFFF" />
            </IconButton>
          </Link>
        </View>
      </SafeAreaView>

      <FinancingSheet
        visible={showFinancing}
        onClose={() => setShowFinancing(false)}
        property={property}
      />
    </View>
  );
}

function UnitRules({ property }: { property: Property }) {
  const { t } = useLanguage();
  return (
    <View className="rounded-xl border border-border p-4">
      <Text className="mb-1 text-sm font-semibold text-foreground">{t("property.unitRules.title")}</Text>
      {property.arrivalTime && (
        <DetailRow icon={<Clock size={16} color={colors.mutedForeground} />} label={t("property.unitRules.arrivalTime")} value={property.arrivalTime} />
      )}
      {property.departureTime && (
        <DetailRow icon={<Clock size={16} color={colors.mutedForeground} />} label={t("property.unitRules.departureTime")} value={property.departureTime} />
      )}
      {property.latestBookingTime && (
        <DetailRow icon={<Clock size={16} color={colors.mutedForeground} />} label={t("property.unitRules.latestBookingTime")} value={property.latestBookingTime} />
      )}
      <DetailRow
        icon={<ShieldCheck size={16} color={colors.mutedForeground} />}
        label={t("property.unitRules.insuranceAmount")}
        value={property.insuranceAmount > 0 ? `SAR ${formatSAR(property.insuranceAmount)}` : t("property.unitRules.noInsurance")}
      />
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-sm text-muted-foreground">{label}</Text>
      </View>
      <Text className="text-sm font-semibold text-foreground">{value}</Text>
    </View>
  );
}

function PropertyFeaturesList({ property }: { property: Property }) {
  const { t } = useLanguage();
  const items: { key: keyof Property["features"]; label: string }[] = [
    { key: "kitchen", label: t("property.features.kitchen") },
    { key: "water", label: t("property.features.water") },
    { key: "electricity", label: t("property.features.electricity") },
    { key: "privateRoof", label: t("property.features.privateRoof") },
    { key: "inVilla", label: t("property.features.inVilla") },
    { key: "twoEntrances", label: t("property.features.twoEntrances") },
    { key: "separateElectricalMeter", label: t("property.features.separateElectricalMeter") },
    { key: "elevator", label: t("property.features.elevator") },
    { key: "airconditioners", label: t("property.features.airconditioners") },
  ];
  const active = items.filter((i) => property.features[i.key]);
  if (active.length === 0) return null;

  return (
    <View>
      <Text className="mb-3 text-sm font-semibold text-foreground">{t("property.features.title")}</Text>
      <View className="flex-row flex-wrap gap-x-6 gap-y-2.5">
        {active.map((i) => (
          <View key={i.key} className="flex-row items-center gap-2" style={{ minWidth: "45%" }}>
            <CheckCircle2 size={16} color={colors.success} />
            <Text className="text-sm text-foreground">{i.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FinancingSheet({
  visible,
  onClose,
  property,
}: {
  visible: boolean;
  onClose: () => void;
  property: Property;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const [budget, setBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiFinancingInterest | null>(null);

  const close = () => {
    onClose();
    setTimeout(() => {
      setResult(null);
      setBudget("");
      setSubmitError(null);
    }, 300);
  };

  async function handleSubmit() {
    const statedBudget = Number(budget);
    if (!statedBudget || statedBudget <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const record = await submitFinancingInterest({ property_id: Number(property.id), stated_budget: statedBudget });
      setResult(record);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t("property.financing.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={close}>
      <View className="gap-4 p-5">
        {result ? (
          <View className="items-center gap-3 py-2">
            <View className="size-14 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 size={28} color={colors.success} />
            </View>
            <Text className="text-lg font-bold text-foreground">{t("property.financing.submittedTitle")}</Text>
            <Text className="text-center text-sm text-muted-foreground">{t("property.financing.submittedDesc")}</Text>
            {result.ai_note && (
              <View className="w-full rounded-xl border border-primary/20 bg-primary/5 p-3">
                <Text className="mb-1 text-xs font-semibold text-primary">{t("property.financing.aiNoteTitle")}</Text>
                <Text className="text-sm text-foreground">{result.ai_note}</Text>
              </View>
            )}
            <Button fullWidth onPress={close}>
              {t("property.financing.done")}
            </Button>
          </View>
        ) : !user ? (
          <View className="items-center gap-3 py-2">
            <Text className="text-lg font-bold text-foreground">{t("property.financing.signInTitle")}</Text>
            <Text className="text-center text-sm text-muted-foreground">{t("property.financing.signInDesc")}</Text>
            <Button
              fullWidth
              onPress={() => {
                close();
                router.push("/auth/login");
              }}
            >
              {t("property.financing.signIn")}
            </Button>
          </View>
        ) : (
          <>
            <Text className="text-lg font-bold text-foreground">{t("property.financing.title")}</Text>
            <Text className="text-xs text-muted-foreground">{t("property.financing.subtitle")}</Text>
            <View>
              <Text className="mb-1 text-sm font-medium text-foreground">{t("property.financing.budgetLabel")}</Text>
              <TextInput
                value={budget}
                onChangeText={setBudget}
                placeholder="8000"
                keyboardType="numeric"
                className="rounded-xl border border-border px-4 py-3 text-foreground"
              />
              <Text className="mt-1 text-xs text-muted-foreground">
                {t("property.financing.rentContext", { amount: formatSAR(Math.round(property.price / 12)) })}
              </Text>
            </View>
            {submitError && <Text className="text-sm text-destructive">{submitError}</Text>}
            <Button fullWidth loading={submitting} onPress={handleSubmit}>
              {submitting ? t("property.financing.submitting") : t("property.financing.submit")}
            </Button>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

/* ==========================================================================
   myMakan Property Intelligence (Prompt 11 — mirrors web's Prompts 7-10)
   ========================================================================== */

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

// Mobile's Badge has no "destructive" tone (see components/Badges.tsx), so
// the worst classification bucket maps to "warning" too — same visual
// weight the web app's `destructive` tone conveys, adapted to this kit.
function classificationTone(classification: string): "success" | "neutral" | "warning" {
  if (classification === "Excellent Value" || classification === "Good Value") return "success";
  if (classification === "Fair") return "neutral";
  return "warning";
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-sm font-semibold text-foreground">{value}</Text>
    </View>
  );
}

function formatViewingDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ViewingStatusBanner({ viewing, onContactAgent }: { viewing: ApiPropertyViewing; onContactAgent: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();

  let title: string;
  let subtitle: string;
  if (viewing.status === "confirmed" && viewing.confirmed_start_at) {
    title = t("property.viewing.banner.confirmedTitle");
    subtitle = t("property.viewing.banner.confirmedSubtitle", { datetime: formatViewingDateTime(viewing.confirmed_start_at) });
  } else if (viewing.status === "reschedule_proposed") {
    title = t("property.viewing.banner.reschedulePendingTitle");
    subtitle = t("property.viewing.banner.reschedulePendingSubtitle");
  } else {
    title = t("property.viewing.banner.requestedTitle");
    subtitle = t("property.viewing.banner.requestedSubtitle");
  }

  return (
    <View className="gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
      <View className="flex-row items-center gap-3">
        <View className="size-9 items-center justify-center rounded-lg" style={{ backgroundColor: colors.primary }}>
          <CalendarClock size={16} color="#FFFFFF" />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">{title}</Text>
          <Text className="text-xs text-muted-foreground">{subtitle}</Text>
        </View>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Pressable onPress={() => router.push(`/viewings/${viewing.id}`)} className="rounded-full border border-border px-3.5 py-2">
          <Text className="text-xs font-semibold text-foreground">{t("property.viewing.banner.viewAppointment")}</Text>
        </Pressable>
        <Pressable onPress={onContactAgent} className="flex-row items-center gap-1 rounded-full border border-border px-3.5 py-2">
          <MessageCircle size={12} color={colors.foreground} />
          <Text className="text-xs font-semibold text-foreground">{t("property.viewing.banner.messageMediator")}</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/viewings/${viewing.id}`)} className="rounded-full border border-border px-3.5 py-2">
          <Text className="text-xs font-semibold text-foreground">{t("property.viewing.banner.prepareForVisit")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function IntelligenceHero({
  property,
  intelligence,
  loading,
  error,
  onOpenWhy,
  onContactAgent,
}: {
  property: Property;
  intelligence: ApiPropertyIntelligence | null;
  loading: boolean;
  error: boolean;
  onOpenWhy: () => void;
  onContactAgent: () => void;
}) {
  const { t } = useLanguage();
  const isSale = property.listingType === "sale";
  const pi = intelligence?.price_intelligence;

  if (error) return null;

  return (
    <View className="gap-3 rounded-2xl p-4" style={{ backgroundColor: "rgba(124,58,237,0.06)", borderWidth: 1, borderColor: "rgba(124,58,237,0.2)" }}>
      <View className="flex-row items-center gap-1.5">
        <Sparkles size={14} color={colors.ai} />
        <Text className="text-xs font-bold uppercase tracking-wide" style={{ color: colors.ai }}>
          {t("property.intelligence.badge")}
        </Text>
      </View>

      {loading ? (
        <View className="gap-2">
          <Skeleton width="40%" height={20} />
          <Skeleton height={40} radius={12} />
        </View>
      ) : !intelligence ? (
        <Text className="text-sm text-muted-foreground">{t("property.intelligence.unavailable")}</Text>
      ) : (
        <>
          <View className="flex-row flex-wrap items-center gap-2">
            <ScoreRing score={intelligence.decision_score} size={44} />
            {intelligence.personalized_fit && (
              <Badge tone="ai">
                {t("property.intelligence.matchLabel", {
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
                {t(`property.intelligence.priceIntelligence.classification.${classificationKey(pi.classification)}`)}
              </Badge>
            )}
          </View>

          <View className="flex-row flex-wrap gap-5">
            <View>
              <Text className="text-xs text-muted-foreground">
                {isSale ? t("property.intelligence.askingPrice") : t("property.intelligence.askingRent")}
              </Text>
              <Text className="text-base font-bold text-foreground">
                SAR {formatSAR(pi?.asking_price ?? property.price)}
                {!isSale && <Text className="text-xs font-normal text-muted-foreground"> /mo</Text>}
              </Text>
            </View>
            {pi?.sufficient_data && pi.fair_range_low != null && pi.fair_range_high != null && (
              <View>
                <Text className="text-xs text-muted-foreground">{t("property.intelligence.priceIntelligence.fairRange")}</Text>
                <Text className="text-sm font-semibold text-foreground">
                  SAR {formatSAR(Math.round(pi.fair_range_low))} – {formatSAR(Math.round(pi.fair_range_high))}
                </Text>
              </View>
            )}
          </View>

          {intelligence.personalized_fit && (
            <Text className="text-sm text-muted-foreground">{intelligence.personalized_fit.summary}</Text>
          )}

          <View className="flex-row flex-wrap gap-2">
            <Pressable onPress={onOpenWhy} className="rounded-full border border-border px-3.5 py-2">
              <Text className="text-xs font-semibold text-foreground">{t("property.intelligence.actions.whyThisProperty")}</Text>
            </Pressable>
            <Link href="/compare" asChild>
              <Pressable className="rounded-full border border-border px-3.5 py-2">
                <Text className="text-xs font-semibold text-foreground">{t("property.intelligence.actions.compare")}</Text>
              </Pressable>
            </Link>
            <Link
              href={{ pathname: "/advisor", params: { q: `Tell me more about ${property.title} — is it a good fit for what I'm looking for?` } }}
              asChild
            >
              <Pressable className="flex-row items-center gap-1 rounded-full px-3.5 py-2" style={{ backgroundColor: colors.ai }}>
                <Sparkles size={12} color="#FFFFFF" />
                <Text className="text-xs font-semibold text-white">{t("property.intelligence.actions.askMyMakan")}</Text>
              </Pressable>
            </Link>
            <Pressable onPress={onContactAgent} className="rounded-full px-3.5 py-2" style={{ backgroundColor: colors.primary }}>
              <Text className="text-xs font-semibold text-white">{t("property.intelligence.actions.contactAgent")}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const DECISION_SCORE_DIMENSIONS = ["price_value", "location_fit", "property_fit", "amenities", "area", "listing_confidence"] as const;

function DecisionScoreCard({ intelligence }: { intelligence: ApiPropertyIntelligence | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  if (!intelligence) return null;
  const dims = DECISION_SCORE_DIMENSIONS.filter((key) => intelligence.component_scores[key]);
  if (dims.length === 0) return null;

  return (
    <View className="gap-4 rounded-2xl border border-border p-4">
      <View className="flex-row items-center gap-3">
        <ScoreRing score={intelligence.decision_score} size={48} />
        <View className="flex-1">
          <Text className="text-sm font-bold text-foreground">{t("property.intelligence.decisionScore.title")}</Text>
          <Text className="text-xs text-muted-foreground">{t("property.intelligence.decisionScore.subtitle")}</Text>
        </View>
      </View>
      <View className="gap-3">
        {dims.map((key) => (
          <ScoreBar key={key} label={t(`property.intelligence.decisionScore.dimensions.${key}`)} value={intelligence.component_scores[key].score} />
        ))}
      </View>
      {intelligence.omitted_score_dimensions.length > 0 && (
        <Text className="text-xs text-muted-foreground">{t("property.intelligence.decisionScore.omittedNote")}</Text>
      )}
      <Pressable
        onPress={() => router.push({ pathname: "/methodology", params: { section: "propertyScore" } })}
        className="flex-row items-center justify-between border-t border-border pt-3"
      >
        <Text className="text-xs font-medium text-primary">{t("property.intelligence.decisionScore.howCalculated")}</Text>
        <ChevronRight size={14} color={colors.primary} />
      </Pressable>
    </View>
  );
}

function PriceIntelligenceCard({ intelligence, isSale }: { intelligence: ApiPropertyIntelligence | null; isSale: boolean }) {
  const { t } = useLanguage();
  if (!intelligence) return null;
  const pi = intelligence.price_intelligence;

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <Text className="text-sm font-bold text-foreground">
        {isSale ? t("property.intelligence.priceIntelligence.titleBuy") : t("property.intelligence.priceIntelligence.titleRent")}
      </Text>
      {!pi.sufficient_data ? (
        <Text className="text-sm text-muted-foreground">{t("property.intelligence.priceIntelligence.insufficientData")}</Text>
      ) : (
        <>
          <View className="flex-row flex-wrap items-center gap-2">
            {pi.classification && (
              <Badge tone={classificationTone(pi.classification)}>
                {t(`property.intelligence.priceIntelligence.classification.${classificationKey(pi.classification)}`)}
              </Badge>
            )}
            <Text className="text-xs text-muted-foreground">
              {t("property.intelligence.priceIntelligence.comparableCount", { count: pi.comparable_count })}
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-4">
            {!isSale ? (
              <>
                <MiniStat label={t("property.intelligence.askingRent")} value={`SAR ${formatSAR(pi.asking_price ?? 0)}/mo`} />
                {pi.fair_range_low != null && pi.fair_range_high != null && (
                  <MiniStat
                    label={t("property.intelligence.priceIntelligence.fairRange")}
                    value={`SAR ${formatSAR(Math.round(pi.fair_range_low))} – ${formatSAR(Math.round(pi.fair_range_high))}/mo`}
                  />
                )}
                {pi.market_midpoint != null && (
                  <MiniStat label={t("property.intelligence.priceIntelligence.marketMidpoint")} value={`SAR ${formatSAR(Math.round(pi.market_midpoint))}/mo`} />
                )}
              </>
            ) : (
              <>
                <MiniStat label={t("property.intelligence.askingPrice")} value={`SAR ${formatSAR(pi.asking_price ?? 0)}`} />
                {pi.price_per_sqm != null && (
                  <MiniStat label={t("property.intelligence.priceIntelligence.pricePerSqm")} value={`SAR ${formatSAR(Math.round(pi.price_per_sqm))}`} />
                )}
                {pi.estimated_value_low != null && pi.estimated_value_high != null && (
                  <MiniStat
                    label={t("property.intelligence.priceIntelligence.estimatedValueRange")}
                    value={`SAR ${formatSAR(Math.round(pi.estimated_value_low))} – ${formatSAR(Math.round(pi.estimated_value_high))}`}
                  />
                )}
              </>
            )}
          </View>
          {pi.factors_used.length > 0 && (
            <Text className="text-xs text-muted-foreground">
              {t("property.intelligence.priceIntelligence.factorsUsed")}:{" "}
              {pi.factors_used.map((f) => t(`property.intelligence.priceIntelligence.factors.${f}`)).join(", ")}
            </Text>
          )}
          {isSale && <Text className="text-xs text-muted-foreground">{t("property.intelligence.priceIntelligence.disclaimerBuy")}</Text>}
        </>
      )}
    </View>
  );
}

const FIT_STATUS_TONE: Record<string, "success" | "warning"> = { match: "success", moderate: "warning", miss: "warning" };

function PersonalizedFitSection({ intelligence }: { intelligence: ApiPropertyIntelligence | null }) {
  const { t } = useLanguage();
  const fit = intelligence?.personalized_fit;
  if (!fit) return null;

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-sm font-bold text-foreground">{t("property.intelligence.personalizedFit.title")}</Text>
        <Text className="text-xs font-medium text-muted-foreground">{fit.summary}</Text>
      </View>
      <View className="gap-2">
        {fit.rows.map((row) => (
          <View key={row.label} className="flex-row items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground">{row.label}</Text>
              {!!row.detail && <Text className="text-xs text-muted-foreground">{row.detail}</Text>}
            </View>
            <Badge tone={FIT_STATUS_TONE[row.status] ?? "neutral"}>{t(`property.intelligence.personalizedFit.status.${row.status}`)}</Badge>
          </View>
        ))}
      </View>
    </View>
  );
}

function AtAGlanceCard({ intelligence }: { intelligence: ApiPropertyIntelligence | null }) {
  const { t } = useLanguage();
  const [showWhy, setShowWhy] = useState(false);
  if (!intelligence) return null;
  const { strengths, considerations, things_to_verify, data_confidence } = intelligence;
  if (strengths.length === 0 && considerations.length === 0 && things_to_verify.length === 0) return null;

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-sm font-bold text-foreground">{t("property.intelligence.atAGlance.title")}</Text>
        <Pressable onPress={() => setShowWhy((v) => !v)} className="flex-row items-center gap-1.5">
          <Badge tone={data_confidence.level === "High" ? "success" : "warning"}>
            {t(data_confidence.level === "High" ? "property.intelligence.dataConfidence.high" : "property.intelligence.dataConfidence.moderate")}
          </Badge>
          <Text className="text-xs font-semibold text-primary">{t("property.intelligence.dataConfidence.why")}</Text>
        </Pressable>
      </View>
      {showWhy && <Text className="text-xs text-muted-foreground">{data_confidence.reason}</Text>}

      {strengths.length > 0 && (
        <View className="gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide" style={{ color: colors.success }}>
            {t("property.intelligence.atAGlance.strengths")}
          </Text>
          {strengths.map((s) => (
            <View key={s} className="flex-row items-start gap-1.5">
              <CheckCircle2 size={14} color={colors.success} />
              <Text className="flex-1 text-sm text-muted-foreground">{s}</Text>
            </View>
          ))}
        </View>
      )}
      {considerations.length > 0 && (
        <View className="gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide" style={{ color: colors.warning }}>
            {t("property.intelligence.atAGlance.considerations")}
          </Text>
          {considerations.map((c) => (
            <View key={c} className="flex-row items-start gap-1.5">
              <TrendingUp size={14} color={colors.warning} />
              <Text className="flex-1 text-sm text-muted-foreground">{c}</Text>
            </View>
          ))}
        </View>
      )}
      {things_to_verify.length > 0 && (
        <View className="gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("property.intelligence.atAGlance.thingsToVerify")}</Text>
          {things_to_verify.map((v) => (
            <View key={v} className="flex-row items-start gap-1.5">
              <FileText size={14} color={colors.mutedForeground} />
              <Text className="flex-1 text-sm text-muted-foreground">{v}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const VALUE_LABEL_KEYS: Record<string, string> = {
  "Better Value": "betterValue",
  "Similar Price": "similarPrice",
  "Higher Price": "higherPrice",
};

function SimilarPropertiesSection({ intelligence }: { intelligence: ApiPropertyIntelligence | null }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [properties, setProperties] = useState<Record<number, Property>>({});
  const [loadingCards, setLoadingCards] = useState(false);

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

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1">
          <Text className="text-sm font-bold text-foreground">{t("property.intelligence.similarProperties.title")}</Text>
          <Text className="text-xs text-muted-foreground">{t("property.intelligence.similarProperties.subtitle")}</Text>
        </View>
        <Pressable onPress={() => setExpanded((v) => !v)} className="rounded-full border border-border px-3 py-1.5">
          <Text className="text-xs font-semibold text-foreground">
            {expanded ? t("property.intelligence.similarProperties.hide") : t("property.intelligence.similarProperties.show")}
          </Text>
        </Pressable>
      </View>

      {expanded &&
        (loadingCards ? (
          <Skeleton height={200} radius={16} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 pe-1">
            {items.map((item) => {
              const p = properties[item.property_id];
              if (!p) return null;
              return (
                <View key={item.property_id} style={{ width: 260 }} className="gap-1.5">
                  <PropertyCard p={p} />
                  {item.value_label && (
                    <Badge tone={item.value_label === "Better Value" ? "success" : item.value_label === "Higher Price" ? "warning" : "neutral"}>
                      {t(`property.intelligence.similarProperties.valueLabel.${VALUE_LABEL_KEYS[item.value_label] ?? "similarPrice"}`)}
                    </Badge>
                  )}
                </View>
              );
            })}
          </ScrollView>
        ))}
    </View>
  );
}

function DecisionSheet({
  visible,
  intelligence,
  property,
  onClose,
}: {
  visible: boolean;
  intelligence: ApiPropertyIntelligence | null;
  property: Property;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const isEmpty =
    !intelligence ||
    (intelligence.strengths.length === 0 && intelligence.considerations.length === 0 && intelligence.things_to_verify.length === 0);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView contentContainerClassName="gap-3 p-5" style={{ maxHeight: 560 }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            {intelligence && <ScoreRing score={intelligence.decision_score} size={40} />}
            <Text className="text-base font-bold text-foreground">{t("property.intelligence.decisionSheet.title")}</Text>
          </View>
          <Pressable onPress={onClose}>
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isEmpty ? (
          <Text className="text-sm text-muted-foreground">{t("property.intelligence.decisionSheet.empty")}</Text>
        ) : (
          <>
            {intelligence!.strengths.length > 0 && (
              <View className="gap-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("property.intelligence.decisionSheet.whyItWorks")}</Text>
                {intelligence!.strengths.map((s) => (
                  <View key={s} className="flex-row items-start gap-1.5">
                    <CheckCircle2 size={14} color={colors.success} />
                    <Text className="flex-1 text-sm text-foreground">{s}</Text>
                  </View>
                ))}
              </View>
            )}
            {intelligence!.considerations.length > 0 && (
              <View className="gap-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("property.intelligence.decisionSheet.tradeOffs")}</Text>
                {intelligence!.considerations.map((c) => (
                  <View key={c} className="flex-row items-start gap-1.5">
                    <TrendingUp size={14} color={colors.warning} />
                    <Text className="flex-1 text-sm text-foreground">{c}</Text>
                  </View>
                ))}
              </View>
            )}
            {intelligence!.things_to_verify.length > 0 && (
              <View className="gap-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("property.intelligence.decisionSheet.thingsToVerify")}</Text>
                {intelligence!.things_to_verify.map((v) => (
                  <View key={v} className="flex-row items-start gap-1.5">
                    <FileText size={14} color={colors.mutedForeground} />
                    <Text className="flex-1 text-sm text-foreground">{v}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        <Link
          href={{ pathname: "/advisor", params: { q: `Tell me more about ${property.title} — is it a good fit for what I'm looking for?` } }}
          asChild
        >
          <Pressable onPress={onClose} className="mt-1 flex-row items-center justify-center gap-2 rounded-xl py-3" style={{ backgroundColor: colors.ai }}>
            <Sparkles size={16} color="#FFFFFF" />
            <Text className="text-sm font-semibold text-white">{t("property.intelligence.decisionSheet.askAI")}</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </BottomSheet>
  );
}

function SmartQuestionsSection({ property, intelligence }: { property: Property; intelligence: ApiPropertyIntelligence | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const questions = intelligence?.smart_questions ?? [];
  if (questions.length === 0) return null;
  const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <Text className="text-sm font-bold text-foreground">{t("property.intelligence.smartQuestions.title")}</Text>
      <Text className="text-xs text-muted-foreground">{t("property.intelligence.smartQuestions.subtitle")}</Text>
      <View className="gap-1.5">
        {questions.map((q, i) => (
          <Text key={q} className="text-sm text-foreground">
            {i + 1}. {q}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={() => Share.share({ message: questionsText }).catch(() => {})}
          className="rounded-full border border-border px-3.5 py-2"
        >
          <Text className="text-xs font-semibold text-foreground">{t("property.intelligence.smartQuestions.shareQuestions")}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: "/lead/new", params: { city: property.city, district: property.district, note: questionsText } })}
          className="rounded-full border border-border px-3.5 py-2"
        >
          <Text className="text-xs font-semibold text-foreground">{t("property.intelligence.smartQuestions.sendToAgent")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NegotiationInsightCard({
  property,
  intelligence,
  waLink,
}: {
  property: Property;
  intelligence: ApiPropertyIntelligence | null;
  waLink: string | undefined;
}) {
  const { t, lang } = useLanguage();
  const router = useRouter();
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
    <View className="gap-3 rounded-2xl border border-border p-4">
      <Text className="text-sm font-bold text-foreground">{t("property.intelligence.negotiation.title")}</Text>
      <View className="flex-row flex-wrap gap-4">
        <MiniStat label={t("property.intelligence.negotiation.askingPrice")} value={`SAR ${formatSAR(negotiation.asking_price)}`} />
        <MiniStat label={t("property.intelligence.negotiation.marketMidpoint")} value={`SAR ${formatSAR(Math.round(negotiation.market_midpoint))}`} />
        <MiniStat
          label={t("property.intelligence.negotiation.discussionRange")}
          value={`SAR ${formatSAR(Math.round(negotiation.discussion_range_low))} – ${formatSAR(Math.round(negotiation.discussion_range_high))}`}
        />
      </View>
      <Text className="text-sm text-muted-foreground">{negotiation.approach}</Text>

      {draft === null ? (
        <Pressable onPress={() => !drafting && handleDraft()} className="self-start rounded-full border border-border px-3.5 py-2">
          <Text className="text-xs font-semibold text-foreground">
            {drafting ? t("property.intelligence.negotiation.drafting") : t("property.intelligence.negotiation.draftMessage")}
          </Text>
        </Pressable>
      ) : (
        <View className="gap-2 rounded-xl border border-border bg-surface p-3">
          <Text className="text-xs font-semibold text-foreground">{t("property.intelligence.negotiation.draftedTitle")}</Text>
          <Text className="text-xs text-muted-foreground">{t("property.intelligence.negotiation.draftedDesc")}</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            numberOfLines={4}
            className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            style={{ textAlignVertical: "top" }}
          />
          <View className="flex-row flex-wrap gap-2">
            {waLink && (
              <Pressable
                onPress={() => Linking.openURL(`${waLink}?text=${encodeURIComponent(draft)}`)}
                className="flex-row items-center gap-1.5 rounded-xl px-4 py-2.5"
                style={{ backgroundColor: colors.whatsapp }}
              >
                <MessageCircle size={16} color="#FFFFFF" />
                <Text className="text-sm font-semibold text-white">{t("property.intelligence.negotiation.sendViaWhatsapp")}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push({ pathname: "/lead/new", params: { city: property.city, district: property.district, note: draft } })}
              className="rounded-xl border border-border px-4 py-2.5"
            >
              <Text className="text-sm font-semibold text-foreground">{t("property.intelligence.negotiation.sendToAgent")}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function AskMyMakanQuickQuestions({ property, isSale }: { property: Property; isSale: boolean }) {
  const { t } = useLanguage();
  const baseKeys = ["fairPricing", "compromises", "compare", "whatToAsk", "familySuitability", "negotiateHelp", "areaInfo"] as const;
  const buyKeys = ["pricePerSqm", "rentalIncome"] as const;
  const keys = isSale ? [...baseKeys, ...buyKeys] : baseKeys;

  return (
    <View className="gap-3 rounded-2xl p-4" style={{ backgroundColor: "rgba(124,58,237,0.06)", borderWidth: 1, borderColor: "rgba(124,58,237,0.2)" }}>
      <View className="flex-row items-center gap-1.5">
        <Sparkles size={14} color={colors.ai} />
        <Text className="text-sm font-bold text-foreground">{t("property.intelligence.quickQuestions.title")}</Text>
      </View>
      <Text className="text-xs text-muted-foreground">{t("property.intelligence.quickQuestions.subtitle")}</Text>
      <View className="flex-row flex-wrap gap-2">
        {keys.map((key) => {
          const question = t(`property.intelligence.quickQuestions.${key}`, { district: property.district });
          return (
            <Link key={key} href={{ pathname: "/advisor", params: { q: question } }} asChild>
              <Pressable className="rounded-full border px-3.5 py-2" style={{ borderColor: "rgba(124,58,237,0.3)" }}>
                <Text className="text-xs font-medium text-foreground">{question}</Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </View>
  );
}
