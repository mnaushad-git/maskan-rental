import { useState } from "react";
import { View, Text, Pressable, Linking } from "react-native";
import { Image } from "expo-image";
import { Link, useRouter } from "expo-router";
import { Bath, BedDouble, Heart, MapPin, Maximize, Phone, MessageCircle } from "lucide-react-native";
import type { Property } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { saveProperty } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { RecommendationBadge, StatusBadge } from "./Badges";
import { ScoreRing } from "./ScoreIndicator";

export function PropertyCard({ p }: { p: Property }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    if (saved || saving) return;
    setSaving(true);
    try {
      await saveProperty(user.id, Number(p.id));
      setSaved(true);
    } catch {
      // silently ignore duplicate-save errors (unique constraint)
    } finally {
      setSaving(false);
    }
  }

  const hasPhone = !!p.agentPhone;
  const waLink = hasPhone
    ? `https://wa.me/${p.agentPhone!.replace(/\D/g, "").replace(/^0/, "966")}`
    : undefined;

  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-background shadow-card">
      <Link href={{ pathname: "/property/[id]", params: { id: p.id } }} asChild>
        <Pressable>
          <View className="relative aspect-[4/3] overflow-hidden bg-surface-2">
            <Image source={{ uri: p.image }} className="size-full" contentFit="cover" />
            <View className="absolute inset-x-3 top-3 flex-row items-start justify-between gap-2">
              <View className="flex-row flex-wrap gap-1.5">
                {p.badges.slice(0, 2).map((b) => (
                  <RecommendationBadge key={b} label={b} />
                ))}
              </View>
              <Pressable
                accessibilityLabel={saved ? "Saved" : "Save"}
                onPress={handleSave}
                disabled={saving}
                className="size-9 items-center justify-center rounded-full bg-background/95 shadow-card"
              >
                <Heart size={16} color={saved ? "#DC2626" : "#2B211A"} fill={saved ? "#DC2626" : "none"} />
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
                  <MapPin size={14} color="#79716B" />
                  <Text className="text-sm text-muted-foreground">
                    {p.district}, {p.city}
                  </Text>
                </View>
              </View>
              <ScoreRing score={p.matchScore} />
            </View>

            <View className="flex-row items-center gap-4">
              <View className="flex-row items-center gap-1.5">
                <BedDouble size={16} color="#79716B" />
                <Text className="text-sm text-muted-foreground">{p.bedrooms}</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <Bath size={16} color="#79716B" />
                <Text className="text-sm text-muted-foreground">{p.bathrooms}</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <Maximize size={16} color="#79716B" />
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
            <Phone size={14} color="#2B211A" />
            <Text className="text-xs font-medium text-foreground">{t("propertyCard.call")}</Text>
          </Pressable>
          <Pressable
            onPress={() => waLink && Linking.openURL(waLink)}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2"
            style={{ borderColor: "#25D366", backgroundColor: "rgba(37,211,102,0.1)" }}
          >
            <MessageCircle size={14} color="#128C7E" />
            <Text className="text-xs font-medium" style={{ color: "#128C7E" }}>
              {t("propertyCard.whatsapp")}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
