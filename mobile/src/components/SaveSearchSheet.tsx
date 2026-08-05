import { Fragment, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { Bell, TriangleAlert } from "lucide-react-native";
import {
  createSavedSearch,
  previewSavedSearch,
  DuplicateSavedSearchError,
  type AlertFrequency,
  type ApiPropertyFilterCriteria,
  type ApiSavedSearch,
  type NotificationChannel,
} from "@/lib/api/maskan";
import type { SearchBarFilters } from "@/components/SearchBar";
import { useLanguage } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { PushPermissionPrompt, usePushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { colors } from "@/lib/colors";

export function filtersToCriteria(filters: SearchBarFilters, query?: string): ApiPropertyFilterCriteria {
  return {
    keyword: query || undefined,
    transaction_type: filters.listingType,
    property_type: filters.type !== "Any" ? filters.type : undefined,
    city: filters.city !== "Any" ? filters.city : undefined,
    districts: filters.district !== "Any" ? [filters.district] : [],
    min_price: filters.minRent > 0 ? filters.minRent : undefined,
    max_price: filters.maxRent,
  };
}

function suggestName(filters: SearchBarFilters, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const place = filters.district !== "Any" ? filters.district : filters.city !== "Any" ? filters.city : null;
  const kind = filters.type !== "Any" ? t(`propertyTypes.${filters.type}`) : t(`listingCategories.${filters.listingType}`);
  return place ? `${kind} · ${place}` : kind;
}

const FREQUENCIES: AlertFrequency[] = ["instant", "daily", "weekly", "off"];

export function SaveSearchSheet({
  visible,
  onClose,
  filters,
  query,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  filters: SearchBarFilters;
  query?: string;
  onSaved?: (savedSearch: ApiSavedSearch) => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const pushPrompt = usePushPermissionPrompt();

  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<AlertFrequency>("instant");
  const [channels, setChannels] = useState<NotificationChannel[]>(["in_app"]);
  const [saving, setSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(suggestName(filters, t));
    setFrequency("instant");
    setChannels(["in_app"]);
    setDuplicateOf(null);
    setPreviewLoading(true);
    setPreviewCount(null);
    previewSavedSearch(filtersToCriteria(filters, query))
      .then((res) => {
        setPreviewCount(res.estimated_count);
        if (res.duplicate_of) setDuplicateOf(res.duplicate_of);
      })
      .catch(() => setPreviewCount(null))
      .finally(() => setPreviewLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function toggleChannel(channel: NotificationChannel) {
    if (channel === "in_app") return; // always on — the durable baseline channel
    setChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  }

  async function handleSave(confirmDuplicate: boolean) {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await createSavedSearch({
        name: name.trim(),
        filters: filtersToCriteria(filters, query),
        alert_enabled: frequency !== "off",
        alert_frequency: frequency,
        channels,
        confirm_duplicate: confirmDuplicate,
      });
      toast(t("savedSearches.saveSheet.savedToast"), "success");
      onSaved?.(saved);
      onClose();
      if (channels.includes("push")) pushPrompt.trigger();
    } catch (err) {
      if (err instanceof DuplicateSavedSearchError) {
        setDuplicateOf(err.duplicateOf);
      } else if (err instanceof Error && err.message.toLowerCase().includes("limit")) {
        toast(t("savedSearches.saveSheet.limitReachedToast"), "error");
      } else {
        toast(t("savedSearches.saveSheet.errorToast"), "error");
      }
    } finally {
      setSaving(false);
    }
  }

  const frequencyLabelKey: Record<AlertFrequency, string> = {
    instant: "savedSearches.card.frequencyInstant",
    daily: "savedSearches.card.frequencyDaily",
    weekly: "savedSearches.card.frequencyWeekly",
    off: "savedSearches.card.frequencyOff",
  };

  return (
    <Fragment>
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-4 px-5 pb-6 pt-1">
        <View className="flex-row items-center gap-2">
          <Bell size={20} color={colors.primary} />
          <Text className="text-lg font-bold text-foreground">{t("savedSearches.saveSheet.title")}</Text>
        </View>

        <View className="gap-1.5">
          <Text className="text-xs font-medium text-muted-foreground">{t("savedSearches.saveSheet.nameLabel")}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("savedSearches.saveSheet.namePlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            className="rounded-xl border border-border bg-background px-3.5 py-3 text-sm text-foreground"
            maxLength={150}
          />
        </View>

        <View className="rounded-xl bg-surface px-3.5 py-3">
          {previewLoading ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-xs text-muted-foreground">{t("savedSearches.saveSheet.estimatedMatchesLoading")}</Text>
            </View>
          ) : previewCount !== null ? (
            <Text className="text-sm font-semibold text-foreground">
              {t(previewCount === 1 ? "savedSearches.saveSheet.estimatedMatchesSingular" : "savedSearches.saveSheet.estimatedMatchesPlural", { count: previewCount })}
            </Text>
          ) : null}
        </View>

        {duplicateOf && (
          <View className="flex-row items-start gap-2 rounded-xl border border-warning/40 bg-surface-2 px-3.5 py-3">
            <TriangleAlert size={16} color={colors.warning} />
            <Text className="flex-1 text-xs text-foreground">
              {t("savedSearches.saveSheet.duplicateWarning", { name: duplicateOf.name })}
            </Text>
          </View>
        )}

        <View className="gap-1.5">
          <Text className="text-xs font-medium text-muted-foreground">{t("savedSearches.saveSheet.frequencyLabel")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <Chip key={f} selected={frequency === f} onPress={() => setFrequency(f)}>
                {t(frequencyLabelKey[f])}
              </Chip>
            ))}
          </View>
        </View>

        <View className="gap-1.5">
          <Text className="text-xs font-medium text-muted-foreground">{t("savedSearches.saveSheet.channelsLabel")}</Text>
          <View className="flex-row flex-wrap gap-2">
            <Chip selected onPress={() => toggleChannel("in_app")}>
              {t("savedSearches.saveSheet.channelInApp")}
            </Chip>
            <Chip selected={channels.includes("push")} onPress={() => toggleChannel("push")}>
              {t("savedSearches.saveSheet.channelPush")}
            </Chip>
            <Chip selected={channels.includes("email")} onPress={() => toggleChannel("email")}>
              {t("savedSearches.saveSheet.channelEmail")}
            </Chip>
          </View>
        </View>

        <View className="flex-row gap-3 pt-1">
          <Button variant="outline" onPress={onClose} className="flex-1" disabled={saving}>
            {t("savedSearches.saveSheet.cancel")}
          </Button>
          <Button
            onPress={() => handleSave(!!duplicateOf)}
            loading={saving}
            disabled={!name.trim()}
            className="flex-1"
          >
            {duplicateOf ? t("savedSearches.saveSheet.duplicateSaveAnyway") : t("savedSearches.saveSheet.save")}
          </Button>
        </View>
      </View>
    </BottomSheet>
    <PushPermissionPrompt visible={pushPrompt.visible} onClose={pushPrompt.close} />
    </Fragment>
  );
}
