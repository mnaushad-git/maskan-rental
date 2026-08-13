import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  FileText,
  Layers,
  MapPin,
  Maximize,
  Phone,
} from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { PhaseGate } from "@/components/maskan/PhaseGate";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/maskan/Badges";
import { ProjectCard } from "@/components/maskan/ProjectCard";
import { WhatsAppIcon, whatsappLink } from "@/components/maskan/ContactButtons";
import { fetchProject, fetchSimilarProjects, mapApiProject } from "@/lib/api/maskan";
import { formatSAR, type Project } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { PHASE1_FLAGS } from "@/lib/phase1-flags";

export const Route = createFileRoute("/project/$id")({
  head: () => ({
    meta: [
      { title: "Project Details — myMakan" },
      {
        name: "description",
        content: "Explore units, pricing, and developer details for this project.",
      },
    ],
  }),
  // Hide-Phase1 (off-plan projects) — see projects.tsx for why the gate is
  // swapped here rather than inside the component.
  component: PHASE1_FLAGS.projects ? ProjectDetail : PhaseGate,
});

function useProjT() {
  const { t } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => t(`projects.detail.${key}`, vars);
}

function priceRangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min !== max) return `SAR ${formatSAR(min)} – ${formatSAR(max)}`;
  return `SAR ${formatSAR(min ?? max ?? 0)}`;
}

function areaRangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min !== max) return `${min} – ${max} m²`;
  return `${min ?? max} m²`;
}

function ProjectDetail() {
  const { id } = Route.useParams();
  const { t } = useLanguage();
  const tProj = useProjT();
  const [project, setProject] = useState<Project | null>(null);
  const [similar, setSimilar] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const [showCall, setShowCall] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const projectId = Number(id);
    if (Number.isNaN(projectId)) {
      setError(tProj("invalidId"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setActive(0);
    fetchProject(projectId)
      .then((raw) => {
        if (cancelled) return;
        const mapped = mapApiProject(raw);
        setProject(mapped);
        fetchSimilarProjects(projectId)
          .then((rawSimilar) => {
            if (!cancelled) setSimilar(rawSimilar.map(mapApiProject));
          })
          .catch(() => {
            if (!cancelled) setSimilar([]);
          });
      })
      .catch(() => {
        if (!cancelled) setError(tProj("unableToLoad"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // tProj intentionally omitted — switching language shouldn't re-fetch the project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <TopNav />
        <div className="container-page py-8">
          <Skeleton className="aspect-[16/9] w-full rounded-2xl md:aspect-[21/9]" />
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.7fr_1fr]">
            <div className="space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-background">
        <TopNav />
        <div className="container-page py-12">
          <p className="text-sm text-destructive">{error ?? tProj("notFound")}</p>
          <Link to="/projects" className="mt-4 inline-block text-sm text-primary">
            {tProj("backToProjects")}
          </Link>
        </div>
      </div>
    );
  }

  const fullDescription = project.description ?? "";
  const DESCRIPTION_PREVIEW_LENGTH = 320;
  const hasPhone = !!project.agentPhone;
  const whatsappNumber = project.agentWhatsapp ?? project.agentPhone;

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container-page py-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {tProj("backToProjects")}
        </Link>
      </div>

      {/* Gallery */}
      <section className="container-page space-y-3">
        <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-surface-2 md:aspect-[21/9]">
          <img key={active} src={project.images[active]} alt={project.title} className="size-full object-cover" />
        </div>
        {project.images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {project.images.map((src, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "h-16 w-24 shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-150",
                  active === i
                    ? "border-primary opacity-100 scale-[1.06] shadow-sm"
                    : "border-transparent opacity-60 hover:opacity-90 hover:border-border",
                )}
              >
                <img src={src} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="container-page grid grid-cols-1 gap-10 pb-32 pt-8 lg:pb-16 lg:grid-cols-[1.7fr_1fr]">
        <main className="space-y-8">
          <div>
            <div className="flex flex-wrap gap-1.5">
              {project.category && <Badge tone="neutral">{project.category}</Badge>}
              {project.completionStatus && <Badge tone="secondary">{project.completionStatus}</Badge>}
              <Badge tone={project.status === "Available" ? "success" : "neutral"}>{project.status}</Badge>
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight md:text-3xl">{project.title}</h1>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-4" />
              {project.district}, {project.city}
            </p>
          </div>

          {project.developerName && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
              {project.developerLogoUrl ? (
                <img src={project.developerLogoUrl} alt={project.developerName} className="size-10 rounded-lg object-cover" />
              ) : (
                <div className="grid size-10 place-items-center rounded-lg bg-surface-2">
                  <Building2 className="size-5 text-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{tProj("developedBy")}</div>
                <div className="truncate text-sm font-semibold text-foreground">{project.developerName}</div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-y border-border py-4">
            {project.unitCount != null && (
              <div className="flex items-center gap-1.5 text-sm">
                <Layers className="size-4 text-muted-foreground" />
                {tProj("unitCount", { count: project.unitCount })}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm">
              <Maximize className="size-4 text-muted-foreground" />
              {areaRangeLabel(project.areaMin, project.areaMax)}
            </div>
            <div className="text-lg font-bold tracking-tight">{priceRangeLabel(project.priceMin, project.priceMax)}</div>
          </div>

          {!!fullDescription && (
            <div>
              <p className="text-sm leading-6 text-foreground">
                {descExpanded || fullDescription.length <= DESCRIPTION_PREVIEW_LENGTH
                  ? fullDescription
                  : `${fullDescription.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…`}
              </p>
              {fullDescription.length > DESCRIPTION_PREVIEW_LENGTH && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((v) => !v)}
                  className="mt-1 text-sm font-semibold text-primary hover:underline"
                >
                  {descExpanded ? tProj("readLess") : tProj("readMore")}
                </button>
              )}
            </div>
          )}

          {project.introDocumentUrl && (
            <a
              href={project.introDocumentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm font-semibold text-primary hover:bg-surface"
            >
              <FileText className="size-4" /> {tProj("introducingDocument")}
            </a>
          )}

          {project.units.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold">{tProj("units")}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {project.units.map((unit) => (
                  <div key={unit.id} className="space-y-2 rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{unit.unitType}</span>
                      <span className="text-base font-bold">SAR {formatSAR(unit.price)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {unit.areaSqm != null && <span>{unit.areaSqm} m²</span>}
                      {unit.bedrooms != null && <span>{unit.bedrooms} BR</span>}
                      {unit.bathrooms != null && <span>{unit.bathrooms} BA</span>}
                      {unit.livingRooms != null && <span>{unit.livingRooms} Living</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {similar.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold">{tProj("similarProjects")}</h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {similar.map((p) => (
                  <ProjectCard key={p.id} p={p} />
                ))}
              </div>
            </div>
          )}
        </main>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tProj("contact")}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => hasPhone && setShowCall(true)}
                disabled={!hasPhone}
                title={hasPhone ? undefined : tProj("noPhone")}
              >
                <Phone className="size-4" /> {t("propertyCard.call")}
              </Button>
              <a
                href={hasPhone ? whatsappLink(whatsappNumber!) : undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => !hasPhone && e.preventDefault()}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                  hasPhone
                    ? "border-whatsapp bg-whatsapp/10 text-whatsapp-foreground hover:bg-whatsapp/20 dark:text-whatsapp"
                    : "border-border text-muted-foreground opacity-40 cursor-not-allowed",
                )}
              >
                <WhatsAppIcon className="size-4" />
                {t("propertyCard.whatsapp")}
              </a>
            </div>

            {hasPhone && (
              <a
                href={`tel:${project.agentPhone}`}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2.5 text-sm font-semibold text-foreground hover:bg-surface-2 transition-colors"
              >
                <Phone className="size-4 text-muted-foreground" />
                {project.agentPhone}
              </a>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile sticky contact bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground">{t("projects.list.startingFrom")}</div>
            <div className="truncate text-base font-bold tracking-tight">
              {priceRangeLabel(project.priceMin, project.priceMax)}
            </div>
          </div>
          {hasPhone ? (
            <>
              <a
                href={whatsappLink(whatsappNumber!)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-whatsapp px-4 py-2.5 text-sm font-semibold text-white"
              >
                <WhatsAppIcon className="size-4" />
                {t("propertyCard.whatsapp")}
              </a>
              <a
                href={`tel:${project.agentPhone}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold"
              >
                <Phone className="size-4" /> {t("propertyCard.call")}
              </a>
            </>
          ) : null}
        </div>
      </div>

      {showCall && hasPhone && (
        <PhoneModal
          projectTitle={project.title}
          agentPhone={project.agentPhone!}
          agentWhatsapp={whatsappNumber!}
          onClose={() => setShowCall(false)}
        />
      )}
    </div>
  );
}

function PhoneModal({
  projectTitle,
  agentPhone,
  agentWhatsapp,
  onClose,
}: {
  projectTitle: string;
  agentPhone: string;
  agentWhatsapp: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const tProj = useProjT();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl text-center space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid size-14 place-items-center rounded-full bg-primary-soft mx-auto">
          <Phone className="size-6 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">{tProj("callDeveloperTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{projectTitle}</p>
        </div>
        <a
          href={`tel:${agentPhone}`}
          className="block rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {agentPhone}
        </a>
        <a
          href={whatsappLink(agentWhatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl border border-whatsapp bg-whatsapp/10 px-4 py-3 text-sm font-bold text-whatsapp-foreground hover:bg-whatsapp/20 transition-colors dark:text-whatsapp"
        >
          {t("property.landlord.openInWhatsapp")}
        </a>
        <Button variant="ghost" className="w-full" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
