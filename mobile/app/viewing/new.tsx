import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { CheckCircle2, Sparkles } from "lucide-react-native";
import { fetchProperty, mapApiProperty, createViewing, type ApiPropertyViewing } from "@/lib/api/maskan";
import { formatSAR, type Property } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Skeleton";
import { colors } from "@/lib/colors";

// Business hours are fixed client-side (09:00-21:00 Riyadh time, 30-min
// slots) — mirrors the web app's ScheduleViewingModal exactly (no real
// mediator-availability data source yet, brief §4). Every slot is labeled
// "Request a preferred time", never "Available Slot".
const BUSINESS_HOURS_START = "09:00";
const BUSINESS_HOURS_END = "21:00";
const SLOT_MINUTES = 30;
const RIYADH_UTC_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh has no DST — fixed UTC+3
const DAYS_AHEAD = 14;

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function riyadhNowMinutesOfDay(): { y: number; m: number; d: number; minutes: number } {
  const riyadh = new Date(Date.now() + RIYADH_UTC_OFFSET_MS);
  return { y: riyadh.getUTCFullYear(), m: riyadh.getUTCMonth(), d: riyadh.getUTCDate(), minutes: riyadh.getUTCHours() * 60 + riyadh.getUTCMinutes() };
}
function buildSlots(date: Date): string[] {
  const start = hhmmToMinutes(BUSINESS_HOURS_START);
  const end = hhmmToMinutes(BUSINESS_HOURS_END);
  const slots: string[] = [];
  for (let t = start; t + SLOT_MINUTES <= end; t += SLOT_MINUTES) slots.push(minutesToHHMM(t));
  const now = riyadhNowMinutesOfDay();
  const isToday = date.getFullYear() === now.y && date.getMonth() === now.m && date.getDate() === now.d;
  if (!isToday) return slots;
  return slots.filter((slot) => hhmmToMinutes(slot) > now.minutes);
}
function toRiyadhISOString(date: Date, hhmm: string): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}T${hhmm}:00+03:00`;
}
function nextNDays(n: number): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
}
function formatDayLabel(d: Date, lang: string): string {
  return d.toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "short", month: "short", day: "numeric" });
}

type Step = "date" | "time" | "note" | "review";
const STEPS: Step[] = ["date", "time", "note", "review"];

export default function ScheduleViewingScreen() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiPropertyViewing | null>(null);

  useEffect(() => {
    if (!propertyId || Number.isNaN(Number(propertyId))) return;
    fetchProperty(Number(propertyId))
      .then((raw) => setProperty(mapApiProperty(raw)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [propertyId]);

  const days = useMemo(() => nextNDays(DAYS_AHEAD), []);
  const slots = useMemo(() => (date ? buildSlots(date) : []), [date]);
  const step = STEPS[stepIndex];

  async function handleSubmit() {
    if (!property || !date || !time) return;
    setSubmitting(true);
    setError(null);
    try {
      const requested_start_at = toRiyadhISOString(date, time);
      const requested_end_at = toRiyadhISOString(date, minutesToHHMM(hhmmToMinutes(time) + SLOT_MINUTES));
      const viewing = await createViewing({
        property_id: Number(property.id),
        requested_start_at,
        requested_end_at,
        timezone: "Asia/Riyadh",
        customer_note: note.trim() || undefined,
      });
      setResult(viewing);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("property.viewing.modal.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !property) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background p-5">
        <Stack.Screen options={{ title: t("property.viewing.modal.title") }} />
        <Skeleton height={200} radius={16} />
      </SafeAreaView>
    );
  }

  if (result) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Stack.Screen options={{ title: t("property.viewing.modal.title") }} />
        <CheckCircle2 size={40} color={colors.success} />
        <Text className="text-center text-lg font-bold text-foreground">{t("property.viewing.banner.requestedTitle")}</Text>
        <Text className="text-center text-sm text-muted-foreground">{t("property.viewing.banner.requestedSubtitle")}</Text>
        <Button className="mt-3" onPress={() => router.replace(`/property/${property.id}`)}>
          {t("property.viewing.modal.done")}
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("property.viewing.modal.title") }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {step === "date" && (
          <View className="gap-3">
            <Text className="text-sm font-semibold text-foreground">{t("property.viewing.modal.stepDate")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {days.map((d) => (
                <Chip
                  key={d.toISOString()}
                  selected={!!date && d.getTime() === date.getTime()}
                  onPress={() => {
                    setDate(d);
                    setTime(null);
                  }}
                >
                  {formatDayLabel(d, lang)}
                </Chip>
              ))}
            </View>
          </View>
        )}

        {step === "time" && (
          <View className="gap-3">
            <Text className="text-sm font-semibold text-foreground">{t("property.viewing.modal.stepTime")}</Text>
            <View className="flex-row items-center gap-1.5">
              <Sparkles size={14} color={colors.ai} />
              <Text className="flex-1 text-xs text-muted-foreground">{t("property.viewing.modal.preferredTimeHint")}</Text>
            </View>
            {slots.length === 0 ? (
              <Text className="text-sm text-muted-foreground">{t("property.viewing.modal.noSlotsToday")}</Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {slots.map((slot) => (
                  <Chip key={slot} selected={time === slot} onPress={() => setTime(slot)}>
                    {slot}
                  </Chip>
                ))}
              </View>
            )}
          </View>
        )}

        {step === "note" && (
          <View className="gap-3">
            <Text className="text-sm font-semibold text-foreground">{t("property.viewing.modal.stepNote")}</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t("property.viewing.modal.notePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
              className="rounded-xl border border-border bg-background p-3 text-sm text-foreground"
              style={{ textAlignVertical: "top", minHeight: 100 }}
            />
          </View>
        )}

        {step === "review" && date && time && (
          <View className="gap-3">
            <Text className="text-sm font-semibold text-foreground">{t("property.viewing.modal.stepReview")}</Text>
            <View className="rounded-xl bg-surface p-3">
              <Text className="font-semibold text-foreground">{property.title}</Text>
              <Text className="text-xs text-muted-foreground">{property.district}, {property.city}</Text>
            </View>
            <ReviewRow label={t("property.viewing.modal.reviewMediator")} value={property.agent} />
            <ReviewRow label={t("property.viewing.modal.reviewDateTime")} value={`${formatDayLabel(date, lang)}, ${time} (${t("property.viewing.modal.timezone")})`} />
            <View>
              <Text className="mb-1 text-xs text-muted-foreground">{t("property.viewing.modal.reviewNote")}</Text>
              <Text className="text-sm text-foreground">{note.trim() || t("property.viewing.modal.noNote")}</Text>
            </View>
          </View>
        )}

        {error && <Text className="text-sm text-destructive">{error}</Text>}

        <View className="mt-2 flex-row gap-3">
          {stepIndex > 0 && (
            <Button variant="outline" className="flex-1" onPress={() => setStepIndex((i) => i - 1)} disabled={submitting}>
              {t("property.viewing.modal.back")}
            </Button>
          )}
          {step !== "review" ? (
            <Button
              className="flex-1"
              onPress={() => setStepIndex((i) => i + 1)}
              disabled={(step === "date" && !date) || (step === "time" && !time)}
            >
              {t("property.viewing.modal.next")}
            </Button>
          ) : (
            <Button className="flex-1" onPress={() => void handleSubmit()} loading={submitting}>
              {t("property.viewing.modal.submit")}
            </Button>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-end text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}
