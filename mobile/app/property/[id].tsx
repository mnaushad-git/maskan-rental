import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { BedDouble, Bath, Maximize, MapPin, Phone, MessageCircle, Heart, FileText, ChevronRight } from "lucide-react-native";
import { fetchProperty, mapApiProperty, saveProperty, deleteSavedProperty } from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import type { Property } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { PropertyImageGallery } from "@/components/PropertyImageGallery";
import { PropertyAreaInsights } from "@/components/PropertyAreaInsights";
import { PropertySimilarListings } from "@/components/PropertySimilarListings";
import { PropertyLocationMap } from "@/components/PropertyLocationMap";
import { BookingCalendar } from "@/components/BookingCalendar";
import { ScoreRing } from "@/components/ScoreIndicator";
import { whatsappLink } from "@/lib/whatsapp";
import { colors } from "@/lib/colors";

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

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: property.title }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        <View className="relative">
          <PropertyImageGallery images={property.images} />
          <IconButton
            onPress={handleToggleSave}
            accessibilityLabel={t(saved ? "property.actions.saved" : "property.actions.save")}
            accessibilityState={{ selected: saved }}
            className="absolute end-4 top-4 border border-border bg-background/95"
          >
            <Heart size={18} color={saved ? colors.destructive : colors.foreground} fill={saved ? colors.destructive : "none"} />
          </IconButton>
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

          <View className="flex-row items-center gap-5 border-y border-border py-4">
            <View className="flex-row items-center gap-1.5">
              <BedDouble size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">{property.bedrooms} {t("property.summary.bedrooms")}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Bath size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">{property.bathrooms} {t("property.summary.bathrooms")}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Maximize size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">{property.area} m²</Text>
            </View>
          </View>

          <Pressable
            onPress={() => property.mediatorId && router.push(`/agent/${property.mediatorId}`)}
            disabled={!property.mediatorId}
            className="flex-row items-center justify-between rounded-xl border border-border p-4"
          >
            <View>
              <Text className="text-sm font-semibold text-foreground">{t("property.landlord.listedBy")}</Text>
              <Text className="mt-1 text-sm text-muted-foreground">{property.agent}</Text>
            </View>
            {property.mediatorId ? <ChevronRight size={18} color={colors.neutral400} /> : null}
          </Pressable>

          {!isSale && (
            <BookingCalendar propertyId={Number(property.id)} monthlyRent={Math.round(property.price / 12)} />
          )}

          <PropertyAreaInsights district={property.district} city={property.city} />

          <PropertyLocationMap
            latitude={property.latitude}
            longitude={property.longitude}
            district={property.district}
            city={property.city}
            title={property.title}
          />

          <PropertySimilarListings excludeId={property.id} district={property.district} city={property.city} />
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
    </View>
  );
}
