import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Bell, List, Map as MapIcon, Search as SearchIcon, SearchX, X, FileText } from "lucide-react-native";
import { fetchProperties, mapApiSearchProperty, searchProperties, type ApiProperty } from "@/lib/api/maskan";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";
import { useFetch } from "@/lib/useFetch";
import { useAuth } from "@/lib/auth-context";
import { SearchBar, type SearchBarFilters } from "@/components/SearchBar";
import { SaveSearchSheet } from "@/components/SaveSearchSheet";
import { PropertyMapView } from "@/components/PropertyMapView";
import { PropertyCard } from "@/components/PropertyCard";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PropertyCardSkeleton } from "@/components/ui/Skeleton";
import { Chip } from "@/components/ui/Chip";
import { Banner } from "@/components/ui/Banner";
import { toCardProperty } from "@/lib/maskan-data";
import { colors } from "@/lib/colors";

type SortKey = "score" | "priceAsc" | "priceDesc";
const PAGE_SIZE = 20;
const DEFAULT_SEARCH_FILTERS: SearchBarFilters = { listingType: "rent", city: "Any", district: "Any", minRent: 0, maxRent: 500_000, type: "Any" };

export default function SearchScreen() {
  const { t } = useLanguage();
  const router = useRouter();
  const rawParams = useLocalSearchParams();
  const params = rawParams as Partial<Record<keyof SearchBarFilters, string>>;
  const [filters, setFilters] = useState<SearchBarFilters | null>(() =>
    params.listingType
      ? {
          listingType: (params.listingType as SearchBarFilters["listingType"]) ?? "rent",
          city: params.city ?? "Any",
          district: params.district ?? "Any",
          type: params.type ?? "Any",
          minRent: params.minRent ? Number(params.minRent) : 0,
          maxRent: params.maxRent ? Number(params.maxRent) : 500_000,
        }
      : null,
  );
  const [view, setView] = useState<"list" | "map">("list");
  const [sort, setSort] = useState<SortKey>("score");
  const [sortOpen, setSortOpen] = useState(false);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const { user } = useAuth();

  // Free-text keyword search — debounced, hits the server-side /search
  // endpoint (real pagination + total count) instead of the flat
  // fetchProperties() batch used when there's no keyword.
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onChangeQuery(text: string) {
    setQueryInput(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(text.trim()), 400);
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const isKeywordSearch = query.length > 0;

  // ── Default (no keyword) mode: fetch-all + client-side filter, unchanged ──
  const { data, loading, error, refreshing, refresh } = useFetch<SearchProperty[]>(
    () => fetchProperties().then((raw: ApiProperty[]) => raw.map(mapApiSearchProperty)),
    [],
  );
  const all = data ?? [];

  const filteredResults = useMemo(() => {
    if (!filters) return all;
    return all.filter((p) => {
      if (p.listingType !== filters.listingType) return false;
      if (filters.city !== "Any" && p.city !== filters.city) return false;
      if (filters.district !== "Any" && p.district !== filters.district) return false;
      if (filters.type !== "Any" && p.type !== filters.type) return false;
      if (p.price < filters.minRent || p.price > filters.maxRent) return false;
      return true;
    });
  }, [all, filters]);

  // ── Keyword mode: server-paginated ──
  const [keywordResults, setKeywordResults] = useState<SearchProperty[]>([]);
  const [keywordTotal, setKeywordTotal] = useState(0);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordLoadingMore, setKeywordLoadingMore] = useState(false);
  const [keywordError, setKeywordError] = useState(false);

  useEffect(() => {
    if (!isKeywordSearch) return;
    let cancelled = false;
    setKeywordLoading(true);
    setKeywordError(false);
    searchProperties({
      q: query,
      listingType: filters?.listingType,
      city: filters && filters.city !== "Any" ? filters.city : undefined,
      area: filters && filters.district !== "Any" ? filters.district : undefined,
      minPrice: filters?.minRent || undefined,
      maxPrice: filters?.maxRent || undefined,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((res) => {
        if (cancelled) return;
        setKeywordResults(res.results.map(mapApiSearchProperty));
        setKeywordTotal(res.total);
      })
      .catch(() => !cancelled && setKeywordError(true))
      .finally(() => !cancelled && setKeywordLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters?.listingType, filters?.city, filters?.district, filters?.minRent, filters?.maxRent, isKeywordSearch]);

  function loadMoreKeywordResults() {
    if (keywordLoadingMore || keywordResults.length >= keywordTotal) return;
    setKeywordLoadingMore(true);
    searchProperties({
      q: query,
      listingType: filters?.listingType,
      city: filters && filters.city !== "Any" ? filters.city : undefined,
      area: filters && filters.district !== "Any" ? filters.district : undefined,
      minPrice: filters?.minRent || undefined,
      maxPrice: filters?.maxRent || undefined,
      limit: PAGE_SIZE,
      offset: keywordResults.length,
    })
      .then((res) => setKeywordResults((prev) => [...prev, ...res.results.map(mapApiSearchProperty)]))
      .catch(() => {})
      .finally(() => setKeywordLoadingMore(false));
  }

  const baseResults = isKeywordSearch ? keywordResults : filteredResults;
  const results = useMemo(() => {
    const sorted = [...baseResults];
    if (sort === "priceAsc") sorted.sort((a, b) => a.price - b.price);
    else if (sort === "priceDesc") sorted.sort((a, b) => b.price - a.price);
    else sorted.sort((a, b) => b.matchScore - a.matchScore);
    return sorted;
  }, [baseResults, sort]);

  const resultCount = isKeywordSearch ? keywordTotal : filteredResults.length;
  const isLoading = isKeywordSearch ? keywordLoading : loading;
  const isError = isKeywordSearch ? keywordError : error;

  const activeFilterChips = filters
    ? [
        filters.city !== "Any" && (filters.district !== "Any" ? `${filters.district}, ${filters.city}` : filters.city),
        filters.type !== "Any" && t(`propertyTypes.${filters.type}`),
        (filters.minRent > 0 || filters.maxRent < 500_000) &&
          `SAR ${Math.round(filters.minRent / 1000)}K–${Math.round(filters.maxRent / 1000)}K`,
      ].filter((v): v is string => !!v)
    : [];

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "score", label: t("search.sortBestScore") },
    { key: "priceAsc", label: t("search.sortPriceLowHigh") },
    { key: "priceDesc", label: t("search.sortPriceHighLow") },
  ];

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-background px-3">
          <SearchIcon size={16} color={colors.mutedForeground} />
          <TextInput
            value={queryInput}
            onChangeText={onChangeQuery}
            placeholder={t("search.keywordPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            className="flex-1 py-3 text-sm text-foreground"
          />
          {queryInput.length > 0 && (
            <Pressable onPress={() => onChangeQuery("")} accessibilityLabel={t("search.clear")}>
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        <SearchBar onSearch={setFilters} onListingTypeChange={(v) => setFilters((f) => (f ? { ...f, listingType: v } : f))} />

        {activeFilterChips.length > 0 && (
          <View className="flex-row flex-wrap items-center gap-2">
            {activeFilterChips.map((label) => (
              <View key={label} className="rounded-full border border-border bg-surface px-3 py-1.5">
                <Text className="text-xs font-medium text-foreground">{label}</Text>
              </View>
            ))}
            <Pressable onPress={() => setFilters(null)} className="rounded-full px-3 py-1.5">
              <Text className="text-xs font-semibold text-primary">{t("search.clearAll")}</Text>
            </Pressable>
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-muted-foreground">
            {isLoading
              ? t("common.loading")
              : t(resultCount === 1 ? "search.resultsHeadingSingular" : "search.resultsHeadingPlural", {
                  count: resultCount,
                })}
          </Text>
          <View className="flex-row items-center gap-1">
            <Pressable
              onPress={() => (user ? setSaveSheetOpen(true) : router.push("/auth/login"))}
              accessibilityRole="button"
              accessibilityLabel={t("savedSearches.saveButton")}
              className="me-1 flex-row items-center gap-1 rounded-lg px-2 py-1"
            >
              <Bell size={14} color={colors.primary} />
              <Text className="text-xs font-semibold text-primary">{t("savedSearches.saveButton")}</Text>
            </Pressable>
            <Pressable
              onPress={() => setSortOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel={t("search.sortBy")}
              className="me-1 rounded-lg px-2 py-1"
            >
              <Text className="text-xs font-semibold text-primary">
                {sortOptions.find((o) => o.key === sort)?.label}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setView("list")}
              accessibilityRole="button"
              accessibilityLabel={t("search.listView")}
              accessibilityState={{ selected: view === "list" }}
              className={`size-9 items-center justify-center rounded-lg ${view === "list" ? "bg-primary-soft" : ""}`}
            >
              <List size={18} color={view === "list" ? colors.primary : colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={() => setView("map")}
              accessibilityRole="button"
              accessibilityLabel={t("search.mapView")}
              accessibilityState={{ selected: view === "map" }}
              className={`size-9 items-center justify-center rounded-lg ${view === "map" ? "bg-primary-soft" : ""}`}
            >
              <MapIcon size={18} color={view === "map" ? colors.primary : colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {sortOpen && (
          <View className="flex-row flex-wrap gap-2">
            {sortOptions.map((o) => (
              <Chip key={o.key} selected={sort === o.key} onPress={() => { setSort(o.key); setSortOpen(false); }}>
                {o.label}
              </Chip>
            ))}
          </View>
        )}
      </View>

      {isLoading ? (
        <View className="flex-1 gap-4 p-4 pt-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <PropertyCardSkeleton key={i} />
          ))}
        </View>
      ) : isError && baseResults.length === 0 ? (
        <ErrorState onRetry={isKeywordSearch ? () => setQuery((q) => q) : refresh} />
      ) : view === "map" ? (
        <View className="flex-1 px-4 pb-4">
          <PropertyMapView properties={results} style={{ flex: 1 }} />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          contentContainerClassName="gap-4 p-4 pt-0"
          renderItem={({ item }) => <PropertyCard p={toCardProperty(item)} />}
          refreshControl={
            !isKeywordSearch ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} /> : undefined
          }
          onEndReachedThreshold={0.4}
          onEndReached={isKeywordSearch ? loadMoreKeywordResults : undefined}
          ListFooterComponent={
            <View className="gap-4 pt-2">
              {isKeywordSearch && keywordLoadingMore && <ActivityIndicator color={colors.primary} />}
              {results.length > 0 && (
                <Banner
                  tone="primary"
                  icon={<FileText size={18} color={colors.primary} />}
                  title={t("search.cantFindTitle")}
                  description={t("search.cantFindDesc", { city: filters?.city !== "Any" ? filters?.city ?? "" : "" })}
                  actionLabel={t("search.submitLeadRequest")}
                  onAction={() => router.push("/lead/new")}
                />
              )}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon={<SearchX size={32} color={colors.mutedForeground} />}
              title={t("search.noMatchesTitle")}
              description={t("search.noMatchesDesc")}
            />
          }
        />
      )}

      <SaveSearchSheet
        visible={saveSheetOpen}
        onClose={() => setSaveSheetOpen(false)}
        filters={filters ?? DEFAULT_SEARCH_FILTERS}
        query={query}
      />
    </SafeAreaView>
  );
}
