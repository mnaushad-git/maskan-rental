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
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/my-leads")({
  head: () => ({ meta: [{ title: "My Leads — Maskan" }] }),
  component: MyLeadsPage,
});

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  pending_review: "neutral",
  rejected: "neutral",
  open: "info",
  assigned: "warning",
  in_progress: "warning",
  pending_closure: "warning",
  closed_won: "success",
  closed_lost: "neutral",
};

function MyLeadsPage() {
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
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
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-muted-foreground">{t("myLeads.loading")}</p></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
          <h1 className="text-xl font-bold">{t("myLeads.signInToView")}</h1>
          <Button onClick={() => navigate({ to: "/auth" })}>{t("myLeads.signIn")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />

      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading && (
          <p className="text-sm text-muted-foreground">{t("myLeads.loadingLeads")}</p>
        )}

        {!loading && leads.length === 0 && (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ClipboardList className="size-7" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{t("myLeads.empty.heading")}</h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                {t("myLeads.empty.desc")}
              </p>
            </div>
            <Link to="/lead/new" search={{ area: "", city: "Riyadh" }}>
              <Button>{t("myLeads.empty.submitFirstLead")}</Button>
            </Link>
          </div>
        )}

        {!loading && leads.length > 0 && (
          <div className="space-y-3">
            {leads.map(lead => {
              const tone = STATUS_TONE[lead.status] ?? "neutral";
              const label = t(`myLeads.statusBadges.${lead.status}`) === `myLeads.statusBadges.${lead.status}`
                ? lead.status
                : t(`myLeads.statusBadges.${lead.status}`);
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
                        <Badge tone={tone}>{label}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {lead.bedrooms_needed ? t("myLeads.bedroomsPrefix", { count: lead.bedrooms_needed }) : ""}
                        {lead.max_budget ? t("myLeads.budgetUpTo", { amount: formatSAR(lead.max_budget) }) : t("myLeads.budgetFlexible")}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(lead.created_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-SA", { day: "numeric", month: "short", year: "numeric" })}
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
