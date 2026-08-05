import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, Switch, Text, View, Modal, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { Clock, Moon, RotateCcw, Send, X } from "lucide-react-native";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  resetNotificationPreferencesDefaults,
  sendTestPushNotification,
  fetchDevices,
  type ApiNotificationPreferences,
  type ApiNotificationPreferencesUpdate,
  type CategoryPreference,
  type NotificationCategory,
  type NotificationChannelPref,
  type NotificationFrequency,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage, type Language } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SelectField, OptionModal } from "@/components/SelectField";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { registerForPushNotificationsAsync } from "@/lib/push";
import { colors } from "@/lib/colors";

type T = (key: string, vars?: Record<string, string | number>) => string;

const CATEGORIES: NotificationCategory[] = [
  "property_alerts",
  "price_changes",
  "saved_search_digest",
  "lead_updates",
  "lead_messages",
  "review_updates",
  "subscription_payments",
  "ai_recommendations",
  "product_announcements",
  "security",
];

const CHANNELS: NotificationChannelPref[] = ["in_app", "push", "email"];
const FREQUENCIES: NotificationFrequency[] = ["instant", "daily", "weekly", "off"];
const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatHour12(hour: number, t: T): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? t("notificationSettings.am") : t("notificationSettings.pm");
  return `${h12}:00 ${period}`;
}

function formatHHMM(value: string, t: T): string {
  const [hStr, mStr] = value.split(":");
  const hour = Number(hStr);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? t("notificationSettings.am") : t("notificationSettings.pm");
  return `${h12}:${mStr} ${period}`;
}

const QUIET_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? 0 : 30;
  return `${pad(h)}:${pad(m)}`;
});

function formatNextDigest(iso: string | null, lang: Language, t: T): string {
  if (!iso) return t("notificationSettings.digest.noneScheduled");
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ToggleRow({
  label,
  desc,
  value,
  onValueChange,
  disabled,
  topBorder = true,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  topBorder?: boolean;
}) {
  return (
    <View className={`flex-row items-center gap-3 px-4 py-3.5 ${topBorder ? "border-t border-border" : ""}`}>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        {desc ? <Text className="text-xs text-muted-foreground">{desc}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

function categorySummary(pref: CategoryPreference, t: T): string {
  if (pref.frequency === "off") return t("notificationSettings.categories.frequency.off");
  const channelLabels = pref.channels.map((c) => t(`notificationSettings.categories.channel.${c}`));
  const freqLabel = t(`notificationSettings.categories.frequency.${pref.frequency}`);
  return channelLabels.length ? `${channelLabels.join(", ")} · ${freqLabel}` : freqLabel;
}

function CategoryEditModal({
  category,
  pref,
  onClose,
  onSave,
}: {
  category: NotificationCategory | null;
  pref: CategoryPreference | null;
  onClose: () => void;
  onSave: (category: NotificationCategory, next: CategoryPreference) => void;
}) {
  const { t } = useLanguage();
  const [channels, setChannels] = useState<NotificationChannelPref[]>(pref?.channels ?? []);
  const [frequency, setFrequency] = useState<NotificationFrequency>(pref?.frequency ?? "instant");

  useEffect(() => {
    if (category && pref) {
      setChannels(pref.channels);
      setFrequency(pref.frequency);
    }
  }, [category, pref]);

  if (!category || !pref) return null;
  const isSecurity = category === "security";

  function toggleChannel(c: NotificationChannelPref) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} className="gap-5 rounded-t-2xl bg-background p-5 pb-8">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-bold text-foreground">{t(`notificationSettings.categories.label.${category}`)}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t("common.close")}>
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text className="-mt-3 text-xs text-muted-foreground">{t(`notificationSettings.categories.desc.${category}`)}</Text>

          <View className="gap-1.5">
            <Text className="text-xs font-medium text-muted-foreground">{t("notificationSettings.categories.channelsLabel")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <Chip key={c} selected={channels.includes(c)} onPress={() => toggleChannel(c)}>
                  {t(`notificationSettings.categories.channel.${c}`)}
                </Chip>
              ))}
            </View>
          </View>

          <View className="gap-1.5">
            <Text className="text-xs font-medium text-muted-foreground">{t("notificationSettings.categories.frequencyLabel")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {FREQUENCIES.map((f) => {
                const disabled = isSecurity && f === "off";
                if (disabled) return null;
                return (
                  <Chip key={f} selected={frequency === f} onPress={() => setFrequency(f)}>
                    {t(`notificationSettings.categories.frequency.${f}`)}
                  </Chip>
                );
              })}
            </View>
            {isSecurity && (
              <Text className="pt-1 text-[11px] text-muted-foreground">{t("notificationSettings.categories.securityOffDisabled")}</Text>
            )}
          </View>

          <Button onPress={() => onSave(category, { channels, frequency })} fullWidth>
            {t("notificationSettings.categories.done")}
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function NotificationSettingsScreen() {
  const { t, lang } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [prefs, setPrefs] = useState<ApiNotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasDevice, setHasDevice] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [editingCategory, setEditingCategory] = useState<NotificationCategory | null>(null);
  const [hourPickerOpen, setHourPickerOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [quietStartOpen, setQuietStartOpen] = useState(false);
  const [quietEndOpen, setQuietEndOpen] = useState(false);

  const load = useCallback(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    Promise.all([fetchNotificationPreferences(), fetchDevices().catch(() => [])])
      .then(([p, devices]) => {
        setPrefs(p);
        setHasDevice(devices.length > 0);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(payload: ApiNotificationPreferencesUpdate) {
    if (!prefs) return;
    try {
      const next = await updateNotificationPreferences(payload);
      setPrefs(next);
      if (payload.push_enabled) fetchDevices().then((d) => setHasDevice(d.length > 0)).catch(() => {});
    } catch (err) {
      toast(err instanceof Error ? err.message : t("common.loadFailed"), "error");
    }
  }

  // Flipping this on is meaningless without OS-level permission — if it's
  // already permanently denied, send the user to system settings instead
  // of silently PATCHing a preference that can never actually deliver a
  // push; if it's undetermined, this is a deliberate settings-screen action
  // (not an unsolicited launch prompt) so asking here is appropriate.
  async function handlePushToggle(v: boolean) {
    if (!v) {
      patch({ push_enabled: false });
      return;
    }
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === "granted") {
      patch({ push_enabled: true });
      return;
    }
    if (!canAskAgain) {
      Linking.openSettings();
      return;
    }
    const token = await registerForPushNotificationsAsync(lang);
    if (token) {
      patch({ push_enabled: true });
      setHasDevice(true);
    }
  }

  function handleSaveCategory(category: NotificationCategory, next: CategoryPreference) {
    setEditingCategory(null);
    patch({ category_preferences: { [category]: next } });
  }

  async function handleTestPush() {
    setTestingPush(true);
    try {
      const res = await sendTestPushNotification();
      toast(t("notificationSettings.testPush.success", { count: res.sent }), res.sent > 0 ? "success" : "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : t("notificationSettings.testPush.error"), "error");
    } finally {
      setTestingPush(false);
    }
  }

  function handleReset() {
    Alert.alert(t("notificationSettings.reset.confirmTitle"), t("notificationSettings.reset.confirmDesc"), [
      { text: t("notificationSettings.reset.cancel"), style: "cancel" },
      {
        text: t("notificationSettings.reset.confirm"),
        style: "destructive",
        onPress: async () => {
          setResetting(true);
          try {
            const next = await resetNotificationPreferencesDefaults();
            setPrefs(next);
            toast(t("notificationSettings.reset.success"), "success");
          } catch {
            toast(t("common.loadFailed"), "error");
          } finally {
            setResetting(false);
          }
        },
      },
    ]);
  }

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Stack.Screen options={{ title: t("notificationSettings.heading") }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={64} radius={16} />
        ))}
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("notificationSettings.heading") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("myLeads.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error || !prefs) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("notificationSettings.heading") }} />
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  const editingPref = editingCategory ? prefs.category_preferences[editingCategory] : null;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("notificationSettings.heading") }} />
      <ScrollView contentContainerClassName="gap-6 p-4 pb-10">
        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("notificationSettings.general")}</Text>
          <View className="rounded-xl border border-border">
            <ToggleRow
              label={t("notificationSettings.pushLabel")}
              desc={t("notificationSettings.pushDesc")}
              value={prefs.push_enabled}
              onValueChange={handlePushToggle}
              topBorder={false}
            />
            <ToggleRow
              label={t("notificationSettings.inAppLabel")}
              desc={t("notificationSettings.inAppDesc")}
              value={prefs.in_app_enabled}
              onValueChange={(v) => patch({ in_app_enabled: v })}
            />
            <ToggleRow
              label={t("notificationSettings.emailLabel")}
              desc={t("notificationSettings.emailDesc")}
              value={prefs.email_enabled}
              onValueChange={(v) => patch({ email_enabled: v })}
            />
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("notificationSettings.categoriesHeading")}</Text>
          <View className="rounded-xl border border-border">
            {CATEGORIES.map((cat, i) => {
              const pref = prefs.category_preferences[cat];
              return (
                <Pressable
                  key={cat}
                  onPress={() => setEditingCategory(cat)}
                  className={`flex-row items-center justify-between gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}
                >
                  <View className="flex-1 gap-0.5">
                    <Text className="text-sm font-medium text-foreground">{t(`notificationSettings.categories.label.${cat}`)}</Text>
                    <Text className="text-xs text-muted-foreground">{pref ? categorySummary(pref, t) : ""}</Text>
                  </View>
                  <Text className="text-xs font-semibold text-primary">{t("notificationSettings.categories.edit")}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("notificationSettings.digest.heading")}</Text>
          <View className="rounded-xl border border-border">
            <SelectField
              label={t("notificationSettings.digest.dailyHourLabel")}
              value={formatHour12(prefs.digest_hour, t)}
              onPress={() => setHourPickerOpen(true)}
              icon={<Clock size={18} color={colors.mutedForeground} />}
            />
            <View className="border-t border-border">
              <SelectField
                label={t("notificationSettings.digest.weeklyDayLabel")}
                value={t(`notificationSettings.weekdays.${WEEKDAY_KEYS[prefs.weekly_digest_day]}`)}
                onPress={() => setDayPickerOpen(true)}
              />
            </View>
          </View>
          <Text className="px-1 text-[11px] text-muted-foreground">
            {t("notificationSettings.digest.nextDaily", { time: formatNextDigest(prefs.next_daily_digest_at, lang, t) })}
          </Text>
          <Text className="px-1 text-[11px] text-muted-foreground">
            {t("notificationSettings.digest.nextWeekly", { time: formatNextDigest(prefs.next_weekly_digest_at, lang, t) })}
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("notificationSettings.quietHours.heading")}</Text>
          <View className="rounded-xl border border-border">
            <ToggleRow
              label={t("notificationSettings.quietHours.enabledLabel")}
              desc={t("notificationSettings.quietHours.enabledDesc")}
              value={prefs.quiet_hours_enabled}
              onValueChange={(v) => patch({ quiet_hours_enabled: v })}
              topBorder={false}
            />
            <View className="border-t border-border">
              <SelectField
                label={t("notificationSettings.quietHours.startLabel")}
                value={formatHHMM(prefs.quiet_hours_start, t)}
                onPress={() => setQuietStartOpen(true)}
                icon={<Moon size={18} color={colors.mutedForeground} />}
              />
            </View>
            <View className="border-t border-border">
              <SelectField
                label={t("notificationSettings.quietHours.endLabel")}
                value={formatHHMM(prefs.quiet_hours_end, t)}
                onPress={() => setQuietEndOpen(true)}
              />
            </View>
            <ToggleRow
              label={t("notificationSettings.quietHours.allowUrgentLabel")}
              desc={t("notificationSettings.quietHours.allowUrgentDesc")}
              value={prefs.quiet_hours_allow_urgent}
              onValueChange={(v) => patch({ quiet_hours_allow_urgent: v })}
            />
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("notificationSettings.privacy")}</Text>
          <View className="rounded-xl border border-border">
            <ToggleRow
              label={t("notificationSettings.hidePreviewLabel")}
              desc={t("notificationSettings.hidePreviewDesc")}
              value={prefs.hide_message_preview}
              onValueChange={(v) => patch({ hide_message_preview: v })}
              topBorder={false}
            />
          </View>
        </View>

        <View className="gap-2">
          <Button
            variant="outline"
            icon={<Send size={16} color={colors.primary} />}
            loading={testingPush}
            disabled={!hasDevice}
            onPress={handleTestPush}
          >
            {t("notificationSettings.testPush.button")}
          </Button>
          {!hasDevice && <Text className="px-1 text-[11px] text-muted-foreground">{t("notificationSettings.testPush.noDevice")}</Text>}
        </View>

        <Pressable onPress={handleReset} disabled={resetting} className="flex-row items-center justify-center gap-2 py-2">
          {resetting ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RotateCcw size={14} color={colors.mutedForeground} />}
          <Text className="text-xs font-semibold text-muted-foreground">{t("notificationSettings.reset.button")}</Text>
        </Pressable>
      </ScrollView>

      <CategoryEditModal
        category={editingCategory}
        pref={editingPref ?? null}
        onClose={() => setEditingCategory(null)}
        onSave={handleSaveCategory}
      />

      <OptionModal
        visible={hourPickerOpen}
        onClose={() => setHourPickerOpen(false)}
        options={Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: formatHour12(h, t) }))}
        onSelect={(key) => patch({ digest_hour: Number(key) })}
      />
      <OptionModal
        visible={dayPickerOpen}
        onClose={() => setDayPickerOpen(false)}
        options={WEEKDAY_KEYS.map((k, i) => ({ key: String(i), label: t(`notificationSettings.weekdays.${k}`) }))}
        onSelect={(key) => patch({ weekly_digest_day: Number(key) })}
      />
      <OptionModal
        visible={quietStartOpen}
        onClose={() => setQuietStartOpen(false)}
        options={QUIET_TIME_OPTIONS.map((v) => ({ key: v, label: formatHHMM(v, t) }))}
        onSelect={(key) => patch({ quiet_hours_start: key })}
      />
      <OptionModal
        visible={quietEndOpen}
        onClose={() => setQuietEndOpen(false)}
        options={QUIET_TIME_OPTIONS.map((v) => ({ key: v, label: formatHHMM(v, t) }))}
        onSelect={(key) => patch({ quiet_hours_end: key })}
      />
    </SafeAreaView>
  );
}
