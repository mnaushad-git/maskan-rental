import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle, Clock, MessageSquare, Phone, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { useAuth } from "@/lib/auth-context";
import {
  fetchLead, acceptLead, rejectLead, patchLeadStatus, fetchLeadMessages, sendLeadMessage, markLeadMessagesRead,
  type ApiLeadDetail, type ApiLeadMessage,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/partner/leads/$leadId")({
  head: () => ({ meta: [{ title: "Lead Detail — Maskan Partner" }] }),
  component: MediatorLeadDetail,
});

function MediatorLeadDetail() {
  const { leadId } = Route.useParams();
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [lead, setLead] = useState<ApiLeadDetail | null>(null);
  const [messages, setMessages] = useState<ApiLeadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [actionState, setActionState] = useState<"idle" | "accepting" | "rejecting" | "closing">("idle");
  const [showCloseMenu, setShowCloseMenu] = useState(false);
  const [closureNote, setClosureNote] = useState("");
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    fetchLead(Number(leadId)).then(setLead).catch(() => {});
    fetchLeadMessages(Number(leadId)).then(msgs => { setMessages(msgs); markLeadMessagesRead(Number(leadId)).catch(() => {}); }).catch(() => {});
  }, [leadId, user]);

  // Poll messages every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLeadMessages(Number(leadId)).then(msgs => { setMessages(msgs); markLeadMessagesRead(Number(leadId)).catch(() => {}); }).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [leadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleAccept() {
    setActionState("accepting");
    setError("");
    try {
      await acceptLead(Number(leadId));
      const updated = await fetchLead(Number(leadId));
      setLead(updated);
    } catch {
      setError(t("partnerLeadDetail.couldNotAccept"));
    } finally {
      setActionState("idle");
    }
  }

  async function handleReject() {
    setActionState("rejecting");
    setError("");
    try {
      await rejectLead(Number(leadId));
      navigate({ to: "/partner" });
    } catch {
      setError(t("partnerLeadDetail.couldNotReject"));
    } finally {
      setActionState("idle");
    }
  }

  async function handleRequestClosure(outcome: "closed_won" | "closed_lost") {
    setActionState("closing");
    setShowCloseMenu(false);
    setError("");
    try {
      await patchLeadStatus(Number(leadId), outcome, closureNote.trim() || undefined);
      const updated = await fetchLead(Number(leadId));
      setLead(updated);
      setClosureNote("");
    } catch {
      setError(t("partnerLeadDetail.couldNotSubmitClosure"));
    } finally {
      setActionState("idle");
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      const msg = await sendLeadMessage(Number(leadId), draft.trim());
      setMessages(m => [...m, msg]);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  if (!user) return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">{t("partnerLeadDetail.pleaseSignIn")}</p></div>;
  if (!lead) return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">{t("partnerLeadDetail.loadingLead")}</p></div>;

  const myAssignment = lead.assignments.find(a => a.status === "pending" || a.status === "accepted");
  const isAccepted = myAssignment?.status === "accepted";
  const isPending = myAssignment?.status === "pending";
  const isInProgress = lead.status === "in_progress";
  const isPendingClosure = lead.status === "pending_closure";
  const isClosed = lead.status === "closed_won" || lead.status === "closed_lost";
  const canSeeContact = isAccepted || isInProgress || isPendingClosure || isClosed;

  function formatExpiry(expiresAt: string): string {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return t("partnerLeadDetail.expired");
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? t("partnerLeadDetail.hoursMinutesRemaining", { h, m }) : t("partnerLeadDetail.minutesRemaining", { m });
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link to="/partner" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {t("partnerLeadDetail.dashboard")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">{t("partnerLeadDetail.leadNumber", { id: lead.id })}</span>
          <Badge tone={lead.status === "closed_won" ? "success" : ["in_progress", "pending_closure"].includes(lead.status) ? "warning" : lead.status === "closed_lost" || lead.status === "rejected" ? "neutral" : "info"}>
            {(() => {
              const translated = t(`myLeads.statusBadges.${lead.status}`);
              return translated === `myLeads.statusBadges.${lead.status}` ? lead.status.replace(/_/g, " ") : translated;
            })()}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Lead details */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-4">
              <h2 className="font-semibold">{t("partnerLeadDetail.leadRequirements")}</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{t("partnerLeadDetail.area")}</span><span className="font-medium">{lead.area_name}, {lead.city}</span></div>
                {lead.bedrooms_needed && <div className="flex justify-between"><span className="text-muted-foreground">{t("partnerLeadDetail.bedrooms")}</span><span className="font-medium">{t("partnerLeadDetail.bedroomsValue", { count: lead.bedrooms_needed })}</span></div>}
                {lead.max_budget && <div className="flex justify-between"><span className="text-muted-foreground">{t("partnerLeadDetail.maxBudget")}</span><span className="font-medium">{t("partnerLeadDetail.perMonth", { amount: formatSAR(lead.max_budget) })}</span></div>}
                {lead.move_in_date && <div className="flex justify-between"><span className="text-muted-foreground">{t("partnerLeadDetail.moveIn")}</span><span className="font-medium">{lead.move_in_date}</span></div>}
              </div>
              {lead.requirements_note && (
                <div className="rounded-lg bg-surface p-3 text-sm text-foreground">
                  {lead.requirements_note}
                </div>
              )}
            </div>

            {/* Customer info — only visible after acceptance */}
            {canSeeContact ? (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <h2 className="font-semibold flex items-center gap-1.5"><CheckCircle className="size-4 text-success" /> {t("partnerLeadDetail.customerContact")}</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">{t("partnerLeadDetail.name")}</span><span className="font-medium">{lead.customer_name}</span></div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("partnerLeadDetail.phone")}</span>
                    <a href={`tel:${lead.customer_phone}`} className="flex items-center gap-1 font-medium text-primary hover:underline">
                      <Phone className="size-3" />{lead.customer_phone}
                    </a>
                  </div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">{t("partnerLeadDetail.email")}</span><span className="font-medium text-xs">{lead.customer_email}</span></div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {t("partnerLeadDetail.contactHiddenNote")}
              </div>
            )}

            {/* Suggested properties */}
            {lead.suggestions.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <h2 className="font-semibold">{t("partnerLeadDetail.suggestedProperties")}</h2>
                {lead.suggestions.map(s => (
                  <div key={s.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{s.property_title ?? t("partnerLeadDetail.propertyFallback", { id: s.property_id })}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {s.bedrooms ? t("partnerLeadDetail.bedroomsPrefix", { count: s.bedrooms }) : ""}
                          {s.monthly_rent ? t("partnerLeadDetail.perMonthPlain", { amount: s.monthly_rent.toLocaleString() }) : ""}
                        </p>
                      </div>
                      <Badge tone="primary" className="shrink-0">{Math.round(s.match_score)}%</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Accept / Reject */}
            {isPending && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {t("partnerLeadDetail.acceptChargePrefix")} <strong>{t("partnerLeadDetail.acceptChargeAmount")}</strong> {t("partnerLeadDetail.acceptChargeSuffix")}
                  </p>
                  {myAssignment?.expires_at && (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <Clock className="size-3" />{formatExpiry(myAssignment.expires_at)}
                    </span>
                  )}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={handleAccept} disabled={actionState !== "idle"}>
                    <CheckCircle className="size-4" />{actionState === "accepting" ? t("partnerLeadDetail.accepting") : t("partnerLeadDetail.acceptLead")}
                  </Button>
                  <Button variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={handleReject} disabled={actionState !== "idle"}>
                    <XCircle className="size-4" />{actionState === "rejecting" ? t("partnerLeadDetail.declining") : t("partnerLeadDetail.decline")}
                  </Button>
                </div>
              </div>
            )}

            {/* Request closure */}
            {isInProgress && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <h2 className="font-semibold text-sm">{t("partnerLeadDetail.requestClosure")}</h2>
                <p className="text-xs text-muted-foreground">{t("partnerLeadDetail.closureReviewNote")}</p>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {showCloseMenu ? (
                  <div className="space-y-3">
                    <textarea
                      value={closureNote}
                      onChange={e => setClosureNote(e.target.value)}
                      placeholder={t("partnerLeadDetail.closureNotePlaceholder")}
                      rows={3}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                    />
                    <div className="flex flex-col gap-2">
                      <Button className="w-full bg-success hover:bg-success/90" onClick={() => handleRequestClosure("closed_won")} disabled={actionState !== "idle"}>
                        <CheckCircle className="size-4" /> {t("partnerLeadDetail.foundProperty")}
                      </Button>
                      <Button variant="outline" className="w-full text-muted-foreground" onClick={() => handleRequestClosure("closed_lost")} disabled={actionState !== "idle"}>
                        <XCircle className="size-4" /> {t("partnerLeadDetail.noMatchFound")}
                      </Button>
                      <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowCloseMenu(false)}>{t("partnerLeadDetail.cancel")}</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setShowCloseMenu(true)} disabled={actionState !== "idle"}>
                    {actionState === "closing" ? t("partnerLeadDetail.submitting") : t("partnerLeadDetail.requestClosure")}
                  </Button>
                )}
              </div>
            )}

            {/* Pending closure banner */}
            {isPendingClosure && (
              <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Clock className="size-4 text-warning" /> {t("partnerLeadDetail.closureSubmitted")}
                </div>
                <p className="text-sm text-muted-foreground">{t("partnerLeadDetail.waitingForAdminReview")}</p>
                {lead.closure_outcome && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{t("partnerLeadDetail.outcome")}</span>
                    <Badge tone={lead.closure_outcome === "closed_won" ? "success" : "neutral"}>
                      {lead.closure_outcome === "closed_won" ? t("partnerLeadDetail.foundProperty") : t("partnerLeadDetail.noMatchFound")}
                    </Badge>
                  </div>
                )}
                {lead.closure_note && (
                  <p className="text-sm text-foreground">"{lead.closure_note}"</p>
                )}
              </div>
            )}

            {/* Closed state */}
            {isClosed && (
              <div className={`rounded-2xl border p-4 text-center text-sm ${lead.status === "closed_won" ? "border-success/30 bg-success/5 text-success" : "border-border bg-surface text-muted-foreground"}`}>
                {lead.status === "closed_won" ? t("partnerLeadDetail.closedFound") : t("partnerLeadDetail.closedNoMatch")}
              </div>
            )}
          </div>

          {/* Chat */}
          <div className="lg:col-span-3 flex flex-col rounded-2xl border border-border bg-card shadow-card" style={{ minHeight: 480 }}>
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <MessageSquare className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{t("partnerLeadDetail.conversation")}</span>
              {!isInProgress && !isAccepted && !isPendingClosure && !isClosed && <Badge tone="neutral">{t("partnerLeadDetail.availableAfterAccepting")}</Badge>}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground pt-8">{t("partnerLeadDetail.noMessagesYet")}</p>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender_role === "mediator" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${msg.sender_role === "mediator" ? "bg-primary text-primary-foreground" : "bg-surface border border-border"}`}>
                    {msg.content}
                    <div className={`mt-1 text-[10px] ${msg.sender_role === "mediator" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {new Date(msg.created_at).toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-SA", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-border p-4">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                placeholder={canSeeContact ? t("partnerLeadDetail.typeMessage") : t("partnerLeadDetail.acceptToMessage")}
                disabled={!canSeeContact}
                rows={2}
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none disabled:opacity-50"
              />
              <Button type="submit" size="icon" disabled={sending || !draft.trim() || !canSeeContact}>
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
