import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bath,
  BedDouble,
  Check,
  ChevronRight,
  ClipboardList,
  Loader2,
  Maximize,
  Pencil,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { PropertyRequestStatusBadge } from "@/components/maskan/PropertyRequestStatusBadge";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";
import {
  activatePropertyRequest,
  cancelPropertyRequest,
  chatWithPropertyRequestAgent,
  closePropertyRequest,
  contactPropertyRequestMatch,
  dismissPropertyRequestMatch,
  fetchAreaSuggestions,
  fetchNoMatchDiagnostics,
  fetchProperty,
  fetchPropertyRequest,
  fetchPropertyRequestActivity,
  fetchPropertyRequestMatches,
  fulfillPropertyRequest,
  pausePropertyRequest,
  resumePropertyRequest,
  savePropertyRequestMatch,
  updatePropertyRequest,
  UnauthorizedError,
  type AlertFrequency,
  type ApiAreaSuggestion,
  type ApiNoMatchDiagnostic,
  type ApiProperty,
  type ApiPropertyRequest,
  type ApiPropertyRequestActivity,
  type ApiPropertyRequestMatch,
  type PropertyRequestFieldKey,
} from "@/lib/api/maskan";
import {
  activityIconFor,
  activityTypeLabel,
  areaSuggestionLabelText,
  areaSuggestionLabelTone,
  fieldKeyLabel,
  matchReasonLabel,
  tradeOffLabel,
} from "@/lib/propertyRequestDisplay";

export const Route = createFileRoute("/property-requests/$id")({
  head: () => ({ meta: [{ title: "Property Request — Maskan" }] }),
  component: PropertyRequestDetailPage,
});

type ChatMsg = { role: "user" | "assistant"; text: string; loading?: boolean };

function formatDate(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function CriteriaRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "must" | "flex";
}) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        {value}
        {tone === "must" && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
            ✓
          </span>
        )}
        {tone === "flex" && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
            ~
          </span>
        )}
      </span>
    </div>
  );
}

function PropertyRequestDetailPage() {
  const { id } = Route.useParams();
  const requestId = Number(id);
  const { user, authLoading, clearAuth } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();

  const [request, setRequest] = useState<ApiPropertyRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [matches, setMatches] = useState<ApiPropertyRequestMatch[]>([]);
  const [matchProperties, setMatchProperties] = useState<Record<number, ApiProperty>>({});
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [areaSuggestions, setAreaSuggestions] = useState<ApiAreaSuggestion[]>([]);
  const [diagnostics, setDiagnostics] = useState<ApiNoMatchDiagnostic[] | null>(null);
  const [activity, setActivity] = useState<ApiPropertyRequestActivity[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<"close" | "cancel" | "fulfill" | null>(
    null,
  );

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  function load() {
    setLoading(true);
    setNotFound(false);
    fetchPropertyRequest(requestId)
      .then((r) => setRequest(r))
      .catch((err) => {
        if (err instanceof UnauthorizedError) clearAuth();
        else setNotFound(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    setLoadingMatches(true);
    fetchPropertyRequestMatches(requestId, { limit: 30 })
      .then(async (res) => {
        setMatches(res);
        const props = await Promise.all(
          res.map((m) => fetchProperty(m.property_id).catch(() => null)),
        );
        const map: Record<number, ApiProperty> = {};
        props.forEach((p) => {
          if (p) map[p.id] = p;
        });
        setMatchProperties(map);
      })
      .catch(() => {})
      .finally(() => setLoadingMatches(false));
    fetchAreaSuggestions(requestId)
      .then(setAreaSuggestions)
      .catch(() => setAreaSuggestions([]));
    fetchPropertyRequestActivity(requestId, { limit: 30 })
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [requestId, user, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      !loadingMatches &&
      matches.length === 0 &&
      request &&
      ["active", "matched", "paused", "negotiating"].includes(request.status)
    ) {
      fetchNoMatchDiagnostics(requestId)
        .then(setDiagnostics)
        .catch(() => setDiagnostics([]));
    }
  }, [loadingMatches, matches.length, request, requestId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function runAction(action: () => Promise<ApiPropertyRequest>, toastKey: string) {
    setActionBusy(true);
    try {
      const updated = await action();
      setRequest(updated);
      toast.success(t(toastKey));
    } catch {
      toast.error(t("propertyRequest.detail.toasts.errorGeneric"));
    } finally {
      setActionBusy(false);
      setConfirmingAction(null);
    }
  }

  async function handleMatchAction(
    match: ApiPropertyRequestMatch,
    kind: "save" | "dismiss" | "contact",
  ) {
    if (match.id == null) return;
    try {
      const fn =
        kind === "save"
          ? savePropertyRequestMatch
          : kind === "dismiss"
            ? dismissPropertyRequestMatch
            : contactPropertyRequestMatch;
      const updated = await fn(requestId, match.id);
      setMatches((prev) => prev.map((m) => (m.id === match.id ? updated : m)));
      if (kind === "save") toast.success(t("propertyRequest.detail.toasts.matchSaved"));
      else if (kind === "dismiss") toast.success(t("propertyRequest.detail.toasts.matchDismissed"));
      else toast.success(t("propertyRequest.detail.toasts.matchContacted"));
    } catch {
      toast.error(t("propertyRequest.detail.toasts.errorGeneric"));
    }
  }

  async function handleAlertFrequencyChange(freq: AlertFrequency) {
    if (!request) return;
    try {
      const updated = await updatePropertyRequest(requestId, { alert_frequency: freq });
      setRequest(updated);
      toast.success(t("propertyRequest.detail.alertFrequency.saved"));
    } catch {
      toast.error(t("propertyRequest.detail.toasts.errorGeneric"));
    }
  }

  async function sendChat(text: string) {
    if (!text.trim() || chatLoading) return;
    const history = chatMessages
      .filter((m) => !m.loading)
      .map((m) => ({ role: m.role, content: m.text }));
    setChatMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: "", loading: true },
    ]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await chatWithPropertyRequestAgent(requestId, text, history);
      setChatMessages((prev) => [...prev.slice(0, -1), { role: "assistant", text: res.reply }]);
    } catch {
      setChatMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", text: t("propertyRequest.detail.agent.errorReaching") },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  if (!user && !authLoading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <EmptyState
          icon={ClipboardList}
          title={t("propertyRequest.list.signInToView")}
          action={<Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>}
        />
      </div>
    );
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="container-page space-y-4 py-10">
          <Skeleton className="h-10 w-1/3 rounded-lg" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (notFound || !request) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <EmptyState
          icon={ClipboardList}
          title={t("propertyRequest.detail.notFound.heading")}
          description={t("propertyRequest.detail.notFound.desc")}
          action={
            <Button onClick={() => navigate({ to: "/property-requests" })}>
              {t("propertyRequest.detail.notFound.back")}
            </Button>
          }
        />
      </div>
    );
  }

  const isDraft = request.status === "draft" || request.status === "awaiting_clarification";
  const isActive =
    request.status === "active" || request.status === "matched" || request.status === "negotiating";
  const isPaused = request.status === "paused";
  const isTerminal = ["fulfilled", "expired", "closed", "cancelled"].includes(request.status);

  const budgetLabel =
    request.min_price || request.max_price
      ? `${request.min_price ? `SAR ${formatSAR(request.min_price)}` : ""}${request.min_price && request.max_price ? " – " : ""}${request.max_price ? `SAR ${formatSAR(request.max_price)}` : ""}`
      : "";

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-8">
        <Link
          to="/property-requests"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-3.5 rotate-180 rtl:rotate-0" />{" "}
          {t("propertyRequest.detail.backToList")}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">{request.title}</h1>
              <PropertyRequestStatusBadge status={request.status} />
            </div>
            {request.description && (
              <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{request.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ to: "/property-requests/new", search: { requestId } })}
            >
              <Pencil className="size-3.5" /> {t("propertyRequest.detail.actions.edit")}
            </Button>
            {isDraft && (
              <Button
                size="sm"
                onClick={() =>
                  void runAction(
                    () => activatePropertyRequest(requestId),
                    "propertyRequest.detail.toasts.updated",
                  )
                }
                disabled={actionBusy}
              >
                {t("propertyRequest.detail.actions.activate")}
              </Button>
            )}
            {isActive && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void runAction(
                    () => pausePropertyRequest(requestId),
                    "propertyRequest.detail.toasts.paused",
                  )
                }
                disabled={actionBusy}
              >
                {t("propertyRequest.detail.actions.pause")}
              </Button>
            )}
            {isPaused && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void runAction(
                    () => resumePropertyRequest(requestId),
                    "propertyRequest.detail.toasts.resumed",
                  )
                }
                disabled={actionBusy}
              >
                {t("propertyRequest.detail.actions.resume")}
              </Button>
            )}
            {(isActive || isPaused) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmingAction("fulfill")}
                disabled={actionBusy}
              >
                <Check className="size-3.5" /> {t("propertyRequest.detail.actions.fulfill")}
              </Button>
            )}
            {!isTerminal && !isDraft && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingAction("close")}
                disabled={actionBusy}
              >
                {t("propertyRequest.detail.actions.close")}
              </Button>
            )}
            {isDraft && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingAction("cancel")}
                disabled={actionBusy}
              >
                {t("propertyRequest.detail.actions.cancel")}
              </Button>
            )}
          </div>
        </div>

        {confirmingAction && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <p className="text-sm">
              {confirmingAction === "close" && t("propertyRequest.detail.actions.confirmClose")}
              {confirmingAction === "cancel" && t("propertyRequest.detail.actions.confirmCancel")}
              {confirmingAction === "fulfill" && t("propertyRequest.detail.actions.confirmFulfill")}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (confirmingAction === "close")
                    void runAction(
                      () => closePropertyRequest(requestId),
                      "propertyRequest.detail.toasts.closed",
                    );
                  else if (confirmingAction === "cancel") {
                    setActionBusy(true);
                    cancelPropertyRequest(requestId)
                      .then(() => navigate({ to: "/property-requests" }))
                      .catch(() => toast.error(t("propertyRequest.detail.toasts.errorGeneric")))
                      .finally(() => setActionBusy(false));
                  } else
                    void runAction(
                      () => fulfillPropertyRequest(requestId),
                      "propertyRequest.detail.toasts.fulfilled",
                    );
                }}
                disabled={actionBusy}
              >
                {actionBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  t("propertyRequest.detail.actions.close")
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingAction(null)}
                disabled={actionBusy}
              >
                {t("propertyRequest.list.card.keepIt")}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Criteria */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  {t("propertyRequest.detail.criteria.heading")}
                </h2>
                {request.ai_confidence != null && (
                  <span className="flex items-center gap-1 rounded-full bg-ai/10 px-2.5 py-1 text-[11px] font-semibold text-ai">
                    <Sparkles className="size-3" />{" "}
                    {t("propertyRequest.detail.aiConfidence", {
                      pct: Math.round(request.ai_confidence * 100),
                    })}
                  </span>
                )}
              </div>
              <div>
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.transactionType")}
                  value={
                    request.transaction_type
                      ? t(`listingCategories.${request.transaction_type}`)
                      : ""
                  }
                  tone={fieldTone(request, "transaction_type")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.propertyCategory")}
                  value={request.property_category ?? ""}
                  tone={fieldTone(request, "property_category")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.city")}
                  value={request.city ? t(`cities.${request.city}`) : ""}
                  tone={fieldTone(request, "city")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.districts")}
                  value={request.preferred_districts.join(", ")}
                  tone={fieldTone(request, "preferred_districts")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.budget")}
                  value={budgetLabel}
                  tone={fieldTone(request, "max_price") || fieldTone(request, "min_price")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.bedrooms")}
                  value={
                    request.bedrooms_min || request.bedrooms_max
                      ? `${request.bedrooms_min ?? "0"}–${request.bedrooms_max ?? "∞"}`
                      : ""
                  }
                  tone={fieldTone(request, "bedrooms_min") || fieldTone(request, "bedrooms_max")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.bathrooms")}
                  value={
                    request.bathrooms_min || request.bathrooms_max
                      ? `${request.bathrooms_min ?? "0"}–${request.bathrooms_max ?? "∞"}`
                      : ""
                  }
                  tone={fieldTone(request, "bathrooms_min") || fieldTone(request, "bathrooms_max")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.area")}
                  value={
                    request.min_area_sq_m || request.max_area_sq_m
                      ? `${request.min_area_sq_m ?? "0"}–${request.max_area_sq_m ?? "∞"} m²`
                      : ""
                  }
                  tone={fieldTone(request, "min_area_sq_m") || fieldTone(request, "max_area_sq_m")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.furnishing")}
                  value={request.furnishing ?? ""}
                  tone={fieldTone(request, "furnishing")}
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.commute")}
                  value={
                    request.max_commute_minutes
                      ? `${request.max_commute_minutes} min · ${request.commute_destination_name ?? ""}`
                      : ""
                  }
                />
                <CriteriaRow
                  label={t("propertyRequest.detail.criteria.verifiedOnly")}
                  value={request.verified_only ? "✓" : ""}
                  tone={fieldTone(request, "verified_only")}
                />
              </div>
              {(request.must_have_fields.length > 0 || request.flexible_fields.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
                  {request.must_have_fields.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
                    >
                      {t("propertyRequest.detail.criteria.mustHave")}: {fieldKeyLabel(t, f)}
                    </span>
                  ))}
                  {request.flexible_fields.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
                    >
                      {t("propertyRequest.detail.criteria.flexible")}: {fieldKeyLabel(t, f)}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Matches or no-match diagnostics */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {t("propertyRequest.detail.matches.heading")}
              </h2>
              {loadingMatches ? (
                <div className="space-y-2">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                </div>
              ) : matches.length === 0 ? (
                <NoMatchPanel diagnostics={diagnostics} />
              ) : (
                <div className="space-y-3">
                  {matches.map((m) => (
                    <MatchCard
                      key={m.id ?? m.property_id}
                      match={m}
                      property={matchProperties[m.property_id]}
                      onAction={handleMatchAction}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Area suggestions */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {t("propertyRequest.detail.areaSuggestions.heading")}
              </h2>
              {areaSuggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("propertyRequest.detail.areaSuggestions.empty")}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {areaSuggestions.map((a) => (
                    <div key={a.area_name} className="rounded-xl border border-border p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{a.area_name}</span>
                        <Badge tone={areaSuggestionLabelTone(a.label)} className="shrink-0">
                          {areaSuggestionLabelText(t, a.label)}
                        </Badge>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        {a.typical_price_range && (
                          <p>
                            {t("propertyRequest.detail.areaSuggestions.typicalPrice", {
                              range: `${a.typical_price_range[0] != null ? formatSAR(a.typical_price_range[0]) : "—"} – ${a.typical_price_range[1] != null ? formatSAR(a.typical_price_range[1]) : "—"}`,
                            })}
                          </p>
                        )}
                        <p>
                          {t("propertyRequest.detail.areaSuggestions.availability", {
                            count: a.estimated_availability,
                          })}
                        </p>
                        {a.commute_estimate_minutes != null && (
                          <p>
                            {t("propertyRequest.detail.areaSuggestions.commute", {
                              minutes: Math.round(a.commute_estimate_minutes),
                            })}
                          </p>
                        )}
                      </div>
                      {a.reasons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {a.reasons.slice(0, 3).map((r) => (
                            <span
                              key={r}
                              className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
                            >
                              {areaSuggestionReasonLabelSafe(t, r)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Activity */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {t("propertyRequest.detail.activity.heading")}
              </h2>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("propertyRequest.detail.activity.empty")}
                </p>
              ) : (
                <div className="space-y-3">
                  {activity.map((a) => {
                    const Icon = activityIconFor(a.activity_type);
                    return (
                      <div key={a.id} className="flex items-start gap-3">
                        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground">
                          <Icon className="size-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {activityTypeLabel(t, a.activity_type)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDate(a.created_at, lang)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {request.mediator_response_count > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  {t("propertyRequest.detail.mediatorResponses.heading")}
                </h2>
                <p className="text-sm font-medium text-foreground">
                  {t("propertyRequest.detail.mediatorResponses.count", {
                    count: request.mediator_response_count,
                  })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("propertyRequest.detail.mediatorResponses.note")}
                </p>
              </section>
            )}
          </div>

          <div className="space-y-6">
            {/* Alert frequency */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {t("propertyRequest.detail.alertFrequency.heading")}
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("propertyRequest.detail.alertFrequency.desc")}
              </p>
              <select
                value={request.alert_frequency}
                onChange={(e) => void handleAlertFrequencyChange(e.target.value as AlertFrequency)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              >
                {(["instant", "daily", "weekly", "off"] as AlertFrequency[]).map((f) => (
                  <option key={f} value={f}>
                    {t(`propertyRequest.new.alertFrequency.${f}`)}
                  </option>
                ))}
              </select>
            </section>

            {/* AI Property Agent */}
            <section className="flex h-[520px] flex-col rounded-2xl border border-ai/20 bg-ai-soft/10 shadow-card">
              <div className="flex items-center gap-2 border-b border-ai/20 px-4 py-3">
                <div className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-ai to-secondary text-white">
                  <Sparkles className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-bold">{t("propertyRequest.detail.agent.heading")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("propertyRequest.detail.agent.desc")}
                  </p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    {["suggested1", "suggested2", "suggested3", "suggested4"].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => void sendChat(t(`propertyRequest.detail.agent.${k}`))}
                        className="rounded-xl border border-border bg-card px-3 py-2 text-start text-xs text-foreground hover:border-ai/40 hover:bg-ai-soft/30"
                      >
                        {t(`propertyRequest.detail.agent.${k}`)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((m, i) => (
                      <div
                        key={i}
                        className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                            m.role === "user"
                              ? "rounded-ee-sm bg-primary text-primary-foreground"
                              : "rounded-es-sm bg-card text-foreground",
                          )}
                        >
                          {m.loading ? (
                            <span className="flex items-center gap-1 py-1">
                              <span className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                              <span className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                              <span className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                            </span>
                          ) : (
                            m.text
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={chatBottomRef} />
                  </div>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat(chatInput);
                }}
                className="flex items-center gap-2 border-t border-ai/20 p-3"
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={t("propertyRequest.detail.agent.placeholder")}
                  className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatLoading}
                  aria-label={t("propertyRequest.detail.agent.send")}
                  className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function fieldTone(request: ApiPropertyRequest, field: string): "must" | "flex" | undefined {
  const key = field as PropertyRequestFieldKey;
  if (request.must_have_fields.includes(key)) return "must";
  if (request.flexible_fields.includes(key)) return "flex";
  return undefined;
}

function areaSuggestionReasonLabelSafe(
  t: (key: string, vars?: Record<string, string | number>) => string,
  code: string,
): string {
  const key = `propertyRequest.areaSuggestionReasons.${code}`;
  const translated = t(key);
  return translated === key ? code.replace(/_/g, " ") : translated;
}

function NoMatchPanel({ diagnostics }: { diagnostics: ApiNoMatchDiagnostic[] | null }) {
  const { t } = useLanguage();
  if (diagnostics === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t("propertyRequest.detail.noMatch.loading")}
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 text-sm font-semibold">{t("propertyRequest.detail.noMatch.heading")}</p>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("propertyRequest.detail.noMatch.desc")}
      </p>
      {diagnostics.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("propertyRequest.detail.noMatch.empty")}</p>
      ) : (
        <div className="space-y-2">
          {diagnostics.map((d) => (
            <div
              key={d.field}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5"
            >
              <span className="text-sm font-medium">{fieldKeyLabel(t, d.field)}</span>
              <span className="text-xs font-semibold text-primary">
                {t("propertyRequest.detail.noMatch.candidatesIfRelaxed", {
                  count: d.candidates_if_relaxed,
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  match,
  property,
  onAction,
}: {
  match: ApiPropertyRequestMatch;
  property: ApiProperty | undefined;
  onAction: (match: ApiPropertyRequestMatch, kind: "save" | "dismiss" | "contact") => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {property ? (
            <>
              <div className="flex items-center gap-2">
                {match.status === "new" && (
                  <Badge tone="info">{t("propertyRequest.detail.matches.newBadge")}</Badge>
                )}
                <p className="truncate text-sm font-semibold">{property.title}</p>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {property.area}, {property.city}
              </p>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <BedDouble className="size-3.5" /> {property.bedrooms ?? "—"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Bath className="size-3.5" /> {property.bathrooms ?? "—"}
                </span>
                {property.size_sq_m && (
                  <span className="inline-flex items-center gap-1">
                    <Maximize className="size-3.5" /> {property.size_sq_m} m²
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">#{match.property_id}</p>
          )}
        </div>
        <Badge tone="primary" className="shrink-0">
          {t("propertyRequest.detail.matches.matchScore", {
            pct: Math.round(match.match_score * 100),
          })}
        </Badge>
      </div>

      {(match.match_reasons.length > 0 || match.trade_offs.length > 0) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {t("propertyRequest.detail.matches.why")}
        </button>
      )}
      {expanded && (
        <div className="mt-2 space-y-2">
          {match.match_reasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {match.match_reasons.map((r, i) => (
                <span
                  key={i}
                  className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
                >
                  {matchReasonLabel(t, r)}
                </span>
              ))}
            </div>
          )}
          {match.trade_offs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {match.trade_offs.map((r, i) => (
                <span
                  key={i}
                  className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning"
                >
                  {tradeOffLabel(t, r)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {property && (
          <Link to="/property/$id" params={{ id: String(property.id) }}>
            <Button size="sm" variant="outline">
              {t("propertyRequest.detail.matches.viewProperty")}
            </Button>
          </Link>
        )}
        <Button
          size="sm"
          variant={match.status === "saved" ? "default" : "outline"}
          onClick={() => onAction(match, "save")}
          disabled={match.status === "saved"}
        >
          {match.status === "saved"
            ? t("propertyRequest.detail.matches.saved")
            : t("propertyRequest.detail.matches.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAction(match, "contact")}
          disabled={match.status === "contacted"}
        >
          {match.status === "contacted"
            ? t("propertyRequest.detail.matches.contacted")
            : t("propertyRequest.detail.matches.contact")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAction(match, "dismiss")}
          disabled={match.status === "dismissed"}
        >
          {match.status === "dismissed"
            ? t("propertyRequest.detail.matches.dismissed")
            : t("propertyRequest.detail.matches.dismiss")}
        </Button>
      </div>
    </div>
  );
}
