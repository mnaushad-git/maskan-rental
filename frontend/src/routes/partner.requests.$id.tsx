import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Bookmark, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";
import {
  bookmarkPropertyRequest,
  fetchEligibleProperties,
  fetchPartnerListings,
  fetchPartnerPropertyRequest,
  fetchProperty,
  ignorePropertyRequest,
  respondToPropertyRequest,
  type ApiPartnerRequestSummary,
  type ApiProperty,
  type ApiPropertyRequestMatch,
  type PartnerPropertyRequestResponseType,
} from "@/lib/api/maskan";
import { fieldKeyLabel, matchReasonLabel } from "@/lib/propertyRequestDisplay";

export const Route = createFileRoute("/partner/requests/$id")({
  head: () => ({ meta: [{ title: "Respond to Property Request — Maskan Partner" }] }),
  component: PartnerRequestDetailPage,
});

function formatDate(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const RESPONSE_TYPES: PartnerPropertyRequestResponseType[] = [
  "submit_property",
  "submit_multiple",
  "upcoming_inventory",
  "clarification_question",
  "decline",
];

const RESPONSE_TYPE_LABEL_KEY: Record<PartnerPropertyRequestResponseType, string> = {
  submit_property: "partnerPropertyRequest.detail.respond.typeSubmitProperty",
  submit_multiple: "partnerPropertyRequest.detail.respond.typeSubmitMultiple",
  upcoming_inventory: "partnerPropertyRequest.detail.respond.typeUpcomingInventory",
  clarification_question: "partnerPropertyRequest.detail.respond.typeClarificationQuestion",
  decline: "partnerPropertyRequest.detail.respond.typeDecline",
};

function PartnerRequestDetailPage() {
  const { id } = Route.useParams();
  const requestId = Number(id);
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();

  const [request, setRequest] = useState<ApiPartnerRequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState<ApiPropertyRequestMatch[]>([]);
  const [eligibleProps, setEligibleProps] = useState<Record<number, ApiProperty>>({});
  const [myListings, setMyListings] = useState<ApiProperty[]>([]);
  const [saved, setSaved] = useState(false);
  const [ignored, setIgnored] = useState(false);

  const [responseType, setResponseType] =
    useState<PartnerPropertyRequestResponseType>("submit_property");
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (authLoading || !user) return;
    setLoading(true);
    fetchPartnerPropertyRequest(requestId)
      .then(setRequest)
      .catch(() => {})
      .finally(() => setLoading(false));
    fetchEligibleProperties(requestId)
      .then(async (matches) => {
        setEligible(matches);
        const props = await Promise.all(
          matches.map((m) => fetchProperty(m.property_id).catch(() => null)),
        );
        const map: Record<number, ApiProperty> = {};
        props.forEach((p) => {
          if (p) map[p.id] = p;
        });
        setEligibleProps(map);
      })
      .catch(() => {});
    fetchPartnerListings()
      .then(setMyListings)
      .catch(() => {});
  }, [requestId, user, authLoading]);

  function togglePropertySelection(propId: number) {
    setSelectedPropertyIds((prev) =>
      prev.includes(propId) ? prev.filter((p) => p !== propId) : [...prev, propId],
    );
  }

  async function handleSubmitResponse() {
    setFormError("");
    const needsProperties =
      responseType === "submit_property" || responseType === "submit_multiple";
    if (needsProperties && selectedPropertyIds.length === 0) {
      setFormError(t("partnerPropertyRequest.detail.respond.errorNoProperties"));
      return;
    }
    setSubmitting(true);
    try {
      await respondToPropertyRequest(requestId, {
        response_type: responseType,
        message: message.trim() || undefined,
        property_ids: needsProperties ? selectedPropertyIds : undefined,
      });
      setSubmitted(true);
      toast.success(t("partnerPropertyRequest.detail.respond.success"));
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : t("partnerPropertyRequest.detail.respond.errorGeneric"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleIgnore() {
    try {
      await ignorePropertyRequest(requestId);
      setIgnored(true);
      navigate({ to: "/partner/requests" });
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    }
  }

  async function handleSave() {
    try {
      await bookmarkPropertyRequest(requestId);
      setSaved(true);
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    }
  }

  if (authLoading || loading) {
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
  if (!request) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {t("propertyRequest.detail.notFound.heading")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link
            to="/partner/requests"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />{" "}
            {t("partnerPropertyRequest.detail.back")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold">{t("partnerPropertyRequest.detail.heading")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("partnerPropertyRequest.detail.privacyNote")}
        </p>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <SummaryRow
                  label={t("partnerPropertyRequest.detail.summary.transactionType")}
                  value={
                    request.transaction_type
                      ? t(`listingCategories.${request.transaction_type}`)
                      : "—"
                  }
                />
                <SummaryRow
                  label={t("partnerPropertyRequest.detail.summary.propertyCategory")}
                  value={request.property_category ?? "—"}
                />
                <SummaryRow
                  label={t("partnerPropertyRequest.detail.summary.city")}
                  value={request.city ? t(`cities.${request.city}`) : "—"}
                />
                <SummaryRow
                  label={t("partnerPropertyRequest.detail.summary.districts")}
                  value={request.preferred_districts.join(", ") || "—"}
                />
                <SummaryRow
                  label={t("partnerPropertyRequest.detail.summary.budget")}
                  value={
                    request.min_price || request.max_price
                      ? `${request.min_price ? `SAR ${formatSAR(request.min_price)}` : ""}${request.min_price && request.max_price ? " – " : ""}${request.max_price ? `SAR ${formatSAR(request.max_price)}` : ""}`
                      : "—"
                  }
                />
                <SummaryRow
                  label={t("partnerPropertyRequest.detail.summary.bedrooms")}
                  value={
                    request.bedrooms_min || request.bedrooms_max
                      ? `${request.bedrooms_min ?? "0"}–${request.bedrooms_max ?? "∞"}`
                      : "—"
                  }
                />
              </div>
              {request.must_have_fields.length > 0 && (
                <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">
                    {t("partnerPropertyRequest.detail.summary.mustHave")}:
                  </strong>{" "}
                  {request.must_have_fields.map((f) => fieldKeyLabel(t, f)).join(", ")}
                </p>
              )}
              {request.flexible_fields.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <strong className="text-foreground">
                    {t("partnerPropertyRequest.detail.summary.flexible")}:
                  </strong>{" "}
                  {request.flexible_fields.map((f) => fieldKeyLabel(t, f)).join(", ")}
                </p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                {t("partnerPropertyRequest.detail.summary.posted", {
                  date: formatDate(request.created_at, lang),
                })}
                {request.expiry_date &&
                  ` · ${t("partnerPropertyRequest.detail.summary.expires", { date: formatDate(request.expiry_date, lang) })}`}
              </p>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {t("partnerPropertyRequest.detail.eligible.heading")}
              </h2>
              {eligible.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("partnerPropertyRequest.detail.eligible.empty")}
                </p>
              ) : (
                <div className="space-y-2">
                  {eligible.map((m, i) => {
                    const p = eligibleProps[m.property_id];
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {p?.title ?? `#${m.property_id}`}
                          </p>
                          {m.match_reasons.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {m.match_reasons
                                .slice(0, 2)
                                .map((r) => matchReasonLabel(t, r))
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                        <Badge tone="primary" className="shrink-0">
                          {t("partnerPropertyRequest.detail.eligible.matchScore", {
                            pct: Math.round(m.match_score * 100),
                          })}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <div className="space-y-4">
            {submitted ? (
              <div className="rounded-2xl border border-success/30 bg-success/5 p-5 text-sm text-success">
                {t("partnerPropertyRequest.detail.respond.success")}
              </div>
            ) : (
              <section className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  {t("partnerPropertyRequest.detail.respond.heading")}
                </h2>
                <div>
                  <label className="mb-1.5 block text-xs font-medium">
                    {t("partnerPropertyRequest.detail.respond.typeLabel")}
                  </label>
                  <select
                    value={responseType}
                    onChange={(e) =>
                      setResponseType(e.target.value as PartnerPropertyRequestResponseType)
                    }
                    className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
                  >
                    {RESPONSE_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {t(RESPONSE_TYPE_LABEL_KEY[rt])}
                      </option>
                    ))}
                  </select>
                </div>

                {(responseType === "submit_property" || responseType === "submit_multiple") && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium">
                      {t("partnerPropertyRequest.detail.respond.selectProperties")}
                    </label>
                    {myListings.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t("partnerPropertyRequest.detail.respond.noProperties")}
                      </p>
                    ) : (
                      <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                        {myListings.map((p) => (
                          <label
                            key={p.id}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                              selectedPropertyIds.includes(p.id) && "bg-primary/5",
                            )}
                          >
                            <input
                              type={responseType === "submit_property" ? "radio" : "checkbox"}
                              checked={selectedPropertyIds.includes(p.id)}
                              onChange={() => {
                                if (responseType === "submit_property")
                                  setSelectedPropertyIds([p.id]);
                                else togglePropertySelection(p.id);
                              }}
                              className="size-4"
                            />
                            <span className="truncate">{p.title}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-medium">
                    {t("partnerPropertyRequest.detail.respond.message")}
                  </label>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t("partnerPropertyRequest.detail.respond.messagePlaceholder")}
                    className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>

                {formError && <p className="text-xs text-destructive">{formError}</p>}

                <Button
                  className="w-full"
                  onClick={() => void handleSubmitResponse()}
                  disabled={submitting}
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  {submitting
                    ? t("partnerPropertyRequest.detail.respond.submitting")
                    : t("partnerPropertyRequest.detail.respond.submit")}
                </Button>
              </section>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void handleSave()}
                disabled={saved}
              >
                <Bookmark className="size-3.5" />{" "}
                {saved
                  ? t("partnerPropertyRequest.detail.actions.saved")
                  : t("partnerPropertyRequest.detail.actions.save")}
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => void handleIgnore()}
                disabled={ignored}
              >
                <EyeOff className="size-3.5" /> {t("partnerPropertyRequest.detail.actions.ignore")}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}
