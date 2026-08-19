import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Bell, Loader2, Mail, RotateCcw, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  fetchDevices,
  fetchNotificationPreferences,
  resetNotificationPreferences,
  sendTestPush,
  updateNotificationPreferences,
  UnauthorizedError,
  type AlertFrequency,
  type ApiNotificationPreferences,
  type CategoryPreference,
  type NotificationCategoryKey,
  type NotificationChannel,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notification-settings")({
  head: () => ({
    meta: [
      { title: "Notification Settings — myMakan" },
      { name: "description", content: "Manage how and when myMakan sends you notifications." },
    ],
  }),
  component: NotificationSettingsPage,
});

const CATEGORY_ORDER: NotificationCategoryKey[] = [
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

const FREQUENCIES: AlertFrequency[] = ["instant", "daily", "weekly", "off"];
const CHANNELS: NotificationChannel[] = ["in_app", "push", "email"];
const WEEKDAYS: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: "notificationSettings.digest.days.mon" },
  { value: 1, labelKey: "notificationSettings.digest.days.tue" },
  { value: 2, labelKey: "notificationSettings.digest.days.wed" },
  { value: 3, labelKey: "notificationSettings.digest.days.thu" },
  { value: 4, labelKey: "notificationSettings.digest.days.fri" },
  { value: 5, labelKey: "notificationSettings.digest.days.sat" },
  { value: 6, labelKey: "notificationSettings.digest.days.sun" },
];

function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

function ToggleRow({
  icon: Icon,
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  icon: typeof Bell;
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{label}</div>
          {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="mt-1 shrink-0"
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CategoryCard({
  categoryKey,
  pref,
  onChange,
}: {
  categoryKey: NotificationCategoryKey;
  pref: CategoryPreference;
  onChange: (next: CategoryPreference) => void;
}) {
  const { t } = useLanguage();
  const isSecurity = categoryKey === "security";

  function toggleChannel(channel: NotificationChannel) {
    const next = pref.channels.includes(channel)
      ? pref.channels.filter((c) => c !== channel)
      : [...pref.channels, channel];
    onChange({ ...pref, channels: next });
  }

  function setFrequency(freq: AlertFrequency) {
    if (isSecurity && freq === "off") return;
    onChange({ ...pref, frequency: freq });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0">
      <div>
        <h3 className="text-sm font-bold text-foreground">
          {t(`notificationSettings.categories.${categoryKey}.label`)}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(`notificationSettings.categories.${categoryKey}.desc`)}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("notificationSettings.categories.channelsLabel")}
        </span>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleChannel(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                pref.channels.includes(c)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-surface",
              )}
            >
              {t(`notificationSettings.channels.${c}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("notificationSettings.categories.frequencyLabel")}
        </span>
        <div className="flex flex-wrap gap-2">
          {FREQUENCIES.map((f) => {
            const disabled = isSecurity && f === "off";
            return (
              <button
                key={f}
                type="button"
                disabled={disabled}
                onClick={() => setFrequency(f)}
                title={
                  disabled ? t("notificationSettings.categories.securityLockedNote") : undefined
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  disabled
                    ? "cursor-not-allowed border-border bg-muted text-muted-foreground/50"
                    : pref.frequency === f
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-surface",
                )}
              >
                {t(`notificationSettings.frequency.${f}`)}
              </button>
            );
          })}
        </div>
        {isSecurity && (
          <p className="text-[11px] text-muted-foreground">
            {t("notificationSettings.categories.securityLockedNote")}
          </p>
        )}
      </div>
    </div>
  );
}

function NotificationSettingsPage() {
  const { user, authLoading, clearAuth } = useAuth();
  const { t, dir } = useLanguage();
  const navigate = useNavigate();

  const [prefs, setPrefs] = useState<ApiNotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasDevice, setHasDevice] = useState(false);
  const [sendingTestPush, setSendingTestPush] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (authLoading || !user) {
      if (!authLoading) setLoading(false);
      return;
    }
    setLoading(true);
    fetchNotificationPreferences()
      .then(setPrefs)
      .catch((err) => {
        if (err instanceof UnauthorizedError) clearAuth();
        else setError(t("notificationSettings.unableToLoad"));
      })
      .finally(() => setLoading(false));
    fetchDevices()
      .then((devices) => setHasDevice(devices.length > 0))
      .catch(() => setHasDevice(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const categoryOrder = useMemo(() => CATEGORY_ORDER, []);

  async function applyPatch(
    patch: Partial<Omit<ApiNotificationPreferences, "category_preferences">> & {
      category_preferences?: Partial<Record<NotificationCategoryKey, CategoryPreference>>;
    },
    optimistic: ApiNotificationPreferences,
  ) {
    const previous = prefs;
    setPrefs(optimistic);
    try {
      const saved = await updateNotificationPreferences(patch);
      setPrefs(saved);
    } catch (err) {
      setPrefs(previous);
      toast.error(err instanceof Error ? err.message : t("notificationSettings.saveError"));
    }
  }

  function handleMasterToggle(
    field: "in_app_enabled" | "push_enabled" | "email_enabled",
    value: boolean,
  ) {
    if (!prefs) return;
    void applyPatch({ [field]: value }, { ...prefs, [field]: value });
  }

  function handleCategoryChange(key: NotificationCategoryKey, next: CategoryPreference) {
    if (!prefs) return;
    void applyPatch(
      { category_preferences: { [key]: next } },
      { ...prefs, category_preferences: { ...prefs.category_preferences, [key]: next } },
    );
  }

  function handleDigestHour(hour: number) {
    if (!prefs) return;
    void applyPatch({ digest_hour: hour }, { ...prefs, digest_hour: hour });
  }

  function handleWeekday(day: number) {
    if (!prefs) return;
    void applyPatch({ weekly_digest_day: day }, { ...prefs, weekly_digest_day: day });
  }

  function handleQuietHoursToggle(enabled: boolean) {
    if (!prefs) return;
    void applyPatch({ quiet_hours_enabled: enabled }, { ...prefs, quiet_hours_enabled: enabled });
  }

  function handleQuietHoursTime(field: "quiet_hours_start" | "quiet_hours_end", value: string) {
    if (!prefs || !value) return;
    void applyPatch({ [field]: value }, { ...prefs, [field]: value });
  }

  function handleAllowUrgent(value: boolean) {
    if (!prefs) return;
    void applyPatch(
      { quiet_hours_allow_urgent: value },
      { ...prefs, quiet_hours_allow_urgent: value },
    );
  }

  function handleHidePreview(value: boolean) {
    if (!prefs) return;
    void applyPatch({ hide_message_preview: value }, { ...prefs, hide_message_preview: value });
  }

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    try {
      const next = await resetNotificationPreferences();
      setPrefs(next);
      toast.success(t("notificationSettings.resetToast"));
      setConfirmingReset(false);
    } catch {
      toast.error(t("notificationSettings.saveError"));
    } finally {
      setResetting(false);
    }
  }

  async function handleTestPush() {
    if (sendingTestPush) return;
    setSendingTestPush(true);
    try {
      const res = await sendTestPush();
      if (res.sent > 0)
        toast.success(t("notificationSettings.testPush.success", { count: res.sent }));
      else toast.error(t("notificationSettings.testPush.noneSent"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("notificationSettings.testPush.error"));
    } finally {
      setSendingTestPush(false);
    }
  }

  const dateLocale = undefined; // date-fns default (en) formatting; app has no ar locale file wired for date-fns elsewhere.

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page max-w-3xl py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {t("notificationSettings.heading")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("notificationSettings.subtitle")}
            </p>
          </div>
          {prefs && (
            <Button variant="outline" size="sm" onClick={() => setConfirmingReset((v) => !v)}>
              <RotateCcw className="size-3.5" />
              {t("notificationSettings.resetButton")}
            </Button>
          )}
        </div>

        {confirmingReset && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-foreground">
              {t("notificationSettings.resetConfirm.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("notificationSettings.resetConfirm.desc")}
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleReset()}
                disabled={resetting}
              >
                {resetting && <Loader2 className="size-3.5 animate-spin" />}
                {t("notificationSettings.resetConfirm.confirm")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingReset(false)}>
                {t("notificationSettings.resetConfirm.cancel")}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-5" dir={dir}>
          {authLoading || loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))
          ) : !user ? (
            <EmptyState
              icon={Bell}
              title={t("myLeads.signInToView")}
              action={
                <Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>
              }
            />
          ) : error || !prefs ? (
            <p className="text-sm text-destructive">
              {error ?? t("notificationSettings.unableToLoad")}
            </p>
          ) : (
            <>
              <Section title={t("notificationSettings.master.heading")}>
                <div className="divide-y divide-border">
                  <ToggleRow
                    icon={Bell}
                    label={t("notificationSettings.master.inApp")}
                    desc={t("notificationSettings.master.inAppDesc")}
                    checked={prefs.in_app_enabled}
                    onChange={(v) => handleMasterToggle("in_app_enabled", v)}
                  />
                  <ToggleRow
                    icon={Smartphone}
                    label={t("notificationSettings.master.push")}
                    desc={t("notificationSettings.master.pushDesc")}
                    checked={prefs.push_enabled}
                    onChange={(v) => handleMasterToggle("push_enabled", v)}
                  />
                  <ToggleRow
                    icon={Mail}
                    label={t("notificationSettings.master.email")}
                    desc={t("notificationSettings.master.emailDesc")}
                    checked={prefs.email_enabled}
                    onChange={(v) => handleMasterToggle("email_enabled", v)}
                  />
                </div>
              </Section>

              <Section
                title={t("notificationSettings.categories.heading")}
                subtitle={t("notificationSettings.categories.subtitle")}
              >
                <div>
                  {categoryOrder.map((key) => (
                    <CategoryCard
                      key={key}
                      categoryKey={key}
                      pref={
                        prefs.category_preferences[key] ?? {
                          channels: ["in_app"],
                          frequency: "instant",
                        }
                      }
                      onChange={(next) => handleCategoryChange(key, next)}
                    />
                  ))}
                </div>
              </Section>

              <Section
                title={t("notificationSettings.digest.heading")}
                subtitle={t("notificationSettings.digest.subtitle")}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="digest-hour"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("notificationSettings.digest.hourLabel")}
                    </label>
                    <select
                      id="digest-hour"
                      value={prefs.digest_hour}
                      onChange={(e) => handleDigestHour(Number(e.target.value))}
                      className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                    >
                      {Array.from({ length: 24 }).map((_, h) => (
                        <option key={h} value={h}>
                          {hourLabel(h)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="digest-weekday"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {t("notificationSettings.digest.weekdayLabel")}
                    </label>
                    <select
                      id="digest-weekday"
                      value={prefs.weekly_digest_day}
                      onChange={(e) => handleWeekday(Number(e.target.value))}
                      className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {t(d.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>
                    {prefs.next_daily_digest_at
                      ? t("notificationSettings.digest.nextDaily", {
                          date: format(new Date(prefs.next_daily_digest_at), "PPpp", {
                            locale: dateLocale,
                          }),
                        })
                      : t("notificationSettings.digest.noneScheduled")}
                  </span>
                  <span>
                    {prefs.next_weekly_digest_at
                      ? t("notificationSettings.digest.nextWeekly", {
                          date: format(new Date(prefs.next_weekly_digest_at), "PPpp", {
                            locale: dateLocale,
                          }),
                        })
                      : t("notificationSettings.digest.noneScheduled")}
                  </span>
                </div>
              </Section>

              <Section
                title={t("notificationSettings.quietHours.heading")}
                subtitle={t("notificationSettings.quietHours.subtitle")}
              >
                <div className="flex flex-col gap-4">
                  <ToggleRow
                    icon={Bell}
                    label={t("notificationSettings.quietHours.enable")}
                    checked={prefs.quiet_hours_enabled}
                    onChange={handleQuietHoursToggle}
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="quiet-start"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t("notificationSettings.quietHours.start")}
                      </label>
                      <input
                        id="quiet-start"
                        type="time"
                        value={prefs.quiet_hours_start}
                        disabled={!prefs.quiet_hours_enabled}
                        onChange={(e) => handleQuietHoursTime("quiet_hours_start", e.target.value)}
                        className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="quiet-end"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t("notificationSettings.quietHours.end")}
                      </label>
                      <input
                        id="quiet-end"
                        type="time"
                        value={prefs.quiet_hours_end}
                        disabled={!prefs.quiet_hours_enabled}
                        onChange={(e) => handleQuietHoursTime("quiet_hours_end", e.target.value)}
                        className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <ToggleRow
                    icon={Bell}
                    label={t("notificationSettings.quietHours.allowUrgent")}
                    checked={prefs.quiet_hours_allow_urgent}
                    onChange={handleAllowUrgent}
                    disabled={!prefs.quiet_hours_enabled}
                  />
                </div>
              </Section>

              <Section title={t("notificationSettings.privacy.heading")}>
                <ToggleRow
                  icon={Mail}
                  label={t("notificationSettings.privacy.hidePreview")}
                  desc={t("notificationSettings.privacy.hidePreviewDesc")}
                  checked={prefs.hide_message_preview}
                  onChange={handleHidePreview}
                />
              </Section>

              {hasDevice && (
                <Section
                  title={t("notificationSettings.testPush.heading")}
                  subtitle={t("notificationSettings.testPush.subtitle")}
                >
                  <Button onClick={() => void handleTestPush()} disabled={sendingTestPush}>
                    {sendingTestPush ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {sendingTestPush
                      ? t("notificationSettings.testPush.sending")
                      : t("notificationSettings.testPush.button")}
                  </Button>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
