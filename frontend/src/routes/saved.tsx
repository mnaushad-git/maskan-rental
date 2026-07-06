import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  Building2,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Heart,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Scale,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/maskan/Badges";
import { ScoreRing } from "@/components/maskan/ScoreIndicator";
import {
  deleteSavedProperty,
  fetchSavedProperties,
  mapApiProperty,
  UnauthorizedError,
  updateSavedProperty,
  type ApiSavedProperty,
} from "@/lib/api/maskan";
import { formatSAR, type Property } from "@/lib/maskan-data";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Saved Properties — Maskan" },
      {
        name: "description",
        content:
          "Your shortlisted Saudi rentals — notes, inquiry status, and quick actions to compare or schedule viewings.",
      },
    ],
  }),
  component: SavedPage,
});

type InquiryStatus = "none" | "sent" | "contacted" | "scheduled";

type SavedItem = {
  id: number;
  property: Property;
  savedAt: string; // ISO
  rentalScore: number;
  notes: string[];
  status: InquiryStatus;
  viewingAt?: string; // ISO
};

function normalizeStatus(status: string): InquiryStatus {
  if (status === "sent" || status === "contacted" || status === "scheduled") {
    return status;
  }
  return "none";
}

function toSavedItem(item: ApiSavedProperty): SavedItem {
  const property = mapApiProperty(item.property);

  return {
    id: item.id,
    property,
    savedAt: item.created_at,
    rentalScore: property.matchScore,
    notes: item.notes ? item.notes.split("\n").filter(Boolean) : [],
    status: normalizeStatus(item.status),
    viewingAt: item.viewing_at ?? undefined,
  };
}

function SavedPage() {
  const { user, authLoading, clearAuth } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [filter, setFilter] = useState<"all" | InquiryStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});
  const pendingRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (authLoading) return; // wait until localStorage has been read
    if (!user) {
      void navigate({ to: "/auth" });
      return;
    }

    let cancelled = false;

    async function loadSavedProperties() {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchSavedProperties(user!.id);
        if (!cancelled) {
          setItems(data.map(toSavedItem));
        }
      } catch {
        if (!cancelled) {
          setError(t("saved.unableToLoad"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSavedProperties();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter],
  );

  const counts = useMemo(() => {
    return {
      all: items.length,
      sent: items.filter((i) => i.status === "sent").length,
      contacted: items.filter((i) => i.status === "contacted").length,
      scheduled: items.filter((i) => i.status === "scheduled").length,
    };
  }, [items]);

  function clearCardError(id: number) {
    setCardErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  async function syncItem(id: number, payload: { status?: InquiryStatus; notes?: string[]; viewingAt?: string | null }) {
    if (pendingRef.current.has(id)) return;
    const current = items.find((item) => item.id === id);
    if (!current) return;

    pendingRef.current.add(id);
    clearCardError(id);

    // Optimistic update — reflect changes immediately in the UI
    const optimistic: SavedItem = {
      ...current,
      status: payload.status ?? current.status,
      notes: payload.notes ?? current.notes,
      viewingAt: payload.viewingAt !== undefined
        ? (payload.viewingAt ?? undefined)
        : current.viewingAt,
    };
    setItems((prev) => prev.map((item) => (item.id === id ? optimistic : item)));

    try {
      const updated = await updateSavedProperty(id, {
        status: payload.status ?? current.status,
        // Use !== undefined so an empty [] correctly sends "" instead of preserving old notes
        notes: payload.notes !== undefined ? payload.notes.join("\n") : current.notes.join("\n"),
        viewing_at: payload.viewingAt !== undefined ? payload.viewingAt : (current.viewingAt ?? null),
      });
      // Replace optimistic with server-confirmed data
      setItems((prev) => prev.map((item) => (item.id === id ? toSavedItem(updated) : item)));
    } catch (e) {
      // Roll back to original state
      setItems((prev) => prev.map((item) => (item.id === id ? current : item)));
      if (e instanceof UnauthorizedError) {
        // Token expired mid-session — clear auth state so the useEffect redirect fires
        clearAuth();
      } else {
        setCardErrors((prev) => ({
          ...prev,
          [id]: e instanceof Error ? e.message : t("saved.failedToSave"),
        }));
      }
    } finally {
      pendingRef.current.delete(id);
    }
  }

  async function scheduleViewing(id: number, isoDate: string) {
    await syncItem(id, { status: "scheduled", viewingAt: isoDate });
  }

  async function remove(id: number) {
    // Optimistic remove
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await deleteSavedProperty(id);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearAuth(); // triggers redirect via useEffect
      } else {
        // Refetch to restore on failure
        if (user) {
          const data = await fetchSavedProperties(user.id).catch(() => []);
          setItems(data.map(toSavedItem));
        }
        setError(e instanceof Error ? e.message : t("saved.failedToRemove"));
      }
    }
  }

  async function addNote(id: number, text: string) {
    if (!text.trim()) return;
    const current = items.find((item) => item.id === id);
    if (!current) return;
    await syncItem(id, { notes: [...current.notes, text.trim()] });
  }

  async function removeNote(id: number, idx: number) {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    await syncItem(id, { notes: current.notes.filter((_, noteIndex) => noteIndex !== idx) });
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Title */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-accent-foreground">
              <Bookmark className="size-3.5" /> {t("saved.badge")}
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              {t("saved.heading")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(items.length === 1 ? "saved.subtitleSingular" : "saved.subtitlePlural", { count: items.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/compare">
                <Scale className="mr-1.5 size-4" /> {t("saved.compareAll")}
              </Link>
            </Button>
            <Button variant="ai" size="sm" asChild>
              <Link to="/advisor">
                <Sparkles className="mr-1.5 size-4" /> {t("saved.askAiAdvisor")}
              </Link>
            </Button>
          </div>
        </header>

        {loading && <p className="mb-4 text-sm text-muted-foreground">{t("saved.loading")}</p>}
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {/* Filter chips */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label={t("saved.filters.all", { count: counts.all })}
          />
          <FilterChip
            active={filter === "sent"}
            onClick={() => setFilter("sent")}
            label={t("saved.filters.sent", { count: counts.sent })}
            tone="info"
          />
          <FilterChip
            active={filter === "contacted"}
            onClick={() => setFilter("contacted")}
            label={t("saved.filters.contacted", { count: counts.contacted })}
            tone="warning"
          />
          <FilterChip
            active={filter === "scheduled"}
            onClick={() => setFilter("scheduled")}
            label={t("saved.filters.scheduled", { count: counts.scheduled })}
            tone="success"
          />
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {filtered.map((item) => (
              <SavedCard
                key={item.id}
                item={item}
                syncError={cardErrors[item.id] ?? null}
                onDismissError={() => clearCardError(item.id)}
                onRemove={() => void remove(item.id)}
                onStatus={(s) => void syncItem(item.id, { status: s })}
                onAddNote={(t) => void addNote(item.id, t)}
                onRemoveNote={(n) => void removeNote(item.id, n)}
                onScheduleViewing={(d) => void scheduleViewing(item.id, d)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------- Nav ----------

// ---------- Filter chip ----------

function FilterChip({
  label,
  active,
  onClick,
  tone = "neutral",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "neutral" | "info" | "warning" | "success";
}) {
  const dot = {
    neutral: "bg-muted-foreground",
    info: "bg-info",
    warning: "bg-warning",
    success: "bg-success",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </button>
  );
}

// ---------- Card ----------

function SavedCard({
  item,
  syncError,
  onDismissError,
  onRemove,
  onStatus,
  onAddNote,
  onRemoveNote,
  onScheduleViewing,
}: {
  item: SavedItem;
  syncError: string | null;
  onDismissError: () => void;
  onRemove: () => void;
  onStatus: (s: InquiryStatus) => void;
  onAddNote: (t: string) => void;
  onRemoveNote: (n: number) => void;
  onScheduleViewing: (isoDate: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [viewingDate, setViewingDate] = useState(
    item.viewingAt ? item.viewingAt.slice(0, 16) : "",
  );
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const p = item.property;

  function handleCardClick(e: React.MouseEvent<HTMLElement>) {
    // Let interactive elements handle their own clicks
    if ((e.target as Element).closest("button, a, input, textarea")) return;
    void navigate({ to: "/property/$id", params: { id: p.id } });
  }

  return (
    <article
      className="cursor-pointer overflow-hidden rounded-2xl border border-border bg-card shadow-card"
      onClick={handleCardClick}
    >
      {/* Image header */}
      <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
        <img
          src={p.image}
          alt={p.title}
          loading="lazy"
          className="size-full object-cover"
        />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between">
          <StatusPill status={item.status} viewingAt={item.viewingAt} />
          <button
            type="button"
            aria-label={t("saved.removeFromSaved")}
            onClick={onRemove}
            className="grid size-9 place-items-center rounded-full bg-background/95 text-foreground shadow-card backdrop-blur hover:bg-background"
          >
            <Heart className="size-4 fill-current text-rose-500" />
          </button>
        </div>
        <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-background/95 px-2.5 py-1 text-[11px] font-semibold text-foreground shadow-card backdrop-blur">
          <Calendar className="size-3.5" /> {t("saved.savedOn", { date: formatDate(item.savedAt, lang) })}
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight">{p.title}</h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5" /> {p.district}, {p.city}
          </p>
        </div>
        <ScoreRing score={item.rentalScore} />
      </div>

      {/* Stats grid */}
      <div className="mx-5 mt-4 grid grid-cols-3 gap-3 rounded-xl border border-border bg-surface/50 p-3 text-center">
        <Stat label={t("saved.rentPerYear")} value={`SAR ${formatSAR(p.price)}`} />
        <Stat label={t("saved.area")} value={`${p.area} m²`} />
        <Stat label={t("saved.rentalScore")} value={`${item.rentalScore}/100`} />
      </div>

      {/* Notes */}
      <section className="px-5 pt-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <StickyNote className="size-3.5" /> {t("saved.yourNotes")}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t(item.notes.length === 1 ? "saved.notesCountSingular" : "saved.notesCountPlural", { count: item.notes.length })}
          </span>
        </div>
        <ul className="space-y-1.5">
          {item.notes.map((n, idx) => (
            <li
              key={idx}
              className="group flex items-start justify-between gap-2 rounded-lg bg-ai-soft/60 px-3 py-2 text-sm text-foreground"
            >
              <span>{n}</span>
              <button
                type="button"
                onClick={() => onRemoveNote(idx)}
                aria-label={t("saved.removeNote")}
                className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAddNote(draft);
            setDraft("");
          }}
        >
          <Textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("saved.addNotePlaceholder")}
            className="min-h-[40px] resize-none text-sm"
          />
          <Button type="submit" size="sm" variant="soft" disabled={!draft.trim()}>
            <Plus className="size-4" />
          </Button>
        </form>
      </section>

      {/* Inquiry status tracker */}
      <section className="px-5 pt-5">
        <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <MessageSquare className="size-3.5" /> {t("saved.inquiryStatus")}
        </div>
        <StatusStepper
          status={item.status}
          onChange={(s) => {
            if (s === "scheduled") {
              setShowDatePicker(true);
            } else {
              setShowDatePicker(false);
              onStatus(s);
            }
          }}
        />
        {(showDatePicker || item.status === "scheduled") && (
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!viewingDate) return;
              onScheduleViewing(new Date(viewingDate).toISOString());
              setShowDatePicker(false);
            }}
          >
            <Calendar className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="datetime-local"
              value={viewingDate}
              onChange={(e) => setViewingDate(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Button type="submit" size="sm" variant="default" disabled={!viewingDate}>
              {t("saved.confirm")}
            </Button>
          </form>
        )}
      </section>

      {/* Sync error */}
      {syncError && (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">{syncError}</span>
          <button type="button" onClick={onDismissError} className="shrink-0 hover:opacity-70">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Contact CTA */}
      {p.agentPhone && (
        <div className="flex gap-2 border-t border-border px-5 py-3">
          <a
            href={`tel:${p.agentPhone}`}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface"
          >
            <Phone className="size-3.5" /> {t("saved.callAgent")}
          </a>
          <a
            href={`https://wa.me/${p.agentPhone.replace(/\D/g, "").replace(/^0/, "966")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#25D366] bg-[#25D366]/10 py-2 text-xs font-medium text-[#128C7E] transition-colors hover:bg-[#25D366]/20 dark:text-[#25D366]"
          >
            <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            {t("saved.whatsapp")}
          </a>
        </div>
      )}

      {/* Actions */}
      <footer className="mt-0 flex items-center gap-2 border-t border-border bg-surface/40 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="size-4" /> {t("saved.remove")}
        </Button>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/compare">
              <Scale className="size-4" /> {t("saved.compare")}
            </Link>
          </Button>
          <Button variant="default" size="sm" asChild>
            <Link to="/property/$id" params={{ id: p.id }}>
              {t("saved.viewDetails")}
            </Link>
          </Button>
        </div>
      </footer>

    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ---------- Status pill ----------

function StatusPill({
  status,
  viewingAt,
}: {
  status: InquiryStatus;
  viewingAt?: string;
}) {
  const { t, lang } = useLanguage();
  if (status === "none")
    return <Badge tone="neutral">{t("saved.statusPill.notContacted")}</Badge>;
  if (status === "sent")
    return (
      <Badge tone="info" icon={<Send className="size-3.5" />}>
        {t("saved.statusPill.inquirySent")}
      </Badge>
    );
  if (status === "contacted")
    return (
      <Badge tone="warning" icon={<Phone className="size-3.5" />}>
        {t("saved.statusPill.agentContacted")}
      </Badge>
    );
  return (
    <Badge tone="success" icon={<CalendarCheck className="size-3.5" />}>
      {t("saved.statusPill.viewing", { date: viewingAt ? formatDateTime(viewingAt, lang) : t("saved.statusPill.scheduled") })}
    </Badge>
  );
}

// ---------- Stepper ----------

function useSteps(): { key: InquiryStatus; label: string; icon: React.ReactNode }[] {
  const { t } = useLanguage();
  return [
    { key: "sent", label: t("saved.steps.inquirySent"), icon: <Send className="size-3.5" /> },
    { key: "contacted", label: t("saved.steps.contacted"), icon: <Phone className="size-3.5" /> },
    {
      key: "scheduled",
      label: t("saved.steps.viewingScheduled"),
      icon: <CalendarCheck className="size-3.5" />,
    },
  ];
}

function StatusStepper({
  status,
  onChange,
}: {
  status: InquiryStatus;
  onChange: (s: InquiryStatus) => void;
}) {
  const order: InquiryStatus[] = ["none", "sent", "contacted", "scheduled"];
  const activeIdx = order.indexOf(status);
  const STEPS = useSteps();

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const stepIdx = order.indexOf(step.key);
        const done = activeIdx >= stepIdx;
        return (
          <div key={step.key} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => onChange(step.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition-colors",
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {done ? <CheckCircle2 className="size-3.5" /> : step.icon}
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "h-px w-3 flex-none",
                  activeIdx > stepIdx ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Empty state ----------

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-primary-soft text-accent-foreground">
        <Bookmark className="size-5" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">{t("saved.empty.heading")}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {t("saved.empty.desc")}
      </p>
      <Button className="mt-5" asChild>
        <Link to="/search">{t("saved.empty.browseProperties")}</Link>
      </Button>
    </div>
  );
}

// ---------- utils ----------

function formatDate(iso: string, lang: "en" | "ar") {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatDateTime(iso: string, lang: "en" | "ar") {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
