import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { NotificationBell } from "@/components/maskan/NotificationBell";
import { useAuth } from "@/lib/auth-context";
import { fetchMyLeads, type ApiLeadSummary } from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";

export const Route = createFileRoute("/my-leads")({
  head: () => ({ meta: [{ title: "My Leads — Maskan" }] }),
  component: MyLeadsPage,
});

const STATUS_BADGE: Record<string, { tone: "success" | "warning" | "info" | "neutral"; label: string }> = {
  pending_review:  { tone: "neutral", label: "Under review" },
  rejected:        { tone: "neutral", label: "Not accepted" },
  open:            { tone: "info",    label: "Searching for partner" },
  assigned:        { tone: "warning", label: "Partner assigned" },
  in_progress:     { tone: "warning", label: "In progress" },
  pending_closure: { tone: "warning", label: "Closing…" },
  closed_won:      { tone: "success", label: "Closed — found!" },
  closed_lost:     { tone: "neutral", label: "Closed" },
};

function MyLeadsPage() {
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<ApiLeadSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchMyLeads()
      .then(setLeads)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <h1 className="text-xl font-bold">Sign in to view your leads</h1>
        <Button onClick={() => navigate({ to: "/auth" })}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />

      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading && (
          <p className="text-sm text-muted-foreground">Loading your leads…</p>
        )}

        {!loading && leads.length === 0 && (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ClipboardList className="size-7" />
            </div>
            <div>
              <h2 className="text-lg font-bold">No leads yet</h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                Submit a lead and we'll match you with a verified partner in your target area.
              </p>
            </div>
            <Link to="/lead/new" search={{ area: "", city: "Riyadh" }}>
              <Button>Submit your first lead</Button>
            </Link>
          </div>
        )}

        {!loading && leads.length > 0 && (
          <div className="space-y-3">
            {leads.map(lead => {
              const badge = STATUS_BADGE[lead.status] ?? { tone: "neutral" as const, label: lead.status };
              return (
                <Link
                  key={lead.id}
                  to="/lead/$leadId"
                  params={{ leadId: String(lead.id) }}
                  className="block rounded-2xl border border-border bg-card p-5 shadow-card hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <MapPin className="size-4 text-muted-foreground" />
                        <span className="font-semibold">{lead.area_name}, {lead.city}</span>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {lead.bedrooms_needed ? `${lead.bedrooms_needed} BR · ` : ""}
                        {lead.max_budget ? `Up to SAR ${formatSAR(lead.max_budget)}/mo` : "Budget flexible"}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(lead.created_at).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
