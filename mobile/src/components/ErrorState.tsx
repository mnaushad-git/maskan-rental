import { View, Text, Pressable } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";

// Shown when a request fails outright, as opposed to a request that succeeded
// with zero results — the two look identical to users unless we say so.
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <View className="items-center gap-3 py-16">
      <Text className="text-center text-sm text-muted-foreground">{t("common.loadFailed")}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t("common.retry")}
        className="flex-row items-center gap-2 rounded-lg bg-primary px-4 py-2"
      >
        <RefreshCw size={14} color="#FFFFFF" />
        <Text className="text-sm font-semibold text-primary-foreground">{t("common.retry")}</Text>
      </Pressable>
    </View>
  );
}
