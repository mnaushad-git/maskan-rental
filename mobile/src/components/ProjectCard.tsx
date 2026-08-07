import { View, Text } from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable } from "react-native";
import { MapPin, Building2 } from "lucide-react-native";
import type { Project } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { Badge } from "./Badges";
import { colors } from "@/lib/colors";

export function ProjectCard({ p }: { p: Project }) {
  const { t } = useLanguage();

  return (
    <Link href={{ pathname: "/project/[id]", params: { id: p.id } }} asChild>
      <Pressable className="overflow-hidden rounded-2xl border border-border bg-background shadow-card">
        <View className="relative aspect-[4/3] overflow-hidden bg-surface-2">
          <Image source={{ uri: p.image }} className="size-full" contentFit="cover" />
          <View className="absolute inset-x-3 top-3 flex-row flex-wrap items-start gap-1.5">
            {p.isFeatured && <Badge tone="ai">{t("projects.list.featured")}</Badge>}
            {p.category && <Badge tone="neutral">{p.category}</Badge>}
            {p.completionStatus && <Badge tone="secondary">{p.completionStatus}</Badge>}
          </View>
        </View>

        <View className="gap-3 p-5">
          <View>
            <Text numberOfLines={1} className="text-base font-semibold tracking-tight text-foreground">
              {p.title}
            </Text>
            <View className="mt-1 flex-row items-center gap-1">
              <MapPin size={14} color={colors.mutedForeground} />
              <Text className="text-sm text-muted-foreground">
                {p.district}, {p.city}
              </Text>
            </View>
            {p.developerName && (
              <View className="mt-1 flex-row items-center gap-1">
                <Building2 size={14} color={colors.mutedForeground} />
                <Text className="text-sm text-muted-foreground">{p.developerName}</Text>
              </View>
            )}
          </View>

          <View className="flex-row items-end justify-between border-t border-border pt-3">
            <View>
              <Text className="text-xs text-muted-foreground">{t("projects.list.startingFrom")}</Text>
              <Text className="text-lg font-bold tracking-tight text-foreground">
                {p.priceMin != null ? `SAR ${formatSAR(p.priceMin)}` : t("projects.list.priceOnRequest")}
              </Text>
            </View>
            {p.unitCount != null && (
              <Text className="text-xs text-muted-foreground">{t("projects.list.unitsCount", { count: p.unitCount })}</Text>
            )}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
