import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Construction } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { colors } from "@/lib/colors";

// Placeholder only — brief §10 explicitly allows a "Coming soon" stand-in
// for "Continue Transaction" in this session, mirrors web's
// transaction.$id.tsx exactly. No payment/contract/Ejar/Nafath logic lives
// here or anywhere else in this feature (see
// docs/implementation/mymakan-negotiations.md "Known limitations").
export default function TransactionPlaceholderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background p-5">
      <Stack.Screen options={{ title: t("transactionPage.comingSoon") }} />
      <View className="flex-1 items-center justify-center">
        <EmptyState
          icon={<Construction size={28} color={colors.mutedForeground} />}
          title={t("transactionPage.comingSoon")}
          description={t("transactionPage.desc")}
          actionLabel={t("transactionPage.backToNegotiation")}
          onAction={() => router.push(`/negotiations/${id}`)}
        />
      </View>
    </SafeAreaView>
  );
}
