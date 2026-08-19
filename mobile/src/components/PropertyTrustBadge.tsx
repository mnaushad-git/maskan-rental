// Property Verification & Trust Center — customer-facing mobile UI
// (Prompt 10). Mirrors frontend/src/components/maskan/PropertyTrustCenter.tsx's
// behavior and copy (not pixel layout — this uses mobile's BottomSheet
// instead of web's fixed-overlay sheet). Named "PropertyTrustBadge" (not
// "TrustBadge") — mobile/src/components/TrustBadge.tsx already exists and is
// the renter's OWN identity-verification score (mock-Nafath flow), an
// unrelated concept from this file's listing/mediator trust. See the
// "Naming collision warning" in
// docs/implementation/mymakan-trust-center-prompts.md.
//
// This file owns:
//   - PropertyTrustSection: the instant badge/entry rendered inline on
//     Property Detail (score, level, top signals, "View Trust Details"),
//     with the AI Trust Summary loading async underneath it, never blocking.
//   - TrustDetailsSheet: the full Trust Center detail sheet (Listing
//     Confidence, Mediator, Freshness, Price Confidence, Things to Verify,
//     Report a Concern).
import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import {
  ShieldCheck,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
  Flag,
  Sparkles,
  Star,
} from "lucide-react-native";
import {
  fetchPropertyTrust,
  fetchPropertyTrustSummary,
  type ApiPropertyIntelligence,
  type ApiTrustAssessment,
  type ApiTrustSummary,
} from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import { Badge } from "@/components/Badges";
import { ScoreRing } from "@/components/ScoreIndicator";
import { Skeleton } from "@/components/ui/Skeleton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ListingVerificationBlock } from "@/components/ListingVerificationBlock";
import { ReportListingSheet } from "@/components/ReportListingSheet";

function useTrustT() {
  const { t } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => t(`property.trust.${key}`, vars);
}

// Mobile's Badge has no "destructive" tone (see components/Badges.tsx), so
// the worst trust level maps to "warning" too — the same accepted mapping
// property/[id].tsx's own classificationTone() already uses for price
// classification on this same screen.
const TRUST_LEVEL_TONE: Record<string, "success" | "warning" | "neutral"> = {
  High: "success",
  Good: "success",
  Moderate: "warning",
  "Limited Confidence": "warning",
};

// Local duplicate of property/[id].tsx's module-private CLASSIFICATION_KEYS/
// classificationTone — that file doesn't export them and components
// shouldn't import from a route file, same "small local duplicate" judgment
// call frontend's PropertyTrustCenter.tsx already documented for the
// identical situation.
const CLASSIFICATION_KEYS: Record<string, string> = {
  "Excellent Value": "excellentValue",
  "Good Value": "goodValue",
  Fair: "fair",
  "Above Market": "aboveMarket",
  "Significantly Above Market": "significantlyAboveMarket",
};

function classificationTone(classification: string): "success" | "neutral" | "warning" {
  if (classification === "Excellent Value" || classification === "Good Value") return "success";
  if (classification === "Fair") return "neutral";
  return "warning";
}

// Maps the backend's exact display labels (app/core/trust_config.py's
// COMPLETENESS_FIELDS) to a clean i18n key — same "raw string -> local key"
// pattern already used across this codebase (e.g. property/[id].tsx's
// CLASSIFICATION_KEYS/VALUE_LABEL_KEYS). Falls back to the raw backend
// label for any field this map doesn't recognize, so nothing silently
// disappears from the list.
const COMPLETENESS_FIELD_KEYS: Record<string, string> = {
  Title: "title",
  "District / area": "district",
  City: "city",
  Price: "price",
  "Property type": "propertyType",
  Bedrooms: "bedrooms",
  Bathrooms: "bathrooms",
  "Size (sqm)": "size",
  Photos: "photos",
  Description: "description",
  "Map location": "mapLocation",
  "Furnishing status": "furnishingStatus",
  "Living rooms": "livingRooms",
  "Contact number": "contactNumber",
  "Multiple photos (3+)": "multiplePhotos",
  "Property age": "propertyAge",
  "Deed area": "deedArea",
  "WhatsApp number": "whatsapp",
  "License number": "licenseNumber",
};

export function PropertyTrustSection({
  propertyId,
  intelligence,
  mediatorId,
  mediatorName,
}: {
  propertyId: number;
  intelligence: ApiPropertyIntelligence | null;
  mediatorId: number | null;
  mediatorName: string;
}) {
  const tt = useTrustT();
  const { lang } = useLanguage();
  const [trust, setTrust] = useState<ApiTrustAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSheet, setShowSheet] = useState(false);

  // AI Trust Summary — fetched separately, after the deterministic
  // assessment, so a slow/failed AI call never blocks the instant trust
  // badge above it (mirrors this same screen's Property Intelligence /
  // ai-summary split).
  const [summary, setSummary] = useState<ApiTrustSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPropertyTrust(propertyId)
      .then((data) => {
        if (!cancelled) setTrust(data);
      })
      .catch(() => {
        if (!cancelled) setTrust(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    fetchPropertyTrustSummary(propertyId, lang === "ar" ? "ar" : "en")
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, lang]);

  if (loading) {
    return (
      <View className="gap-3 rounded-2xl border border-border p-4">
        <View className="flex-row items-center gap-3">
          <Skeleton width={52} height={52} radius={26} />
          <View className="flex-1 gap-2">
            <Skeleton width="40%" height={16} />
            <Skeleton width="60%" height={12} />
          </View>
        </View>
      </View>
    );
  }
  if (!trust) return null; // never block the rest of the screen on a failed call

  const topSignals: { text: string; positive: boolean }[] = [];
  for (const p of trust.positive_signals) {
    if (topSignals.length >= 4) break;
    topSignals.push({ text: p, positive: true });
  }
  for (const v of trust.things_to_verify) {
    if (topSignals.length >= 4) break;
    topSignals.push({ text: v, positive: false });
  }

  return (
    <>
      <View className="gap-4 rounded-2xl border border-border p-4">
        <View className="flex-row items-center gap-1.5">
          <ShieldCheck size={14} color={colors.primary} />
          <Text className="text-xs font-bold uppercase tracking-wide text-primary">{tt("badge")}</Text>
        </View>

        <View className="flex-row items-center gap-3">
          <ScoreRing score={trust.overall_score} size={52} />
          <View>
            <Text className="text-sm font-semibold text-foreground">{tt("scoreLabel")}</Text>
            <Badge tone={TRUST_LEVEL_TONE[trust.trust_level] ?? "neutral"}>{tt(`level.${trust.trust_level}`)}</Badge>
          </View>
        </View>

        {topSignals.length > 0 && (
          <View className="gap-2">
            {topSignals.map((s) => (
              <View key={s.text} className="flex-row items-start gap-1.5">
                {s.positive ? (
                  <CheckCircle2 size={14} color={colors.success} />
                ) : (
                  <AlertTriangle size={14} color={colors.warning} />
                )}
                <Text className="flex-1 text-sm text-muted-foreground">{s.text}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable onPress={() => setShowSheet(true)} className="self-start rounded-full border border-border px-3.5 py-2">
          <Text className="text-xs font-semibold text-foreground">{tt("viewDetails")}</Text>
        </Pressable>

        {/* AI Trust Summary — loads async underneath the instant score/
            signals above; never blocks or delays them. */}
        <View className="gap-1.5 border-t border-border pt-3">
          {summaryLoading ? (
            <View className="flex-row items-center gap-1.5">
              <Sparkles size={12} color={colors.ai} />
              <Text className="text-xs text-muted-foreground">{tt("aiSummary.loading")}</Text>
            </View>
          ) : summary ? (
            <View className="gap-1.5">
              {summary.generated_by === "ai" && (
                <Badge tone="ai" icon={<Sparkles size={12} color={colors.ai} />}>
                  {tt("aiSummary.label")}
                </Badge>
              )}
              <Text className="text-sm leading-5 text-muted-foreground">{summary.summary}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <TrustDetailsSheet
        visible={showSheet}
        onClose={() => setShowSheet(false)}
        propertyId={propertyId}
        trust={trust}
        intelligence={intelligence}
        mediatorId={mediatorId}
        mediatorName={mediatorName}
      />
    </>
  );
}

function TrustDetailsSheet({
  visible,
  onClose,
  propertyId,
  trust,
  intelligence,
  mediatorId,
  mediatorName,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: number;
  trust: ApiTrustAssessment;
  intelligence: ApiPropertyIntelligence | null;
  mediatorId: number | null;
  mediatorName: string;
}) {
  const tt = useTrustT();
  const { t } = useLanguage();
  const router = useRouter();
  const [showReportSheet, setShowReportSheet] = useState(false);

  const completeness = trust.component_scores.completeness;
  const mediatorTrust = trust.component_scores.mediator_trust;
  const freshness = trust.component_scores.freshness;
  const pi = intelligence?.price_intelligence;

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose}>
        <ScrollView contentContainerClassName="gap-5 p-5" style={{ maxHeight: 620 }}>
          <View className="flex-row items-center gap-3">
            <ScoreRing score={trust.overall_score} size={44} />
            <View>
              <Text className="text-base font-bold text-foreground">{tt("sheet.title")}</Text>
              <Badge tone={TRUST_LEVEL_TONE[trust.trust_level] ?? "neutral"}>{tt(`level.${trust.trust_level}`)}</Badge>
            </View>
          </View>

          {/* Listing Confidence (completeness) */}
          {completeness && (
            <View className="gap-2 border-t border-border pt-4">
              <Text className="text-sm font-semibold text-foreground">{tt("sheet.sections.completeness")}</Text>
              <Text className="text-xs text-muted-foreground">
                {tt("sheet.completeness.subtitle", {
                  present: completeness.present_fields.length,
                  total: completeness.present_fields.length + completeness.missing_fields.length,
                })}
              </Text>
              <View className="mt-1 gap-1.5">
                {completeness.present_fields.map((f) => (
                  <View key={f} className="flex-row items-center gap-1.5">
                    <CheckCircle2 size={13} color={colors.success} />
                    <Text className="text-xs text-foreground">
                      {COMPLETENESS_FIELD_KEYS[f] ? tt(`sheet.completeness.fields.${COMPLETENESS_FIELD_KEYS[f]}`) : f}
                    </Text>
                  </View>
                ))}
                {completeness.missing_fields.map((f) => (
                  <View key={f} className="flex-row items-center gap-1.5">
                    <Circle size={13} color={colors.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">
                      {COMPLETENESS_FIELD_KEYS[f] ? tt(`sheet.completeness.fields.${COMPLETENESS_FIELD_KEYS[f]}`) : f}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Mediator */}
          <View className="gap-2 border-t border-border pt-4">
            <Text className="text-sm font-semibold text-foreground">{tt("sheet.sections.mediator")}</Text>
            <Pressable
              onPress={() => mediatorId && router.push(`/agent/${mediatorId}`)}
              disabled={!mediatorId}
              className="flex-row items-center justify-between gap-2"
            >
              <Text className="text-sm font-medium text-foreground">{mediatorName}</Text>
              {mediatorId && <Text className="text-xs font-semibold text-primary">{t("property.landlord.profile")}</Text>}
            </Pressable>
            {mediatorTrust ? (
              <>
                <View className="flex-row flex-wrap items-center gap-3">
                  {mediatorTrust.avg_rating != null ? (
                    <View className="flex-row items-center gap-1">
                      <Star size={13} color="#F59E0B" fill="#F59E0B" />
                      <Text className="text-sm text-muted-foreground">
                        {mediatorTrust.avg_rating.toFixed(2)} · {t("property.landlord.reviews", { count: mediatorTrust.review_count })}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-sm text-muted-foreground">{tt("sheet.mediator.noReviewsYet")}</Text>
                  )}
                  <Text className="text-sm text-muted-foreground">
                    {tt("sheet.mediator.listings", { count: mediatorTrust.listing_count })}
                  </Text>
                </View>
                <ListingVerificationBlock
                  providers={[
                    {
                      key: "mymakan",
                      name: t("listingVerification.mymakan"),
                      status: mediatorTrust.is_verified ? "verified" : "not_connected",
                      label: mediatorTrust.is_verified
                        ? t("listingVerification.verifiedLabel")
                        : t("listingVerification.notVerifiedLabel"),
                    },
                  ]}
                />
              </>
            ) : (
              <Text className="text-sm text-muted-foreground">{tt("sheet.mediator.noMediator")}</Text>
            )}
          </View>

          {/* Listing Freshness */}
          {freshness && (
            <View className="gap-1.5 border-t border-border pt-4">
              <Text className="text-sm font-semibold text-foreground">{tt("sheet.sections.freshness")}</Text>
              <View className="flex-row items-center gap-1.5">
                <Clock size={14} color={colors.mutedForeground} />
                <Text className="text-sm font-medium text-foreground">
                  {tt(`sheet.freshness.category.${freshness.category}`)}
                </Text>
              </View>
              <Text className="text-xs text-muted-foreground">{freshness.reason}</Text>
            </View>
          )}

          {/* Price Confidence — reuses Property Intelligence data already
              fetched on this screen; never recalculated here. */}
          <View className="gap-1.5 border-t border-border pt-4">
            <Text className="text-sm font-semibold text-foreground">{tt("sheet.sections.priceConfidence")}</Text>
            <Text className="text-xs text-muted-foreground">{tt("sheet.priceConfidence.subtitle")}</Text>
            {pi?.sufficient_data ? (
              <View className="mt-1 flex-row flex-wrap items-center gap-2">
                {pi.classification && (
                  <Badge tone={classificationTone(pi.classification)}>
                    {t(`property.intelligence.priceIntelligence.classification.${CLASSIFICATION_KEYS[pi.classification] ?? "fair"}`)}
                  </Badge>
                )}
                {intelligence?.data_confidence && (
                  <Badge tone={intelligence.data_confidence.level === "High" ? "success" : "warning"}>
                    {t(
                      intelligence.data_confidence.level === "High"
                        ? "property.intelligence.dataConfidence.high"
                        : "property.intelligence.dataConfidence.moderate",
                    )}
                  </Badge>
                )}
              </View>
            ) : (
              <Text className="text-sm text-muted-foreground">{tt("sheet.priceConfidence.unavailable")}</Text>
            )}
          </View>

          {/* Things to Verify */}
          <View className="gap-1.5 border-t border-border pt-4">
            <Text className="text-sm font-semibold text-foreground">{tt("sheet.sections.thingsToVerify")}</Text>
            {trust.things_to_verify.length > 0 ? (
              <View className="gap-1.5">
                {trust.things_to_verify.map((v) => (
                  <View key={v} className="flex-row items-start gap-1.5">
                    <AlertTriangle size={13} color={colors.warning} />
                    <Text className="flex-1 text-sm text-muted-foreground">{v}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-sm text-muted-foreground">{tt("sheet.thingsToVerify.empty")}</Text>
            )}
          </View>

          {/* Report a Concern */}
          <Pressable
            onPress={() => setShowReportSheet(true)}
            className="mt-1 flex-row items-center justify-center gap-2 rounded-xl border border-border py-3"
          >
            <Flag size={15} color={colors.warning} />
            <Text className="text-sm font-semibold text-foreground">{tt("sheet.reportConcern.cta")}</Text>
          </Pressable>
        </ScrollView>
      </BottomSheet>

      {/* A separate top-level BottomSheet (its own Modal), not nested inside
          this one — RN Modals stack independently, so opening this one
          doesn't require closing TrustDetailsSheet first, and closing it
          never triggers this sheet's onClose. Mirrors the sibling-overlay
          reasoning frontend/src/components/maskan/PropertyTrustCenter.tsx's
          Prompt 9 judgment call documents for the same web situation. */}
      <ReportListingSheet visible={showReportSheet} onClose={() => setShowReportSheet(false)} propertyId={propertyId} />
    </>
  );
}
