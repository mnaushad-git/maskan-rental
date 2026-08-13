import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { PhaseGate } from "@/components/maskan/PhaseGate";
import { ProjectCard } from "@/components/maskan/ProjectCard";
import { fetchProjects, mapApiProject } from "@/lib/api/maskan";
import type { Project } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";
import { PHASE1_FLAGS } from "@/lib/phase1-flags";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — myMakan" },
      {
        name: "description",
        content: "Browse new developments and off-plan projects from trusted developers across Saudi Arabia.",
      },
    ],
  }),
  // Hide-Phase1 (off-plan projects) — swapped at the route definition, not
  // inside the component, so this never conditionally skips hooks.
  component: PHASE1_FLAGS.projects ? ProjectsPage : PhaseGate,
});

function ProjectsPage() {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjects()
      .then((raw) => {
        if (!cancelled) setProjects(raw.map(mapApiProject));
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <section className="border-b border-border bg-surface">
        <div className="container-page py-10">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {t("projects.list.heading")}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t("projects.list.subtitle")}</p>
          {!loading && (
            <div className="mt-4 text-sm text-muted-foreground">
              {t(projects.length === 1 ? "projects.list.countSingular" : "projects.list.countPlural", {
                count: projects.length,
              })}
            </div>
          )}
        </div>
      </section>

      <main className="container-page py-10">
        {loading && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-80 animate-pulse rounded-2xl bg-surface" />
            ))}
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="grid size-16 place-items-center rounded-2xl bg-surface text-muted-foreground">
              <Building2 className="size-8" />
            </div>
            <div>
              <p className="font-semibold">{t("projects.list.empty.heading")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("projects.list.empty.desc")}</p>
            </div>
          </div>
        )}

        {!loading && projects.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
