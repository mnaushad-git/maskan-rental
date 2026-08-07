import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Calendar as CalendarIcon, MapPin, ChevronLeft, ChevronRight, CalendarCheck } from "lucide-react-native";
import { fetchBookableProperties, mapApiProperty } from "@/lib/api/maskan";
import type { Property } from "@/lib/maskan-data";
import { districtsByCity } from "@/lib/maskan-search-data";
import { useFetch } from "@/lib/useFetch";
import { useLanguage } from "@/lib/i18n/context";
import { BookableListingCard } from "@/components/BookableListingCard";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SelectField, OptionModal } from "@/components/SelectField";
import { Button } from "@/components/ui/Button";
import { colors } from "@/lib/colors";

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function monthGrid(viewDate: Date): (Date | null)[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function DateRangeSheet({
  visible,
  onClose,
  checkIn,
  checkOut,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  checkIn: Date | null;
  checkOut: Date | null;
  onApply: (checkIn: Date, checkOut: Date) => void;
}) {
  const { t } = useLanguage();
  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [draftIn, setDraftIn] = useState<Date | null>(checkIn);
  const [draftOut, setDraftOut] = useState<Date | null>(checkOut);
  const cells = useMemo(() => monthGrid(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function handleDayPress(day: Date) {
    if (day < today) return;
    if (!draftIn || draftOut) {
      setDraftIn(day);
      setDraftOut(null);
      return;
    }
    if (day.getTime() === draftIn.getTime()) return;
    if (day > draftIn) setDraftOut(day);
    else {
      setDraftIn(day);
      setDraftOut(null);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-4 p-5">
        <Text className="text-lg font-bold text-foreground">{t("bookings.browse.datePicker.title")}</Text>
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} className="rounded-lg p-2">
            <ChevronLeft size={18} color={colors.foreground} />
          </Pressable>
          <Text className="text-sm font-semibold text-foreground">{monthLabel}</Text>
          <Pressable onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} className="rounded-lg p-2">
            <ChevronRight size={18} color={colors.foreground} />
          </Pressable>
        </View>
        <View className="flex-row">
          {WEEKDAY_LABELS.map((label, i) => (
            <View key={i} className="flex-1 items-center">
              <Text className="text-[11px] font-medium text-muted-foreground">{label}</Text>
            </View>
          ))}
        </View>
        <View className="flex-row flex-wrap">
          {cells.map((day, i) => {
            if (!day) return <View key={i} style={{ width: "14.2857%" }} className="aspect-square" />;
            const isPast = day < today;
            const isCheckIn = draftIn && day.getTime() === draftIn.getTime();
            const isCheckOut = draftOut && day.getTime() === draftOut.getTime();
            const isInRange = !!(draftIn && draftOut && day > draftIn && day < draftOut);
            const isEdge = !!(isCheckIn || isCheckOut);
            return (
              <View key={i} style={{ width: "14.2857%" }} className="aspect-square items-center justify-center p-0.5">
                <Pressable
                  onPress={() => handleDayPress(day)}
                  disabled={isPast}
                  className={`size-full items-center justify-center rounded-full ${isEdge ? "bg-primary" : isInRange ? "bg-primary/15" : ""}`}
                >
                  <Text className={`text-sm ${isPast ? "text-muted-foreground opacity-40" : isEdge ? "font-bold text-primary-foreground" : "text-foreground"}`}>
                    {day.getDate()}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Button disabled={!draftIn || !draftOut} onPress={() => draftIn && draftOut && onApply(draftIn, draftOut)}>
          {t("bookings.browse.datePicker.apply")}
        </Button>
      </View>
    </BottomSheet>
  );
}

export default function BookingsScreen() {
  const { t } = useLanguage();
  const router = useRouter();
  const today = startOfDay(new Date());
  const [checkIn, setCheckIn] = useState<Date | null>(today);
  const [checkOut, setCheckOut] = useState<Date | null>(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const [city, setCity] = useState("Any");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);

  const {
    data,
    loading,
    refreshing,
    error,
    refresh,
  } = useFetch<Property[]>(
    () =>
      fetchBookableProperties({
        checkIn: checkIn ? toISODate(checkIn) : undefined,
        checkOut: checkOut ? toISODate(checkOut) : undefined,
        city,
      }).then(({ data: raw }) => raw.map(mapApiProperty)),
    [checkIn, checkOut, city],
  );
  const listings = data ?? [];

  const dateLabel =
    checkIn && checkOut
      ? `${checkIn.toLocaleDateString(undefined, { day: "numeric", month: "short" })} - ${checkOut.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
      : t("bookings.browse.datePicker.title");

  const cityOptions = ["Any", ...Object.keys(districtsByCity)];

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 border-b border-border p-3">
        <Pressable
          onPress={() => setShowDatePicker(true)}
          className="flex-1 flex-row items-center gap-2 rounded-xl border border-border px-3 py-2.5"
        >
          <CalendarIcon size={16} color={colors.mutedForeground} />
          <Text numberOfLines={1} className="flex-1 text-sm font-medium text-foreground">
            {dateLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setShowCityPicker(true)}
          className="flex-1 flex-row items-center gap-2 rounded-xl border border-border px-3 py-2.5"
        >
          <MapPin size={16} color={colors.mutedForeground} />
          <Text numberOfLines={1} className="flex-1 text-sm font-medium text-foreground">
            {city === "Any" ? t("bookings.browse.city") : city}
          </Text>
        </Pressable>
      </View>

      <Pressable onPress={() => router.push("/my-bookings")} className="flex-row items-center gap-2 border-b border-border px-4 py-3">
        <CalendarCheck size={16} color={colors.primary} />
        <Text className="text-sm font-semibold text-primary">{t("bookings.browse.myBookingsLink")}</Text>
      </Pressable>

      {loading ? (
        <View className="flex-1 gap-4 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} className="gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4">
              <Skeleton height={160} radius={16} />
              <Skeleton width="60%" height={16} />
              <Skeleton width="40%" height={12} />
            </View>
          ))}
        </View>
      ) : error && listings.length === 0 ? (
        <ErrorState onRetry={refresh} />
      ) : listings.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <CalendarCheck size={40} color={colors.neutral400} />
          <Text className="text-center text-lg font-semibold text-foreground">{t("bookings.browse.empty.heading")}</Text>
          <Text className="text-center text-sm text-muted-foreground">{t("bookings.browse.empty.desc")}</Text>
        </View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(p) => p.id}
          contentContainerClassName="gap-4 p-4"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <Text className="mb-1 text-sm font-semibold text-muted-foreground">
              {t(listings.length === 1 ? "bookings.browse.countSingular" : "bookings.browse.countPlural", { count: listings.length })}
            </Text>
          }
          renderItem={({ item }) => <BookableListingCard p={item} />}
        />
      )}

      <DateRangeSheet
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        checkIn={checkIn}
        checkOut={checkOut}
        onApply={(inDate, outDate) => {
          setCheckIn(inDate);
          setCheckOut(outDate);
          setShowDatePicker(false);
        }}
      />

      <OptionModal
        visible={showCityPicker}
        onClose={() => setShowCityPicker(false)}
        options={cityOptions.map((c) => ({ key: c, label: c === "Any" ? t("bookings.browse.anyCity") : c }))}
        onSelect={(key) => setCity(key)}
      />
    </SafeAreaView>
  );
}
