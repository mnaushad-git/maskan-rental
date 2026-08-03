import { View, Text } from "react-native";
import type { ReactNode } from "react";
import { Button } from "./Button";

type Tone = "primary" | "ai" | "info" | "warning";

const TONE_CLASS: Record<Tone, string> = {
  primary: "border-primary/20 bg-primary/5",
  ai: "border-ai/20 bg-ai-soft",
  info: "border-info/20 bg-info/10",
  warning: "border-warning/20 bg-warning/10",
};

/** Inline callout — for cross-sell/CTA content inside a scrollable screen
 * (e.g. the "can't find what you're looking for, submit a lead" banner
 * search results end with), not for transient feedback (use Toast) or
 * blocking states (use EmptyState/ErrorState). */
export function Banner({
  tone = "primary",
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className={`gap-3 rounded-2xl border p-4 ${TONE_CLASS[tone]}`}>
      <View className="flex-row items-start gap-3">
        {icon}
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">{title}</Text>
          {description ? <Text className="mt-0.5 text-xs text-muted-foreground">{description}</Text> : null}
        </View>
      </View>
      {actionLabel && onAction ? (
        <Button size="sm" onPress={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}
