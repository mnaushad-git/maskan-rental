// Property Verification & Trust Center — customer-facing Web UI (Prompt 7).
// Named distinctly from mobile's unrelated `TrustBadge.tsx` (the renter's
// own identity-verification score) — see mymakan-trust-center-prompts.md's
// "Naming collision warning". This file owns:
//   - PropertyTrustSection: the instant badge/entry rendered inline on
//     Property Detail (score, level, top signals, "View Trust Details"),
//     with the AI Trust Summary loading async underneath it, never blocking.
//   - PropertyTrustSheet: the full Trust Center detail sheet (Listing
//     Confidence, Mediator, Freshness, Price Confidence, Things to Verify,
//     Report a Concern stub).
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Flag,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/maskan/Badges";
import { ScoreRing, ScoreBar } from "@/components/maskan/ScoreIndicator";
import { VerificationBlock } from "@/components/maskan/VerificationBlock";
import { ReportListingModal } from "@/components/maskan/ReportListingModal";
import {
  fetchPropertyTrust,
  fetchPropertyTrustSummary,
  type ApiPropertyIntelligence,
  type ApiTrustAssessment,
  type ApiTrustSummary,
} from "@/lib/api/maskan";

function useTrustT() {
  const { t } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => t(`property.trust.${key}`, vars);
}

const TRUST_LEVEL_TONE: Record<string, "success" | "warning" | "destructive"> = {
  High: "success",
  Good: "success",
  Moderate: "warning",
  "Limited Confidence": "destructive",
};

const CLASSIFICATION_KEYS: Record<string, string> = {
  "Excellent Value": "excellentValue",
  "Good Value": "goodValue",
  Fair: "fair",
  "Above Market": "aboveMarket",
  "Significantly Above Market": "significantlyAboveMarket",
};

function classificationTone(
  classification: string,
): "success" | "neutral" | "warning" | "destructive" {
  if (classification === "Excellent Value" || classification === "Good Value") return "success";
  if (classification === "Fair") return "neutral";
  if (classification === "Above Market") return "warning";
  return "destructive";
}

// Maps backend's exact display labels (app/core/trust_config.py's
// COMPLETENESS_FIELDS) to a clean i18n key — same "raw string -> local key"
// pattern property.$id.tsx already uses for price-intelligence
// classification labels. Falls back to the raw backend label for any field
// this map doesn't recognize, so nothing silently disappears from the list.
const COMPLETENESS_FIELD_KEYS: Record<string, string> = {
  Title: "title",
  "District / area": "district",
  City: "city",
  Price: "price",
  "Property type": "propertyType",
  Bedrooms: "bedrooms",
  Bathrooms: "bathrooms",
  "Size (sqm)": "size",
  Photos: "photos",
  Description: "description",
  "Map location": "mapLocation",
  "Furnishing status": "furnishingStatus",
  "Living rooms": "livingRooms",
  "Contact number": "contactNumber",
  "Multiple photos (3+)": "multiplePhotos",
  "Property age": "propertyAge",
  "Deed area": "deedArea",
  "WhatsApp number": "whatsapp",
  "License number": "licenseNumber",
};

/* ------------------------------ Badge/entry ------------------------------ */

export function PropertyTrustSection({
  propertyId,
  intelligence,
  mediatorId,
  mediatorName,
}: {
  propertyId: number;
  intelligence: ApiPropertyIntelligence | null;
  mediatorId: number | null;
  mediatorName: string;
}) {
  const tt = useTrustT();
  const { lang } = useLanguage();
  const [trust, setTrust] = useState<ApiTrustAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSheet, setShowSheet] = useState(false);

  // AI Trust Summary (Prompt 5) — fetched separately, after the
  // deterministic assessment, so a slow/failed AI call never blocks the
  // instant trust badge above it. Mirrors the intelligence/ai-summary split
  // already established for myMakan Intelligence on this same page.
  const [summary, setSummary] = useState<ApiTrustSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPropertyTrust(propertyId)
      .then((data) => {
        if (!cancelled) setTrust(data);
      })
      .catch(() => {
        if (!cancelled) setTrust(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    fetchPropertyTrustSummary(propertyId, lang === "ar" ? "ar" : "en")
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, lang]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </section>
    );
  }
  if (!trust) return null; // never block the rest of the page on a failed call

  const positives = trust.positive_signals;
  const verifies = trust.things_to_verify;
  const topSignals: { text: string; positive: boolean }[] = [];
  for (const p of positives) {
    if (topSignals.length >= 4) break;
    topSignals.push({ text: p, positive: true });
  }
  for (const v of verifies) {
    if (topSignals.length >= 4) break;
    topSignals.push({ text: v, positive: false });
  }

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card md:p-8">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            {tt("badge")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <ScoreRing score={trust.overall_score} size={56} />
          <div>
            <div className="text-sm font-semibold">{tt("scoreLabel")}</div>
            <Badge tone={TRUST_LEVEL_TONE[trust.trust_level] ?? "neutral"}>
              {tt(`level.${trust.trust_level}`)}
            </Badge>
          </div>
        </div>

        {topSignals.length > 0 && (
          <ul className="mt-5 space-y-2">
            {topSignals.map((s) => (
              <li key={s.text} className="flex items-start gap-2 text-sm">
                {s.positive ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                )}
                <span className="text-muted-foreground">{s.text}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5">
          <Button size="sm" variant="outline" onClick={() => setShowSheet(true)}>
            {tt("viewDetails")}
          </Button>
        </div>

        {/* AI Trust Summary — loads async underneath the instant score/
            signals above; never blocks or delays them. */}
        <div className="mt-5 border-t border-border pt-4">
          {summaryLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 animate-pulse text-ai" /> {tt("aiSummary.loading")}
            </div>
          ) : summary ? (
            <div>
              {summary.generated_by === "ai" && (
                <Badge tone="ai" className="mb-2">
                  <Sparkles className="size-3.5" /> {tt("aiSummary.label")}
                </Badge>
              )}
              <p className="text-sm leading-relaxed text-muted-foreground">{summary.summary}</p>
            </div>
          ) : null}
        </div>
      </section>

      {showSheet && (
        <PropertyTrustSheet
          propertyId={propertyId}
          trust={trust}
          intelligence={intelligence}
          mediatorId={mediatorId}
          mediatorName={mediatorName}
          onClose={() => setShowSheet(false)}
        />
      )}
    </>
  );
}

/* --------------------------------- Sheet --------------------------------- */

function PropertyTrustSheet({
  propertyId,
  trust,
  intelligence,
  mediatorId,
  mediatorName,
  onClose,
}: {
  propertyId: number;
  trust: ApiTrustAssessment;
  intelligence: ApiPropertyIntelligence | null;
  mediatorId: number | null;
  mediatorName: string;
  onClose: () => void;
}) {
  const tt = useTrustT();
  const { t } = useLanguage();
  const [showReportModal, setShowReportModal] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const completeness = trust.component_scores.completeness;
  const mediatorTrust = trust.component_scores.mediator_trust;
  const freshness = trust.component_scores.freshness;
  const pi = intelligence?.price_intelligence;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ maxHeight: "min(92vh, 780px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <ScoreRing score={trust.overall_score} size={44} />
            <div>
              <h3 className="font-display text-base font-bold">{tt("sheet.title")}</h3>
              <Badge tone={TRUST_LEVEL_TONE[trust.trust_level] ?? "neutral"}>
                {tt(`level.${trust.trust_level}`)}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* Listing Confidence (completeness) */}
          {completeness && (
            <div>
              <h4 className="text-sm font-semibold">{tt("sheet.sections.completeness")}</h4>
              <div className="mt-2">
                <ScoreBar
                  label={tt("sheet.completeness.subtitle", {
                    present: completeness.present_fields.length,
                    total: completeness.present_fields.length + completeness.missing_fields.length,
                  })}
                  value={completeness.score}
                />
              </div>
              <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {completeness.present_fields.map((f) => (
                  <li key={f} className="flex items-center gap-1.5 text-xs">
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                    <span>
                      {COMPLETENESS_FIELD_KEYS[f]
                        ? tt(`sheet.completeness.fields.${COMPLETENESS_FIELD_KEYS[f]}`)
                        : f}
                    </span>
                  </li>
                ))}
                {completeness.missing_fields.map((f) => (
                  <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Circle className="size-3.5 shrink-0" />
                    <span>
                      {COMPLETENESS_FIELD_KEYS[f]
                        ? tt(`sheet.completeness.fields.${COMPLETENESS_FIELD_KEYS[f]}`)
                        : f}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Mediator */}
          <div className="border-t border-border pt-5">
            <h4 className="text-sm font-semibold">{tt("sheet.sections.mediator")}</h4>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{mediatorName}</span>
              {mediatorId && (
                <Link
                  to="/agent/$id"
                  params={{ id: String(mediatorId) }}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {t("property.landlord.profile")}
                </Link>
              )}
            </div>
            {mediatorTrust ? (
              <>
                <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                  {mediatorTrust.avg_rating != null ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3.5 fill-warning text-warning" />{" "}
                      {mediatorTrust.avg_rating.toFixed(2)}{" "}
                      {t("property.landlord.reviews", { count: mediatorTrust.review_count })}
                    </span>
                  ) : (
                    <span>{tt("sheet.mediator.noReviewsYet")}</span>
                  )}
                  <span>
                    {tt("sheet.mediator.listings", { count: mediatorTrust.listing_count })}
                  </span>
                </div>
                <div className="mt-3">
                  <VerificationBlock
                    providers={[
                      {
                        key: "mymakan",
                        name: t("verification.mymakan"),
                        status: mediatorTrust.is_verified ? "verified" : "not_connected",
                        label: mediatorTrust.is_verified
                          ? t("verification.verifiedLabel")
                          : t("verification.notVerifiedLabel"),
                      },
                    ]}
                  />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {tt("sheet.mediator.noMediator")}
              </p>
            )}
          </div>

          {/* Listing Freshness */}
          {freshness && (
            <div className="border-t border-border pt-5">
              <h4 className="text-sm font-semibold">{tt("sheet.sections.freshness")}</h4>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Clock className="size-4 text-muted-foreground" />
                <span className="font-medium">
                  {tt(`sheet.freshness.category.${freshness.category}`)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{freshness.reason}</p>
            </div>
          )}

          {/* Price Confidence — reuses Property Intelligence data already
              fetched on this page; never recalculated here. */}
          <div className="border-t border-border pt-5">
            <h4 className="text-sm font-semibold">{tt("sheet.sections.priceConfidence")}</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {tt("sheet.priceConfidence.subtitle")}
            </p>
            {pi?.sufficient_data ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {pi.classification && (
                  <Badge tone={classificationTone(pi.classification)}>
                    {t(
                      `property.intelligence.priceIntelligence.classification.${CLASSIFICATION_KEYS[pi.classification] ?? "fair"}`,
                    )}
                  </Badge>
                )}
                {intelligence?.data_confidence && (
                  <Badge
                    tone={intelligence.data_confidence.level === "High" ? "success" : "warning"}
                  >
                    {t(
                      intelligence.data_confidence.level === "High"
                        ? "property.intelligence.dataConfidence.high"
                        : "property.intelligence.dataConfidence.moderate",
                    )}
                  </Badge>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {tt("sheet.priceConfidence.unavailable")}
              </p>
            )}
          </div>

          {/* Things to Verify */}
          <div className="border-t border-border pt-5">
            <h4 className="text-sm font-semibold">{tt("sheet.sections.thingsToVerify")}</h4>
            {trust.things_to_verify.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {trust.things_to_verify.map((v) => (
                  <li key={v} className="flex items-start gap-1.5 text-sm">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span className="text-muted-foreground">{v}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {tt("sheet.thingsToVerify.empty")}
              </p>
            )}
          </div>
        </div>

        {/* Report a Concern — Prompt 7 stubbed this button; Prompt 9 wires it
            into the actual report modal (ReportListingModal.tsx). */}
        <div className="shrink-0 border-t border-border p-4">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setShowReportModal(true)}
          >
            <Flag className="size-4" /> {tt("sheet.reportConcern.cta")}
          </Button>
        </div>
      </div>
    </div>

    {/* Rendered as a sibling, not a DOM child, of the sheet's backdrop —
        so a click on the report modal's own backdrop only closes the
        report modal, never bubbles up into the trust sheet's onClose. */}
    {showReportModal && (
      <ReportListingModal propertyId={propertyId} onClose={() => setShowReportModal(false)} />
    )}
    </>
  );
}
