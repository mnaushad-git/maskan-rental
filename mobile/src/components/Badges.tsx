import { View, Text } from "react-native";
import { Sparkles, ShieldCheck, Flame, TrendingDown, Star } from "lucide-react-native";
import type { ReactNode } from "react";
import { useLanguage } from "@/lib/i18n/context";

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
    "Best Match": { tone: "ai", icon: <Sparkles size={14} color="#7C3AED" /> },
    Verified: { tone: "success", icon: <ShieldCheck size={14} color="#16A34A" /> },
    Hot: { tone: "warning", icon: <Flame size={14} color="#D97706" /> },
    "Price Drop": { tone: "info", icon: <TrendingDown size={14} color="#2563EB" /> },
    New: { tone: "primary", icon: <Star size={14} color="#0F172A" /> },
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
