import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Image } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Briefcase, Sparkles, Calculator, ChevronRight, SearchCheck } from "lucide-react-native";
import { fetchPublicPartners, type ApiPartnerPublic } from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

type TabKey = "partner" | "advisor" | "estimate" | "requests";

const ACCENTS: Record<TabKey, { tabBg: string; tabText: string; cardBg: string; accent: string }> = {
  partner: { tabBg: "#E0F2FE", tabText: colors.info, cardBg: "#F0F9FF", accent: colors.info },
  advisor: { tabBg: "#EDE9FE", tabText: "#6D28D9", cardBg: "#F5F3FF", accent: "#6D28D9" },
  estimate: { tabBg: "#DCFCE7", tabText: colors.success, cardBg: "#F0FDF4", accent: colors.success },
  requests: { tabBg: colors.primarySoft, tabText: colors.primary, cardBg: "#EFF6FF", accent: colors.primary },
};

const AVATAR_COLORS = [colors.primary, colors.ai, "#0EA5E9", "#F59E0B", colors.destructive];

export function MoreWaysSection() {
  const { t } = useLanguage();
  const router = useRouter();
  const [active, setActive] = useState<TabKey>("partner");
  const [partners, setPartners] = useState<ApiPartnerPublic[]>([]);

  useEffect(() => {
    fetchPublicPartners()
      .then((list) => setPartners(list.slice(0, 4)))
      .catch(() => setPartners([]));
  }, []);

  const tabs: { key: TabKey; icon: typeof Briefcase; label: string; to: Href }[] = [
    { key: "partner", icon: Briefcase, label: t("home.truPartner.badge"), to: "/lead/new" },
    { key: "advisor", icon: Sparkles, label: t("home.truAIAdvisor.badge"), to: "/advisor" },
    { key: "estimate", icon: Calculator, label: t("home.truEstimate.badge"), to: "/estimate" },
    { key: "requests", icon: SearchCheck, label: t("propertyRequest.entryPoint.cta"), to: "/property-requests/new" },
  ];

  const content: Record<TabKey, { newLabel?: string; title: string; body: string }> = {
    partner: { newLabel: t("home.truPartner.new"), title: t("home.truPartner.title"), body: t("home.truPartner.body") },
    advisor: { newLabel: t("home.truAIAdvisor.new"), title: t("home.truAIAdvisor.title"), body: t("home.truAIAdvisor.body") },
    estimate: { title: t("home.truEstimate.title"), body: t("home.truEstimate.body") },
    requests: {
      newLabel: t("home.truAIAdvisor.new"),
      title: t("propertyRequest.entryPoint.homeTitle"),
      body: t("propertyRequest.entryPoint.homeDesc"),
    },
  };

  const activeTab = tabs.find((tb) => tb.key === active)!;
  const accent = ACCENTS[active];
  const c = content[active];

  return (
    <View className="gap-3">
      <Text className="text-lg font-bold text-foreground">{t("home.exploreMore")}</Text>

      {/* Tabs */}
      <View className="flex-row gap-1.5 rounded-2xl border border-border bg-card p-1.5">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          const a = ACCENTS[tab.key];
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActive(tab.key)}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl px-2 py-2.5"
              style={isActive ? { backgroundColor: a.tabBg } : undefined}
            >
              <Icon size={15} color={isActive ? a.tabText : colors.mutedForeground} />
              <Text
                numberOfLines={1}
                className="text-xs font-semibold"
                style={{ color: isActive ? a.tabText : colors.mutedForeground }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Card */}
      <Pressable
        onPress={() => router.push(activeTab.to)}
        className="justify-between gap-5 rounded-2xl p-5"
        style={{ backgroundColor: accent.cardBg, minHeight: 180 }}
      >
        <View>
          {c.newLabel && (
            <View className="mb-2 self-start rounded-full px-2.5 py-1" style={{ backgroundColor: colors.info }}>
              <Text className="text-[11px] font-bold text-white">{c.newLabel}</Text>
            </View>
          )}
          <Text className="text-lg font-bold text-foreground">{c.title}</Text>
          <Text className="mt-2 text-sm leading-5 text-muted-foreground">{c.body}</Text>
        </View>

        <View className="flex-row items-center justify-between">
          {active === "partner" && partners.length > 0 ? (
            <View className="flex-row">
              {partners.map((p, i) => (
                <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                  {p.profile_image_url ? (
                    <Image
                      source={{ uri: p.profile_image_url }}
                      className="size-9 rounded-full border-2 border-white"
                    />
                  ) : (
                    <View
                      className="size-9 items-center justify-center rounded-full border-2 border-white"
                      style={{ backgroundColor: AVATAR_COLORS[p.id % AVATAR_COLORS.length] }}
                    >
                      <Text className="text-xs font-bold text-white">
                        {(p.agency_name ?? "M").slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : active === "estimate" ? (
            <Text className="text-sm font-semibold" style={{ color: accent.accent }}>
              {t("home.truEstimate.getStarted")}
            </Text>
          ) : active === "requests" ? (
            <Text className="text-sm font-semibold" style={{ color: accent.accent }}>
              {t("propertyRequest.list.newRequest")}
            </Text>
          ) : (
            <View />
          )}
          <ChevronRight size={20} color={accent.accent} />
        </View>
      </Pressable>
    </View>
  );
}
