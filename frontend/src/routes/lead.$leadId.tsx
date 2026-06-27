import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle, Clock, Home, MessageSquare, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { NotificationBell } from "@/components/maskan/NotificationBell";
import { useAuth } from "@/lib/auth-context";
import {
  fetchLead, fetchMyLeads, fetchLeadMessages, sendLeadMessage, markLeadMessagesRead,
  type ApiLeadDetail, type ApiLeadMessage,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";

export const Route = createFileRoute("/lead/$leadId")({
  head: () => ({ meta: [{ title: "My Lead — Maskan" }] }),
  component: CustomerLeadPage,
});

const STATUS_INFO: Record<string, { label: string; description: string; tone: "info" | "warning" | "success" | "neutral" }> = {
  pending_review:  { label: "Under review", description: "Our team is reviewing your lead before sharing it with partners.", tone: "neutral" },
  rejected:        { label: "Not accepted", description: "Your lead was not accepted. Please contact us for more information.", tone: "neutral" },
  open:            { label: "Searching for partner", description: "We're matching you with a verified partner in your area.", tone: "info" },
  assigned:        { label: "Partner assigned", description: "A partner has been found and will review your requirements shortly.", tone: "warning" },
  in_progress:     { label: "In progress", description: "Your partner is actively working on your request.", tone: "warning" },
  pending_closure: { label: "Closing in progress", description: "Your partner has requested to close this lead. Our team is reviewing it.", tone: "warning" },
  closed_won:      { label: "Closed — found!", description: "Congratulations! Your rental has been arranged.", tone: "success" },
  closed_lost:     { label: "Closed", description: "This lead was closed without a match.", tone: "neutral" },
};

function CustomerLeadPage() {
  const { leadId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lead, setLead] = useState<ApiLeadDetail | null>(null);
  const [messages, setMessages] = useState<ApiLeadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    fetchLead(Number(leadId))
      .then(l => { setLead(l); setLoading(false); })
      .catch(() => setLoading(false));
    fetchLeadMessages(Number(leadId))
      .then(msgs => { setMessages(msgs); markLeadMessagesRead(Number(leadId)).catch(() => {}); })
      .catch(() => {});
  }, [leadId, user]);

  // Poll messages every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLeadMessages(Number(leadId))
        .then(msgs => { setMessages(msgs); markLeadMessagesRead(Number(leadId)).catch(() => {}); })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [leadId]);

  // Poll lead status every 15 seconds while not yet in a terminal state
  useEffect(() => {
    const TERMINAL = ["closed_won", "closed_lost", "rejected"];
    if (lead && TERMINAL.includes(lead.status)) return;
    const interval = setInterval(() => {
      fetchLead(Number(leadId)).then(setLead).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [leadId, lead?.status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <h1 className="text-xl font-bold">Sign in to view your lead</h1>
        <Button onClick={() => navigate({ to: "/auth" })}>Sign in</Button>
      </div>
    );
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }

  if (!lead) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4">
        <p className="text-sm text-muted-foreground">Lead not found or you don't have access.</p>
        <Button variant="outline" onClick={() => navigate({ to: "/" })}>Go home</Button>
      </div>
    );
  }

  const statusInfo = STATUS_INFO[lead.status] ?? STATUS_INFO.open;
  const hasMediator = ["in_progress", "pending_closure", "closed_won", "closed_lost"].includes(lead.status);
  // Allow chat when admin has sent a question (pending_review) or mediator is active
  const canChat = hasMediator || ["pending_review"].includes(lead.status);
  const acceptedAssignment = lead.assignments.find(a => a.status === "accepted");

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link to="/my-leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> My Leads
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">Lead #{lead.id}</span>
          <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Status banner */}
        <div className={`mb-6 rounded-2xl border p-5 ${lead.status === "closed_won" ? "border-success/30 bg-success/5" : lead.status === "closed_lost" ? "border-border bg-card" : "border-primary/20 bg-primary/5"}`}>
          <div className="flex items-start gap-3">
            <div className={`grid size-9 shrink-0 place-items-center rounded-full ${lead.status === "closed_won" ? "bg-success/15 text-success" : lead.status === "in_progress" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
              {lead.status === "closed_won" ? <CheckCircle className="size-5" /> : <Clock className="size-5" />}
            </div>
            <div>
              <h2 className="font-semibold">{statusInfo.label}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{statusInfo.description}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Left panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Requirements */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
              <h2 className="font-semibold">Your requirements</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span className="font-medium">{lead.area_name}, {lead.city}</span>
                </div>
                {lead.bedrooms_needed && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bedrooms</span>
                    <span className="font-medium">{lead.bedrooms_needed} BR</span>
                  </div>
                )}
                {(lead.min_budget || lead.max_budget) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Budget</span>
                    <span className="font-medium">
                      {lead.min_budget ? `SAR ${formatSAR(lead.min_budget)}` : ""}
                      {lead.min_budget && lead.max_budget ? " – " : ""}
                      {lead.max_budget ? `SAR ${formatSAR(lead.max_budget)}` : ""}/mo
                    </span>
                  </div>
                )}
                {lead.move_in_date && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Move-in</span>
                    <span className="font-medium">{lead.move_in_date}</span>
                  </div>
                )}
              </div>
              {lead.requirements_note && (
                <div className="rounded-lg bg-surface p-3 text-sm">
                  {lead.requirements_note}
                </div>
              )}
            </div>

            {/* Partner status */}
            {hasMediator ? (
              <div className="rounded-2xl border border-success/30 bg-success/5 p-5 shadow-card space-y-2">
                <h2 className="font-semibold flex items-center gap-2">
                  <CheckCircle className="size-4 text-success" /> Partner assigned
                </h2>
                <p className="text-sm text-muted-foreground">
                  A verified partner covering {lead.area_name} is working on your request. Use the chat to discuss your needs.
                </p>
                {acceptedAssignment && (
                  <p className="text-xs text-muted-foreground">
                    Assignment #{acceptedAssignment.id} · accepted
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-5 text-center space-y-2">
                <Sparkles className="size-6 text-primary mx-auto" />
                <p className="text-sm font-medium">Matching in progress</p>
                <p className="text-xs text-muted-foreground">
                  We're finding the best partner for {lead.area_name}. This usually takes under 24 hours.
                </p>
              </div>
            )}

            {/* Suggested properties */}
            {lead.suggestions.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <Home className="size-4 text-muted-foreground" /> Suggested properties
                </h2>
                {lead.suggestions.map(s => (
                  s.property_id ? (
                    <Link
                      key={s.id}
                      to="/property/$id"
                      params={{ id: String(s.property_id) }}
                      className="block rounded-lg border border-border p-3 text-sm hover:bg-surface transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{s.property_title ?? `Property #${s.property_id}`}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {s.bedrooms ? `${s.bedrooms} BR · ` : ""}
                            {s.monthly_rent ? `SAR ${formatSAR(s.monthly_rent)}/mo` : ""}
                          </p>
                        </div>
                        <Badge tone="primary" className="shrink-0">{Math.round(s.match_score)}%</Badge>
                      </div>
                    </Link>
                  ) : (
                    <div key={s.id} className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                      {s.reason}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          {/* Chat */}
          <div className="lg:col-span-3 flex flex-col rounded-2xl border border-border bg-card shadow-card" style={{ minHeight: 480 }}>
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <MessageSquare className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{hasMediator ? "Chat with your partner" : "Messages from Maskan"}</span>
              {!canChat && <Badge tone="neutral">Available once partner is assigned</Badge>}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.length === 0 && canChat && (
                <p className="text-center text-sm text-muted-foreground pt-8">
                  {hasMediator ? "Your partner will message you here. You can also start the conversation." : "Our team may send you questions here before matching you with a partner."}
                </p>
              )}
              {messages.length === 0 && !canChat && (
                <p className="text-center text-sm text-muted-foreground pt-8">
                  Chat will open once a partner accepts your lead.
                </p>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender_role === "customer" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${msg.sender_role === "customer" ? "bg-primary text-primary-foreground" : "bg-surface border border-border"}`}>
                    {msg.sender_role === "mediator" && (
                      <div className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Partner</div>
                    )}
                    {msg.sender_role === "admin" && (
                      <div className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Maskan Team</div>
                    )}
                    {msg.content}
                    <div className={`mt-1 text-[10px] ${msg.sender_role === "customer" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {new Date(msg.created_at).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit" })}
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
                placeholder={canChat ? (hasMediator ? "Type a message to your partner…" : "Reply to Maskan team…") : "Waiting for partner assignment…"}
                disabled={!canChat}
                rows={2}
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none disabled:opacity-50"
              />
              <Button type="submit" size="icon" disabled={sending || !draft.trim() || !canChat}>
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/search" })}>
            Browse properties
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/lead/new", search: { area: "", city: "Riyadh" } })}>
            Submit another lead
          </Button>
        </div>
      </main>
    </div>
  );
}
