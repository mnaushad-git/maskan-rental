import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LogOut, Globe, FileText, ClipboardList, ChevronRight, Sparkles, Map, BookOpen, Scale, Calculator } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";

export default function ProfileScreen() {
  const { t, lang, setLang } = useLanguage();
  const { user, authLoading, clearAuth } = useAuth();
  const router = useRouter();

  if (authLoading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#2563EB" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 gap-6 bg-background p-4">
      {user ? (
        <View className="gap-1 rounded-2xl border border-border p-4">
          <Text className="text-base font-bold text-foreground">{user.full_name ?? user.email}</Text>
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
        <Globe size={18} color="#2B211A" />
        <Text className="flex-1 text-sm font-medium text-foreground">{t("common.language")}</Text>
        <Text className="text-sm text-muted-foreground">{lang === "en" ? "English" : "العربية"}</Text>
      </Pressable>

      <View className="gap-2">
        <Pressable
          onPress={() => router.push("/lead/new")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <FileText size={18} color="#2B211A" />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("leadNew.heading")}</Text>
          <ChevronRight size={18} color="#A8A29E" />
        </Pressable>

        <Pressable
          onPress={() => router.push("/leads")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <ClipboardList size={18} color="#2B211A" />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("nav.myLeads")}</Text>
          <ChevronRight size={18} color="#A8A29E" />
        </Pressable>

        <Pressable
          onPress={() => router.push("/advisor")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <Sparkles size={18} color="#2563EB" />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("nav.aiAdvisor")}</Text>
          <ChevronRight size={18} color="#A8A29E" />
        </Pressable>

        <Pressable
          onPress={() => router.push("/areas")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <Map size={18} color="#2B211A" />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("nav.exploreAreas")}</Text>
          <ChevronRight size={18} color="#A8A29E" />
        </Pressable>

        <Pressable
          onPress={() => router.push("/estimate")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <Calculator size={18} color="#2B211A" />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("estimate.badge")}</Text>
          <ChevronRight size={18} color="#A8A29E" />
        </Pressable>

        <Pressable
          onPress={() => router.push("/compare")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <Scale size={18} color="#2B211A" />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("nav.compare")}</Text>
          <ChevronRight size={18} color="#A8A29E" />
        </Pressable>

        <Pressable
          onPress={() => router.push("/methodology")}
          className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
        >
          <BookOpen size={18} color="#2B211A" />
          <Text className="flex-1 text-sm font-medium text-foreground">{t("methodology.badge")}</Text>
          <ChevronRight size={18} color="#A8A29E" />
        </Pressable>
      </View>

      {user && (
        <Pressable onPress={() => clearAuth()} className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3">
          <LogOut size={18} color="#DC2626" />
          <Text className="text-sm font-medium" style={{ color: "#DC2626" }}>
            {t("navAuth.signOut")}
          </Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
