import { useState } from "react";
import { Building2, LocateFixed, MapPin, Home, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { nearestDistrict } from "@/lib/geo";
import { districtsByCity } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";

const ONBOARDING_KEY = "maskan_onboarding_done";

export function hasSeenOnboarding(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return true; // fail safe: never block the page if storage is unavailable
  }
}

function markOnboardingSeen() {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    // ignore — private browsing etc.
  }
}

const CITIES = ["Riyadh", "Jeddah", "Dammam", "Khobar", "Madinah"];
const PROPERTY_TYPES = ["Apartment", "Villa", "Penthouse", "Townhouse"];

type Step = "intro" | "manual";

export function LocationOnboarding({
  onSelect,
}: {
  onSelect: (city: string, district: string, propertyType: string) => void;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>("intro");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [city, setCity] = useState("Riyadh");
  const [district, setDistrict] = useState<string>("Any");
  const [propertyType, setPropertyType] = useState<string>("Any");

  function finish(params: { city: string; district?: string; type?: string }) {
    markOnboardingSeen();
    onSelect(params.city, params.district ?? "Any", params.type ?? "Any");
  }

  function handleAllowLocation() {
    if (!("geolocation" in navigator)) {
      setLocationError(t("onboarding.locationUnavailable"));
      setStep("manual");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const match = nearestDistrict(latitude, longitude);
        setLocating(false);
        finish({ city: match.city, district: match.district });
      },
      () => {
        setLocating(false);
        setLocationError(t("onboarding.locationDenied"));
        setStep("manual");
      },
      { timeout: 8000 },
    );
  }

  function handleSkip() {
    setStep("manual");
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    finish({ city, district, type: propertyType });
  }

  function handleDismiss() {
    markOnboardingSeen();
    onSelect("Any", "Any", "Any");
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl sm:p-8">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("common.close")}
          className="absolute end-4 top-4 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        {step === "intro" && (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <LocateFixed className="size-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{t("onboarding.findHomesNearYou")}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t("onboarding.shareLocationDesc")}
              </p>
            </div>
            {locationError && <p className="text-xs text-destructive">{locationError}</p>}
            <div className="flex w-full flex-col gap-2.5">
              <Button
                size="lg"
                className="w-full"
                onClick={handleAllowLocation}
                disabled={locating}
              >
                <LocateFixed className="size-4" />{" "}
                {locating ? t("onboarding.locating") : t("onboarding.shareMyLocation")}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={handleSkip}
                disabled={locating}
              >
                {t("onboarding.tellUsManually")}
              </Button>
            </div>
          </div>
        )}

        {step === "manual" && (
          <form onSubmit={handleManualSubmit} className="space-y-5">
            <div className="text-center">
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <MapPin className="size-7" />
              </div>
              <h2 className="text-xl font-bold">{t("onboarding.whereLookingTitle")}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t("onboarding.whereLookingDesc")}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("onboarding.city")}</label>
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
              <label className="mb-1.5 block text-sm font-medium">
                {t("onboarding.areaDistrict")}
              </label>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              >
                <option value="Any">
                  {t("onboarding.anyAreaIn", { city: t(`cities.${city}`) })}
                </option>
                {(districtsByCity[city] ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {t("onboarding.propertyType")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPropertyType("Any")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                    propertyType === "Any"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface text-foreground hover:bg-surface-2",
                  )}
                >
                  <Home className="size-4" /> {t("onboarding.any")}
                </button>
                {PROPERTY_TYPES.map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setPropertyType(pt)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                      propertyType === pt
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-foreground hover:bg-surface-2",
                    )}
                  >
                    <Building2 className="size-4" /> {t(`propertyTypes.${pt}`)}
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full">
              {t("onboarding.showMeMatchingHomes")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
