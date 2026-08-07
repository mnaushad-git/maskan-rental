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
} from "lucide-react-native";
import { fetchProperty, mapApiProperty, saveProperty, deleteSavedProperty, submitFinancingInterest } from "@/lib/api/maskan";
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
import { ScoreRing } from "@/components/ScoreIndicator";
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
  const saved = savedId !== null;

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
      .then((raw) => setProperty(mapApiProperty(raw)))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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
  const waLink = property.agentPhone ? whatsappLink(property.agentPhone) : undefined;
  const fullDescription = property.description ?? "";

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

          {property.commissionPercent != null && (
            <Text className="-mt-3 text-xs text-muted-foreground">
              {t("property.summary.plusCommission", { percent: property.commissionPercent })}
            </Text>
          )}

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

          {!isSale && (
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
        </View>
      </ScrollView>

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
                className="flex-row items-center gap-1.5 rounded-xl bg-whatsapp px-4 py-2.5"
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
