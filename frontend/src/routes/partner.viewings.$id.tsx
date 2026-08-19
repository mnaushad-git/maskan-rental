import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Calendar, CheckCircle2, Mail, Phone, UserX, X } from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as DateRangeCalendar } from "@/components/ui/calendar";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import {
  fetchPartnerViewing,
  confirmViewing,
  proposeViewingTimeAsPartner,
  cancelViewingAsPartner,
  completeViewing,
  markViewingNoShow,
  VIEWING_MEDIATOR_CANCEL_REASONS,
  type ApiPartnerPropertyViewing,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/partner/viewings/$id")({
  head: () => ({ meta: [{ title: "Viewing Request — myMakan Partner" }] }),
  component: PartnerViewingDetailPage,
});

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  requested: "info",
  reschedule_proposed: "warning",
  confirmed: "success",
  completed: "neutral",
  cancelled_by_customer: "neutral",
  cancelled_by_mediator: "neutral",
  no_show_customer: "neutral",
  no_show_mediator: "neutral",
};

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PartnerViewingDetailPage() {
  const { id } = Route.useParams();
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const [viewing, setViewing] = useState<ApiPartnerPropertyViewing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPropose, setShowPropose] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    const viewingId = Number(id);
    if (Number.isNaN(viewingId)) {
      setError(t("partnerViewings.detail.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchPartnerViewing(viewingId)
      .then(setViewing)
      .catch(() => setError(t("partnerViewings.detail.unableToLoad")))
      .finally(() => setLoading(false));
  }, [id, user, authLoading, t]);

  async function handleConfirm() {
    if (!viewing) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await confirmViewing(viewing.id);
      setViewing(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("partnerViewings.detail.confirmFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    if (!viewing) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await completeViewing(viewing.id);
      setViewing(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("partnerViewings.detail.completeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleNoShow(who: "customer" | "mediator") {
    if (!viewing) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await markViewingNoShow(viewing.id, who);
      setViewing(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("partnerViewings.detail.noShowFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-64 rounded-2xl" />
      </div>
    );
  }

  if (error || !viewing) {
    return (
      <div className="min-h-screen bg-surface px-6 py-12">
        <p className="text-sm text-destructive">{error ?? t("partnerViewings.detail.notFound")}</p>
        <Link to="/partner/viewings" className="mt-4 inline-block text-sm text-primary">
          {t("partnerViewings.detail.back")}
        </Link>
      </div>
    );
  }

  const canConfirm = viewing.status === "requested" || (viewing.status === "reschedule_proposed" && viewing.proposed_by === "customer");
  const canAct = viewing.status === "requested" || viewing.status === "confirmed" || viewing.status === "reschedule_proposed";

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link to="/partner/viewings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("partnerViewings.detail.back")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <Badge tone={STATUS_TONE[viewing.status] ?? "neutral"}>{t(`myViewings.status.${viewing.status}`)}</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
              <h2 className="font-semibold">{t("partnerViewings.detail.propertyBlock")}</h2>
              <div className="flex items-center gap-3">
                {viewing.property_image_url && <img src={viewing.property_image_url} alt="" className="size-16 shrink-0 rounded-xl object-cover" />}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{viewing.property_title ?? `#${viewing.property_id}`}</div>
                  <div className="text-xs text-muted-foreground">{viewing.property_area}, {viewing.property_city}</div>
                </div>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{t("partnerViewings.detail.requestedTime")}: </span>
                <span className="font-medium">{formatDateTime(viewing.requested_start_at, lang)}</span>
              </div>
              {viewing.confirmed_start_at && (
                <div className="text-sm">
                  <span className="text-muted-foreground">{t("viewingDetail.appointmentBlock.confirmedTime")}: </span>
                  <span className="font-medium">{formatDateTime(viewing.confirmed_start_at, lang)}</span>
                </div>
              )}
              {viewing.proposed_start_at && viewing.status === "reschedule_proposed" && (
                <div className="text-sm">
                  <span className="text-muted-foreground">{t("viewingDetail.appointmentBlock.proposedTime")}: </span>
                  <span className="font-medium">{formatDateTime(viewing.proposed_start_at, lang)}</span>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-2">
              <h2 className="font-semibold">{t("partnerViewings.detail.customerBlock")}</h2>
              <div className="text-sm font-medium">{viewing.customer_name}</div>
              {viewing.customer_phone && (
                <a href={`tel:${viewing.customer_phone}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Phone className="size-3.5" /> {viewing.customer_phone}
                </a>
              )}
              {viewing.customer_email && (
                <a href={`mailto:${viewing.customer_email}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Mail className="size-3.5" /> {viewing.customer_email}
                </a>
              )}
              {viewing.customer_note && <p className="rounded-lg bg-surface p-3 text-sm">{viewing.customer_note}</p>}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-2.5">
              {canConfirm && (
                <Button variant="hero" className="w-full" onClick={() => void handleConfirm()} disabled={busy}>
                  <CheckCircle2 className="size-4" /> {busy ? t("partnerViewings.detail.confirming") : t("partnerViewings.detail.confirmCta")}
                </Button>
              )}
              {canAct && (
                <Button variant="outline" className="w-full" onClick={() => setShowPropose(true)}>
                  <Calendar className="size-4" /> {t("partnerViewings.card.proposeTime")}
                </Button>
              )}
              {canAct && (
                <Button variant="outline" className="w-full" onClick={() => setShowCancel(true)}>
                  <X className="size-4" /> {t("partnerViewings.card.decline")}
                </Button>
              )}
              {viewing.status === "confirmed" && (
                <>
                  <Button variant="outline" className="w-full" onClick={() => void handleComplete()} disabled={busy}>
                    <CheckCircle2 className="size-4" /> {t("partnerViewings.card.markCompleted")}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => void handleNoShow("customer")} disabled={busy}>
                    <UserX className="size-4" /> {t("partnerViewings.detail.noShowCustomer")}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => void handleNoShow("mediator")} disabled={busy}>
                    <UserX className="size-4" /> {t("partnerViewings.detail.noShowMediator")}
                  </Button>
                </>
              )}
              {actionError && <p className="text-xs text-destructive">{actionError}</p>}
            </div>
          </div>
        </div>
      </main>

      {showPropose && (
        <ProposeTimeModal
          viewing={viewing}
          onClose={() => setShowPropose(false)}
          onProposed={(v) => {
            setViewing(v);
            setShowPropose(false);
          }}
        />
      )}
      {showCancel && (
        <CancelModal
          viewing={viewing}
          onClose={() => setShowCancel(false)}
          onCancelled={(v) => {
            setViewing(v);
            setShowCancel(false);
          }}
        />
      )}
    </div>
  );
}

function ProposeTimeModal({
  viewing,
  onClose,
  onProposed,
}: {
  viewing: ApiPartnerPropertyViewing;
  onClose: () => void;
  onProposed: (v: ApiPartnerPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!date) return;
    setSubmitting(true);
    setError(null);
    try {
      const y = date.getFullYear();
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const [h, m] = time.split(":").map(Number);
      const endMinutes = h * 60 + m + 30;
      const endH = String(Math.floor(endMinutes / 60) % 24).padStart(2, "0");
      const endM = String(endMinutes % 60).padStart(2, "0");
      const start_at = `${y}-${mo}-${d}T${time}:00+03:00`;
      const end_at = `${y}-${mo}-${d}T${endH}:${endM}:00+03:00`;
      const updated = await proposeViewingTimeAsPartner(viewing.id, { start_at, end_at, note: note.trim() || undefined });
      onProposed(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerViewings.detail.proposeFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("viewingDetail.proposeModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex justify-center">
          <DateRangeCalendar mode="single" selected={date} onSelect={setDate} disabled={{ before: today }} />
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium">{t("property.viewing.modal.stepTime")}</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t("property.viewing.modal.notePlaceholder")}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
          />
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <Button variant="hero" className="mt-4 w-full" onClick={() => void handleSubmit()} disabled={!date || submitting}>
          {submitting ? t("partnerViewings.detail.proposing") : t("partnerViewings.detail.proposeCta")}
        </Button>
      </div>
    </div>
  );
}

function CancelModal({
  viewing,
  onClose,
  onCancelled,
}: {
  viewing: ApiPartnerPropertyViewing;
  onClose: () => void;
  onCancelled: (v: ApiPartnerPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(VIEWING_MEDIATOR_CANCEL_REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await cancelViewingAsPartner(viewing.id, reason, note.trim() || undefined);
      onCancelled(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerViewings.detail.cancelFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("partnerViewings.card.decline")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("partnerViewings.detail.cancelReasonLabel")}</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {VIEWING_MEDIATOR_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`partnerViewings.detail.reasons.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("partnerViewings.detail.cancelNoteLabel")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
              {t("myViewings.cancelModal.cancel")}
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => void handleConfirm()} disabled={submitting}>
              {submitting ? t("partnerViewings.detail.cancelling") : t("partnerViewings.detail.cancelCta")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
