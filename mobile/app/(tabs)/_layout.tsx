import { Tabs } from "expo-router";
import { Home, Search, Heart, User } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";

export default function TabLayout() {
  const { t } = useLanguage();

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#16A34A", headerShown: true }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t("common.brand"),
          tabBarLabel: t("nav.home"),
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
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
        name="profile"
        options={{
          title: t("navAuth.account"),
          tabBarLabel: t("navAuth.account"),
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
