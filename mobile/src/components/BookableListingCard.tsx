import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { BedDouble, Bath, Sofa, Maximize, MapPin } from "lucide-react-native";
import type { Property } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

/** Card for a short-term bookable stay — shows nightly price instead of
 * annual rent, links to the existing /property/[id] detail screen (no
 * separate booking-detail route; BookingCalendar there handles reserving). */
export function BookableListingCard({ p }: { p: Property }) {
  const { t } = useLanguage();

  return (
    <Link href={{ pathname: "/property/[id]", params: { id: p.id } }} asChild>
      <Pressable className="overflow-hidden rounded-2xl border border-border bg-background shadow-card">
        <View className="aspect-[4/3] overflow-hidden bg-surface-2">
          <Image source={{ uri: p.image }} className="size-full" contentFit="cover" />
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
          </View>

          <View className="flex-row items-center gap-4">
            <View className="flex-row items-center gap-1.5">
              <Maximize size={16} color={colors.mutedForeground} />
              <Text className="text-sm text-muted-foreground">{p.area} m²</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <BedDouble size={16} color={colors.mutedForeground} />
              <Text className="text-sm text-muted-foreground">{p.bedrooms}</Text>
            </View>
            {p.livingRooms != null && (
              <View className="flex-row items-center gap-1.5">
                <Sofa size={16} color={colors.mutedForeground} />
                <Text className="text-sm text-muted-foreground">{p.livingRooms}</Text>
              </View>
            )}
            <View className="flex-row items-center gap-1.5">
              <Bath size={16} color={colors.mutedForeground} />
              <Text className="text-sm text-muted-foreground">{p.bathrooms}</Text>
            </View>
          </View>

          <View className="border-t border-border pt-3">
            <Text className="text-lg font-bold tracking-tight text-foreground">
              SAR {formatSAR(p.nightlyRate ?? 0)}
              <Text className="text-xs font-medium text-muted-foreground"> {t("bookings.browse.perNight")}</Text>
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
