import { useState } from "react";
import { View, Text, Pressable, Modal, ActivityIndicator } from "react-native";
import * as Location from "expo-location";
import { Building2, LocateFixed, MapPin, Home, X } from "lucide-react-native";
import { nearestDistrict } from "@/lib/geo";
import { districtsByCity } from "@/lib/maskan-search-data";
import { markOnboardingSeen } from "@/lib/onboarding-storage";
import { useLanguage } from "@/lib/i18n/context";
import { OptionModal } from "./SelectField";
import { colors } from "@/lib/colors";

// Mirrors frontend/src/components/maskan/LocationOnboarding.tsx's flow, ported
// to expo-location + a native modal instead of the browser geolocation API.
const CITIES = ["Riyadh", "Jeddah", "Dammam", "Khobar", "Madinah"];
const PROPERTY_TYPES = ["Apartment", "Villa", "Penthouse", "Townhouse"];
const LOCATE_TIMEOUT_MS = 8000;

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
  const [district, setDistrict] = useState("Any");
  const [propertyType, setPropertyType] = useState("Any");
  const [districtPickerOpen, setDistrictPickerOpen] = useState(false);

  function finish(params: { city: string; district?: string; type?: string }) {
    markOnboardingSeen();
    onSelect(params.city, params.district ?? "Any", params.type ?? "Any");
  }

  async function handleAllowLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocating(false);
        setLocationError(t("onboarding.locationDenied"));
        setStep("manual");
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), LOCATE_TIMEOUT_MS),
        ),
      ]);
      const match = nearestDistrict(position.coords.latitude, position.coords.longitude);
      setLocating(false);
      finish({ city: match.city, district: match.district });
    } catch {
      setLocating(false);
      setLocationError(t("onboarding.locationDenied"));
      setStep("manual");
    }
  }

  function handleSkip() {
    setStep("manual");
  }

  function handleManualSubmit() {
    finish({ city, district, type: propertyType });
  }

  function handleDismiss() {
    markOnboardingSeen();
    onSelect("Any", "Any", "Any");
  }

  const districts = ["Any", ...(districtsByCity[city] ?? [])];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleDismiss}>
      <View className="flex-1 items-center justify-center bg-black/50 px-4">
        <View className="w-full max-w-md rounded-2xl border border-border bg-background p-6">
          <Pressable
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            className="absolute end-4 top-4 z-10 size-8 items-center justify-center rounded-full"
          >
            <X size={16} color={colors.mutedForeground} />
          </Pressable>

          {step === "intro" ? (
            <View className="items-center gap-5">
              <View className="size-14 items-center justify-center rounded-2xl bg-primary-soft">
                <LocateFixed size={28} color={colors.primary} />
              </View>
              <View className="items-center gap-1.5">
                <Text className="text-center text-xl font-bold text-foreground">
                  {t("onboarding.findHomesNearYou")}
                </Text>
                <Text className="text-center text-sm text-muted-foreground">
                  {t("onboarding.shareLocationDesc")}
                </Text>
              </View>
              {locationError && (
                <Text className="text-center text-xs text-destructive">{locationError}</Text>
              )}
              <View className="w-full gap-2.5">
                <Pressable
                  onPress={handleAllowLocation}
                  disabled={locating}
                  className="w-full flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3.5"
                  style={{ opacity: locating ? 0.7 : 1 }}
                >
                  {locating ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <LocateFixed size={16} color="#FFFFFF" />
                  )}
                  <Text className="text-sm font-semibold text-primary-foreground">
                    {locating ? t("onboarding.locating") : t("onboarding.shareMyLocation")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleSkip}
                  disabled={locating}
                  className="w-full items-center rounded-xl border border-border py-3.5"
                >
                  <Text className="text-sm font-semibold text-foreground">
                    {t("onboarding.tellUsManually")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="gap-5">
              <View className="items-center gap-1.5">
                <View className="size-14 items-center justify-center rounded-2xl bg-primary-soft">
                  <MapPin size={28} color={colors.primary} />
                </View>
                <Text className="text-center text-xl font-bold text-foreground">
                  {t("onboarding.whereLookingTitle")}
                </Text>
                <Text className="text-center text-sm text-muted-foreground">
                  {t("onboarding.whereLookingDesc")}
                </Text>
              </View>

              <View className="gap-1.5">
                <Text className="text-sm font-medium text-foreground">{t("onboarding.city")}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {CITIES.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => {
                        setCity(c);
                        setDistrict("Any");
                      }}
                      className={`rounded-xl border px-3 py-2 ${city === c ? "border-primary bg-primary" : "border-border bg-surface"}`}
                    >
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: city === c ? "#FFFFFF" : colors.foreground }}
                      >
                        {t(`cities.${c}`)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View className="gap-1.5">
                <Text className="text-sm font-medium text-foreground">{t("onboarding.areaDistrict")}</Text>
                <Pressable
                  onPress={() => setDistrictPickerOpen(true)}
                  className="h-10 w-full flex-row items-center justify-between rounded-xl border border-border bg-background px-3"
                >
                  <Text className="text-sm text-foreground">
                    {district === "Any" ? t("onboarding.anyAreaIn", { city: t(`cities.${city}`) }) : district}
                  </Text>
                </Pressable>
              </View>

              <View className="gap-1.5">
                <Text className="text-sm font-medium text-foreground">{t("onboarding.propertyType")}</Text>
                <View className="flex-row flex-wrap gap-2">
                  <Pressable
                    onPress={() => setPropertyType("Any")}
                    className={`flex-row items-center gap-1.5 rounded-xl border px-3 py-2 ${propertyType === "Any" ? "border-primary bg-primary" : "border-border bg-surface"}`}
                  >
                    <Home size={16} color={propertyType === "Any" ? "#FFFFFF" : colors.foreground} />
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: propertyType === "Any" ? "#FFFFFF" : colors.foreground }}
                    >
                      {t("onboarding.any")}
                    </Text>
                  </Pressable>
                  {PROPERTY_TYPES.map((pt) => (
                    <Pressable
                      key={pt}
                      onPress={() => setPropertyType(pt)}
                      className={`flex-row items-center gap-1.5 rounded-xl border px-3 py-2 ${propertyType === pt ? "border-primary bg-primary" : "border-border bg-surface"}`}
                    >
                      <Building2 size={16} color={propertyType === pt ? "#FFFFFF" : colors.foreground} />
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: propertyType === pt ? "#FFFFFF" : colors.foreground }}
                      >
                        {t(`propertyTypes.${pt}`)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Pressable onPress={handleManualSubmit} className="w-full items-center rounded-xl bg-primary py-3.5">
                <Text className="text-sm font-semibold text-primary-foreground">
                  {t("onboarding.showMeMatchingHomes")}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <OptionModal
        visible={districtPickerOpen}
        onClose={() => setDistrictPickerOpen(false)}
        options={districts.map((d) => ({
          key: d,
          label: d === "Any" ? t("onboarding.anyAreaIn", { city: t(`cities.${city}`) }) : d,
        }))}
        onSelect={setDistrict}
      />
    </Modal>
  );
}
