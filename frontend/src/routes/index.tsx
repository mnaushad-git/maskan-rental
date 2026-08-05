import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Building2,
  Calculator,
  ChevronRight,
  Facebook,
  Home,
  Instagram,
  Linkedin,
  Loader2,
  Map,
  MapPin,
  ShieldCheck,
  Sparkles,
  Twitter,
  Users,
} from "lucide-react";
import heroImg from "@/assets/hero-villa.jpg";
import { TopNav, Logo } from "@/components/maskan/TopNav";
import { Button } from "@/components/ui/button";
import { SearchBar, type SearchBarFilters } from "@/components/maskan/SearchBar";
import { Badge } from "@/components/maskan/Badges";
import { PropertyMapView } from "@/components/maskan/PropertyMapView";
import {
  fetchProperties,
  fetchPublicPartners,
  mapApiSearchProperty,
  type ApiProperty,
  type ApiPartnerPublic,
} from "@/lib/api/maskan";
import type { SearchProperty } from "@/lib/maskan-search-data";
import type { ListingType } from "@/lib/listingCategories";
import { LocationOnboarding, hasSeenOnboarding } from "@/components/maskan/LocationOnboarding";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Maskan — Find the Right Home with AI Rental Intelligence" },
      {
        name: "description",
        content:
          "Discover rental properties across Saudi Arabia. Compare areas, evaluate rental value, and find homes that match your lifestyle with Maskan's AI advisor.",
      },
      { property: "og:title", content: "Maskan — AI Rental Intelligence" },
      {
        property: "og:description",
        content:
          "Compare areas, evaluate rental value, and discover homes that match your lifestyle.",
      },
    ],
  }),
  component: Index,
});

const DEFAULT_FILTERS: SearchBarFilters = {
  listingType: "rent",
  city: "Riyadh",
  district: "Any",
  minRent: 0,
  maxRent: 500000,
  type: "Any",
};

function Index() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [filters, setFilters] = useState<SearchBarFilters>(DEFAULT_FILTERS);
  const [rawProperties, setRawProperties] = useState<ApiProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewPartners, setPreviewPartners] = useState<ApiPartnerPublic[]>([]);

  useEffect(() => {
    fetchProperties()
      .then(setRawProperties)
      .catch(() => setRawProperties([]))
      .finally(() => setLoading(false));
    fetchPublicPartners()
      .then((p) => setPreviewPartners(p.slice(0, 3)))
      .catch(() => {});
    if (!hasSeenOnboarding()) setShowOnboarding(true);
  }, []);

  const properties = useMemo<SearchProperty[]>(
    () => rawProperties.map(mapApiSearchProperty),
    [rawProperties],
  );

  const mapProperties = useMemo(() => {
    return properties.filter((p) => {
      if (p.listingType !== filters.listingType) return false;
      if (filters.city !== "Any" && p.city !== filters.city) return false;
      if (filters.district !== "Any" && p.district !== filters.district) return false;
      if (p.price < filters.minRent || p.price > filters.maxRent) return false;
      if (filters.type !== "Any" && p.type !== filters.type) return false;
      return true;
    });
  }, [properties, filters]);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <HomeSearchSection
        filters={filters}
        listingsCount={rawProperties.length}
        onSearch={(f) => setFilters(f)}
        onListingTypeChange={(v) =>
          setFilters((f) => ({
            ...f,
            listingType: v,
            type: "Any",
            minRent: 0,
            maxRent: v === "sale" ? 30_000_000 : 500_000,
          }))
        }
        onChangeLocation={() => setShowOnboarding(true)}
      />
      <HomeMapSection properties={mapProperties} loading={loading} filters={filters} />
      <FeaturesGrid partners={previewPartners} />
      <Footer />
      {showOnboarding && (
        <LocationOnboarding
          onSelect={(city, district, propertyType) => {
            setFilters((f) => ({ ...f, city, district, type: propertyType }));
            setShowOnboarding(false);
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------- Search section ----------------------------- */
function HomeSearchSection({
  filters,
  listingsCount,
  onSearch,
  onListingTypeChange,
  onChangeLocation,
}: {
  filters: SearchBarFilters;
  listingsCount: number;
  onSearch: (filters: SearchBarFilters) => void;
  onListingTypeChange: (v: ListingType) => void;
  onChangeLocation: () => void;
}) {
  const { t } = useLanguage();

  return (
    <section className="relative overflow-hidden bg-primary-soft">
      <div className="absolute inset-0">
        <img src={heroImg} alt="" className="size-full object-cover opacity-15" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary-soft/90 via-primary-soft/95 to-primary-soft" />
      </div>

      <div className="container-page relative py-6 sm:py-10 lg:py-12">
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={onChangeLocation}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-card transition-colors hover:bg-surface"
          >
            <MapPin className="size-3.5" /> {t("home.changeCity")}
          </button>
        </div>

        <SearchBar onSearch={onSearch} onListingTypeChange={onListingTypeChange} />

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Home className="size-4 text-primary" />
            {t(
              listingsCount === 1
                ? "home.stats.verifiedListingsSingular"
                : "home.stats.verifiedListingsPlural",
              { count: listingsCount },
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4 text-primary" /> {t("home.stats.trustedByRenters")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-primary" /> {t("home.stats.aiScoring")}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Map section ------------------------------ */
function HomeMapSection({
  properties,
  loading,
  filters,
}: {
  properties: SearchProperty[];
  loading: boolean;
  filters: SearchBarFilters;
}) {
  const { t } = useLanguage();
  const searchParams = {
    listingType: filters.listingType,
    ...(filters.city !== "Any" ? { city: filters.city } : {}),
    ...(filters.district !== "Any" ? { district: filters.district } : {}),
    ...(filters.type !== "Any" ? { type: filters.type } : {}),
    ...(filters.minRent > 0 ? { minRent: filters.minRent } : {}),
    ...(filters.maxRent < (filters.listingType === "sale" ? 30_000_000 : 500_000)
      ? { maxRent: filters.maxRent }
      : {}),
  } as never;

  return (
    <section className="container-page py-8 sm:py-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Badge tone="primary">
            <MapPin className="size-3.5" />
            {filters.city === "Any" ? t("map.allCities") : t(`cities.${filters.city}`)}
            {filters.district !== "Any" ? `, ${filters.district}` : ""}
          </Badge>
          <span className="text-muted-foreground">
            {loading
              ? t("common.loading")
              : t(
                  properties.length === 1 ? "map.propertyCountSingular" : "map.propertyCountPlural",
                  { count: properties.length },
                )}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
          <Link to="/search" search={searchParams}>
            {t("map.fullSearch")} <ArrowRight />
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid h-64 place-items-center rounded-2xl border border-border bg-surface lg:h-[480px]">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
          </div>
        </div>
      ) : properties.length === 0 ? (
        <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-border bg-surface text-center lg:h-[480px]">
          <div>
            <Building2 className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">{t("map.empty")}</p>
          </div>
        </div>
      ) : (
        <div className="relative">
          <PropertyMapView properties={properties} heightClassName="h-64 sm:h-80 lg:h-[480px]" />
          <div className="absolute inset-x-0 bottom-4 flex justify-center sm:hidden">
            <Button size="sm" className="shadow-elevated" asChild>
              <Link to="/search" search={searchParams}>
                <Map className="size-4" /> {t("home.viewFullMap")}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------- Features grid ----------------------------- */
const AVATAR_COLORS = [
  "bg-primary text-primary-foreground",
  "bg-emerald-600 text-white",
  "bg-violet-600 text-white",
];

function avatarInitials(p: ApiPartnerPublic) {
  const name = p.agency_name ?? `P${p.id}`;
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type FeatureTabKey = "partner" | "advisor" | "propertyRequest" | "estimate";

const FEATURE_ACCENT: Record<FeatureTabKey, { bg: string; text: string }> = {
  partner: { bg: "bg-secondary/10", text: "text-secondary" },
  advisor: { bg: "bg-ai-soft", text: "text-ai" },
  propertyRequest: { bg: "bg-ai-soft", text: "text-ai" },
  estimate: { bg: "bg-primary-soft", text: "text-primary" },
};

function FeaturesGrid({ partners }: { partners: ApiPartnerPublic[] }) {
  const { t } = useLanguage();
  const [active, setActive] = useState<FeatureTabKey>("partner");

  const tabs: Array<{
    key: FeatureTabKey;
    icon: typeof Briefcase;
    label: string;
    newLabel?: string;
    title: string;
    body: string;
    to: string;
  }> = [
    {
      key: "partner",
      icon: Briefcase,
      label: t("home.truPartner.badge"),
      newLabel: t("home.truPartner.new"),
      title: t("home.truPartner.title"),
      body: t("home.truPartner.body"),
      to: "/partners",
    },
    {
      key: "advisor",
      icon: Sparkles,
      label: t("home.truAIAdvisor.badge"),
      newLabel: t("home.truAIAdvisor.new"),
      title: t("home.truAIAdvisor.title"),
      body: t("home.truAIAdvisor.body"),
      to: "/advisor",
    },
    {
      key: "propertyRequest",
      icon: Sparkles,
      label: t("home.truPropertyRequest.badge"),
      newLabel: t("home.truPropertyRequest.new"),
      title: t("home.truPropertyRequest.title"),
      body: t("home.truPropertyRequest.body"),
      to: "/property-requests/new",
    },
    {
      key: "estimate",
      icon: Calculator,
      label: t("home.truEstimate.badge"),
      title: t("home.truEstimate.title"),
      body: t("home.truEstimate.body"),
      to: "/estimate",
    },
  ];

  const activeTab = tabs.find((tb) => tb.key === active)!;
  const accent = FEATURE_ACCENT[active];

  return (
    <section className="container-page py-8 sm:py-10">
      <h2 className="mb-5 font-display text-lg font-bold tracking-tight sm:text-xl">
        {t("home.exploreMore")}
      </h2>

      <div className="flex gap-1.5 rounded-2xl border border-border bg-surface p-1.5">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          const tabAccent = FEATURE_ACCENT[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-semibold transition-colors sm:text-sm",
                isActive
                  ? `${tabAccent.bg} ${tabAccent.text}`
                  : "text-muted-foreground hover:bg-surface-2",
              )}
            >
              <tab.icon className="size-4 shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <Link
        to={activeTab.to}
        className={cn(
          "group mt-3 flex flex-col justify-between overflow-hidden rounded-2xl p-6 shadow-card transition-transform hover:-translate-y-0.5 sm:min-h-60",
          accent.bg,
        )}
      >
        <div>
          {activeTab.newLabel && (
            <div className="mb-3">
              <Badge tone="info">{activeTab.newLabel}</Badge>
            </div>
          )}
          <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
            {activeTab.title}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">{activeTab.body}</p>
        </div>
        <div className="mt-5 flex items-center justify-between">
          {active === "partner" && partners.length > 0 ? (
            <div className="-space-x-2 flex">
              {partners.map((p) =>
                p.profile_image_url ? (
                  <img
                    key={p.id}
                    src={p.profile_image_url}
                    alt=""
                    className="size-9 rounded-full border-2 border-background object-cover"
                  />
                ) : (
                  <div
                    key={p.id}
                    className={`grid size-9 place-items-center rounded-full border-2 border-background text-xs font-bold ${AVATAR_COLORS[p.id % AVATAR_COLORS.length]}`}
                  >
                    {avatarInitials(p)}
                  </div>
                ),
              )}
            </div>
          ) : active === "estimate" ? (
            <span className={cn("text-sm font-semibold", accent.text)}>
              {t("home.truEstimate.getStarted")}
            </span>
          ) : (
            <span />
          )}
          <ChevronRight
            className={cn("size-5 transition-transform group-hover:translate-x-1", accent.text)}
          />
        </div>
      </Link>
    </section>
  );
}

/* --------------------------------- Footer -------------------------------- */
function Footer() {
  const { t } = useLanguage();
  const cols = [
    {
      h: t("footer.discover"),
      l: [
        { label: t("footer.links.search"), to: "/search" },
        { label: t("footer.links.exploreAreas"), to: "/areas" },
        { label: t("footer.links.aiAdvisor"), to: "/advisor" },
        { label: t("footer.links.partners"), to: "/partners" },
        { label: t("footer.links.savedHomes"), to: "/saved" },
        { label: t("footer.links.compare"), to: "/compare" },
        { label: t("footer.links.scoreMethodology"), to: "/methodology" },
      ],
    },
    {
      h: t("footer.citiesHeading"),
      l: [
        { label: t("cities.Riyadh"), to: "/search" },
        { label: t("cities.Jeddah"), to: "/search" },
        { label: t("cities.Dammam"), to: "/search" },
        { label: t("cities.Khobar"), to: "/search" },
        { label: t("cities.Madinah"), to: "/search" },
      ],
    },
  ] as const;

  return (
    <footer id="list" className="border-t border-border bg-background">
      <div className="container-page py-10 sm:py-14">
        <div className="grid gap-8 grid-cols-2 md:grid-cols-5">
          <div className="col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">{t("footer.tagline")}</p>
            <div className="mt-5 flex items-center gap-2">
              {[Twitter, Instagram, Linkedin, Facebook].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label="Social"
                  className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.h}>
              <div className="mb-3 text-sm font-semibold">{c.h}</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {c.l.map((i) => (
                  <li key={i.label}>
                    <Link to={i.to} className="hover:text-foreground">
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border bg-surface">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <Building2 className="size-3.5" />
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </div>
          <div>{t("footer.madeFor")}</div>
        </div>
      </div>
    </footer>
  );
}
