import { cn } from "@/lib/utils";
import { Sparkles, ShieldCheck, Flame, TrendingDown, Star } from "lucide-react";
import type { ReactNode } from "react";
import { useLanguage } from "@/lib/i18n/context";

type Tone = "primary" | "secondary" | "ai" | "success" | "warning" | "info" | "neutral";

// Solid, high-contrast fills — pale tinted badges (the old bg-x/10-style
// pills) read as near-identical washed-out blobs at small sizes, especially
// when "Verified" and "New" sit right next to each other on a card.
const toneClass: Record<Tone, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  ai: "bg-ai text-ai-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  info: "bg-info text-info-foreground",
  neutral: "bg-muted-foreground text-background",
};

export function Badge({
  children,
  tone = "neutral",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-tight",
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function RecommendationBadge({ label }: { label: string }) {
  const { t } = useLanguage();
  const map: Record<string, { tone: Tone; icon: ReactNode }> = {
    "Best Match": { tone: "ai", icon: <Sparkles className="size-3.5" /> },
    Verified: { tone: "success", icon: <ShieldCheck className="size-3.5" /> },
    Hot: { tone: "warning", icon: <Flame className="size-3.5" /> },
    "Price Drop": { tone: "secondary", icon: <TrendingDown className="size-3.5" /> },
    // Blue, not green — "New" sits directly next to "Verified" on every card,
    // so it needs a hue that doesn't read as a paler version of the same badge.
    New: { tone: "info", icon: <Star className="size-3.5" /> },
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
  return (
    <Badge tone={tone}>
      <span className={cn("size-1.5 rounded-full",
        status === "Available" ? "bg-success" : status === "Reserved" ? "bg-warning" : "bg-muted-foreground")} />
      {t(`badges.${status}`)}
    </Badge>
  );
}
