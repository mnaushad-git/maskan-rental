import { Bath, BedDouble, Heart, MapPin, Maximize, Phone } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Property } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { saveProperty } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { RecommendationBadge, StatusBadge } from "./Badges";
import { ScoreRing } from "./ScoreIndicator";

export function PropertyCard({ p }: { p: Property }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      void navigate({ to: "/auth" });
      return;
    }
    if (saved || saving) return;
    setSaving(true);
    try {
      await saveProperty(user.id, Number(p.id));
      setSaved(true);
    } catch {
      // silently ignore duplicate-save errors (unique constraint)
    } finally {
      setSaving(false);
    }
  }

  const hasPhone = !!p.agentPhone;
  const waLink = hasPhone
    ? `https://wa.me/${p.agentPhone!.replace(/\D/g, "").replace(/^0/, "966")}`
    : undefined;

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
              aria-label={saved ? "Saved" : "Save"}
              onClick={handleSave}
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
            <ScoreRing score={p.matchScore} />
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
              <div className="text-xs text-muted-foreground">{t("propertyCard.annualRent")}</div>
              <div className="text-xl font-bold tracking-tight">
                SAR {formatSAR(p.price)}
                <span className="ms-1 text-xs font-medium text-muted-foreground">
                  {t("propertyCard.perYear")}
                </span>
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
        <div className="flex gap-2 border-t border-border px-5 py-3">
          <a
            href={`tel:${p.agentPhone}`}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface"
          >
            <Phone className="size-3.5" /> {t("propertyCard.call")}
          </a>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors",
              "border-[#25D366] bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366]/20 dark:text-[#25D366]",
            )}
          >
            <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            {t("propertyCard.whatsapp")}
          </a>
        </div>
      )}
    </div>
  );
}
