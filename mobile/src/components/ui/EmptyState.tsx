import { View, Text } from "react-native";
import type { ReactNode } from "react";
import { Button } from "./Button";

/** A request that succeeded with zero results — distinct from ErrorState
 * (src/components/ErrorState.tsx), which is for requests that failed
 * outright. The two look identical to users unless the screen tells them
 * apart, so every list screen should use one or the other, never a bare
 * "No results" text left over from before either existed. */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="items-center gap-3 px-6 py-16">
      {icon}
      <Text className="text-center text-base font-semibold text-foreground">{title}</Text>
      {description ? <Text className="text-center text-sm text-muted-foreground">{description}</Text> : null}
      {actionLabel && onAction ? (
        <Button variant="outline" size="sm" onPress={onAction} className="mt-2">
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}
