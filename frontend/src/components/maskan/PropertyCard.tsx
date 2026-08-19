import { Bath, BedDouble, Clock, Heart, MapPin, Maximize, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Property } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { saveProperty, deleteSavedProperty } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { RecommendationBadge, StatusBadge } from "./Badges";
import { ContactButtons } from "./ContactButtons";

// Trust Center (Prompt 7) — a lightweight, approximate client-side
// completeness estimate for list cards only. NOT the authoritative Trust
// Model score (that's the real deterministic `/properties/{id}/trust`
// endpoint, rendered on Property Detail's Trust Center — see
// PropertyTrustCenter.tsx). Fetching `/trust` per card in a search-results
// grid would mean dozens of extra requests just to decorate a card, so this
// mirrors the same "required fields are always filled, extra detail fields
// vary" shape as the backend's completeness tiers using only fields already
// present on the mapped `Property` — never a network call, never LLM-based.
// Documented judgment call: see docs/implementation/mymakan-trust-center.md
// "Prompt 7".
const RECENTLY_UPDATED_DAYS = 14; // matches trust_config.py's FRESHNESS_RECENTLY_UPDATED_DAYS

function estimateCompletenessPercent(p: Property): number {
  const optionalFieldsPresent = [
    !!(p.description && p.description.trim()),
    !!p.furnished,
    p.livingRooms != null,
    p.propertyAgeYears != null,
    p.deedArea != null,
    !!p.licenseNumber,
  ].filter(Boolean).length;
  // Base 60 represents the fields every saved listing already has (title,
  // district, city, price, bedrooms, bathrooms) — the remaining 40 scales
  // with how many of the six "extra detail" fields above are filled in.
  return 60 + Math.round((optionalFieldsPresent / 6) * 40);
}

function isRecentlyUpdated(p: Property): boolean {
  const updatedMs = Date.parse(p.updatedAt);
  return (
    !Number.isNaN(updatedMs) && Date.now() - updatedMs < RECENTLY_UPDATED_DAYS * 24 * 60 * 60 * 1000
  );
}

export function PropertyCard({
  p,
  initialSavedId,
  onUnsaved,
}: {
  p: Property;
  /** Pass the saved-properties record id when this card is known to already be saved. */
  initialSavedId?: number;
  /** Called once an unsave is confirmed by the server, so the parent list can drop this item. */
  onUnsaved?: () => void;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [savedId, setSavedId] = useState<number | null>(initialSavedId ?? null);
  const [saving, setSaving] = useState(false);
  const saved = savedId !== null;

  async function handleToggleSave(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      void navigate({ to: "/auth" });
      return;
    }
    if (saving) return;
    setSaving(true);
    if (saved) {
      const prevId = savedId;
      setSavedId(null);
      try {
        await deleteSavedProperty(prevId!);
        onUnsaved?.();
      } catch {
        setSavedId(prevId);
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const result = await saveProperty(user.id, Number(p.id));
      setSavedId(result.id);
    } catch {
      // silently ignore duplicate-save errors (unique constraint)
    } finally {
      setSaving(false);
    }
  }

  const hasPhone = !!p.agentPhone;

  // Small trust signals (Prompt 7, spec section 19) — kept to at most two
  // short items so the card never feels cluttered: verified mediators lead
  // with "✓ Verified by myMakan" (the one allowed verification phrase, kept
  // un-translated to match the backend's own un-localized constant),
  // unverified listings show the completeness estimate instead so the row
  // never looks empty, and "Recently Updated" appends when applicable.
  const isVerified = p.badges.includes("Verified");
  const recentlyUpdated = isRecentlyUpdated(p);
  const trustChips: string[] = [];
  if (isVerified) trustChips.push(t("propertyCard.trust.verified"));
  else
    trustChips.push(t("propertyCard.trust.complete", { percent: estimateCompletenessPercent(p) }));
  if (recentlyUpdated) trustChips.push(t("propertyCard.trust.recentlyUpdated"));

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elevated">
      <Link to="/property/$id" params={{ id: p.id }} className="flex flex-col">
        <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
          <img
            src={p.image}
            alt={p.title}
            loading="lazy"
            width={800}
            height={600}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {p.badges.slice(0, 2).map((b) => (
                <RecommendationBadge key={b} label={b} />
              ))}
            </div>
            <button
              type="button"
              aria-label={saved ? "Unsave" : "Save"}
              onClick={handleToggleSave}
              disabled={saving}
              className="grid size-9 place-items-center rounded-full bg-background/95 shadow-card backdrop-blur transition-colors hover:bg-background disabled:opacity-60"
            >
              <Heart
                className={
                  saved ? "size-4 fill-destructive text-destructive" : "size-4 text-foreground"
                }
              />
            </button>
          </div>
          <div className="absolute bottom-3 start-3">
            <StatusBadge status={p.status} />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5" />
                {p.district}, {p.city}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <BedDouble className="size-4" /> {p.bedrooms}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Bath className="size-4" /> {p.bathrooms}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Maximize className="size-4" /> {p.area} m²
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {trustChips.map((chip, i) => (
              <span key={chip} className="inline-flex items-center gap-1">
                {i === 0 && isVerified ? (
                  <ShieldCheck className="size-3.5" />
                ) : i === trustChips.length - 1 && recentlyUpdated ? (
                  <Clock className="size-3.5" />
                ) : null}
                {chip}
              </span>
            ))}
          </div>

          <div className="mt-auto flex items-end justify-between border-t border-border pt-4">
            <div>
              <div className="text-xs text-muted-foreground">
                {p.listingType === "sale"
                  ? t("propertyCard.salePrice")
                  : t("propertyCard.annualRent")}
              </div>
              <div className="text-xl font-bold tracking-tight">
                SAR {formatSAR(p.price)}
                {p.listingType !== "sale" && (
                  <span className="ms-1 text-xs font-medium text-muted-foreground">
                    {t("propertyCard.perYear")}
                  </span>
                )}
              </div>
            </div>
            <div className="text-end text-xs text-muted-foreground">
              SAR {formatSAR(p.pricePerSqm)}/m²
            </div>
          </div>
        </div>
      </Link>

      {/* Contact CTA — outside the Link to avoid nested <a> */}
      {hasPhone && (
        <ContactButtons
          phone={p.agentPhone!}
          whatsappPhone={p.agentWhatsapp ?? undefined}
          callLabel={t("propertyCard.call")}
          whatsappLabel={t("propertyCard.whatsapp")}
        />
      )}
    </div>
  );
}
