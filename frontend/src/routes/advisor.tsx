import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Briefcase,
  Building2,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Phone,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { chatWithAdvisor, createLead, fetchProperty, mapApiProperty } from "@/lib/api/maskan";
import type { Property } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/advisor")({
  validateSearch: (s: Record<string, unknown>): { q?: string; propertyId?: number } => ({
    q: typeof s.q === "string" ? s.q : undefined,
    // TanStack Router JSON-parses search values, so propertyId arrives as number not string
    propertyId: s.propertyId != null ? Number(s.propertyId) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "AI Advisor — Maskan" },
      {
        name: "description",
        content:
          "Chat with Maskan's AI Advisor for personalized Saudi rental insights, area comparisons, and fair-rent analysis.",
      },
    ],
  }),
  component: AdvisorPage,
});

type LeadData = {
  area_name: string;
  city: string;
  bedrooms_needed?: number;
  max_budget?: number;
  move_in_date?: string;
  requirements_note?: string;
};

type Msg =
  | { role: "user"; text: string; ts?: number }
  | { role: "ai"; text: string; loading?: boolean; ts?: number }
  | { role: "divider"; text: string }
  | { role: "lead_confirm"; data: LeadData };

// ── History persistence ───────────────────────────────────────────────────────
const HISTORY_KEY = "maskan_advisor_history";
const MAX_STORED = 40;

type StoredMsg = { role: "user" | "ai"; text: string; ts: number };

function loadHistory(): Msg[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(HISTORY_KEY) : null;
    if (!raw) return [];
    const stored = JSON.parse(raw) as StoredMsg[];
    if (!Array.isArray(stored) || stored.length === 0) return [];
    const msgs: Msg[] = stored.map((m) => ({ role: m.role, text: m.text, ts: m.ts }));
    // Insert a session-break divider so the user sees where the new session starts
    msgs.push({
      role: "divider",
      text: new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    });
    return msgs;
  } catch {
    return [];
  }
}

function persistHistory(msgs: Msg[]) {
  try {
    const toStore: StoredMsg[] = msgs
      .filter((m): m is { role: "user" | "ai"; text: string; ts?: number } =>
        (m.role === "user" || m.role === "ai") && !("loading" in m && m.loading),
      )
      .slice(-MAX_STORED)
      .map((m) => ({ role: m.role as "user" | "ai", text: m.text, ts: m.ts ?? Date.now() }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(toStore));
  } catch {}
}

const SUGGESTED = [
  "What are the best family areas in North Riyadh?",
  "Compare Al Narjis vs Al Yasmin for a family of 4",
  "Is SAR 8,000/month fair for a 3BR in Al Malqa?",
  "Which areas have the best value for money?",
];

// ── Lead creation system context injected into every Claude call ──────────────
const LEAD_SYSTEM_CTX: Array<{ role: "user" | "assistant"; content: string }> = [
  {
    role: "user",
    content: `[SYSTEM] Besides answering rental questions, you can help create partner lead requests. When a user mentions wanting to find a property, get matched with a partner, or submit a rental request, gather these details conversationally:
1. area_name — district/neighbourhood (required, e.g. "Al Yasmin")
2. city — one of: Riyadh, Jeddah, Dammam, Khobar, Madinah (required)
3. bedrooms_needed — number (optional)
4. max_budget — SAR per month (optional)
5. move_in_date — YYYY-MM-DD format (optional)
6. requirements_note — any specific needs (optional)

Ask for required fields if missing. Once you have area_name + city at minimum, end your response with this marker on its own line with NO text after it:
[CREATE_LEAD:{"area_name":"Al Yasmin","city":"Riyadh","bedrooms_needed":3,"max_budget":15000}]
Include all gathered optional fields in the JSON. Do not output the marker until you have both required fields.`,
  },
  {
    role: "assistant",
    content: "Understood. I'll answer rental questions and help create lead requests. When users want property matching, I'll gather their requirements conversationally and output the CREATE_LEAD marker when ready.",
  },
];

function buildPropertyContext(p: Property): Array<{ role: string; content: string }> {
  return [
    {
      role: "user",
      content: [
        "I need your help evaluating a specific rental property. Here are its details:",
        `Title: ${p.title}`,
        `Type: ${p.type}  |  Location: ${p.district}, ${p.city}`,
        `Size: ${p.bedrooms} bedrooms / ${p.bathrooms} bathrooms, ${p.area} m²`,
        `Monthly rent: SAR ${Math.round(p.price / 12).toLocaleString()}  (SAR ${p.price.toLocaleString()}/year)`,
        `Match score: ${p.matchScore ?? "N/A"}/100`,
        "Please keep all your answers focused on this specific property and its neighbourhood.",
      ].join("\n"),
    },
    {
      role: "assistant",
      content: `Understood — I'll help you evaluate "${p.title}" in ${p.district}, ${p.city} (SAR ${Math.round(p.price / 12).toLocaleString()}/month). What would you like to know?`,
    },
  ];
}

const LEAD_MARKER_RE = /\[CREATE_LEAD:(\{[\s\S]*?\})\]\s*$/m;

function AdvisorPage() {
  const { q: prefilledQ = "", propertyId } = Route.useSearch();
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [propertyCtx, setPropertyCtx] = useState<Property | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const didAutoSend = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Persist every completed message to localStorage
  useEffect(() => {
    persistHistory(messages);
  }, [messages]);

  useEffect(() => {
    // Try sessionStorage first (set by the property page before navigating here)
    const stored = sessionStorage.getItem("maskan_advisor_ctx");
    if (stored) {
      try {
        const parsed: Property = JSON.parse(stored);
        // Only use it if it matches the propertyId in the URL (or if no propertyId constraint)
        if (!propertyId || String(parsed.id) === String(propertyId)) {
          setPropertyCtx(parsed);
          return;
        }
      } catch {
        // ignore corrupt data
      }
    }
    // Fallback: fetch from API (handles direct URL access / refresh)
    if (!propertyId) return;
    fetchProperty(propertyId)
      .then((api) => setPropertyCtx(mapApiProperty(api)))
      .catch(() => {});
  }, [propertyId]);

  useEffect(() => {
    if (prefilledQ && !didAutoSend.current) {
      didAutoSend.current = true;
      void send(prefilledQ);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledQ]);

  const send = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const ctxHistory = propertyCtx ? buildPropertyContext(propertyCtx) : [];
    const history = [
      ...LEAD_SYSTEM_CTX,
      ...ctxHistory,
      ...messages
        .filter(
          (m): m is { role: "user" | "ai"; text: string; ts?: number; loading?: boolean } =>
            (m.role === "user" || m.role === "ai") && !("loading" in m && m.loading),
        )
        .map((m) => ({
          role: m.role === "ai" ? "assistant" : "user",
          content: m.text,
        })),
    ];

    setMessages((prev) => [
      ...prev,
      { role: "user", text, ts: Date.now() },
      { role: "ai", text: "", loading: true },
    ]);
    setInput("");
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const { reply } = await chatWithAdvisor(text, history);

      // Check for lead creation marker
      const match = reply.match(LEAD_MARKER_RE);
      if (match) {
        try {
          const leadData = JSON.parse(match[1]) as LeadData;
          const cleanText = reply.replace(LEAD_MARKER_RE, "").trimEnd();
          setMessages((prev) => [
            ...prev.slice(0, -1),
            ...(cleanText ? [{ role: "ai" as const, text: cleanText, ts: Date.now() }] : []),
            { role: "lead_confirm" as const, data: leadData },
          ]);
        } catch {
          // JSON parse failed — show raw reply
          setMessages((prev) => [...prev.slice(0, -1), { role: "ai" as const, text: reply, ts: Date.now() }]);
        }
      } else {
        setMessages((prev) => [...prev.slice(0, -1), { role: "ai" as const, text: reply, ts: Date.now() }]);
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "ai", text: "Sorry, I couldn't reach the AI service. Please try again.", ts: Date.now() },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const isEmpty = messages.filter((m) => m.role !== "divider").length === 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <Link to="/" className="inline-flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="size-3.5" />
          </span>
          <span className="font-display text-base font-bold tracking-tight">Maskan</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">/ AI Advisor</span>
        </Link>
        <button
          onClick={() => {
            setMessages([]);
            try { localStorage.removeItem(HISTORY_KEY); } catch {}
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <Plus className="size-3.5" /> New chat
        </button>
      </header>

      {/* Property context banner */}
      {propertyCtx && (
        <div className="flex shrink-0 items-center gap-3 border-b border-ai/20 bg-ai-soft/25 px-4 py-2.5">
          <Sparkles className="size-4 shrink-0 text-ai" />
          <div className="min-w-0 flex-1 text-xs">
            <span className="font-semibold text-ai">Property context loaded · </span>
            <span className="text-muted-foreground">
              {propertyCtx.title}, {propertyCtx.district} · SAR {Math.round(propertyCtx.price / 12).toLocaleString()}/mo
            </span>
          </div>
          <Link
            to="/property/$id"
            params={{ id: String(propertyCtx.id) }}
            className="shrink-0 inline-flex items-center gap-0.5 text-xs text-ai hover:underline"
          >
            View <ChevronRight className="size-3" />
          </Link>
          <button
            type="button"
            onClick={() => { setPropertyCtx(null); sessionStorage.removeItem("maskan_advisor_ctx"); }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState onSend={send} propertyCtx={propertyCtx} />
        ) : (
          <div className="mx-auto max-w-2xl px-4 pb-6 pt-8">
            {messages.map((m, i) => (
              <MessageRow key={i} msg={m} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-border/60 bg-background px-4 pb-6 pt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mx-auto max-w-2xl"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm focus-within:border-ai/50 focus-within:shadow-md transition-shadow">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              placeholder="Ask about areas, rent fairness… or say 'I want to find a 3BR in Al Yasmin'"
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!input.trim() || isLoading}
              className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Maskan AI answers based on live platform data. You can also ask it to create a lead request.
          </p>
        </form>
      </div>
    </div>
  );
}

/* ── Lead confirm card (shown in chat when AI gathers enough data) ─────────── */
function LeadConfirmCard({ data }: { data: LeadData }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [doneLeadId, setDoneLeadId] = useState<number | null>(null);

  if (!user) {
    return (
      <div className="mb-8 ms-10 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList className="size-4 text-primary" />
          <span className="text-sm font-semibold">Ready to submit your lead</span>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Sign in to submit this lead — partners covering <strong>{data.area_name}, {data.city}</strong> will be notified.
        </p>
        <Button size="sm" onClick={() => void navigate({ to: "/auth" })}>Sign in to continue</Button>
      </div>
    );
  }

  if (doneLeadId !== null) {
    return (
      <div className="mb-8 ms-10 flex items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-5">
        <CheckCircle className="size-5 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-success">Lead submitted!</p>
          <p className="text-xs text-muted-foreground">
            Partners covering {data.area_name}, {data.city} will be notified. You'll hear back within 24 hours.
          </p>
        </div>
        <Link to="/lead/$leadId" params={{ leadId: String(doneLeadId) }}>
          <Button size="sm" variant="outline">Track lead →</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-8 ms-10 rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList className="size-4 text-primary" />
        <span className="text-sm font-semibold">Ready to submit your lead request</span>
      </div>

      {/* Lead summary */}
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-surface p-3 text-sm">
        <div><span className="text-muted-foreground">District: </span><span className="font-medium">{data.area_name}</span></div>
        <div><span className="text-muted-foreground">City: </span><span className="font-medium">{data.city}</span></div>
        {data.bedrooms_needed != null && (
          <div><span className="text-muted-foreground">Bedrooms: </span><span className="font-medium">{data.bedrooms_needed} BR</span></div>
        )}
        {data.max_budget != null && (
          <div><span className="text-muted-foreground">Budget: </span><span className="font-medium">SAR {data.max_budget.toLocaleString()}/mo</span></div>
        )}
        {data.move_in_date && (
          <div><span className="text-muted-foreground">Move-in: </span><span className="font-medium">{data.move_in_date}</span></div>
        )}
        {data.requirements_note && (
          <div className="col-span-2"><span className="text-muted-foreground">Requirements: </span><span className="font-medium">{data.requirements_note}</span></div>
        )}
      </div>

      {/* Phone input */}
      <div className="mb-3">
        <label className="mb-1.5 block text-xs font-medium">
          Your phone number <span className="text-destructive">*</span>
          <span className="ms-1 font-normal text-muted-foreground">(so the partner can reach you)</span>
        </label>
        <div className="flex items-center gap-2">
          <Phone className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+966 5X XXX XXXX"
            className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={submitting || !phone.trim()}
          onClick={async () => {
            setSubmitting(true);
            setError("");
            try {
              const lead = await createLead({
                area_name: data.area_name,
                city: data.city,
                customer_name: user.full_name ?? user.email ?? "",
                customer_phone: phone.trim(),
                customer_email: user.email ?? "",
                bedrooms_needed: data.bedrooms_needed,
                max_budget: data.max_budget,
                move_in_date: data.move_in_date,
                requirements_note: data.requirements_note,
              });
              setDoneLeadId(lead.id);
            } catch {
              setError("Failed to submit lead. Please try again.");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Submitting…" : "Submit lead request"}
        </Button>
        <span className="text-xs text-muted-foreground">Free · Partners pay SAR 25 to see your details</span>
      </div>
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */
function EmptyState({ onSend, propertyCtx }: { onSend: (t: string) => void; propertyCtx: Property | null }) {
  const suggested = propertyCtx
    ? [
        `Is SAR ${Math.round(propertyCtx.price / 12).toLocaleString()}/month fair for a ${propertyCtx.bedrooms}BR in ${propertyCtx.district}?`,
        `What are the pros and cons of living in ${propertyCtx.district}?`,
        `How does ${propertyCtx.district} compare to similar areas in ${propertyCtx.city}?`,
        `What should I check before renting this property?`,
      ]
    : SUGGESTED;

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 pb-16">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-ai to-secondary text-white shadow-lg">
        <Sparkles className="size-5" />
      </div>
      {propertyCtx ? (
        <>
          <h2 className="font-display text-2xl font-bold tracking-tight">Ask about this property</h2>
          <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
            {propertyCtx.title} · {propertyCtx.district}, {propertyCtx.city}
          </p>
        </>
      ) : (
        <>
          <h2 className="font-display text-2xl font-bold tracking-tight">Maskan AI Advisor</h2>
          <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
            Ask anything about rental properties, neighborhoods, or fair pricing — or let me help you create a partner lead request.
          </p>
        </>
      )}
      <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2 w-full max-w-lg">
        {suggested.map((q) => (
          <button
            key={q}
            onClick={() => onSend(q)}
            className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:border-ai/40 hover:bg-ai-soft/30"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Lead request shortcut */}
      <div className="mt-4 w-full max-w-lg">
        <button
          onClick={() => onSend("I want to find a rental property. Can you help me submit a lead request?")}
          className="flex w-full items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-left text-sm transition-colors hover:bg-primary/10"
        >
          <Briefcase className="size-4 shrink-0 text-primary" />
          <div>
            <span className="font-medium text-foreground">Get matched with a partner</span>
            <span className="ms-2 text-muted-foreground">Tell me what you need — I'll find the right partner for you.</span>
          </div>
        </button>
      </div>
    </div>
  );
}

/* ── Message row ─────────────────────────────────────────────────────────── */
function MessageRow({ msg }: { msg: Msg }) {
  if (msg.role === "divider") {
    return (
      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium text-muted-foreground">{msg.text}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (msg.role === "lead_confirm") {
    return <LeadConfirmCard data={msg.data} />;
  }

  if (msg.role === "user") {
    return (
      <div className="mb-6 flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-ee-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 flex gap-3">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-ai to-secondary text-white">
        <Sparkles className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {msg.loading ? (
          <span className="flex items-center gap-1 pt-1">
            <span className="inline-block size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
            <span className="inline-block size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="inline-block size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </span>
        ) : (
          <MarkdownBlock text={msg.text} />
        )}
      </div>
    </div>
  );
}

/* ── Minimal markdown renderer ───────────────────────────────────────────── */
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.match(/^---+$/)) {
      nodes.push(<hr key={i} className="my-4 border-border" />);
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={i} className="mt-4 mb-1 text-sm font-bold text-foreground">
          {inlineFormat(line.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={i} className="mt-5 mb-2 text-base font-bold text-foreground">
          {inlineFormat(line.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }

    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={i} className="mt-5 mb-2 text-lg font-bold text-foreground">
          {inlineFormat(line.slice(2))}
        </h1>,
      );
      i++;
      continue;
    }

    // Collect consecutive bullet lines into a list
    if (line.match(/^[-*•]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*•]\s/)) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm leading-relaxed text-foreground">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
              <span>{inlineFormat(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
        num++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="my-2 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm leading-relaxed text-foreground">
              <span className="shrink-0 font-semibold text-muted-foreground">{j + 1}.</span>
              <span>{inlineFormat(item)}</span>
            </li>
          ))}
        </ol>,
      );
      void num;
      continue;
    }

    if (line.trim() === "") {
      nodes.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    nodes.push(
      <p key={i} className="text-sm leading-relaxed text-foreground">
        {inlineFormat(line)}
      </p>,
    );
    i++;
  }

  return <div className="space-y-0.5">{nodes}</div>;
}

function inlineFormat(text: string): ReactNode {
  // Split on bold, italic, and markdown links [label](url)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      const isInternal = href.startsWith("/");
      return (
        <a
          key={i}
          href={href}
          {...(!isInternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="font-medium text-ai underline underline-offset-2 hover:text-ai/80 transition-colors"
        >
          {label}
        </a>
      );
    }
    return part;
  });
}
