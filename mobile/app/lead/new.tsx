import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MapPin } from "lucide-react-native";
import { createLead } from "@/lib/api/maskan";
import { districtsByCity } from "@/lib/maskan-search-data";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { SelectField, OptionModal } from "@/components/SelectField";

const BEDROOM_OPTIONS = ["Any", "1", "2", "3", "4", "5"];

export default function LeadNewScreen() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();

  const [city, setCity] = useState<string>("Riyadh");
  const [district, setDistrict] = useState<string>("Any");
  const [bedrooms, setBedrooms] = useState("Any");
  const [maxBudget, setMaxBudget] = useState("");
  const [requirements, setRequirements] = useState("");
  const [name, setName] = useState(user?.full_name ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [openModal, setOpenModal] = useState<"city" | "district" | "bedrooms" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-base font-semibold text-foreground">{t("leadNew.signInGate.heading")}</Text>
        <Text className="text-center text-sm text-muted-foreground">{t("leadNew.signInGate.desc")}</Text>
        <Pressable onPress={() => router.push("/auth/login")} className="rounded-lg bg-primary px-5 py-2.5">
          <Text className="text-sm font-semibold text-primary-foreground">{t("leadNew.signInGate.cta")}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (success) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-2 bg-background p-6">
        <Text className="text-center text-lg font-bold text-foreground">{t("leadNew.success.heading")}</Text>
        <Text className="text-center text-sm text-muted-foreground">
          {t("leadNew.success.desc", { area: district === "Any" ? city : district, city })}
        </Text>
        <Pressable onPress={() => router.back()} className="mt-4 rounded-lg bg-primary px-5 py-2.5">
          <Text className="text-sm font-semibold text-primary-foreground">{t("leadNew.success.browseProperties")}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const districts = ["Any", ...(districtsByCity[city] ?? [])];

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await createLead({
        area_name: district === "Any" ? city : district,
        city,
        customer_name: name,
        customer_phone: phone,
        customer_email: email,
        max_budget: maxBudget ? Number(maxBudget) : undefined,
        bedrooms_needed: bedrooms !== "Any" ? Number(bedrooms) : undefined,
        requirements_note: requirements || undefined,
      });
      setSuccess(true);
    } catch {
      setError(t("leadNew.failedToSubmit"));
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !name || !phone || !email;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-4 p-6">
        <Text className="font-bold text-xl text-foreground">{t("leadNew.heading")}</Text>
        <Text className="text-sm text-muted-foreground">{t("leadNew.subtitle")}</Text>

        <View className="rounded-xl border border-border">
          <SelectField
            label={t("leadNew.city")}
            value={t(`cities.${city}`)}
            onPress={() => setOpenModal("city")}
            icon={<MapPin size={18} color="#79716B" />}
          />
          <View className="border-t border-border">
            <SelectField
              label={t("leadNew.districtArea")}
              value={district === "Any" ? t("leadNew.selectDistrict") : district}
              onPress={() => setOpenModal("district")}
            />
          </View>
          <View className="border-t border-border">
            <SelectField
              label={t("leadNew.bedroomsNeeded")}
              value={bedrooms === "Any" ? t("leadNew.any") : t("leadNew.bedroomsOption", { count: Number(bedrooms) })}
              onPress={() => setOpenModal("bedrooms")}
            />
          </View>
        </View>

        <TextInput
          value={maxBudget}
          onChangeText={setMaxBudget}
          placeholder={t("leadNew.maxBudget")}
          keyboardType="numeric"
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
        <TextInput
          value={requirements}
          onChangeText={setRequirements}
          placeholder={t("leadNew.requirementsPlaceholder")}
          multiline
          numberOfLines={3}
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />

        <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("leadNew.sections.yourContact")}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("leadNew.fullNamePlaceholder")}
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder={t("leadNew.phone")}
          keyboardType="phone-pad"
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("leadNew.email")}
          autoCapitalize="none"
          keyboardType="email-address"
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />

        {error && <Text className="text-sm" style={{ color: "#DC2626" }}>{error}</Text>}

        <Pressable
          onPress={handleSubmit}
          disabled={disabled}
          className={`items-center rounded-xl bg-primary py-3 ${disabled ? "opacity-60" : ""}`}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-sm font-semibold text-primary-foreground">{t("leadNew.submitLeadRequest")}</Text>
          )}
        </Pressable>
      </ScrollView>

      <OptionModal
        visible={openModal === "city"}
        onClose={() => setOpenModal(null)}
        options={Object.keys(districtsByCity).map((c) => ({ key: c, label: t(`cities.${c}`) }))}
        onSelect={(key) => {
          setCity(key);
          setDistrict("Any");
        }}
      />
      <OptionModal
        visible={openModal === "district"}
        onClose={() => setOpenModal(null)}
        options={districts.map((d) => ({ key: d, label: d === "Any" ? t("leadNew.selectDistrict") : d }))}
        onSelect={setDistrict}
      />
      <OptionModal
        visible={openModal === "bedrooms"}
        onClose={() => setOpenModal(null)}
        options={BEDROOM_OPTIONS.map((b) => ({ key: b, label: b === "Any" ? t("leadNew.any") : t("leadNew.bedroomsOption", { count: Number(b) }) }))}
        onSelect={setBedrooms}
      />
    </SafeAreaView>
  );
}
