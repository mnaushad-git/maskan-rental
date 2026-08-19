import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Bookmark, ClipboardList, EyeOff, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/maskan/Badges";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { cities, formatSAR } from "@/lib/maskan-data";
import {
  bookmarkPropertyRequest,
  fetchPartnerPropertyRequests,
  ignorePropertyRequest,
  type ApiPartnerRequestSummary,
} from "@/lib/api/maskan";
import { fieldKeyLabel } from "@/lib/propertyRequestDisplay";

export const Route = createFileRoute("/partner/requests")({
  head: () => ({ meta: [{ title: "Property Request Marketplace — myMakan Partner" }] }),
  component: PartnerRequestMarketplace,
});

function relativeDate(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PartnerRequestMarketplace() {
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();

  const [items, setItems] = useState<ApiPartnerRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<Set<number>>(new Set());

  const [cityFilter, setCityFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [maxBudget, setMaxBudget] = useState("");

  function load() {
    setLoading(true);
    fetchPartnerPropertyRequests({
      city: cityFilter || undefined,
      district: districtFilter || undefined,
      transactionType: typeFilter || undefined,
      maxBudget: maxBudget ? Number(maxBudget) : undefined,
      limit: 100,
    })
      .then(setItems)
      .catch(() => toast.error(t("partnerPropertyRequest.marketplace.empty")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  async function handleIgnore(id: number) {
    try {
      await ignorePropertyRequest(id);
      setHidden((prev) => new Set(prev).add(id));
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    }
  }

  async function handleSave(id: number) {
    try {
      await bookmarkPropertyRequest(id);
      setSaved((prev) => new Set(prev).add(id));
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    }
  }

  const visible = items.filter((it) => !hidden.has(it.id));

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("propertyRequest.list.signInToView")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link
            to="/partner"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("partnerDashboard.sidebar.brand")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">{t("partnerPropertyRequest.nav")}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold">{t("partnerPropertyRequest.marketplace.heading")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("partnerPropertyRequest.marketplace.subtitle")}
        </p>

        <div className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {t("partnerPropertyRequest.marketplace.filters.city")}
            </label>
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("partnerPropertyRequest.marketplace.filters.cityAny")}</option>
              {cities.map((c) => (
                <option key={c.name} value={c.name}>
                  {t(`cities.${c.name}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {t("partnerPropertyRequest.marketplace.filters.district")}
            </label>
            <input
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              placeholder={t("partnerPropertyRequest.marketplace.filters.districtAny")}
              className="h-9 w-40 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {t("partnerPropertyRequest.marketplace.filters.transactionType")}
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="">
                {t("partnerPropertyRequest.marketplace.filters.transactionTypeAny")}
              </option>
              <option value="rent">{t("listingCategories.rent")}</option>
              <option value="sale">{t("listingCategories.sale")}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {t("partnerPropertyRequest.marketplace.filters.maxBudget")}
            </label>
            <input
              type="number"
              min={0}
              value={maxBudget}
              onChange={(e) => setMaxBudget(e.target.value)}
              className="h-9 w-32 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <Button size="sm" onClick={load}>
            {t("partnerPropertyRequest.marketplace.filters.apply")}
          </Button>
        </div>

        <div className="mt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={t("partnerPropertyRequest.marketplace.empty")}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {visible.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <MapPin className="size-3.5 text-muted-foreground" />
                      {r.preferred_districts.length > 0
                        ? r.preferred_districts.join(", ")
                        : r.city
                          ? t(`cities.${r.city}`)
                          : "—"}
                    </div>
                    {r.already_responded && (
                      <Badge tone="success">
                        {t("partnerPropertyRequest.marketplace.card.alreadyResponded")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {r.min_price || r.max_price
                      ? t("partnerPropertyRequest.marketplace.card.budget", {
                          range: `${r.min_price ? `SAR ${formatSAR(r.min_price)}` : ""}${r.min_price && r.max_price ? " – " : ""}${r.max_price ? `SAR ${formatSAR(r.max_price)}` : ""}`,
                        })
                      : t("partnerPropertyRequest.marketplace.card.budgetFlexible")}
                    {r.bedrooms_min
                      ? ` · ${t("partnerPropertyRequest.marketplace.card.bedrooms", { count: r.bedrooms_min })}`
                      : ""}
                  </p>
                  {r.inventory_match_count > 0 && (
                    <p className="text-xs font-medium text-success">
                      {t("partnerPropertyRequest.marketplace.card.eligibleListings", {
                        count: r.inventory_match_count,
                      })}
                    </p>
                  )}
                  {r.must_have_fields.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("partnerPropertyRequest.marketplace.card.mustHave", {
                        fields: r.must_have_fields.map((f) => fieldKeyLabel(t, f)).join(", "),
                      })}
                    </p>
                  )}
                  {r.expiry_date && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("partnerPropertyRequest.marketplace.card.expiresOn", {
                        date: relativeDate(r.expiry_date, lang),
                      })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() =>
                        navigate({ to: "/partner/requests/$id", params: { id: String(r.id) } })
                      }
                    >
                      {t("partnerPropertyRequest.marketplace.card.respond")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleSave(r.id)}
                      disabled={saved.has(r.id)}
                    >
                      <Bookmark className="size-3.5" />{" "}
                      {saved.has(r.id)
                        ? t("partnerPropertyRequest.detail.actions.saved")
                        : t("partnerPropertyRequest.detail.actions.save")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleIgnore(r.id)}>
                      <EyeOff className="size-3.5" />{" "}
                      {t("partnerPropertyRequest.detail.actions.ignore")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
