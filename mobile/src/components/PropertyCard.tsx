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
  const waLink = hasPhone ? whatsappLink(p.agentPhone!) : undefined;

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
