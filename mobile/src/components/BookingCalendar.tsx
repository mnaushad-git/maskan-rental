import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Calendar as CalendarIcon, Sparkles, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import { formatSAR } from "@/lib/maskan-data";
import { fetchAvailability, fetchBookingInsights, createBooking, type ApiAvailabilityInsight } from "@/lib/api/maskan";
import { Button } from "@/components/ui/Button";

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

// Bookable listings (Property.is_bookable) carry a real nightly_rate — use
// it when present. Older/regular rent listings have no nightly rate in the
// data model, so the nightly rate shown for them is an indicative estimate
// derived from monthly_rent, using the same short-term premium heuristic as
// the AI pricing suggestion shown to landlords on the web partner dashboard
// (see backend/app/api/routes/ai.py's pricing-suggestion endpoint).
export function BookingCalendar({
  propertyId,
  monthlyRent,
  nightlyRate: fixedNightlyRate,
}: {
  propertyId: number;
  monthlyRent: number | null;
  nightlyRate?: number | null;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();

  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [insight, setInsight] = useState<ApiAvailabilityInsight | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBookingInsights(propertyId)
      .then((data) => {
        if (!cancelled) setInsight(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  useEffect(() => {
    setAvailability(null);
    setError(null);
  }, [checkIn, checkOut]);

  const nightlyRate = fixedNightlyRate ?? Math.max(50, Math.round(((monthlyRent ?? 9000) / 30) * 1.6));
  const nights = checkIn && checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000) : 0;
  const totalPrice = nights > 0 ? nights * nightlyRate : 0;

  function handleDayPress(day: Date) {
    if (day < today) return;
    if (!checkIn || checkOut) {
      setCheckIn(day);
      setCheckOut(null);
      return;
    }
    if (day.getTime() === checkIn.getTime()) return;
    if (day > checkIn) {
      setCheckOut(day);
    } else {
      setCheckIn(day);
      setCheckOut(null);
    }
  }

  async function handleCheck() {
    if (!checkIn || !checkOut) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetchAvailability(propertyId, toISODate(checkIn), toISODate(checkOut));
      setAvailability(res.available);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("property.booking.checkFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function handleBook() {
    if (!checkIn || !checkOut) return;
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setBooking(true);
    setError(null);
    try {
      await createBooking({
        property_id: propertyId,
        check_in: toISODate(checkIn),
        check_out: toISODate(checkOut),
        total_price: totalPrice,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("property.booking.bookFailed"));
      setAvailability(false);
    } finally {
      setBooking(false);
    }
  }

  const cells = useMemo(() => monthGrid(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  if (success && checkIn && checkOut) {
    return (
      <View className="gap-2 rounded-2xl border border-success/30 bg-success/10 p-4">
        <View className="flex-row items-center gap-2">
          <CheckCircle2 size={20} color={colors.success} />
          <Text className="text-base font-bold text-foreground">{t("property.booking.confirmedTitle")}</Text>
        </View>
        <Text className="text-sm text-muted-foreground">
          {t("property.booking.confirmedDesc", {
            checkIn: checkIn.toLocaleDateString(),
            checkOut: checkOut.toLocaleDateString(),
          })}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold text-foreground">{t("property.booking.title")}</Text>
        <View className="flex-row items-center gap-1 rounded-full bg-surface px-2.5 py-1">
          <CalendarIcon size={12} color={colors.mutedForeground} />
          <Text className="text-xs font-semibold text-muted-foreground">
            SAR {formatSAR(nightlyRate)} {t("property.booking.perNight")}
          </Text>
        </View>
      </View>
      <Text className="text-sm text-muted-foreground">{t("property.booking.subtitle")}</Text>

      {insight && (
        <View className="flex-row items-start gap-1.5">
          <Sparkles size={14} color={colors.ai} />
          <Text className="flex-1 text-xs text-muted-foreground">{insight.note}</Text>
        </View>
      )}

      {/* Month navigation */}
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          className="rounded-lg p-2"
          accessibilityLabel="Previous month"
        >
          <ChevronLeft size={18} color={colors.foreground} />
        </Pressable>
        <Text className="text-sm font-semibold text-foreground">{monthLabel}</Text>
        <Pressable
          onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
          className="rounded-lg p-2"
          accessibilityLabel="Next month"
        >
          <ChevronRight size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {/* Weekday header */}
      <View className="flex-row">
        {WEEKDAY_LABELS.map((label, i) => (
          <View key={i} className="flex-1 items-center">
            <Text className="text-[11px] font-medium text-muted-foreground">{label}</Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      <View className="flex-row flex-wrap">
        {cells.map((day, i) => {
          if (!day) {
            return <View key={i} style={{ width: "14.2857%" }} className="aspect-square" />;
          }
          const isPast = day < today;
          const isCheckIn = checkIn && day.getTime() === checkIn.getTime();
          const isCheckOut = checkOut && day.getTime() === checkOut.getTime();
          const isInRange = !!(checkIn && checkOut && day > checkIn && day < checkOut);
          const isEdge = !!(isCheckIn || isCheckOut);
          return (
            <View key={i} style={{ width: "14.2857%" }} className="aspect-square items-center justify-center p-0.5">
              <Pressable
                onPress={() => handleDayPress(day)}
                disabled={isPast}
                className={`size-full items-center justify-center rounded-full ${
                  isEdge ? "bg-primary" : isInRange ? "bg-primary/15" : ""
                }`}
              >
                <Text
                  className={`text-sm ${
                    isPast
                      ? "text-muted-foreground opacity-40"
                      : isEdge
                        ? "font-bold text-primary-foreground"
                        : "text-foreground"
                  }`}
                >
                  {day.getDate()}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {nights > 0 && (
        <View className="flex-row items-center justify-between rounded-xl bg-surface p-3">
          <Text className="text-sm text-muted-foreground">{t("property.booking.nightsTotal", { nights })}</Text>
          <Text className="text-base font-bold text-foreground">SAR {formatSAR(totalPrice)}</Text>
        </View>
      )}

      <Button variant="outline" disabled={!checkIn || !checkOut || checking} loading={checking} onPress={() => void handleCheck()}>
        {t("property.booking.checkAvailability")}
      </Button>

      {availability === true && (
        <View className="flex-row items-center gap-1.5">
          <CheckCircle2 size={16} color={colors.success} />
          <Text className="text-sm font-semibold text-success">{t("property.booking.available")}</Text>
        </View>
      )}
      {availability === false && !error && (
        <Text className="text-sm font-semibold text-destructive">{t("property.booking.unavailable")}</Text>
      )}
      {error && <Text className="text-sm text-destructive">{error}</Text>}

      <Button variant="primary" disabled={availability !== true || booking} loading={booking} onPress={() => void handleBook()}>
        {!user ? t("property.booking.signInToBook") : t("property.booking.bookNow")}
      </Button>
    </View>
  );
}
