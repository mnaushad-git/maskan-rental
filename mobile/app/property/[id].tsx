import { useEffect, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator, Pressable, Linking, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { BedDouble, Bath, Maximize, MapPin, Phone, MessageCircle, Heart, FileText } from "lucide-react-native";
import { fetchProperty, mapApiProperty, saveProperty } from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import type { Property } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";

const { width } = Dimensions.get("window");

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id || Number.isNaN(Number(id))) {
      setError(true);
      setLoading(false);
      return;
    }
    fetchProperty(Number(id))
      .then((raw) => setProperty(mapApiProperty(raw)))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    if (saved || !property) return;
    try {
      await saveProperty(user.id, Number(property.id));
      setSaved(true);
    } catch {
      // ignore duplicate-save errors
    }
  }

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#16A34A" />
      </SafeAreaView>
    );
  }

  if (error || !property) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-sm text-muted-foreground">{t("property.unableToLoad")}</Text>
      </SafeAreaView>
    );
  }

  const isSale = property.listingType === "sale";
  const waLink = property.agentPhone
    ? `https://wa.me/${property.agentPhone.replace(/\D/g, "").replace(/^0/, "966")}`
    : undefined;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: property.title }} />
      <ScrollView>
        <Image source={{ uri: property.image }} style={{ width, height: width * 0.7 }} resizeMode="cover" />

        <View className="gap-4 p-5">
          <View>
            <Text className="font-bold text-xl text-foreground">{property.title}</Text>
            <View className="mt-1 flex-row items-center gap-1">
              <MapPin size={14} color="#64748B" />
              <Text className="text-sm text-muted-foreground">
                {property.district}, {property.city}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-5 border-y border-border py-4">
            <View className="flex-row items-center gap-1.5">
              <BedDouble size={18} color="#0F172A" />
              <Text className="text-sm text-foreground">{property.bedrooms} {t("property.summary.bedrooms")}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Bath size={18} color="#0F172A" />
              <Text className="text-sm text-foreground">{property.bathrooms} {t("property.summary.bathrooms")}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Maximize size={18} color="#0F172A" />
              <Text className="text-sm text-foreground">{property.area} m²</Text>
            </View>
          </View>

          <View className="flex-row items-end justify-between">
            <View>
              <Text className="text-xs text-muted-foreground">
                {isSale ? t("propertyCard.salePrice") : t("propertyCard.annualRent")}
              </Text>
              <Text className="font-bold text-2xl text-foreground">
                SAR {formatSAR(property.price)}
                {!isSale && <Text className="text-sm font-medium text-muted-foreground"> {t("propertyCard.perYear")}</Text>}
              </Text>
            </View>
            <Pressable
              onPress={handleSave}
              className="size-11 items-center justify-center rounded-full border border-border"
            >
              <Heart size={18} color={saved ? "#DC2626" : "#0F172A"} fill={saved ? "#DC2626" : "none"} />
            </Pressable>
          </View>

          <View className="flex-row gap-2">
            {property.agentPhone && (
              <Pressable
                onPress={() => Linking.openURL(`tel:${property.agentPhone}`)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-border py-3"
              >
                <Phone size={16} color="#0F172A" />
                <Text className="text-sm font-medium text-foreground">{t("propertyCard.call")}</Text>
              </Pressable>
            )}
            {waLink && (
              <Pressable
                onPress={() => Linking.openURL(waLink)}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-3"
                style={{ borderColor: "#25D366", backgroundColor: "rgba(37,211,102,0.1)" }}
              >
                <MessageCircle size={16} color="#128C7E" />
                <Text className="text-sm font-medium" style={{ color: "#128C7E" }}>
                  {t("propertyCard.whatsapp")}
                </Text>
              </Pressable>
            )}
          </View>

          <View className="rounded-xl border border-border p-4">
            <Text className="text-sm font-semibold text-foreground">{t("property.landlord.listedBy")}</Text>
            <Text className="mt-1 text-sm text-muted-foreground">{property.agent}</Text>
          </View>

          <Pressable
            onPress={() => router.push("/lead/new")}
            className="flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3.5"
          >
            <FileText size={16} color="#FFFFFF" />
            <Text className="text-sm font-semibold text-primary-foreground">{t("property.actions.submitLeadRequest")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
