import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Calendar, CheckCircle2, GitCompare, Handshake, MapPin, MessageCircle, Phone, Sparkles, X } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as DateRangeCalendar } from "@/components/ui/calendar";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import {
  fetchViewing,
  cancelViewing,
  proposeViewingTime,
  acceptViewingReschedule,
  updateViewingChecklist,
  submitViewingFeedback,
  fetchViewingNextSteps,
  VIEWING_CUSTOMER_CANCEL_REASONS,
  VIEWING_INTEREST_LEVELS,
  VIEWING_FEEDBACK_REASONS,
  type ApiPropertyViewing,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/viewings/$id")({
  head: () => ({ meta: [{ title: "Viewing Details — myMakan" }] }),
  component: ViewingDetailPage,
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

function ViewingDetailPage() {
  const { id } = Route.useParams();
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState<ApiPropertyViewing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    const viewingId = Number(id);
    if (Number.isNaN(viewingId)) {
      setError(t("viewingDetail.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchViewing(viewingId)
      .then(setViewing)
      .catch(() => setError(t("viewingDetail.unableToLoad")))
      .finally(() => setLoading(false));
  }, [id, user, authLoading, t]);

  async function handleAccept() {
    if (!viewing) return;
    setAccepting(true);
    setActionError(null);
    try {
      const updated = await acceptViewingReschedule(viewing.id);
      setViewing(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("viewingDetail.acceptFailed"));
    } finally {
      setAccepting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="container-page py-10">
          <Skeleton className="h-8 w-48" />
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
          <h1 className="text-xl font-bold">{t("myViewings.signInToView")}</h1>
          <Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>
        </div>
      </div>
    );
  }

  if (error || !viewing) {
    return (
      <div className="container-page py-12">
        <TopNav />
        <p className="mt-6 text-sm text-destructive">{error ?? t("viewingDetail.notFound")}</p>
        <Link to="/viewings" className="mt-4 inline-block text-sm text-primary">
          {t("viewingDetail.back")}
        </Link>
      </div>
    );
  }

  const tone = STATUS_TONE[viewing.status] ?? "neutral";

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-8">
        <Link to="/viewings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("viewingDetail.back")}
        </Link>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            {/* Property block */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <h2 className="text-sm font-semibold text-muted-foreground">{t("viewingDetail.propertyBlock.title")}</h2>
              <div className="mt-3 flex items-center gap-4">
                {viewing.property_image_url && (
                  <img src={viewing.property_image_url} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{viewing.property_title ?? `#${viewing.property_id}`}</div>
                  {viewing.property_area && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" /> {viewing.property_area}, {viewing.property_city}
                    </div>
                  )}
                  <Link to="/property/$id" params={{ id: String(viewing.property_id) }} className="mt-1 inline-block text-xs text-primary hover:underline">
                    {t("viewingDetail.propertyBlock.viewProperty")}
                  </Link>
                </div>
              </div>
            </section>

            {/* Appointment block */}
            <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground">{t("viewingDetail.appointmentBlock.title")}</h2>
                <Badge tone={tone}>{t(`myViewings.status.${viewing.status}`)}</Badge>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <DetailRow label={t("viewingDetail.appointmentBlock.requestedTime")} value={formatDateTime(viewing.requested_start_at, lang)} />
                {viewing.confirmed_start_at && (
                  <DetailRow label={t("viewingDetail.appointmentBlock.confirmedTime")} value={formatDateTime(viewing.confirmed_start_at, lang)} />
                )}
                {viewing.proposed_start_at && viewing.status === "reschedule_proposed" && (
                  <DetailRow label={t("viewingDetail.appointmentBlock.proposedTime")} value={formatDateTime(viewing.proposed_start_at, lang)} />
                )}
                {viewing.mediator_agent_name && (
                  <DetailRow label={t("viewingDetail.appointmentBlock.mediator")} value={viewing.mediator_agent_name} />
                )}
                {viewing.customer_note && (
                  <DetailRow label={t("viewingDetail.appointmentBlock.yourNote")} value={viewing.customer_note} />
                )}
              </div>
            </section>

            {/* Timeline — derived purely client-side from timestamp fields, no dedicated backend endpoint */}
            <ViewingTimeline viewing={viewing} lang={lang} t={t} />

            {/* Prepare for Your Visit / AI Viewing Checklist (brief §11) —
                visible for confirmed or still-pending viewings. */}
            {(viewing.status === "confirmed" || viewing.status === "requested" || viewing.status === "reschedule_proposed") && (
              <ChecklistSection viewing={viewing} onUpdated={setViewing} />
            )}

            {/* Post-viewing decision (brief §16) */}
            {viewing.status === "completed" && <FeedbackSection viewing={viewing} onUpdated={setViewing} />}

            {/* Ask myMakan What Next? (brief §17) */}
            {viewing.status === "completed" && <NextStepsSection viewing={viewing} />}
          </div>

          {/* Actions block */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("viewingDetail.actions.title")}</h2>
              <div className="space-y-2.5">
                {viewing.status === "reschedule_proposed" && viewing.proposed_by === "mediator" && (
                  <Button variant="hero" className="w-full" onClick={() => void handleAccept()} disabled={accepting}>
                    <CheckCircle2 className="size-4" /> {t("viewingDetail.actions.acceptProposedTime")}
                  </Button>
                )}
                {(viewing.status === "requested" || viewing.status === "confirmed" || viewing.status === "reschedule_proposed") && (
                  <Button variant="outline" className="w-full" onClick={() => setShowPropose(true)}>
                    <Calendar className="size-4" /> {t("viewingDetail.actions.proposeAnotherTime")}
                  </Button>
                )}
                {(viewing.status === "requested" || viewing.status === "confirmed" || viewing.status === "reschedule_proposed") && (
                  <Button variant="outline" className="w-full" onClick={() => setShowCancel(true)}>
                    <X className="size-4" /> {t("viewingDetail.actions.cancelViewing")}
                  </Button>
                )}
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/property/$id" params={{ id: String(viewing.property_id) }}>
                    <MessageCircle className="size-4" /> {t("viewingDetail.actions.messageMediator")}
                  </Link>
                </Button>
                {(viewing.status === "confirmed" || viewing.status === "requested" || viewing.status === "reschedule_proposed") && (
                  <Button variant="outline" className="w-full" asChild>
                    <a href="#checklist">
                      <Sparkles className="size-4" /> {t("viewingDetail.actions.viewChecklist")}
                    </a>
                  </Button>
                )}
                {actionError && <p className="text-xs text-destructive">{actionError}</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>

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
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}

function ViewingTimeline({
  viewing,
  lang,
  t,
}: {
  viewing: ApiPropertyViewing;
  lang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const events: { at: string; label: string }[] = [];
  events.push({ at: viewing.created_at, label: t("viewingDetail.timeline.requested") });
  if (viewing.proposed_by) {
    events.push({
      at: viewing.updated_at,
      label: t("viewingDetail.timeline.proposed", { who: viewing.proposed_by === "customer" ? t("viewingDetail.timeline.you") : t("viewingDetail.timeline.mediator") }),
    });
  }
  if (viewing.confirmed_at) events.push({ at: viewing.confirmed_at, label: t("viewingDetail.timeline.confirmed") });
  if (viewing.cancelled_at) {
    events.push({
      at: viewing.cancelled_at,
      label: t("viewingDetail.timeline.cancelled", { who: viewing.cancelled_by === "customer" ? t("viewingDetail.timeline.you") : t("viewingDetail.timeline.mediator") }),
    });
  }
  if (viewing.completed_at) events.push({ at: viewing.completed_at, label: t("viewingDetail.timeline.completed") });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("viewingDetail.timeline.title")}</h2>
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            <div>
              <div className="font-medium">{e.label}</div>
              <div className="text-xs text-muted-foreground">{formatDateTime(e.at, lang)}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CancelModal({
  viewing,
  onClose,
  onCancelled,
}: {
  viewing: ApiPropertyViewing;
  onClose: () => void;
  onCancelled: (v: ApiPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(VIEWING_CUSTOMER_CANCEL_REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await cancelViewing(viewing.id, reason, note.trim() || undefined);
      onCancelled(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myViewings.cancelModal.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("myViewings.cancelModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("myViewings.cancelModal.reasonLabel")}</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {VIEWING_CUSTOMER_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`myViewings.cancelModal.reasons.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("myViewings.cancelModal.noteLabel")}</label>
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
              {submitting ? t("myViewings.cancelModal.submitting") : t("myViewings.cancelModal.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProposeTimeModal({
  viewing,
  onClose,
  onProposed,
}: {
  viewing: ApiPropertyViewing;
  onClose: () => void;
  onProposed: (v: ApiPropertyViewing) => void;
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
      const updated = await proposeViewingTime(viewing.id, { start_at, end_at, note: note.trim() || undefined });
      onProposed(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("viewingDetail.proposeModal.failed"));
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
          {submitting ? t("viewingDetail.proposeModal.submitting") : t("viewingDetail.proposeModal.submit")}
        </Button>
      </div>
    </div>
  );
}

// ── AI Viewing Checklist + During Visit mode (Prompt 9, brief §11/§15) ─────

function ChecklistSection({
  viewing,
  onUpdated,
}: {
  viewing: ApiPropertyViewing;
  onUpdated: (v: ApiPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const checklist = viewing.checklist;
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [pendingItems, setPendingItems] = useState<Set<string>>(new Set());

  if (!checklist) {
    return (
      <section id="checklist" className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-xl font-bold tracking-tight">{t("viewingDetail.checklist.title")}</h2>
        <p className="mt-2 text-sm text-destructive">{t("viewingDetail.checklist.loadFailed")}</p>
      </section>
    );
  }

  async function toggleItem(itemId: string, checked: boolean) {
    setPendingItems((prev) => new Set(prev).add(itemId));
    // Optimistic UI — persistence is fire-and-forget, no offline queue per
    // the brief's "keep this lightweight" instruction for During Viewing mode.
    onUpdated({
      ...viewing,
      checklist: checklist ? { ...checklist, checked: { ...checklist.checked, [itemId]: checked } } : checklist,
    });
    try {
      const updated = await updateViewingChecklist(viewing.id, { checked: { [itemId]: checked } });
      onUpdated(updated);
    } catch {
      // Best-effort — leave the optimistic state; a later toggle or reload will reconcile.
    } finally {
      setPendingItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function saveNote() {
    if (!noteDraft.trim()) return;
    setSavingNote(true);
    try {
      const updated = await updateViewingChecklist(viewing.id, { note: noteDraft.trim() });
      onUpdated(updated);
      setNoteDraft("");
    } catch {
      // Best-effort save — the draft stays in the textarea so the user can retry.
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <section
      id="checklist"
      className="relative overflow-hidden rounded-2xl border border-ai/20 bg-gradient-to-br from-ai-soft via-card to-card p-6 shadow-elevated md:p-8"
    >
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-ai text-ai-foreground shadow-card">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight">{t("viewingDetail.checklist.title")}</h2>
            <Badge tone="ai">{checklist.generated_by === "ai" ? t("viewingDetail.checklist.aiAnnotated") : t("viewingDetail.checklist.deterministicOnly")}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("viewingDetail.checklist.subtitle")}</p>
          {checklist.visit_plan_summary && (
            <p className="mt-3 rounded-xl bg-background/60 p-3 text-sm leading-relaxed">{checklist.visit_plan_summary}</p>
          )}

          <div className="mt-5 space-y-5">
            {checklist.sections.map((section) => (
              <div key={section.key}>
                <h3 className="text-sm font-semibold">{section.title}</h3>
                <ul className="mt-2 space-y-2">
                  {section.items.map((item) => {
                    const checked = !!checklist.checked[item.id];
                    return (
                      <li key={item.id} className="flex items-start gap-2.5 rounded-xl bg-background/60 p-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={pendingItems.has(item.id)}
                          onChange={(e) => void toggleItem(item.id, e.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <div className="min-w-0">
                          <div className={checked ? "text-sm line-through text-muted-foreground" : "text-sm"}>{item.text}</div>
                          {item.why_it_matters && (
                            <div className="mt-0.5 flex items-start gap-1 text-xs text-ai">
                              <Sparkles className="mt-0.5 size-3 shrink-0" /> {item.why_it_matters}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* During Visit mode (brief §15) — private notes, customer-only */}
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">{t("viewingDetail.checklist.duringVisitTitle")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("viewingDetail.checklist.duringVisitHint")}</p>
            {viewing.private_notes && viewing.private_notes.length > 0 && (
              <ul className="mt-3 space-y-2">
                {viewing.private_notes.map((n, i) => (
                  <li key={i} className="rounded-xl bg-background/60 p-3 text-sm">
                    {n.text}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("viewingDetail.checklist.notesLabel")}</label>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onBlur={() => void saveNote()}
                rows={2}
                placeholder={t("viewingDetail.checklist.notesPlaceholder")}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
              />
              {savingNote && <p className="mt-1 text-xs text-muted-foreground">{t("viewingDetail.checklist.notesSaved")}</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Post-viewing feedback (Prompt 9, brief §16) ─────────────────────────────

function FeedbackSection({
  viewing,
  onUpdated,
}: {
  viewing: ApiPropertyViewing;
  onUpdated: (v: ApiPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const [interestLevel, setInterestLevel] = useState<string | null>(viewing.interest_level);
  const [reason, setReason] = useState<string | undefined>(viewing.feedback_reason ?? undefined);
  const [note, setNote] = useState(viewing.feedback_note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(!!viewing.interest_level);

  async function handleSubmit() {
    if (!interestLevel) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await submitViewingFeedback(viewing.id, {
        interest_level: interestLevel,
        reason: interestLevel === "Not Interested" ? reason : undefined,
        note: note.trim() || undefined,
      });
      onUpdated(updated);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("viewingDetail.feedback.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{t("viewingDetail.feedback.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("viewingDetail.feedback.subtitle")}</p>

      <div className="mt-4">
        <label className="mb-2 block text-sm font-medium">{t("viewingDetail.feedback.interestLabel")}</label>
        <div className="flex flex-wrap gap-2">
          {VIEWING_INTEREST_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setInterestLevel(level)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                interestLevel === level ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"
              }`}
            >
              {t(`viewingDetail.feedback.interestLevels.${level}`)}
            </button>
          ))}
        </div>
      </div>

      {interestLevel === "Not Interested" && (
        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium">{t("viewingDetail.feedback.reasonLabel")}</label>
          <div className="flex flex-wrap gap-2">
            {VIEWING_FEEDBACK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  reason === r ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"
                }`}
              >
                {t(`viewingDetail.feedback.reasons.${r}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium">{t("viewingDetail.feedback.noteLabel")}</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
        />
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <Button variant="hero" className="mt-4" onClick={() => void handleSubmit()} disabled={!interestLevel || submitting}>
        {submitting ? t("viewingDetail.feedback.submitting") : t("viewingDetail.feedback.submit")}
      </Button>
      {submitted && !error && <p className="mt-2 text-xs text-success">{t("viewingDetail.feedback.submitted")}</p>}

      {submitted && interestLevel === "Very Interested" && (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">{t("viewingDetail.feedback.suggestedActions.title")}</h3>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Button variant="outline" size="sm" asChild>
              <Link to="/property/$id" params={{ id: String(viewing.property_id) }}>
                <Phone className="size-4" /> {t("viewingDetail.feedback.suggestedActions.contactMediator")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              {/* Retargeted (Prompt 7 — AI Negotiation & Offer Management):
                  used to deep-link into /advisor with a negotiation-tips
                  question; now opens the Make an Offer flow on Property
                  Detail, pre-filled with this completed viewing's id, via
                  the same sessionStorage handoff idiom property.$id.tsx's
                  storeAdvisorCtx/consumeHomeFinderCriteria already use
                  (write-once-before-navigating, read-once-and-clear there —
                  see consumeOfferHandoff in property.$id.tsx). */}
              <Link
                to="/property/$id"
                params={{ id: String(viewing.property_id) }}
                onClick={() => {
                  try {
                    sessionStorage.setItem("maskan_offer_viewing_id", String(viewing.id));
                  } catch {
                    // sessionStorage unavailable (private browsing edge case)
                  }
                }}
              >
                <Handshake className="size-4" /> {t("viewingDetail.feedback.suggestedActions.askNegotiation")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/compare">
                <GitCompare className="size-4" /> {t("viewingDetail.feedback.suggestedActions.compareProperties")}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Ask myMakan What Next? (Prompt 9, brief §17) ────────────────────────────

function NextStepsSection({ viewing }: { viewing: ApiPropertyViewing }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ visit_summary: string; next_steps: string[]; generated_by: string } | null>(null);

  async function handleAsk() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchViewingNextSteps(viewing.id);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("viewingDetail.nextSteps.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-ai/20 bg-ai-soft/40 p-6 shadow-card md:p-8">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-ai text-ai-foreground shadow-card">
          <Sparkles className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold tracking-tight">{t("viewingDetail.nextSteps.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("viewingDetail.nextSteps.subtitle")}</p>

          {!result && (
            <Button variant="ai" className="mt-4" onClick={() => void handleAsk()} disabled={loading}>
              <Sparkles className="size-4" /> {loading ? t("viewingDetail.nextSteps.loading") : t("viewingDetail.nextSteps.cta")}
            </Button>
          )}

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          {result && (
            <div className="mt-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">{t("viewingDetail.nextSteps.summaryTitle")}</h3>
                <p className="mt-1 text-sm leading-relaxed">{result.visit_summary}</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold">{t("viewingDetail.nextSteps.stepsTitle")}</h3>
                <ul className="mt-2 space-y-1.5">
                  {result.next_steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> {step}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="rounded-xl border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                {t("viewingDetail.nextSteps.disclaimer")}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
