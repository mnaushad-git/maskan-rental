import { Building2, Layers, MapPin, Maximize } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Project } from "@/lib/maskan-data";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { Badge } from "./Badges";
import { ContactButtons } from "./ContactButtons";

function priceRangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min !== max) return `${formatSAR(min)} – ${formatSAR(max)}`;
  return formatSAR(min ?? max ?? 0);
}

export function ProjectCard({ p }: { p: Project }) {
  const { t } = useLanguage();
  const hasPhone = !!p.agentPhone;

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elevated">
      <Link to="/project/$id" params={{ id: p.id }} className="flex flex-col">
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
              {p.category && <Badge tone="neutral">{p.category}</Badge>}
              {p.completionStatus && <Badge tone="secondary">{p.completionStatus}</Badge>}
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight">{p.title}</h3>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" />
              {p.district}, {p.city}
            </p>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {p.developerName && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Building2 className="size-4 shrink-0" />
                <span className="truncate">{p.developerName}</span>
              </span>
            )}
            {(p.areaMin != null || p.areaMax != null) && (
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <Maximize className="size-4" /> {p.areaMin ?? p.areaMax} m²
              </span>
            )}
            {p.unitCount != null && (
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <Layers className="size-4" /> {p.unitCount}
              </span>
            )}
          </div>

          <div className="mt-auto flex items-end justify-between border-t border-border pt-4">
            <div>
              <div className="text-xs text-muted-foreground">{t("projects.list.startingFrom")}</div>
              <div className="text-xl font-bold tracking-tight">
                SAR {priceRangeLabel(p.priceMin, p.priceMax)}
              </div>
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
