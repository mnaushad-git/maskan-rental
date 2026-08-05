import { Bath, BedDouble, Heart, MapPin, Maximize } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Property } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { saveProperty, deleteSavedProperty } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { RecommendationBadge, StatusBadge } from "./Badges";
import { ContactButtons } from "./ContactButtons";

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
              <Heart className={saved ? "size-4 fill-destructive text-destructive" : "size-4 text-foreground"} />
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

          <div className="mt-auto flex items-end justify-between border-t border-border pt-4">
            <div>
              <div className="text-xs text-muted-foreground">
                {p.listingType === "sale" ? t("propertyCard.salePrice") : t("propertyCard.annualRent")}
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
        <ContactButtons phone={p.agentPhone!} callLabel={t("propertyCard.call")} whatsappLabel={t("propertyCard.whatsapp")} />
      )}
    </div>
  );
}
