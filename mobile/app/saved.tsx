import { useCallback, useState } from "react";
import { View, Text, FlatList, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Heart } from "lucide-react-native";
import { fetchSavedProperties, mapApiSearchProperty, type ApiSavedProperty } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { PropertyCard } from "@/components/PropertyCard";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PropertyCardSkeleton } from "@/components/ui/Skeleton";
import { toCardProperty, type Property } from "@/lib/maskan-data";
import { colors } from "@/lib/colors";

function toUiProperty(saved: ApiSavedProperty): Property {
  return toCardProperty(mapApiSearchProperty(saved.property));
}

export default function SavedScreen() {
  const { t } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const [saved, setSaved] = useState<ApiSavedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!user) {
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);
      fetchSavedProperties(user.id)
        .then(setSaved)
        .catch(() => setError(true))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [user],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Stack.Screen options={{ title: t("saved.heading") }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("saved.heading") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("myLeads.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error && saved.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("saved.heading") }} />
        <ErrorState onRetry={() => load(false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("saved.heading") }} />
      <FlatList
        data={saved}
        keyExtractor={(s) => String(s.id)}
        contentContainerClassName="gap-4 p-4"
        renderItem={({ item }) => (
          <PropertyCard
            p={toUiProperty(item)}
            initialSavedId={item.id}
            onUnsaved={() => setSaved((prev) => prev.filter((s) => s.id !== item.id))}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
        ListEmptyComponent={
          <EmptyState
            icon={<Heart size={32} color={colors.mutedForeground} />}
            title={t("saved.empty.heading")}
            description={t("saved.empty.desc")}
            actionLabel={t("saved.empty.browseProperties")}
            onAction={() => router.push("/search")}
          />
        }
      />
    </SafeAreaView>
  );
}
