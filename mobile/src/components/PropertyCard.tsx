import { useState } from "react";
import { View, Text, Pressable, Linking, Image } from "react-native";
import { Link, useRouter } from "expo-router";
import { Bath, BedDouble, Heart, MapPin, Maximize, Phone, MessageCircle } from "lucide-react-native";
import type { Property } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { saveProperty, deleteSavedProperty } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { RecommendationBadge, StatusBadge } from "./Badges";
import { ScoreRing } from "./ScoreIndicator";
import { colors } from "@/lib/colors";
import { whatsappLink } from "@/lib/whatsapp";

// Client-side approximation for the card's trust signal row (Property
// Verification & Trust Center, Prompt 10) — NOT a per-card GET
// /properties/{id}/trust fetch. A search-results grid can render dozens of
// cards; calling the real Trust endpoint once per card would mean dozens of
// extra requests just to decorate a list. Mirrors
// frontend/src/components/maskan/PropertyCard.tsx's identical
// estimateCompletenessPercent()/isRecentlyUpdated() judgment call: base 60%
// (fields every saved listing already has: title/district/city/price/
// bedrooms/bathrooms) plus up to 40% scaled by how many of six already-
// available "extra detail" fields are present on the already-mapped
// `Property` object — never a network call, never LLM-based, and explicitly
// NOT the authoritative score (that's PropertyTrustBadge's real
// /trust-backed Listing Confidence section).
function estimateCompletenessPercent(p: Property): number {
  const extras = [p.description, p.furnished, p.livingRooms, p.propertyAgeYears, p.deedArea, p.licenseNumber];
  const presentCount = extras.filter((v) => v != null && v !== "").length;
  return Math.round(60 + (presentCount / extras.length) * 40);
}

// Mirrors trust_config.py's FRESHNESS_RECENTLY_UPDATED_DAYS = 14 threshold
// client-side against the already-loaded updatedAt field — same "no extra
// fetch" reasoning as the completeness estimate above.
function isRecentlyUpdated(p: Property): boolean {
  const ms = Date.parse(p.updatedAt);
  return !Number.isNaN(ms) && Date.now() - ms < 14 * 24 * 60 * 60 * 1000;
}

export function PropertyCard({
  p,
  initialSavedId,
  onUnsaved,
}: {
  p: Property;
  /** Pass the saved-properties record id when this card is known to already be saved (e.g. Saved screen). */
  initialSavedId?: number;
  /** Called once an unsave is confirmed by the server, so the parent list can drop this item. */
  onUnsaved?: () => void;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [savedId, setSavedId] = useState<number | null>(initialSavedId ?? null);
  const [saving, setSaving] = useState(false);
  const saved = savedId !== null;

  async function handleToggleSave() {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    if (saving) return;
    setSaving(true);
    if (saved) {
      const prevId = savedId;
      setSavedId(null);
      try {
        await deleteSavedProperty(prevId!);
        onUnsaved?.();
      } catch {
        setSavedId(prevId);
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const result = await saveProperty(user.id, Number(p.id));
      setSavedId(result.id);
    } catch {
      // silently ignore duplicate-save errors (unique constraint)
    } finally {
      setSaving(false);
    }
  }

  const hasPhone = !!p.agentPhone;
  const waLink = hasPhone ? whatsappLink(p.agentWhatsapp ?? p.agentPhone!) : undefined;

  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-background shadow-card">
      <Link href={{ pathname: "/property/[id]", params: { id: p.id } }} asChild>
        <Pressable>
          <View className="relative aspect-[4/3] overflow-hidden bg-surface-2">
            <Image source={{ uri: p.image }} className="size-full" resizeMode="cover" />
            <View className="absolute inset-x-3 top-3 flex-row items-start justify-between gap-2">
              <View className="flex-row flex-wrap gap-1.5">
                {p.badges.slice(0, 2).map((b) => (
                  <RecommendationBadge key={b} label={b} />
                ))}
              </View>
              <Pressable
                accessibilityLabel={saved ? "Unsave" : "Save"}
                onPress={handleToggleSave}
                disabled={saving}
                className="size-9 items-center justify-center rounded-full bg-background/95 shadow-card"
              >
                <Heart size={16} color={saved ? colors.destructive : colors.foreground} fill={saved ? colors.destructive : "none"} />
              </Pressable>
            </View>
            <View className="absolute bottom-3 start-3">
              <StatusBadge status={p.status} />
            </View>
          </View>

          <View className="gap-4 p-5">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text numberOfLines={1} className="text-base font-semibold tracking-tight text-foreground">
                  {p.title}
                </Text>
                <View className="mt-1 flex-row items-center gap-1">
                  <MapPin size={14} color={colors.mutedForeground} />
                  <Text className="text-sm text-muted-foreground">
                    {p.district}, {p.city}
                  </Text>
                </View>
              </View>
              <ScoreRing score={p.matchScore} />
            </View>

            {/* Trust signal row (Property Verification & Trust Center,
                Prompt 10) — keep minimal, don't clutter the card. */}
            <View className="flex-row flex-wrap items-center gap-1.5">
              {p.badges.includes("Verified") ? (
                <Text className="text-[11px] font-semibold text-success">{t("propertyCard.trust.verified")}</Text>
              ) : (
                <Text className="text-[11px] font-medium text-muted-foreground">
                  {t("propertyCard.trust.complete", { percent: estimateCompletenessPercent(p) })}
                </Text>
              )}
              {isRecentlyUpdated(p) && (
                <>
                  <Text className="text-[11px] text-muted-foreground">·</Text>
                  <Text className="text-[11px] font-medium text-muted-foreground">
                    {t("propertyCard.trust.recentlyUpdated")}
                  </Text>
                </>
              )}
            </View>

            <View className="flex-row items-center gap-4">
              <View className="flex-row items-center gap-1.5">
                <BedDouble size={16} color={colors.mutedForeground} />
                <Text className="text-sm text-muted-foreground">{p.bedrooms}</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <Bath size={16} color={colors.mutedForeground} />
                <Text className="text-sm text-muted-foreground">{p.bathrooms}</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <Maximize size={16} color={colors.mutedForeground} />
                <Text className="text-sm text-muted-foreground">{p.area} m²</Text>
              </View>
            </View>

            <View className="flex-row items-end justify-between border-t border-border pt-4">
              <View>
                <Text className="text-xs text-muted-foreground">
                  {p.listingType === "sale" ? t("propertyCard.salePrice") : t("propertyCard.annualRent")}
                </Text>
                <Text className="text-xl font-bold tracking-tight text-foreground">
                  SAR {formatSAR(p.price)}
                  {p.listingType !== "sale" && (
                    <Text className="text-xs font-medium text-muted-foreground"> {t("propertyCard.perYear")}</Text>
                  )}
                </Text>
              </View>
              <Text className="text-xs text-muted-foreground">SAR {formatSAR(p.pricePerSqm)}/m²</Text>
            </View>
          </View>
        </Pressable>
      </Link>

      {hasPhone && (
        <View className="flex-row gap-2 border-t border-border px-5 py-3">
          <Pressable
            onPress={() => Linking.openURL(`tel:${p.agentPhone}`)}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-border py-2"
          >
            <Phone size={14} color={colors.foreground} />
            <Text className="text-xs font-medium text-foreground">{t("propertyCard.call")}</Text>
          </Pressable>
          <Pressable
            onPress={() => waLink && Linking.openURL(waLink)}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2"
            style={{ borderColor: colors.whatsapp, backgroundColor: "rgba(37,211,102,0.1)" }}
          >
            <MessageCircle size={14} color={colors.whatsappForeground} />
            <Text className="text-xs font-medium" style={{ color: colors.whatsappForeground }}>
              {t("propertyCard.whatsapp")}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
