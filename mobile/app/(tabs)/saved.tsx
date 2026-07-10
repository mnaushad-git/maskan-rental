import { useCallback, useState } from "react";
import { View, Text, FlatList, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { fetchSavedProperties, mapApiSearchProperty, type ApiSavedProperty } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { PropertyCard } from "@/components/PropertyCard";
import type { Property } from "@/lib/maskan-data";

function toUiProperty(saved: ApiSavedProperty): Property {
  const p = mapApiSearchProperty(saved.property);
  return {
    id: p.id,
    title: p.title,
    district: p.district,
    city: p.city,
    price: p.price,
    listingType: p.listingType,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    area: p.area,
    type: p.type,
    image: p.image,
    images: [p.image],
    matchScore: p.matchScore,
    badges: ["Verified"],
    status: "Available",
    pricePerSqm: p.area > 0 ? Math.round(p.price / p.area) : 0,
    agent: "Maskan Agent",
    agentPhone: p.agentPhone,
    agentProfileImage: null,
    mediatorId: null,
  };
}

export default function SavedScreen() {
  const { t } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const [saved, setSaved] = useState<ApiSavedProperty[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      fetchSavedProperties(user.id)
        .then(setSaved)
        .catch(() => setSaved([]))
        .finally(() => setLoading(false));
    }, [user]),
  );

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#16A34A" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-base font-semibold text-foreground">{t("myLeads.signInToView")}</Text>
        <Pressable onPress={() => router.push("/auth/login")} className="rounded-lg bg-primary px-5 py-2.5">
          <Text className="text-sm font-semibold text-primary-foreground">{t("myLeads.signIn")}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <FlatList
        data={saved}
        keyExtractor={(s) => String(s.id)}
        contentContainerClassName="gap-4 p-4"
        renderItem={({ item }) => <PropertyCard p={toUiProperty(item)} />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-sm text-muted-foreground">{t("saved.empty.heading")}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
