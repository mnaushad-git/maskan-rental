import { View, Text, FlatList, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Building2 } from "lucide-react-native";
import { fetchProjects, mapApiProject } from "@/lib/api/maskan";
import type { Project } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { useFetch } from "@/lib/useFetch";
import { ProjectCard } from "@/components/ProjectCard";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { colors } from "@/lib/colors";

export default function ProjectsScreen() {
  const { t } = useLanguage();
  const {
    data,
    loading,
    refreshing,
    error,
    refresh,
  } = useFetch<Project[]>(() => fetchProjects().then((raw) => raw.map(mapApiProject)), []);
  const projects = data ?? [];

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} className="gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4">
            <Skeleton height={160} radius={16} />
            <Skeleton width="60%" height={16} />
            <Skeleton width="40%" height={12} />
          </View>
        ))}
      </SafeAreaView>
    );
  }

  if (error && projects.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <ErrorState onRetry={refresh} />
      </SafeAreaView>
    );
  }

  if (projects.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Building2 size={40} color={colors.neutral400} />
        <Text className="text-center text-lg font-semibold text-foreground">{t("projects.list.empty.heading")}</Text>
        <Text className="text-center text-sm text-muted-foreground">{t("projects.list.empty.desc")}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        contentContainerClassName="gap-4 p-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <Text className="mb-1 text-sm font-semibold text-muted-foreground">
            {t(projects.length === 1 ? "projects.list.countSingular" : "projects.list.countPlural", { count: projects.length })}
          </Text>
        }
        renderItem={({ item }) => <ProjectCard p={item} />}
      />
    </SafeAreaView>
  );
}
