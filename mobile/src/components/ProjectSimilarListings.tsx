import { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { fetchSimilarProjects, mapApiProject } from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { ProjectCard } from "./ProjectCard";
import type { Project } from "@/lib/maskan-data";

/** Horizontal rail of other projects near this one — backed by
 * /projects/{id}/similar (same city, closest price), mirroring
 * PropertySimilarListings' pattern for the property detail screen. */
export function ProjectSimilarListings({ excludeId }: { excludeId: string }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Project[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSimilarProjects(Number(excludeId))
      .then((results) => {
        if (cancelled) return;
        setItems(results.map(mapApiProject));
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [excludeId]);

  if (!items || items.length === 0) return null;

  return (
    <View className="gap-3">
      <View>
        <Text className="text-sm font-bold text-foreground">{t("projects.detail.nearbyProjects")}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 pe-1">
        {items.map((p) => (
          <View key={p.id} style={{ width: 260 }}>
            <ProjectCard p={p} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
