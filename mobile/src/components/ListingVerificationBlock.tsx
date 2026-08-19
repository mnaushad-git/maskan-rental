// Generic, reusable "Verification" block (Property Verification & Trust
// Center spec section 21): myMakan ✓ vs. future external providers ("Not
// connected"). Mirrors frontend/src/components/maskan/VerificationBlock.tsx
// behavior/copy — built generically now (a caller passes a list of
// providers) but per this prompt's scope, only the myMakan row is ever
// rendered today; no other provider (REGA/Ejar/Nafath/etc.) is named or
// wired up anywhere in this codebase.
//
// Named "ListingVerificationBlock" (not "VerificationBlock") and its i18n
// copy lives under the top-level "listingVerification" key (not
// "verification") because mobile already has an unrelated top-level
// `verification.*` i18n namespace for the renter's own mock-Nafath identity
// verification flow (see mobile/app/verification.tsx +
// mobile/src/components/TrustBadge.tsx) — reusing that key space would mix
// two different "verification" concepts under one name. See the
// "Naming collision warning" in docs/implementation/
// mymakan-trust-center-prompts.md.
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Info, ShieldCheck } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

export type VerificationProvider = {
  key: string;
  name: string;
  status: "verified" | "not_connected";
  label: string;
};

export function ListingVerificationBlock({
  providers,
  showExplainer = false,
}: {
  providers: VerificationProvider[];
  showExplainer?: boolean;
}) {
  const { t } = useLanguage();
  // Mobile has no Popover primitive (unlike web's components/ui/popover.tsx)
  // — a simple toggle-open info panel is the native-appropriate equivalent
  // for the "What does myMakan Verified mean?" explainer.
  const [showInfo, setShowInfo] = useState(false);

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1.5">
        <ShieldCheck size={13} color={colors.mutedForeground} />
        <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("listingVerification.title")}
        </Text>
        {showExplainer && (
          <Pressable
            onPress={() => setShowInfo((v) => !v)}
            accessibilityLabel={t("listingVerification.explainerTitle")}
            hitSlop={8}
          >
            <Info size={13} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {showExplainer && showInfo && (
        <View className="rounded-xl border border-border bg-surface p-3">
          <Text className="text-xs font-semibold text-foreground">
            {t("listingVerification.explainerTitle")}
          </Text>
          <Text className="mt-1 text-xs leading-4 text-muted-foreground">
            {t("listingVerification.explainer")}
          </Text>
        </View>
      )}

      <View className="gap-1.5">
        {providers.map((p) => (
          <View key={p.key} className="flex-row items-center justify-between gap-3">
            <Text className="text-sm text-muted-foreground">{p.name}</Text>
            <Text
              className={`text-sm font-semibold ${p.status === "verified" ? "text-success" : "text-muted-foreground"}`}
            >
              {p.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
