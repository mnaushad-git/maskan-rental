import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LogOut, Globe, FileText, ChevronRight, Map, BookOpen, Scale, Calculator, Bell, BellRing, Settings, SearchCheck, ShieldCheck, Sparkles } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import { fetchMyTrustMetrics, type ApiTrustMetrics } from "@/lib/api/maskan";
import { TrustBadgeChip } from "@/components/TrustBadge";

export default function ProfileScreen() {
  const { t, lang, setLang } = useLanguage();
  const { user, authLoading, clearAuth } = useAuth();
  const router = useRouter();
  const [trustMetrics, setTrustMetrics] = useState<ApiTrustMetrics | null>(null);

  useEffect(() => {
    if (!user) {
      setTrustMetrics(null);
      return;
    }
    fetchMyTrustMetrics().then(setTrustMetrics).catch(() => setTrustMetrics(null));
  }, [user]);

  if (authLoading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 gap-6 bg-background p-4">
      {user ? (
        <View className="gap-1.5 rounded-2xl border border-border p-4">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-bold text-foreground">{user.full_name ?? user.email}</Text>
            {trustMetrics && <TrustBadgeChip metrics={trustMetrics} />}
          </View>
          <Text className="text-sm text-muted-foreground">{user.email}</Text>
        </View>
      ) : (
        <View className="gap-3 rounded-2xl border border-border p-4">
          <Text className="text-sm text-muted-foreground">{t("auth.signInDesc")}</Text>
          <Pressable onPress={() => router.push("/auth/login")} className="items-center rounded-lg bg-primary py-2.5">
            <Text className="text-sm font-semibold text-primary-foreground">{t("auth.signIn")}</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        onPress={() => setLang(lang === "en" ? "ar" : "en")}
        className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
      >
        <Globe size={18} color={colors.foreground} />
        <Text className="flex-1 text-sm font-medium text-foreground">{t("common.language")}</Text>
        <Text className="text-sm text-muted-foreground">{lang === "en" ? "English" : "العربية"}</Text>
      </Pressable>

      {user && (
        <View className="gap-2">
          <Pressable
            onPress={() => router.push("/premium")}
            className="flex-row items-center gap-3 rounded-xl border border-ai/30 bg-ai-soft px-4 py-3"
          >
            <Sparkles size={18} color={colors.ai} />
            <Text className="flex-1 text-sm font-medium text-foreground">{t("premium.profileRowLabel")}</Text>
            <Text className="text-xs font-semibold" style={{ color: colors.ai }}>
              {user.subscription_status === "active" ? t("premium.tier.premium") : t("premium.tier.free")}
            </Text>
            <ChevronRight size={18} color={colors.ai} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/notifications")}
            className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
          >
            <BellRing size={18} color={colors.foreground} />
            <Text className="flex-1 text-sm font-medium text-foreground">{t("notificationCenter.heading")}</Text>
            <ChevronRight size={18} color={colors.neutral400} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/saved-searches")}
            className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
          >
            <Bell size={18} color={colors.foreground} />
            <Text className="flex-1 text-sm font-medium text-foreground">{t("savedSearches.heading")}</Text>
            <ChevronRight size={18} color={colors.neutral400} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/property-requests")}
            className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
          >
            <SearchCheck size={18} color={colors.foreground} />
            <Text className="flex-1 text-sm font-medium text-foreground">{t("propertyRequest.entryPoint.profileLink")}</Text>
            <ChevronRight size={18} color={colors.neutral400} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/notification-settings")}
            className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
          >
            <Settings size={18} color={colors.foreground} />
            <Text className="flex-1 text-sm font-medium text-foreground">{t("notificationSettings.heading")}</Text>
            <ChevronRight size={18} color={colors.neutral400} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/verification")}
            className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
          >
            <ShieldCheck size={18} color={colors.foreground} />
            <Text className="flex-1 text-sm font-medium text-foreground">{t("verification.profileRowLabel")}</Text>
            <Text className="text-xs text-muted-foreground">{t(`verification.status.${user.verification_status}`)}</Text>
            <ChevronRight size={18} color={colors.neutral400} />
          </Pressable>
        </View>
      )}

      <View className="gap-2">
        <Pressable
          onPress={() => router.push("/lead/new")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <FileText size={18} color={colors.foreground} />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("leadNew.heading")}</Text>
          <ChevronRight size={18} color={colors.neutral400} />
        </Pressable>

        <Pressable
          onPress={() => router.push("/areas")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <Map size={18} color={colors.foreground} />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("nav.exploreAreas")}</Text>
          <ChevronRight size={18} color={colors.neutral400} />
        </Pressable>

        <Pressable
          onPress={() => router.push("/estimate")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <Calculator size={18} color={colors.foreground} />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("estimate.badge")}</Text>
          <ChevronRight size={18} color={colors.neutral400} />
        </Pressable>

        <Pressable
          onPress={() => router.push("/compare")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <Scale size={18} color={colors.foreground} />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("nav.compare")}</Text>
          <ChevronRight size={18} color={colors.neutral400} />
        </Pressable>

        <Pressable
          onPress={() => router.push("/methodology")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <BookOpen size={18} color={colors.foreground} />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("methodology.badge")}</Text>
          <ChevronRight size={18} color={colors.neutral400} />
        </Pressable>
      </View>

      {user && (
        <Pressable onPress={() => clearAuth()} className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3">
          <LogOut size={18} color={colors.destructive} />
          <Text className="text-sm font-medium" style={{ color: colors.destructive }}>
            {t("navAuth.signOut")}
          </Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
