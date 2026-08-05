import { View, Text } from "react-native";
import { Sparkles, ShieldCheck, Flame, TrendingDown, Star } from "lucide-react-native";
import type { ReactNode } from "react";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

type Tone = "primary" | "secondary" | "ai" | "success" | "warning" | "info" | "neutral";

const toneClass: Record<Tone, string> = {
  primary: "bg-primary-soft text-foreground",
  secondary: "bg-secondary/10 text-secondary",
  ai: "bg-ai-soft text-ai",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  info: "bg-info/10 text-info",
  neutral: "bg-surface-2 text-muted-foreground",
};

const toneTextClass: Record<Tone, string> = {
  primary: "text-foreground",
  secondary: "text-secondary",
  ai: "text-ai",
  success: "text-success",
  warning: "text-warning-foreground",
  info: "text-info",
  neutral: "text-muted-foreground",
};

export function Badge({
  children,
  tone = "neutral",
  icon,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <View className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${toneClass[tone]} ${className}`}>
      {icon}
      <Text className={`text-xs font-semibold ${toneTextClass[tone]}`}>{children}</Text>
    </View>
  );
}

export function RecommendationBadge({ label }: { label: string }) {
  const { t } = useLanguage();
  const map: Record<string, { tone: Tone; icon: ReactNode }> = {
    "Best Match": { tone: "ai", icon: <Sparkles size={14} color={colors.ai} /> },
    Verified: { tone: "success", icon: <ShieldCheck size={14} color={colors.success} /> },
    Hot: { tone: "warning", icon: <Flame size={14} color="#B45309" /> },
    "Price Drop": { tone: "info", icon: <TrendingDown size={14} color={colors.info} /> },
    New: { tone: "primary", icon: <Star size={14} color={colors.foreground} /> },
  };
  const cfg = map[label] ?? { tone: "neutral" as Tone, icon: null };
  return (
    <Badge tone={cfg.tone} icon={cfg.icon}>
      {t(`badges.${label}`)}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: "Available" | "Reserved" | "Rented" | "Sold" }) {
  const { t } = useLanguage();
  const tone: Tone = status === "Available" ? "success" : status === "Reserved" ? "warning" : "neutral";
  const dotClass =
    status === "Available" ? "bg-success" : status === "Reserved" ? "bg-warning" : "bg-muted-foreground";
  return (
    <Badge tone={tone} icon={<View className={`size-1.5 rounded-full ${dotClass}`} />}>
      {t(`badges.${status}`)}
    </Badge>
  );
}

const PROPERTY_REQUEST_STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  awaiting_clarification: "warning",
  active: "success",
  paused: "neutral",
  matched: "ai",
  negotiating: "info",
  fulfilled: "success",
  expired: "neutral",
  closed: "neutral",
  cancelled: "neutral",
};

/** Status pill for a PropertyRequest (see app/property-requests/*) — a
 * separate enum/tone map from the listing StatusBadge above since a request
 * moves through its own lifecycle (draft → awaiting_clarification → active →
 * matched/negotiating → fulfilled/expired/closed/cancelled), not a listing's. */
export function PropertyRequestStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const tone = PROPERTY_REQUEST_STATUS_TONE[status] ?? "neutral";
  return <Badge tone={tone}>{t(`propertyRequest.status.${status}`)}</Badge>;
}
