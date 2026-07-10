import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LogOut, Globe, FileText } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";

export default function ProfileScreen() {
  const { t, lang, setLang } = useLanguage();
  const { user, authLoading, clearAuth } = useAuth();
  const router = useRouter();

  if (authLoading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#16A34A" />
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
        <Globe size={18} color="#0F172A" />
        <Text className="flex-1 text-sm font-medium text-foreground">{t("common.language")}</Text>
        <Text className="text-sm text-muted-foreground">{lang === "en" ? "English" : "العربية"}</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/lead/new")}
        className="flex-row items-center gap-3 rounded-xl border border-border px-4 py-3"
      >
        <FileText size={18} color="#0F172A" />
        <Text className="flex-1 text-sm font-medium text-foreground">{t("leadNew.heading")}</Text>
      </Pressable>

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
