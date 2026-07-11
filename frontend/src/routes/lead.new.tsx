import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/maskan/Badges";
import { useAuth } from "@/lib/auth-context";
import { createLead, fetchAreas, type ApiLeadDetail } from "@/lib/api/maskan";
import { cities } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/lead/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    area: (s.area as string) ?? "",
    city: (s.city as string) ?? "Riyadh",
  }),
  head: () => ({ meta: [{ title: "Submit a Lead — Maskan" }] }),
  component: NewLeadPage,
});

function NewLeadPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { area, city } = Route.useSearch();

  const [form, setForm] = useState({
    area_name: area || "",
    city: city || "Riyadh",
    customer_name: user?.full_name ?? "",
    customer_phone: "",
    customer_email: user?.email ?? "",
    min_budget: "",
    max_budget: "",
    bedrooms_needed: "",
    move_in_date: "",
    requirements_note: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ApiLeadDetail | null>(null);
  const [error, setError] = useState("");
  const [availableAreas, setAvailableAreas] = useState<{ name: string; city: string }[]>([]);

  useEffect(() => {
    fetchAreas()
      .then((areas) => setAvailableAreas(areas.map((a) => ({ name: a.name, city: a.city }))))
      .catch(() => {});
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
          <Lightbulb className="size-10 text-primary" />
          <h1 className="text-xl font-bold">{t("leadNew.signInGate.heading")}</h1>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            {t("leadNew.signInGate.desc")}
          </p>
          <Button onClick={() => navigate({ to: "/auth" })}>{t("leadNew.signInGate.cta")}</Button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const lead = await createLead({
        area_name: form.area_name,
        city: form.city,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        min_budget: form.min_budget ? Number(form.min_budget) : undefined,
        max_budget: form.max_budget ? Number(form.max_budget) : undefined,
        bedrooms_needed: form.bedrooms_needed ? Number(form.bedrooms_needed) : undefined,
        move_in_date: form.move_in_date || undefined,
        requirements_note: form.requirements_note || undefined,
      });
      setResult(lead);
    } catch {
      setError(t("leadNew.failedToSubmit"));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-12">
          <div className="grid size-16 place-items-center rounded-full bg-success/10 text-success">
            <CheckCircle className="size-8" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">{t("leadNew.success.heading")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("leadNew.success.desc", { area: result.area_name, city: result.city })}
            </p>
          </div>
          {result.suggestions.length > 0 && (
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="mb-3 font-semibold">{t("leadNew.success.suggestedHeading")}</h2>
              <div className="space-y-2">
                {result.suggestions.map(s => (
                  <div key={s.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{s.property_title ?? t("leadNew.success.propertyFallback", { id: s.property_id })}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {s.bedrooms ? t("leadNew.success.bedroomsPrefix", { count: s.bedrooms }) : ""}
                          {s.monthly_rent ? t("leadNew.success.perMonth", { amount: s.monthly_rent.toLocaleString() }) : ""}
                        </p>
                      </div>
                      <Badge tone="primary" className="shrink-0">{t("leadNew.success.matchPct", { pct: Math.round(s.match_score) })}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={() => navigate({ to: "/search" })}>{t("leadNew.success.browseProperties")}</Button>
            <Button variant="outline" onClick={() => navigate({ to: "/my-leads" })}>{t("leadNew.success.allMyLeads")}</Button>
            <Button onClick={() => navigate({ to: "/lead/$leadId", params: { leadId: String(result.id) } })}>{t("leadNew.success.trackThisLead")}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="px-4 py-12">
      <div className="mx-auto max-w-lg">
        <div className="mb-8">
          <Badge tone="ai" className="mb-3"><Lightbulb className="size-3" /> {t("leadNew.badge")}</Badge>
          <h1 className="text-2xl font-bold">{t("leadNew.heading")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("leadNew.subtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-8 shadow-card space-y-5">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{t("leadNew.sections.targetLocation")}</h2>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("leadNew.city")} <span className="text-destructive">*</span></label>
            <select
              required
              value={form.city}
              onChange={e => setForm(f => ({ ...f, city: e.target.value, area_name: "" }))}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {cities.map(c => <option key={c.name} value={c.name}>{t(`cities.${c.name}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("leadNew.districtArea")} <span className="text-destructive">*</span></label>
            <select
              required
              value={form.area_name}
              onChange={e => setForm(f => ({ ...f, area_name: e.target.value }))}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">{t("leadNew.selectDistrict")}</option>
              {availableAreas.filter(a => a.city === form.city).sort((a, b) => a.name.localeCompare(b.name)).map(a => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>

          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground pt-2">{t("leadNew.sections.propertyRequirements")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("leadNew.minBudget")}</label>
              <Input type="number" min={0} value={form.min_budget} onChange={e => setForm(f => ({ ...f, min_budget: e.target.value }))} placeholder="e.g. 5000" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("leadNew.maxBudget")}</label>
              <Input type="number" min={0} value={form.max_budget} onChange={e => setForm(f => ({ ...f, max_budget: e.target.value }))} placeholder="e.g. 15000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("leadNew.bedroomsNeeded")}</label>
              <select value={form.bedrooms_needed} onChange={e => setForm(f => ({ ...f, bedrooms_needed: e.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                <option value="">{t("leadNew.any")}</option>
                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{t("leadNew.bedroomsOption", { count: n })}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("leadNew.moveInDate")}</label>
              <Input type="date" value={form.move_in_date} onChange={e => setForm(f => ({ ...f, move_in_date: e.target.value }))} min={new Date().toISOString().split("T")[0]} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("leadNew.additionalRequirements")}</label>
            <textarea rows={3} value={form.requirements_note} onChange={e => setForm(f => ({ ...f, requirements_note: e.target.value }))} placeholder={t("leadNew.requirementsPlaceholder")} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
          </div>

          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground pt-2">{t("leadNew.sections.yourContact")}</h2>
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t("leadNew.fullName")} <span className="text-destructive">*</span></label>
            <Input required value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} placeholder={t("leadNew.fullNamePlaceholder")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("leadNew.phone")} <span className="text-destructive">*</span></label>
              <Input required type="tel" value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} placeholder="+966 5X XXX XXXX" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t("leadNew.email")} <span className="text-destructive">*</span></label>
              <Input required type="email" value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} placeholder="you@example.com" />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? t("leadNew.submitting") : t("leadNew.submitLeadRequest")}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            {t("leadNew.partnerNotifyNote", { city: t(`cities.${form.city}`) })}
          </p>
        </form>
      </div>
      </div>
    </div>
  );
}
