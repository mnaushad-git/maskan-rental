import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { CalendarCheck, MapPin } from "lucide-react-native";
import { fetchMyBookings, cancelBooking, type ApiBooking } from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/Badges";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { colors } from "@/lib/colors";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function BookingCard({ booking, onCancelled }: { booking: ApiBooking; onCancelled: (id: number) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const isUpcoming = booking.status === "confirmed" && new Date(booking.check_in) >= new Date(new Date().toDateString());

  async function handleCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await cancelBooking(booking.id);
      onCancelled(booking.id);
      toast(t("myBookings.cancelSuccess"), "success");
    } catch {
      toast(t("myBookings.cancelFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={() => router.push(`/property/${booking.property_id}`)}
      className="gap-3 rounded-2xl border border-border bg-background p-4 shadow-card"
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text numberOfLines={1} className="text-base font-bold text-foreground">
            {booking.property_title ?? t("myBookings.untitledProperty")}
          </Text>
          <View className="flex-row items-center gap-1">
            <MapPin size={12} color={colors.mutedForeground} />
            <Text className="text-xs text-muted-foreground">
              {formatDate(booking.check_in)} – {formatDate(booking.check_out)}
            </Text>
          </View>
        </View>
        <Badge tone={booking.status === "confirmed" ? "success" : "neutral"}>
          {t(`myBookings.status.${booking.status}`)}
        </Badge>
      </View>

      <View className="flex-row items-center justify-between border-t border-border pt-3">
        <Text className="text-sm font-semibold text-foreground">{formatSAR(booking.total_price)}</Text>
        {isUpcoming && (
          <Button size="sm" variant="outline" loading={busy} onPress={handleCancel}>
            {t("myBookings.cancel")}
          </Button>
        )}
      </View>
    </Pressable>
  );
}

export default function MyBookingsScreen() {
  const { t } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
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
      fetchMyBookings()
        .then(setBookings)
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]),
  );

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("nav.bookings") }} />
      {authLoading || loading ? (
        <View className="flex-1 gap-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} className="gap-2.5 rounded-2xl border border-border bg-card p-4">
              <Skeleton width="60%" height={16} />
              <Skeleton width="40%" height={12} />
              <Skeleton width={90} height={22} radius={11} />
            </View>
          ))}
        </View>
      ) : !user ? (
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <Text className="text-center text-base text-muted-foreground">{t("myBookings.signInToView")}</Text>
          <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
        </View>
      ) : error && bookings.length === 0 ? (
        <ErrorState onRetry={() => load(false)} />
      ) : bookings.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <CalendarCheck size={40} color={colors.neutral400} />
          <Text className="text-center text-lg font-semibold text-foreground">{t("myBookings.empty.heading")}</Text>
          <Text className="text-center text-sm text-muted-foreground">{t("myBookings.empty.desc")}</Text>
          <Button className="mt-2" onPress={() => router.back()}>
            {t("myBookings.empty.browseProperties")}
          </Button>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(b) => String(b.id)}
          contentContainerClassName="gap-3 p-4"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              onCancelled={(id) => setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)))}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
