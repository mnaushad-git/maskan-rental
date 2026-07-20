import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchProperties, fetchPropertiesInBounds, mapApiSearchProperty, type ApiProperty } from "@/lib/api/maskan";
import type { SearchProperty } from "@/lib/maskan-search-data";
import type { ListingType } from "@/lib/listingCategories";
import { useLanguage } from "@/lib/i18n/context";
import { useFetch } from "@/lib/useFetch";
import { hasSeenOnboarding } from "@/lib/onboarding-storage";
import { PropertyMapView, type MapSearchBounds } from "@/components/PropertyMapView";
import { HomeSearchHeader } from "@/components/HomeSearchHeader";
import { HomeSheet } from "@/components/HomeSheet";
import { MoreWaysSection } from "@/components/MoreWaysSection";
import { HomeFilterSheet, type HomeFilterValue } from "@/components/HomeFilterSheet";
import { LocationOnboarding } from "@/components/LocationOnboarding";
import { ErrorState } from "@/components/ErrorState";

const NO_MAX = Number.MAX_SAFE_INTEGER;
const DEFAULT_FILTERS: HomeFilterValue = {
  listingType: "rent",
  city: "Any",
  district: "Any",
  propertyType: "Any",
  budgetIdx: 0,
  minBedrooms: 0,
};

export default function HomeScreen() {
  const { t } = useLanguage();
  const [listingType, setListingType] = useState<ListingType>("rent");
  const [category, setCategory] = useState("Any");
  const [showFilters, setShowFilters] = useState(false);
  const [mapCardOpen, setMapCardOpen] = useState(false);
  const [filterValue, setFilterValue] = useState<HomeFilterValue>(DEFAULT_FILTERS);
  const [adv, setAdv] = useState({ city: "Any", district: "Any", minRent: 0, maxRent: NO_MAX, minBedrooms: 0 });
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    hasSeenOnboarding().then((seen) => {
      if (!seen) setShowOnboarding(true);
    });
  }, []);

  const {
    data,
    loading,
    error,
    refresh,
  } = useFetch<SearchProperty[]>(
    () => fetchProperties().then((raw: ApiProperty[]) => raw.map(mapApiSearchProperty)),
    [],
  );
  // Once the user pans/zooms the map, this replaces the initial fixed list
  // with only the properties inside the currently visible bounds.
  const [mapOverride, setMapOverride] = useState<SearchProperty[] | null>(null);
  const regionSearchSeq = useRef(0);
  const handleRegionSearch = (bounds: MapSearchBounds) => {
    const seq = ++regionSearchSeq.current;
    fetchPropertiesInBounds(bounds)
      .then((raw: ApiProperty[]) => {
        // Drop stale responses if a later pan already kicked off a newer request.
        if (seq === regionSearchSeq.current) setMapOverride(raw.map(mapApiSearchProperty));
      })
      .catch(() => {
        /* keep showing whatever was already on screen if the region search fails */
      });
  };
  const properties = mapOverride ?? data ?? [];

  const filtered = useMemo(
    () =>
      properties.filter(
        (p) =>
          p.listingType === listingType &&
          (category === "Any" || p.type === category) &&
          (adv.city === "Any" || p.city === adv.city) &&
          (adv.district === "Any" || p.district === adv.district) &&
          p.price >= adv.minRent &&
          p.price <= adv.maxRent &&
          p.bedrooms >= adv.minBedrooms,
      ),
    [properties, listingType, category, adv],
  );

  return (
    <View className="flex-1 bg-background">
      {/* Full-screen map. Raised above the HomeSheet while a marker's preview
          card is open, since the card floats near the bottom edge and would
          otherwise render underneath the sheet's peeked content. */}
      <View className="flex-1" style={{ zIndex: mapCardOpen ? 20 : 0 }}>
        {loading ? (
          <View className="flex-1 items-center justify-center bg-surface">
            <ActivityIndicator color="#2563EB" />
          </View>
        ) : error && properties.length === 0 ? (
          <View className="flex-1 items-center justify-center bg-surface">
            <ErrorState onRetry={refresh} />
          </View>
        ) : (
          <PropertyMapView
            chromeless
            properties={filtered}
            style={{ flex: 1 }}
            onSelectedChange={(p) => setMapCardOpen(!!p)}
            onRegionSearch={handleRegionSearch}
          />
        )}
      </View>

      {/* Fixed floating search header over the map */}
      <SafeAreaView edges={["top"]} className="absolute inset-x-0 top-0" style={{ zIndex: 30 }}>
        <View className="px-3 pt-1">
          <HomeSearchHeader
            listingType={listingType}
            onListingType={(v) => {
              setListingType(v);
              setCategory("Any");
              setFilterValue((f) => ({ ...f, listingType: v, propertyType: "Any", budgetIdx: 0 }));
            }}
            category={category}
            onCategory={(c) => {
              setCategory(c);
              setFilterValue((f) => ({ ...f, propertyType: c }));
            }}
            onFilters={() => setShowFilters(true)}
          />
        </View>
      </SafeAreaView>

      {/* Pull-up bottom sheet: listing count + More ways + New listings */}
      <HomeSheet
        header={
          <View className="pb-0.5">
            <Text className="text-base font-bold text-foreground">
              {t(filtered.length === 1 ? "map.propertyCountSingular" : "map.propertyCountPlural", {
                count: filtered.length,
              })}
            </Text>
          </View>
        }
      >
        <MoreWaysSection />
      </HomeSheet>

      {/* All-filters sheet over the map — city, district, type, budget, bedrooms */}
      <HomeFilterSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        value={filterValue}
        onApply={(r) => {
          setListingType(r.listingType);
          setCategory(r.propertyType);
          setAdv({
            city: r.city,
            district: r.district,
            minRent: r.minRent,
            maxRent: r.maxRent,
            minBedrooms: r.minBedrooms,
          });
          setFilterValue(r.value);
        }}
      />

      {showOnboarding && (
        <LocationOnboarding
          onSelect={(city, district, propertyType) => {
            setCategory(propertyType);
            setAdv((a) => ({ ...a, city, district }));
            setFilterValue((f) => ({ ...f, city, district, propertyType }));
            setShowOnboarding(false);
          }}
        />
      )}
    </View>
  );
}
