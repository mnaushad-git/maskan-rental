import { Tabs, useRouter } from "expo-router";
import { Home, Search, Heart, User, Sparkles } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

export default function TabLayout() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
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
        name="search-shortcut"
        options={{
          title: t("nav.search"),
          tabBarLabel: t("nav.search"),
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
        listeners={{
          // This route never actually renders — tapping it pushes the real
          // Search screen (app/search.tsx) as a Stack screen instead of
          // switching tabs, matching the AI Advisor shortcut below.
          tabPress: (e) => {
            e.preventDefault();
            router.push("/search");
          },
        }}
      />
      <Tabs.Screen
        name="advisor-shortcut"
        options={{
          title: t("nav.aiAdvisor"),
          tabBarLabel: t("nav.aiAdvisor"),
          tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} />,
        }}
        listeners={{
          // This route never actually renders — tapping it pushes the real
          // AI Advisor screen (app/advisor.tsx) as a Stack screen instead of
          // switching tabs, so its chat state and dynamic header (New chat
          // button) keep working exactly as before.
          tabPress: (e) => {
            e.preventDefault();
            router.push("/advisor");
          },
        }}
      />
      <Tabs.Screen
        name="saved-shortcut"
        options={{
          title: t("nav.saved"),
          tabBarLabel: t("nav.saved"),
          tabBarIcon: ({ color, size }) => <Heart color={color} size={size} />,
        }}
        listeners={{
          // This route never actually renders — tapping it pushes the real
          // Saved screen (app/saved.tsx) as a Stack screen instead of
          // switching tabs, matching the AI Advisor shortcut above.
          tabPress: (e) => {
            e.preventDefault();
            router.push("/saved");
          },
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
      <Tabs.Screen name="projects" options={{ href: null }} />
      <Tabs.Screen name="bookings" options={{ href: null }} />
    </Tabs>
  );
}
