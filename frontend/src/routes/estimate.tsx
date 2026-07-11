import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Calculator, Home, MapPin, Sparkles } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { fetchAreas, type ApiAreaSummary } from "@/lib/api/maskan";
import { districtsByCity } from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/estimate")({
  head: () => ({
    meta: [
      { title: "TruEstimate™ — Rent Estimator | Maskan" },
      {
        name: "description",
        content:
          "Get an instant, data-backed estimate of what your property could rent for, based on live listings across Saudi Arabia.",
      },
    ],
  }),
  component: EstimatePage,
});

const CITIES = ["Riyadh", "Jeddah", "Dammam", "Khobar", "Madinah"];
const PROPERTY_TYPES = [
  { label: "Apartment", factor: 1 },
  { label: "Villa", factor: 1.35 },
  { label: "Penthouse", factor: 1.5 },
  { label: "Townhouse", factor: 1.15 },
] as const;

function typeFactorFor(type: string): number {
  return PROPERTY_TYPES.find((t) => t.label === type)?.factor ?? 1;
}

function EstimatePage() {
  const { t } = useLanguage();
  const [areas, setAreas] = useState<ApiAreaSummary[]>([]);
  const [city, setCity] = useState("Riyadh");
  const [district, setDistrict] = useState("Any");
  const [bedrooms, setBedrooms] = useState(3);
  const [type, setType] = useState<string>("Apartment");
  const [size, setSize] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetchAreas()
      .then(setAreas)
      .catch(() => setAreas([]));
  }, []);

  const districts = districtsByCity[city] ?? [];

  const estimate = useMemo(() => {
    const cityAreas = areas.filter(
      (a) => a.city === city || (city === "Khobar" && a.city === "Al Khobar"),
    );
    const matched = district !== "Any" ? cityAreas.find((a) => a.name === district) : null;
    const base =
      matched?.average_rent ??
      (cityAreas.length > 0
        ? cityAreas.reduce((s, a) => s + a.average_rent, 0) / cityAreas.length
        : 6000);

    const bedroomFactor = 1 + (bedrooms - 3) * 0.12;
    const typeFactor = typeFactorFor(type);
    const sizeNum = Number(size);
    const typicalSize = bedrooms * 70;
    const sizeFactor = sizeNum > 0 ? Math.max(0.7, Math.min(1.6, sizeNum / typicalSize)) : 1;

    const monthly = base * bedroomFactor * typeFactor * sizeFactor;
    const annual = monthly * 12;

    return {
      monthlyLow: Math.round((monthly * 0.9) / 100) * 100,
      monthlyHigh: Math.round((monthly * 1.1) / 100) * 100,
      annualLow: Math.round((annual * 0.9) / 100) * 100,
      annualHigh: Math.round((annual * 1.1) / 100) * 100,
      sampleSize: matched?.property_count ?? cityAreas.reduce((s, a) => s + a.property_count, 0),
      basedOn: matched ? `${district}, ${city}` : t("estimate.cityAverage", { city }),
    };
  }, [areas, city, district, bedrooms, type, size, t]);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container-page py-8 sm:py-12">
        <Badge tone="primary" className="mb-3">
          <Calculator className="size-3.5" /> {t("estimate.badge")}
        </Badge>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {t("estimate.heading")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          {t("estimate.subtitle")}
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Form */}
          <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("estimate.city")}</label>
              <div className="grid grid-cols-3 gap-2">
                {CITIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCity(c);
                      setDistrict("Any");
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                      city === c
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-foreground hover:bg-surface-2",
                    )}
                  >
                    {t(`cities.${c}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("estimate.areaDistrict")}</label>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              >
                <option value="Any">{t("estimate.anyAreaIn", { city: t(`cities.${city}`) })}</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("estimate.bedrooms")}</label>
              <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBedrooms(n)}
                    className={cn(
                      "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
                      bedrooms === n
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("estimate.propertyType")}</label>
              <div className="grid grid-cols-2 gap-2">
                {PROPERTY_TYPES.map((pt) => (
                  <button
                    key={pt.label}
                    type="button"
                    onClick={() => setType(pt.label)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                      type === pt.label
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-foreground hover:bg-surface-2",
                    )}
                  >
                    <Building2 className="size-4" /> {t(`propertyTypes.${pt.label}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("estimate.sizeLabel")} <span className="font-normal text-muted-foreground">{t("estimate.sizeOptional")}</span>
              </label>
              <input
                type="number"
                min={0}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder={t("estimate.sizePlaceholder", { size: bedrooms * 70 })}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </div>

            <Button size="lg" className="w-full" onClick={() => setSubmitted(true)}>
              <Calculator className="size-4" /> {t("estimate.getMyEstimate")}
            </Button>
          </div>

          {/* Result */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
            {!submitted ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                  <Home className="size-7" />
                </div>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {t("estimate.emptyPrompt")}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className="grid size-9 place-items-center rounded-xl bg-primary-soft">
                    <Sparkles className="size-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">{t("estimate.resultHeading")}</h2>
                    <p className="text-xs text-muted-foreground">
                      {estimate.sampleSize > 0
                        ? t("estimate.basedOnWithListings", { basis: estimate.basedOn, count: estimate.sampleSize })
                        : t("estimate.basedOn", { basis: estimate.basedOn })}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/8 p-5 text-center">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("estimate.monthlyRent")}
                  </div>
                  <div className="mt-1 text-3xl font-bold tracking-tight text-primary">
                    SAR {formatSAR(estimate.monthlyLow)} – {formatSAR(estimate.monthlyHigh)}
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm">
                    <span className="text-muted-foreground">{t("estimate.annualRentRange")}</span>
                    <span className="font-semibold tabular-nums">
                      SAR {formatSAR(estimate.annualLow)} – {formatSAR(estimate.annualHigh)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-surface px-4 py-3 text-sm">
                    <span className="text-muted-foreground">{t("estimate.property")}</span>
                    <span className="font-semibold">
                      {size
                        ? t("estimate.propertySummaryWithSize", { bedrooms, type: t(`propertyTypes.${type}`), size })
                        : t("estimate.propertySummary", { bedrooms, type: t(`propertyTypes.${type}`) })}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {t("estimate.disclaimer")}
                </p>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" className="flex-1" asChild>
                    <Link
                      to="/search"
                      search={
                        {
                          city,
                          ...(district !== "Any" ? { district } : {}),
                          type,
                        } as never
                      }
                    >
                      <MapPin className="size-4" /> {t("estimate.viewSimilarListings")}
                    </Link>
                  </Button>
                  <Button variant="hero" className="flex-1" asChild>
                    <Link
                      to="/lead/new"
                      search={{ area: district !== "Any" ? district : "", city }}
                    >
                      {t("estimate.submitLeadRequest")} <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
