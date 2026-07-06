import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Home,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  Star,
} from "lucide-react";
import { PropertyCard } from "@/components/maskan/PropertyCard";
import { Badge } from "@/components/maskan/Badges";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  fetchPublicPartner,
  fetchPropertiesByMediator,
  fetchMediatorReviews,
  fetchMediatorReviewSummary,
  fetchMyReview,
  submitReview,
  mapApiProperty,
  type ApiPartnerPublic,
  type ApiReview,
  type ApiReviewSummary,
} from "@/lib/api/maskan";
import type { Property } from "@/lib/maskan-data";
import { useLanguage, type Language } from "@/lib/i18n/context";

export const Route = createFileRoute("/agent/$id")({
  head: () => ({ meta: [{ title: "Agent Profile — Maskan" }] }),
  component: AgentProfilePage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function agentInitials(name: string | null): string {
  if (!name) return "MA";
  return name.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "MA";
}

function waUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? "966" + digits.slice(1) : digits;
  return `https://wa.me/${normalized}`;
}

function memberSince(dateStr: string, lang: Language): string {
  return new Date(dateStr).toLocaleDateString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", { month: "long", year: "numeric" });
}

function timeAgo(dateStr: string, lang: Language, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t("agent.timeAgo.today");
  if (days === 1) return t("agent.timeAgo.yesterday");
  if (days < 30)  return t("agent.timeAgo.daysAgo", { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t(months > 1 ? "agent.timeAgo.monthsAgo" : "agent.timeAgo.monthAgo", { count: months });
  return new Date(dateStr).toLocaleDateString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", { month: "short", year: "numeric" });
}

function reviewerInitials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
}

// ── Star display (static, supports half-stars) ────────────────────────────────

function StarDisplay({ score, size = 4 }: { score: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = score >= i ? "full" : score >= i - 0.5 ? "half" : "empty";
        return (
          <span key={i} className="relative inline-block">
            <Star className={`size-${size} text-muted-foreground/25`} strokeWidth={1.5} />
            <span className={cn("absolute inset-0 overflow-hidden", fill === "full" ? "w-full" : fill === "half" ? "w-1/2" : "w-0")}>
              <Star className={`size-${size} fill-warning text-warning`} strokeWidth={1.5} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── Interactive star picker ───────────────────────────────────────────────────

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(0);
  const ratingLabels = [
    "",
    t("agent.reviews.ratingPoor"),
    t("agent.reviews.ratingFair"),
    t("agent.reviews.ratingGood"),
    t("agent.reviews.ratingVeryGood"),
    t("agent.reviews.ratingExcellent"),
  ];
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => {
        const active = (hovered || value) >= i;
        return (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(i)}
            className="transition-transform hover:scale-110"
            aria-label={t(i > 1 ? "agent.starsLabel" : "agent.starLabel", { count: i })}
          >
            <Star className={cn("size-7 transition-colors", active ? "fill-warning text-warning" : "text-muted-foreground/30")} strokeWidth={1.5} />
          </button>
        );
      })}
      {value > 0 && (
        <span className="ms-2 text-sm font-semibold text-foreground">
          {ratingLabels[value]}
        </span>
      )}
    </div>
  );
}

// ── Rating distribution bars ──────────────────────────────────────────────────

function DistributionBars({ summary }: { summary: ApiReviewSummary }) {
  const max = Math.max(...Object.values(summary.distribution), 1);
  return (
    <div className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((star) => {
        const count = summary.distribution[String(star)] ?? 0;
        const pct   = Math.round((count / max) * 100);
        return (
          <div key={star} className="flex items-center gap-2 text-xs">
            <span className="w-3 shrink-0 text-end text-muted-foreground">{star}</span>
            <Star className="size-3 shrink-0 fill-warning text-warning" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-warning transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-4 shrink-0 text-end text-muted-foreground">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Single review card ────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: ApiReview }) {
  const { lang, t } = useLanguage();
  const name = review.reviewer_name ?? t("agent.reviews.anonymous");
  return (
    <div className="flex gap-4 py-5 border-b border-border last:border-0">
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {reviewerInitials(review.reviewer_name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm">{name}</span>
          <StarDisplay score={review.rating} size={3} />
          <span className="text-xs text-muted-foreground ms-auto">{timeAgo(review.created_at, lang, t)}</span>
        </div>
        {review.comment && (
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
        )}
      </div>
    </div>
  );
}

// ── Reviews section (aggregate + form + list) ─────────────────────────────────

function ReviewsSection({ mediatorId, displayName }: { mediatorId: number; displayName: string }) {
  const { t } = useLanguage();
  const { user } = useAuth();

  const [summary,   setSummary]   = useState<ApiReviewSummary | null>(null);
  const [reviews,   setReviews]   = useState<ApiReview[]>([]);
  const [myReview,  setMyReview]  = useState<ApiReview | null>(null);
  const [loading,   setLoading]   = useState(true);

  // Form state
  const [rating,    setRating]    = useState(0);
  const [comment,   setComment]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  function loadReviews() {
    const calls: Promise<unknown>[] = [
      fetchMediatorReviewSummary(mediatorId).then(setSummary),
      fetchMediatorReviews(mediatorId).then(setReviews),
    ];
    if (user) {
      calls.push(fetchMyReview(mediatorId).then(r => { setMyReview(r); if (r) { setRating(r.rating); setComment(r.comment ?? ""); } }));
    }
    Promise.all(calls).finally(() => setLoading(false));
  }

  useEffect(() => { loadReviews(); }, [mediatorId, user?.id]);

  async function handleSubmit() {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      const saved = await submitReview({ mediator_id: mediatorId, rating, comment: comment.trim() || undefined });
      setMyReview(saved);
      setSubmitted(true);
      // Refresh list + summary
      await Promise.all([
        fetchMediatorReviewSummary(mediatorId).then(setSummary),
        fetchMediatorReviews(mediatorId).then(setReviews),
      ]);
    } catch {
      alert(t("agent.reviews.failedToSubmit"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return null;

  return (
    <div className="mt-10 space-y-6">
      <h2 className="text-xl font-bold tracking-tight">{t("agent.reviews.heading")}</h2>

      {/* Aggregate */}
      {summary && summary.review_count > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {/* Big score */}
            <div className="text-center sm:w-32 shrink-0">
              <div className="text-5xl font-bold tracking-tight text-foreground">
                {summary.avg_rating?.toFixed(1) ?? "—"}
              </div>
              <div className="mt-1">
                <StarDisplay score={summary.avg_rating ?? 0} size={5} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t(summary.review_count === 1 ? "agent.reviewCountSingular" : "agent.reviewCountPlural", { count: summary.review_count })}
              </div>
            </div>
            {/* Distribution */}
            <div className="flex-1">
              <DistributionBars summary={summary} />
            </div>
          </div>
        </div>
      )}

      {/* Write a review — only for logged-in users */}
      {!user && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            <Link to="/auth" className="font-semibold text-primary hover:underline">{t("agent.reviews.signInPrefix")}</Link>
            {t("agent.reviews.signInSuffix", { name: displayName })}
          </p>
        </div>
      )}

      {user && !submitted && (
        <div ref={formRef} className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
          <div className="text-sm font-semibold">
            {myReview ? t("agent.reviews.updateReview") : t("agent.reviews.rateAgent", { name: displayName })}
          </div>

          <StarPicker value={rating} onChange={setRating} />

          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={t("agent.reviews.commentPlaceholder")}
            rows={3}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {myReview?.status === "pending" && t("agent.reviews.pendingApproval")}
              {myReview?.status === "rejected" && t("agent.reviews.rejected")}
              {myReview ? t("agent.reviews.editingResets") : t("agent.reviews.onePerAgent")}
            </p>
            <button
              type="button"
              disabled={rating === 0 || submitting}
              onClick={handleSubmit}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                rating > 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              <Send className="size-4" />
              {submitting ? t("agent.reviews.submitting") : myReview ? t("agent.reviews.update") : t("agent.reviews.submit")}
            </button>
          </div>
        </div>
      )}

      {submitted && (
        <div className="rounded-2xl border border-warning/30 bg-warning/8 p-5 text-center space-y-1">
          <div className="text-sm font-semibold text-warning">{t("agent.reviews.submittedPendingTitle")}</div>
          <p className="text-xs text-muted-foreground">{t("agent.reviews.submittedPendingDesc")}</p>
          <button type="button" className="mt-1 text-xs text-muted-foreground underline" onClick={() => setSubmitted(false)}>
            {t("agent.reviews.editReview")}
          </button>
        </div>
      )}

      {/* Reviews list */}
      {reviews.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
          <div className="divide-y divide-border px-6">
            {reviews.map(r => <ReviewCard key={r.id} review={r} />)}
          </div>
        </div>
      ) : (
        !user && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t("agent.reviews.noReviewsBeFirst", { name: displayName })}
          </div>
        )
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const NAV = <TopNav />;

function AgentProfilePage() {
  const { t, lang } = useLanguage();
  const { id } = Route.useParams();
  const agentId = Number(id);

  const [partner,  setPartner]  = useState<ApiPartnerPublic | null>(null);
  const [listings, setListings] = useState<Property[]>([]);
  const [summary,  setSummary]  = useState<ApiReviewSummary | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (isNaN(agentId)) { setNotFound(true); setLoading(false); return; }
    Promise.all([
      fetchPublicPartner(agentId),
      fetchPropertiesByMediator(agentId),
      fetchMediatorReviewSummary(agentId),
    ])
      .then(([p, props, s]) => {
        setPartner(p);
        setListings(props.map(mapApiProperty));
        setSummary(s);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        {NAV}
        <div className="flex h-[60vh] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {t("agent.loadingProfile")}
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !partner) {
    return (
      <div className="min-h-screen bg-background">
        {NAV}
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <Building2 className="size-12 text-muted-foreground/30" />
          <div className="text-lg font-bold">{t("agent.partnerNotFound")}</div>
          <p className="text-sm text-muted-foreground">{t("agent.partnerNotFoundDesc")}</p>
          <Link to="/search" className="text-sm font-semibold text-primary hover:underline">{t("agent.browseAllListings")}</Link>
        </div>
      </div>
    );
  }

  const displayName   = partner.agency_name ?? t("agent.defaultAgentName");
  const initials      = agentInitials(partner.agency_name);
  const realRating    = summary?.avg_rating ?? null;
  const reviewCount   = summary?.review_count ?? 0;

  const cityClusters = partner.areas.reduce<Record<string, string[]>>((acc, a) => {
    (acc[a.city] ??= []).push(a.area_name);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      {NAV}

      <div className="container-page py-5">
        <Link to="/partners" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("agent.allPartners")}
        </Link>
      </div>

      <div className="container-page pb-20">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[300px_1fr]">

          {/* ── Sidebar ── */}
          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">

            {/* Profile card */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="h-20 bg-gradient-to-br from-primary/20 to-primary/5" />
              <div className="-mt-10 px-6 pb-6">
                <div className="mb-3 flex items-end gap-4">
                  {partner.profile_image_url ? (
                    <img src={partner.profile_image_url} alt={displayName} className="size-20 rounded-2xl border-4 border-card object-cover shadow-md" />
                  ) : (
                    <div className="grid size-20 place-items-center rounded-2xl border-4 border-card bg-primary text-2xl font-bold text-primary-foreground shadow-md">
                      {initials}
                    </div>
                  )}
                  {partner.is_verified && (
                    <div className="mb-1 flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                      <BadgeCheck className="size-3.5" /> {t("agent.verified")}
                    </div>
                  )}
                </div>

                <h1 className="text-xl font-bold tracking-tight">{displayName}</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("agent.memberSince", { date: memberSince(partner.created_at, lang) })}</p>

                {/* Real rating from reviews */}
                {realRating !== null ? (
                  <div className="mt-3 flex items-center gap-2">
                    <StarDisplay score={realRating} />
                    <span className="text-sm font-bold">{realRating.toFixed(1)}</span>
                    <span className="text-xs text-muted-foreground">· {t(reviewCount === 1 ? "agent.reviewCountSingular" : "agent.reviewCountPlural", { count: reviewCount })}</span>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">{t("agent.noReviewsYet")}</div>
                )}

                {partner.bio && (
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{partner.bio}</p>
                )}

                {/* Stats */}
                <div className="mt-5 grid grid-cols-3 divide-x divide-border rounded-xl border border-border text-center">
                  {[
                    { value: listings.length,             label: t("agent.listingsLabel") },
                    { value: partner.total_leads_accepted, label: t("agent.dealsLabel")   },
                    { value: partner.areas.length,         label: t("agent.areasLabel")   },
                  ].map(({ value, label }) => (
                    <div key={label} className="py-3">
                      <div className="text-lg font-bold">{value}</div>
                      <div className="text-[11px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("agent.contactAgent")}</div>
              <a
                href={waUrl(partner.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                {t("agent.whatsapp")}
              </a>
              <a
                href={`tel:${partner.phone}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3 text-sm font-semibold text-foreground hover:bg-surface-2 transition-colors"
              >
                <Phone className="size-4" /> {t("agent.call", { phone: partner.phone })}
              </a>
            </div>

            {/* Service areas */}
            {partner.areas.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <div className="mb-4 flex items-center gap-2">
                  <MapPin className="size-4 text-primary" />
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("agent.serviceAreas")}</div>
                </div>
                <div className="space-y-4">
                  {Object.entries(cityClusters).map(([city, areas]) => (
                    <div key={city}>
                      <div className="mb-2 text-xs font-semibold text-foreground">{t(`cities.${city === "Al Khobar" ? "Khobar" : city}`)}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {areas.map((a) => (
                          <span key={a} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted-foreground">{a}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* ── Main column ── */}
          <main>
            {/* Listings */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {listings.length > 0
                    ? t(listings.length === 1 ? "agent.activeListingsSingular" : "agent.activeListingsPlural", { count: listings.length })
                    : t("agent.listingsHeading")}
                </h2>
                <p className="text-sm text-muted-foreground">{t("agent.propertiesListedBy", { name: displayName })}</p>
              </div>
              {listings.length > 0 && (
                <Badge tone="primary" className="hidden sm:flex">
                  {t(listings.length === 1 ? "agent.propertyCountSingular" : "agent.propertyCountPlural", { count: listings.length })}
                </Badge>
              )}
            </div>

            {listings.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border py-16 text-center">
                <Home className="size-12 text-muted-foreground/30" />
                <div className="text-base font-semibold text-muted-foreground">{t("agent.noActiveListings")}</div>
                <a
                  href={waUrl(partner.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white"
                >
                  <MessageCircle className="size-4" /> {t("agent.askOnWhatsapp")}
                </a>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {listings.map((p) => <PropertyCard key={p.id} p={p} />)}
              </div>
            )}

            {/* Reviews */}
            <ReviewsSection mediatorId={agentId} displayName={displayName} />
          </main>
        </div>
      </div>
    </div>
  );
}
