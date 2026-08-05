import { View, Pressable } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Search, Heart, User, FileText, Sparkles } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { shadows, zIndex, MIN_TOUCH_TARGET } from "@/lib/theme";
import { colors } from "@/lib/colors";

export default function TabLayout() {
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerShown: true }}>
        <Tabs.Screen
          name="index"
          options={{
            title: t("common.brand"),
            tabBarLabel: t("nav.home"),
            tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: t("nav.search"),
            tabBarLabel: t("nav.search"),
            tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="saved"
          options={{
            title: t("saved.heading"),
            tabBarLabel: t("nav.saved"),
            tabBarIcon: ({ color, size }) => <Heart color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="leads"
          options={{
            title: t("nav.myLeads"),
            tabBarLabel: t("nav.myLeads"),
            tabBarIcon: ({ color, size }) => <FileText color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t("navAuth.account"),
            tabBarLabel: t("navAuth.account"),
            tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
          }}
        />
      </Tabs>

      {/* AI Advisor — prominent floating action rather than a 6th tab, so the
          primary tab bar stays at 5 items. Positioned above the tab bar on
          every tab screen; naturally disappears under pushed Stack screens
          (property detail, advisor itself, etc.) since it lives in this
          layout's tree, not the root. */}
      <Pressable
        accessibilityLabel={t("nav.aiAdvisor")}
        onPress={() => router.push("/advisor")}
        className="absolute end-5 items-center justify-center rounded-full bg-ai"
        style={[
          {
            bottom: insets.bottom + 72,
            width: MIN_TOUCH_TARGET + 12,
            height: MIN_TOUCH_TARGET + 12,
            zIndex: zIndex.overlay,
          },
          shadows.floating,
        ]}
      >
        <Sparkles size={24} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}
