import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { MapPin, Building2, FileText, Maximize, Layers, BedDouble, Bath, Sofa, School, Hospital, MessageCircle, Phone } from "lucide-react-native";
import { fetchProject, mapApiProject, fetchAreaIntelligence, type ApiAreaIntelligence } from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import type { Project } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { whatsappLink } from "@/lib/whatsapp";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Accordion } from "@/components/ui/Accordion";
import { Badge } from "@/components/Badges";
import { PropertyImageGallery } from "@/components/PropertyImageGallery";
import { PropertyLocationMap } from "@/components/PropertyLocationMap";
import { ProjectSimilarListings } from "@/components/ProjectSimilarListings";
import { colors } from "@/lib/colors";

const DESCRIPTION_PREVIEW_LENGTH = 220;

function priceRangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min !== max) return `SAR ${formatSAR(min)} – ${formatSAR(max)}`;
  return `SAR ${formatSAR(min ?? max ?? 0)}`;
}

function areaRangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min !== max) return `${min} – ${max} m²`;
  return `${min ?? max} m²`;
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [areaIntel, setAreaIntel] = useState<ApiAreaIntelligence | null>(null);

  const load = useCallback(() => {
    if (!id || Number.isNaN(Number(id))) {
      setError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    fetchProject(Number(id))
      .then((raw) => setProject(mapApiProject(raw)))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    fetchAreaIntelligence(project.district, project.city)
      .then((data) => !cancelled && setAreaIntel(data))
      .catch(() => !cancelled && setAreaIntel(null));
    return () => {
      cancelled = true;
    };
  }, [project?.district, project?.city]);

  if (loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Skeleton height={260} radius={20} />
        <Skeleton width="60%" height={24} />
        <Skeleton width="40%" height={16} />
        <Skeleton height={100} radius={16} />
      </SafeAreaView>
    );
  }

  if (error || !project) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center bg-background p-6">
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  const waLink = project.agentWhatsapp
    ? whatsappLink(project.agentWhatsapp)
    : project.agentPhone
      ? whatsappLink(project.agentPhone)
      : undefined;
  const fullDescription = project.description ?? "";
  const landmarks = [
    ...(areaIntel?.schools ?? []).map((s) => ({ name: s.name, distanceKm: s.distance_km, Icon: School })),
    ...(areaIntel?.hospitals ?? []).map((h) => ({ name: h.name, distanceKm: h.distance_km, Icon: Hospital })),
  ];

  function handleContact() {
    if (!project) return;
    router.push({
      pathname: "/lead/new",
      params: {
        city: project.city,
        district: project.district,
        note: t("projects.detail.contactNoteTemplate", { title: project.title }),
      },
    });
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: project.title }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        <View className="relative">
          <PropertyImageGallery images={project.images} />
        </View>

        <View className="gap-5 p-5">
          <View>
            <View className="flex-row flex-wrap gap-1.5">
              {project.category && <Badge tone="neutral">{project.category}</Badge>}
              {project.completionStatus && <Badge tone="secondary">{project.completionStatus}</Badge>}
              <Badge tone={project.status === "Available" ? "success" : "neutral"}>{project.status}</Badge>
            </View>
            <Text className="mt-2 font-bold text-xl text-foreground">{project.title}</Text>
            <View className="mt-1 flex-row items-center gap-1">
              <MapPin size={14} color={colors.mutedForeground} />
              <Text className="text-sm text-muted-foreground">
                {project.district}, {project.city}
              </Text>
            </View>
          </View>

          {project.developerName && (
            <View className="flex-row items-center gap-3 rounded-xl border border-border p-4">
              <View className="size-10 items-center justify-center rounded-lg bg-surface-2">
                <Building2 size={20} color={colors.foreground} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground">{project.developerName}</Text>
                <Text className="text-xs text-muted-foreground">
                  {project.district}, {project.city}
                </Text>
              </View>
            </View>
          )}

          {/* Details of available units */}
          <View className="flex-row flex-wrap gap-x-6 gap-y-4 border-y border-border py-4">
            <View className="flex-row items-center gap-1.5">
              <Layers size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">
                {project.unitCount != null ? t("projects.detail.unitCount", { count: project.unitCount }) : "—"}
              </Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Maximize size={18} color={colors.foreground} />
              <Text className="text-sm text-foreground">{areaRangeLabel(project.areaMin, project.areaMax)}</Text>
            </View>
          </View>
          <Text className="-mt-3 text-base font-bold text-foreground">
            {priceRangeLabel(project.priceMin, project.priceMax)}
          </Text>

          {/* Description */}
          {!!fullDescription && (
            <View>
              <Text className="text-sm leading-5 text-foreground">
                {descExpanded || fullDescription.length <= DESCRIPTION_PREVIEW_LENGTH
                  ? fullDescription
                  : `${fullDescription.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`}
              </Text>
              {fullDescription.length > DESCRIPTION_PREVIEW_LENGTH && (
                <Pressable onPress={() => setDescExpanded((v) => !v)} className="mt-1">
                  <Text className="text-sm font-semibold text-primary">
                    {descExpanded ? t("property.readLess") : t("property.readMore")}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Know More */}
          <View className="rounded-xl border border-border p-4">
            <Text className="mb-1 text-sm font-semibold text-foreground">{t("projects.detail.knowMore")}</Text>
            {project.introDocumentUrl && (
              <Pressable
                onPress={() => Linking.openURL(project.introDocumentUrl!)}
                className="flex-row items-center gap-2 py-2.5"
              >
                <FileText size={16} color={colors.primary} />
                <Text className="text-sm font-semibold text-primary">{t("projects.detail.introducingDocument")}</Text>
              </Pressable>
            )}
            {landmarks.length > 0 && (
              <Accordion title={t("projects.detail.nearbyLandmarks")}>
                {landmarks.map((l, i) => (
                  <View key={`${l.name}-${i}`} className="flex-row items-center justify-between py-1.5">
                    <View className="flex-row items-center gap-2">
                      <l.Icon size={16} color={colors.mutedForeground} />
                      <Text className="text-sm text-muted-foreground">{l.name}</Text>
                    </View>
                    <Text className="text-sm font-semibold text-foreground">{l.distanceKm} km</Text>
                  </View>
                ))}
              </Accordion>
            )}
          </View>

          <PropertyLocationMap
            latitude={project.latitude}
            longitude={project.longitude}
            district={project.district}
            city={project.city}
            title={project.title}
          />

          {/* Units */}
          {project.units.length > 0 && (
            <View className="gap-3">
              <Text className="text-sm font-bold text-foreground">{t("projects.detail.units")}</Text>
              {project.units.map((unit) => (
                <View key={unit.id} className="gap-2 rounded-xl border border-border p-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-foreground">{unit.unitType}</Text>
                    <Text className="text-base font-bold text-foreground">SAR {formatSAR(unit.price)}</Text>
                  </View>
                  <View className="flex-row flex-wrap items-center gap-4">
                    {unit.areaSqm != null && (
                      <View className="flex-row items-center gap-1.5">
                        <Maximize size={14} color={colors.mutedForeground} />
                        <Text className="text-xs text-muted-foreground">{unit.areaSqm} m²</Text>
                      </View>
                    )}
                    {unit.bedrooms != null && (
                      <View className="flex-row items-center gap-1.5">
                        <BedDouble size={14} color={colors.mutedForeground} />
                        <Text className="text-xs text-muted-foreground">{unit.bedrooms}</Text>
                      </View>
                    )}
                    {unit.bathrooms != null && (
                      <View className="flex-row items-center gap-1.5">
                        <Bath size={14} color={colors.mutedForeground} />
                        <Text className="text-xs text-muted-foreground">{unit.bathrooms}</Text>
                      </View>
                    )}
                    {unit.livingRooms != null && (
                      <View className="flex-row items-center gap-1.5">
                        <Sofa size={14} color={colors.mutedForeground} />
                        <Text className="text-xs text-muted-foreground">{unit.livingRooms}</Text>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          <ProjectSimilarListings excludeId={project.id} />
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} className="border-t border-border bg-background/95 px-4 pt-3">
        <View className="flex-row items-center gap-3 pb-3">
          <View className="min-w-0 flex-1">
            <Text className="text-[11px] text-muted-foreground">{t("projects.list.startingFrom")}</Text>
            <Text numberOfLines={1} className="text-base font-bold text-foreground">
              {priceRangeLabel(project.priceMin, project.priceMax)}
            </Text>
          </View>
          {project.agentPhone ? (
            <>
              <Pressable
                onPress={() => waLink && Linking.openURL(waLink)}
                className="flex-row items-center gap-1.5 rounded-xl px-4 py-2.5"
                style={{ backgroundColor: colors.whatsapp }}
              >
                <MessageCircle size={16} color="#FFFFFF" />
                <Text className="text-sm font-semibold text-white">{t("propertyCard.whatsapp")}</Text>
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL(`tel:${project.agentPhone}`)}
                className="flex-row items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5"
              >
                <Phone size={16} color={colors.foreground} />
                <Text className="text-sm font-semibold text-foreground">{t("propertyCard.call")}</Text>
              </Pressable>
            </>
          ) : (
            <Button onPress={handleContact}>{t("projects.detail.contact")}</Button>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
