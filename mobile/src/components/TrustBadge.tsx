import { View, Text } from "react-native";
import { ShieldCheck, ShieldAlert, Shield } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import { computeTrustScore, type TrustTier } from "@/lib/trustScore";
import type { ApiTrustMetrics } from "@/lib/api/maskan";
import { ScoreRing, ScoreBar } from "@/components/ScoreIndicator";

const TIER_ICON: Record<TrustTier, typeof ShieldCheck> = {
  trusted: ShieldCheck,
  building: Shield,
  new: ShieldAlert,
};

const TIER_TONE_CLASS: Record<TrustTier, string> = {
  trusted: "bg-success/10",
  building: "bg-secondary/10",
  new: "bg-surface-2",
};

const TIER_ICON_COLOR: Record<TrustTier, string> = {
  trusted: colors.success,
  building: colors.secondary,
  new: colors.mutedForeground,
};

const TIER_TEXT_CLASS: Record<TrustTier, string> = {
  trusted: "text-success",
  building: "text-secondary",
  new: "text-muted-foreground",
};

/** Compact pill for inline use (e.g. next to a reviewer's name). */
export function TrustBadgeChip({ metrics }: { metrics: ApiTrustMetrics }) {
  const { t } = useLanguage();
  const { tier } = computeTrustScore(metrics);
  const Icon = TIER_ICON[tier];
  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 ${TIER_TONE_CLASS[tier]}`}>
      <Icon size={12} color={TIER_ICON_COLOR[tier]} />
      <Text className={`text-[11px] font-semibold ${TIER_TEXT_CLASS[tier]}`}>{t(`trustBadge.tier.${tier}`)}</Text>
    </View>
  );
}

/** Full card with score ring + breakdown — used on the renter's own profile. */
export function TrustBadgeCard({ metrics }: { metrics: ApiTrustMetrics }) {
  const { t } = useLanguage();
  const { score, tier, breakdown } = computeTrustScore(metrics);
  const Icon = TIER_ICON[tier];

  return (
    <View className="gap-4 rounded-2xl border border-border p-4">
      <View className="flex-row items-center gap-3">
        <ScoreRing score={score} size={56} />
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-1.5">
            <Icon size={16} color={TIER_ICON_COLOR[tier]} />
            <Text className={`text-sm font-bold ${TIER_TEXT_CLASS[tier]}`}>{t(`trustBadge.tier.${tier}`)}</Text>
          </View>
          <Text className="text-xs text-muted-foreground">{t("trustBadge.desc")}</Text>
        </View>
      </View>

      <View className="gap-2.5">
        <ScoreBar label={t("trustBadge.breakdown.verification")} value={breakdown.verification} />
        <ScoreBar label={t("trustBadge.breakdown.reviews")} value={breakdown.reviews} />
        <ScoreBar label={t("trustBadge.breakdown.responseRate")} value={breakdown.responseRate} />
      </View>
    </View>
  );
}
