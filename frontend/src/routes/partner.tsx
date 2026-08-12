import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Briefcase,
  Building2,
  CheckCircle,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  History,
  Home,
  ListChecks,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { ListingStatusBadge } from "@/components/maskan/ListingStatusBadge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { cities as CITY_LIST } from "@/lib/maskan-data";
import {
  login,
  fetchAreas,
  fetchMyPartnerProfile,
  fetchPartnerLeads,
  fetchAvailableLeads,
  acceptLead,
  addPartnerArea,
  removePartnerArea,
  fetchPartnerListings,
  createPartnerListing,
  patchPartnerListing,
  addPartnerPropertyImage,
  deletePartnerPropertyImage,
  fetchPricingSuggestion,
  fetchPartnerProjects,
  createPartnerProject,
  patchPartnerProject,
  type ApiAreaSummary,
  type ApiPartner,
  type ApiLeadDetail,
  type ApiLeadAvailable,
  type ApiProperty,
  type ApiProject,
  type ApiPricingSuggestion,
  type PartnerPropertyPayload,
  type PartnerProjectPayload,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/partner")({
  head: () => ({ meta: [{ title: "Partner Dashboard — Maskan" }] }),
  component: PartnerDashboard,
});

type PartnerView = "leads" | "listings" | "projects";

function PartnerDashboard() {
  const { user, authLoading, clearAuth } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [view, setView] = useState<PartnerView>("leads");
  const [partner, setPartner] = useState<ApiPartner | null>(null);
  const [leads, setLeads] = useState<ApiLeadDetail[]>([]);
  const [availableLeads, setAvailableLeads] = useState<ApiLeadAvailable[]>([]);
  const [listings, setListings] = useState<ApiProperty[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [availableAreas, setAvailableAreas] = useState<ApiAreaSummary[]>([]);
  const [newArea, setNewArea] = useState({ area_name: "", city: "Riyadh" });
  const [addingArea, setAddingArea] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Listing form state
  const [listingFormOpen, setListingFormOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<ApiProperty | null>(null);

  // Project form state
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ApiProject | null>(null);

  async function reloadLeads() {
    const [profile, l, avail] = await Promise.all([
      fetchMyPartnerProfile().catch(() => null),
      fetchPartnerLeads().catch(() => []),
      fetchAvailableLeads().catch(() => []),
    ]);
    if (profile) setPartner(profile);
    setLeads(l as ApiLeadDetail[]);
    setAvailableLeads(avail as ApiLeadAvailable[]);
  }

  useEffect(() => {
    if (pathname !== "/partner" || !user) return;
    Promise.all([
      fetchMyPartnerProfile().catch(() => null),
      fetchPartnerLeads().catch(() => []),
      fetchAvailableLeads().catch(() => []),
      fetchAreas().catch(() => []),
    ]).then(([m, l, avail, areas]) => {
      if (!m) {
        setNoProfile(true);
        setLoading(false);
        return;
      }
      setPartner(m);
      setLeads(l as ApiLeadDetail[]);
      setAvailableLeads(avail as ApiLeadAvailable[]);
      setAvailableAreas(areas as ApiAreaSummary[]);
      setLoading(false);
    });
  }, [user, pathname]);

  useEffect(() => {
    if (view === "listings" && !loadingListings) {
      setLoadingListings(true);
      fetchPartnerListings()
        .then(setListings)
        .catch(() => {})
        .finally(() => setLoadingListings(false));
    }
    if (view === "projects" && !loadingProjects) {
      setLoadingProjects(true);
      fetchPartnerProjects()
        .then(setProjects)
        .catch(() => {})
        .finally(() => setLoadingProjects(false));
    }
  }, [view]);

  async function handleConfirmAccept(leadId: number) {
    setAcceptingId(leadId);
    setAcceptError(null);
    try {
      await acceptLead(leadId);
      setConfirmingId(null);
      await reloadLeads();
    } catch {
      setAcceptError(t("partnerDashboard.couldNotAcceptLead"));
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleAddArea(e: React.FormEvent) {
    e.preventDefault();
    if (!newArea.area_name.trim()) return;
    setAddingArea(true);
    try {
      const area = await addPartnerArea(newArea.area_name.trim(), newArea.city);
      setPartner((m) => (m ? { ...m, areas: [...m.areas, area] } : m));
      setNewArea({ area_name: "", city: "Riyadh" });
    } finally {
      setAddingArea(false);
    }
  }

  async function handleRemoveArea(area_id: number) {
    await removePartnerArea(area_id);
    setPartner((m) => (m ? { ...m, areas: m.areas.filter((a) => a.id !== area_id) } : m));
  }

  async function handleSaveListing(
    payload: PartnerPropertyPayload,
    imageUrls: string[],
    editId?: number,
  ) {
    let saved: ApiProperty;
    if (editId) {
      saved = await patchPartnerListing(editId, payload);
      setListings((ls) => ls.map((l) => (l.id === editId ? saved : l)));
    } else {
      saved = await createPartnerListing(payload);
      setListings((ls) => [saved, ...ls]);
    }
    // Sync images
    const existingImages = saved.images ?? [];
    const existingUrls = new Set(existingImages.map((i) => i.url));
    const newUrlSet = new Set(imageUrls);
    await Promise.all([
      ...imageUrls
        .filter((u) => !existingUrls.has(u))
        .map((u) => addPartnerPropertyImage(saved.id, u)),
      ...existingImages
        .filter((i) => !newUrlSet.has(i.url))
        .map((i) => deletePartnerPropertyImage(saved.id, i.id)),
    ]);
    // Re-fetch to get updated images
    const fresh = await fetchPartnerListings();
    setListings(fresh);
  }

  async function handleSaveProject(payload: PartnerProjectPayload, editId?: number) {
    let saved: ApiProject;
    if (editId) {
      saved = await patchPartnerProject(editId, payload);
      setProjects((ps) => ps.map((p) => (p.id === editId ? saved : p)));
    } else {
      saved = await createPartnerProject(payload);
      setProjects((ps) => [saved, ...ps]);
    }
  }

  if (pathname !== "/partner") return <Outlet />;
  if (authLoading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  if (!user) return <PartnerLoginGate />;
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );

  if (noProfile)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Briefcase className="size-8" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t("partnerDashboard.becomePartner.heading")}</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm">
            {t("partnerDashboard.becomePartner.desc")}
          </p>
        </div>
        <Button onClick={() => navigate({ to: "/partner/register" })}>
          {t("partnerDashboard.becomePartner.cta")}
        </Button>
      </div>
    );

  if (partner && partner.approval_status === "pending")
    return <PartnerApprovalGate state="pending" email={user?.email} onSignOut={clearAuth} />;
  if (partner && partner.approval_status === "rejected")
    return <PartnerApprovalGate state="rejected" email={user?.email} onSignOut={clearAuth} />;

  const acceptedLeads = leads.filter(
    (l) =>
      l.assignments.some((a) => a.status === "accepted") &&
      (l.status === "in_progress" || l.status === "pending_closure"),
  );
  const closedLeads = leads.filter((l) => l.status === "closed_won" || l.status === "closed_lost");

  return (
    <div className="flex min-h-screen bg-surface">
      {/* ── Left sidebar ── */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-e border-border bg-background lg:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-5">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Briefcase className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{t("partnerDashboard.sidebar.brand")}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user?.full_name ?? user?.email}
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {[
            {
              v: "leads" as const,
              icon: ListChecks,
              label: t("partnerDashboard.sidebar.navLeads"),
            },
            {
              v: "listings" as const,
              icon: Home,
              label: t("partnerDashboard.sidebar.navListings"),
            },
            {
              v: "projects" as const,
              icon: Building2,
              label: t("partnerDashboard.sidebar.navProjects"),
            },
          ].map(({ v, icon: Icon, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
          {/* Property Request Marketplace lives at its own route (/partner/requests),
              not as a client-state PartnerView — mirrors admin.tsx's Notification
              Operations Link pattern for the same reason. */}
          <Link
            to="/partner/requests"
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <ClipboardList className="size-4 shrink-0" />
            {t("partnerPropertyRequest.nav")}
          </Link>
        </nav>

        <div className="border-t border-border px-3 py-4 space-y-2">
          <Badge
            tone={partner!.subscription_status === "active" ? "success" : "warning"}
            className="w-full justify-center"
          >
            {partner!.subscription_status === "active" ? (
              <CheckCircle className="size-3" />
            ) : (
              <Clock className="size-3" />
            )}
            {partner!.subscription_status}
          </Badge>
          <button
            type="button"
            onClick={clearAuth}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="size-4" /> {t("partnerDashboard.sidebar.signOut")}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top nav — sidebar is hidden below lg, so provide tab switching here */}
        <div className="sticky top-0 z-20 border-b border-border bg-background lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Briefcase className="size-4" />
              </div>
              <span className="truncate text-sm font-bold">
                {t("partnerDashboard.sidebar.brand")}
              </span>
            </div>
            <button
              type="button"
              onClick={clearAuth}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
          <nav className="flex gap-1 px-3 pb-2">
            {[
              {
                v: "leads" as const,
                icon: ListChecks,
                label: t("partnerDashboard.sidebar.navLeads"),
              },
              {
                v: "listings" as const,
                icon: Home,
                label: t("partnerDashboard.sidebar.navListings"),
              },
              {
                v: "projects" as const,
                icon: Building2,
                label: t("partnerDashboard.sidebar.navProjects"),
              },
            ].map(({ v, icon: Icon, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            ))}
            <Link
              to="/partner/requests"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <ClipboardList className="size-4 shrink-0" />
              {t("partnerPropertyRequest.nav")}
            </Link>
          </nav>
        </div>

        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
          {/* ══ LEADS VIEW ══ */}
          {view === "leads" && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-8">
                {/* Available Leads */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">
                      {t("partnerDashboard.leads.availableLeads")}
                    </h2>
                    {availableLeads.length > 0 && (
                      <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                        {t("partnerDashboard.leads.newCount", { count: availableLeads.length })}
                      </span>
                    )}
                  </div>
                  {availableLeads.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                      {t("partnerDashboard.leads.noNewLeads")}
                    </div>
                  )}
                  {availableLeads.map((lead) => {
                    const isConfirming = confirmingId === lead.id;
                    const isAccepting = acceptingId === lead.id;
                    return (
                      <div
                        key={lead.id}
                        className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <MapPin className="size-4 text-muted-foreground" />
                              <span className="font-semibold">
                                {lead.area_name}, {lead.city}
                              </span>
                              <Badge tone="warning">{t("partnerDashboard.leads.newBadge")}</Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {lead.bedrooms_needed
                                ? t("partnerDashboard.leads.bedroomsPrefix", {
                                    count: lead.bedrooms_needed,
                                  })
                                : ""}
                              {lead.max_budget
                                ? t("partnerDashboard.leads.budgetUpTo", {
                                    amount: formatSAR(lead.max_budget),
                                  })
                                : t("partnerDashboard.leads.budgetFlexible")}
                              {lead.move_in_date
                                ? t("partnerDashboard.leads.moveInSuffix", {
                                    date: lead.move_in_date,
                                  })
                                : ""}
                            </div>
                            {lead.requirements_note && (
                              <p className="text-sm text-foreground line-clamp-2">
                                {lead.requirements_note}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                          <span className="font-mono tracking-widest select-none">
                            ●●● ●●●●●● · ●●●@●●●●.●●●
                          </span>
                          <span className="ml-auto text-xs">
                            {t("partnerDashboard.leads.unlockedAfterPayment")}
                          </span>
                        </div>
                        {!isConfirming ? (
                          <Button
                            className="w-full"
                            onClick={() => {
                              setConfirmingId(lead.id);
                              setAcceptError(null);
                            }}
                          >
                            {t("partnerDashboard.leads.acceptLeadCta")}
                          </Button>
                        ) : (
                          <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                            <p className="text-sm">
                              <strong>{t("partnerDashboard.leads.confirmChargeAmount")}</strong>{" "}
                              {t("partnerDashboard.leads.confirmChargeSuffix")}
                            </p>
                            {acceptError && (
                              <p className="text-xs text-destructive">{acceptError}</p>
                            )}
                            <div className="flex gap-2">
                              <Button
                                className="flex-1"
                                onClick={() => handleConfirmAccept(lead.id)}
                                disabled={isAccepting}
                              >
                                {isAccepting
                                  ? t("partnerDashboard.leads.processing")
                                  : t("partnerDashboard.leads.confirmAndPay")}
                              </Button>
                              <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => {
                                  setConfirmingId(null);
                                  setAcceptError(null);
                                }}
                                disabled={isAccepting}
                              >
                                {t("partnerDashboard.leads.cancel")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>

                {/* Accepted Leads */}
                <section className="space-y-3">
                  <h2 className="text-lg font-bold">{t("partnerDashboard.leads.acceptedLeads")}</h2>
                  {acceptedLeads.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      {t("partnerDashboard.leads.noAcceptedLeads")}
                    </div>
                  )}
                  {acceptedLeads.map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() =>
                        navigate({
                          to: "/partner/leads/$leadId",
                          params: { leadId: String(lead.id) },
                        })
                      }
                      className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <MapPin className="size-4 text-muted-foreground" />
                            <span className="font-semibold">
                              {lead.area_name}, {lead.city}
                            </span>
                            <Badge tone={lead.status === "pending_closure" ? "warning" : "success"}>
                              {lead.status === "pending_closure"
                                ? t("partnerDashboard.leads.closingBadge")
                                : t("partnerDashboard.leads.inProgressBadge")}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {lead.bedrooms_needed
                              ? t("partnerDashboard.leads.bedroomsPrefix", {
                                  count: lead.bedrooms_needed,
                                })
                              : ""}
                            {lead.max_budget
                              ? t("partnerDashboard.leads.budgetUpTo", {
                                  amount: formatSAR(lead.max_budget),
                                })
                              : t("partnerDashboard.leads.budgetFlexible")}
                          </div>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-primary font-medium">
                          <MessageSquare className="size-3.5" />{" "}
                          {t("partnerDashboard.leads.openLabel")}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                          <Phone className="size-3.5 text-muted-foreground shrink-0" />
                          <a
                            href={`tel:${lead.customer_phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-primary hover:underline truncate"
                          >
                            {lead.customer_phone}
                          </a>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                          <Mail className="size-3.5 text-muted-foreground shrink-0" />
                          <a
                            href={`mailto:${lead.customer_email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="truncate text-foreground hover:underline"
                          >
                            {lead.customer_email}
                          </a>
                        </div>
                      </div>
                      <p className="text-sm font-medium">{lead.customer_name}</p>
                      {lead.requirements_note && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {lead.requirements_note}
                        </p>
                      )}
                    </div>
                  ))}
                </section>

                {/* Closed Leads */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">{t("partnerDashboard.leads.closedLeads")}</h2>
                    <Badge tone="neutral">
                      <History className="size-3" /> {t("partnerDashboard.leads.historyBadge")}
                    </Badge>
                  </div>
                  {closedLeads.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      {t("partnerDashboard.leads.noClosedLeads")}
                    </div>
                  ) : (
                    closedLeads.map((lead) => (
                      <div
                        key={lead.id}
                        onClick={() =>
                          navigate({
                            to: "/partner/leads/$leadId",
                            params: { leadId: String(lead.id) },
                          })
                        }
                        className={cn(
                          "rounded-2xl border p-5 space-y-1.5 cursor-pointer hover:shadow-md transition-all",
                          lead.status === "closed_won"
                            ? "border-success/30 bg-success/5 hover:border-success/50"
                            : "border-border bg-card hover:border-primary/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <MapPin className="size-4 text-muted-foreground" />
                            <span className="font-semibold">
                              {lead.area_name}, {lead.city}
                            </span>
                            <Badge tone={lead.status === "closed_won" ? "success" : "neutral"}>
                              {lead.status === "closed_won"
                                ? t("partnerDashboard.leads.foundBadge")
                                : t("partnerDashboard.leads.noMatchBadge")}
                            </Badge>
                          </div>
                          {lead.closed_at && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(lead.closed_at).toLocaleDateString(
                                lang === "ar" ? "ar-SA" : "en-SA",
                                { day: "numeric", month: "short", year: "numeric" },
                              )}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{lead.customer_name}</p>
                        <p className="text-xs text-primary font-medium">
                          {t("partnerDashboard.leads.viewDetails")}
                        </p>
                      </div>
                    ))
                  )}
                </section>
              </div>

              {/* Covered areas sidebar */}
              <div className="space-y-4">
                <h2 className="text-lg font-bold">{t("partnerDashboard.coveredAreas.heading")}</h2>
                <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                  {partner!.areas.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("partnerDashboard.coveredAreas.noAreasYet")}
                    </p>
                  )}
                  {partner!.areas.map((area) => (
                    <div key={area.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="size-3.5 text-muted-foreground" />
                        <span>{area.area_name}</span>
                        <span className="text-xs text-muted-foreground">{area.city}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveArea(area.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <form onSubmit={handleAddArea} className="border-t border-border pt-3 space-y-2">
                    <select
                      value={newArea.area_name ? `${newArea.area_name}|${newArea.city}` : ""}
                      onChange={(e) => {
                        const [area_name, city] = e.target.value.split("|");
                        setNewArea({ area_name: area_name ?? "", city: city ?? "" });
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                    >
                      <option value="">{t("partnerDashboard.coveredAreas.selectDistrict")}</option>
                      {Array.from(new Set(availableAreas.map((a) => a.city)))
                        .sort()
                        .map((city) => {
                          const taken = new Set(
                            partner!.areas.filter((a) => a.city === city).map((a) => a.area_name),
                          );
                          return (
                            <optgroup key={city} label={city}>
                              {availableAreas
                                .filter((a) => a.city === city)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((area) => (
                                  <option
                                    key={`${area.name}|${city}`}
                                    value={`${area.name}|${city}`}
                                    disabled={taken.has(area.name)}
                                  >
                                    {area.name}
                                    {taken.has(area.name)
                                      ? t("partnerDashboard.coveredAreas.addedSuffix")
                                      : ""}
                                  </option>
                                ))}
                            </optgroup>
                          );
                        })}
                    </select>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={addingArea || !newArea.area_name.trim()}
                    >
                      <Plus className="size-3.5" /> {t("partnerDashboard.coveredAreas.addArea")}
                    </Button>
                  </form>
                </div>
                <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted-foreground space-y-1">
                  <div>
                    <strong>{t("partnerDashboard.coveredAreas.subscriptionLabel")}</strong>{" "}
                    {partner!.subscription_status}
                  </div>
                  {partner!.subscription_expires_at && (
                    <div>
                      {t("partnerDashboard.coveredAreas.expires", {
                        date: new Date(partner!.subscription_expires_at).toLocaleDateString(
                          lang === "ar" ? "ar-SA" : "en-SA",
                        ),
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ LISTINGS VIEW ══ */}
          {view === "listings" && (
            <div>
              {listingFormOpen || editingListing ? (
                <PartnerListingForm
                  areas={availableAreas}
                  editing={editingListing}
                  onClose={() => {
                    setListingFormOpen(false);
                    setEditingListing(null);
                  }}
                  onSave={async (payload, imageUrls) => {
                    await handleSaveListing(payload, imageUrls, editingListing?.id);
                    setListingFormOpen(false);
                    setEditingListing(null);
                  }}
                />
              ) : (
                <PartnerListingsView
                  listings={listings}
                  loading={loadingListings}
                  onAdd={() => setListingFormOpen(true)}
                  onEdit={(l) => setEditingListing(l)}
                />
              )}
            </div>
          )}

          {/* ══ PROJECTS VIEW ══ */}
          {view === "projects" && (
            <div>
              {projectFormOpen || editingProject ? (
                <PartnerProjectForm
                  editing={editingProject}
                  onClose={() => {
                    setProjectFormOpen(false);
                    setEditingProject(null);
                  }}
                  onSave={async (payload) => {
                    await handleSaveProject(payload, editingProject?.id);
                    setProjectFormOpen(false);
                    setEditingProject(null);
                  }}
                />
              ) : (
                <PartnerProjectsView
                  projects={projects}
                  loading={loadingProjects}
                  onAdd={() => setProjectFormOpen(true)}
                  onEdit={(p) => setEditingProject(p)}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Listings list view ───────────────────────────────────────────────────────

function PartnerListingsView({
  listings,
  loading,
  onAdd,
  onEdit,
}: {
  listings: ApiProperty[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (l: ApiProperty) => void;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("partnerDashboard.listingsView.myPortfolio")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {t("partnerDashboard.listingsView.heading")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("partnerDashboard.listingsView.subtitle")}
          </p>
        </div>
        <Button onClick={onAdd} className="shrink-0">
          <Plus className="size-4" /> {t("partnerDashboard.listingsView.addListing")}
        </Button>
      </div>

      {loading && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {t("partnerDashboard.listingsView.loadingListings")}
        </div>
      )}

      {!loading && listings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center space-y-3">
          <Home className="mx-auto size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {t("partnerDashboard.listingsView.noListingsYet")}
          </p>
          <Button variant="outline" onClick={onAdd}>
            <Plus className="size-4" /> {t("partnerDashboard.listingsView.addListing")}
          </Button>
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="space-y-3">
          {listings.map((l) => {
            const canEdit = l.status === "Published";
            return (
              <div key={l.id} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{l.title}</span>
                      <ListingStatusBadge status={l.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {l.area}, {l.city}
                      {l.bedrooms != null ? ` · ${l.bedrooms} BR` : ""}
                      {l.bathrooms != null ? ` · ${l.bathrooms} BA` : ""}
                      {l.size_sq_m ? ` · ${l.size_sq_m} m²` : ""}
                    </p>
                    <p className="text-sm font-semibold text-primary">
                      SAR {formatSAR(l.monthly_rent ?? 0)}/mo
                    </p>
                    {l.status === "Pending Approval" && (
                      <p className="text-xs text-muted-foreground">
                        {t("partnerDashboard.listingsView.underReview")}
                      </p>
                    )}
                    {l.status === "Rejected" && (
                      <p className="text-xs text-destructive">
                        {t("partnerDashboard.listingsView.rejectedContact")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => canEdit && onEdit(l)}
                    title={
                      canEdit
                        ? t("partnerDashboard.listingsView.editTitle")
                        : t("partnerDashboard.listingsView.editLockedTitle")
                    }
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors",
                      canEdit
                        ? "border-border text-muted-foreground hover:border-primary hover:text-primary"
                        : "border-border/40 text-muted-foreground/30 cursor-not-allowed",
                    )}
                  >
                    <Pencil className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Listing creation / edit form ─────────────────────────────────────────────

type ListingFormState = {
  title: string;
  city: string;
  district: string;
  rent: string;
  bedrooms: string;
  bathrooms: string;
  size: string;
  owner_name: string;
  description: string;
  property_type: string;
  furnished: string;
  contact_phone: string;
  whatsapp_phone: string;
  whatsappSameAsCall: boolean;
};

function PartnerListingForm({
  areas,
  editing,
  onClose,
  onSave,
}: {
  areas: ApiAreaSummary[];
  editing: ApiProperty | null;
  onClose: () => void;
  onSave: (p: PartnerPropertyPayload, imageUrls: string[]) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<ListingFormState>({
    title: editing?.title ?? "",
    city: editing?.city ?? "",
    district: editing?.area ?? "",
    rent: editing ? String(editing.monthly_rent) : "",
    bedrooms: editing?.bedrooms != null ? String(editing.bedrooms) : "3",
    bathrooms: editing?.bathrooms != null ? String(editing.bathrooms) : "2",
    size: editing?.size_sq_m != null ? String(editing.size_sq_m) : "",
    owner_name: editing?.owner_name ?? "",
    description: editing?.description ?? "",
    property_type: editing?.property_type ?? "",
    furnished: editing?.furnished ?? "",
    contact_phone: editing?.contact_phone ?? "",
    whatsapp_phone: editing?.whatsapp_phone ?? "",
    whatsappSameAsCall: !editing || editing.whatsapp_phone === editing.contact_phone,
  });
  const [media, setMedia] = useState<string[]>(
    editing?.images?.length
      ? editing.images.sort((a, b) => a.display_order - b.display_order).map((i) => i.url)
      : [],
  );
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<ApiPricingSuggestion | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);

  async function handleGetPricing() {
    const rent = parseFloat(form.rent);
    setPricingLoading(true);
    setPricingError(null);
    setPricing(null);
    try {
      const result = await fetchPricingSuggestion({
        area: form.district.trim(),
        city: form.city.trim(),
        monthly_rent: rent > 0 ? rent : undefined,
      });
      setPricing(result);
    } catch (err) {
      setPricingError(
        err instanceof Error ? err.message : t("partnerDashboard.listingForm.pricingSuggestion.failed"),
      );
    } finally {
      setPricingLoading(false);
    }
  }

  // Districts for the selected city
  const districtOptions = areas
    .filter((a) => !form.city || a.city === form.city)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function submit() {
    if (!form.city.trim()) {
      setError(t("partnerDashboard.listingForm.errors.selectCity"));
      return;
    }
    if (!form.district.trim()) {
      setError(t("partnerDashboard.listingForm.errors.selectDistrict"));
      return;
    }
    const rent = parseFloat(form.rent);
    if (!rent || rent <= 0) {
      setError(t("partnerDashboard.listingForm.errors.invalidRent"));
      return;
    }
    if (!form.title.trim()) {
      setError(t("partnerDashboard.listingForm.errors.enterTitle"));
      return;
    }
    if (!form.contact_phone.trim()) {
      setError(t("partnerDashboard.listingForm.errors.enterContactPhone"));
      return;
    }
    const whatsappPhone = form.whatsappSameAsCall ? form.contact_phone : form.whatsapp_phone;
    if (!whatsappPhone.trim()) {
      setError(t("partnerDashboard.listingForm.errors.enterWhatsappPhone"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          title: form.title.trim() || "Untitled listing",
          city: form.city.trim(),
          area: form.district.trim(),
          monthly_rent: rent,
          bedrooms: form.bedrooms ? parseInt(form.bedrooms) : undefined,
          bathrooms: form.bathrooms ? parseInt(form.bathrooms) : undefined,
          size_sq_m: form.size ? parseInt(form.size) : undefined,
          owner_name: form.owner_name.trim() || undefined,
          description: form.description.trim() || undefined,
          property_type: form.property_type || undefined,
          furnished: form.furnished || undefined,
          contact_phone: form.contact_phone.trim(),
          whatsapp_phone: whatsappPhone.trim(),
        },
        media,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("partnerDashboard.listingForm.errors.failedToSave"),
      );
      setSaving(false);
    }
  }

  const isEdit = !!editing;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onClose}
            className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("partnerDashboard.listingForm.backToListings")}
          </button>
          <h1 className="text-2xl font-bold">
            {isEdit
              ? t("partnerDashboard.listingForm.editHeading")
              : t("partnerDashboard.listingForm.newHeading")}
          </h1>
          {isEdit && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("partnerDashboard.listingForm.resubmitNote")}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("partnerDashboard.listingForm.propertyDetails")}
          </h2>

          <FormField label={t("partnerDashboard.listingForm.listingTitle")}>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("partnerDashboard.listingForm.listingTitlePlaceholder")}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("partnerDashboard.listingForm.city")}>
              <select
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value, district: "" }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("partnerDashboard.listingForm.selectCity")}</option>
                {CITY_LIST.map((c) => (
                  <option key={c.name} value={c.name}>
                    {t(`cities.${c.name}`)}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label={t("partnerDashboard.listingForm.district")}>
              <select
                value={form.district}
                onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
                disabled={!form.city}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              >
                <option value="">{t("partnerDashboard.listingForm.selectDistrict")}</option>
                {districtOptions.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
                {form.district && !districtOptions.find((a) => a.name === form.district) && (
                  <option value={form.district}>{form.district}</option>
                )}
              </select>
            </FormField>
          </div>

          <FormField label={t("partnerDashboard.listingForm.monthlyRent")}>
            <Input
              type="number"
              min={1}
              value={form.rent}
              onChange={(e) => setForm((f) => ({ ...f, rent: e.target.value }))}
              placeholder={t("partnerDashboard.listingForm.monthlyRentPlaceholder")}
            />
          </FormField>

          {/* AI dynamic pricing suggestion — nightly rate for short-term
              (Airbnb-style) bookings, distinct from the long-term monthly
              rent above. Reuses backend/app/api/routes/ai.py's
              /pricing-suggestion endpoint. */}
          <div className="rounded-xl border border-ai/20 bg-ai-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-ai">
                <Sparkles className="size-4" /> {t("partnerDashboard.listingForm.pricingSuggestion.title")}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!form.city.trim() || !form.district.trim() || pricingLoading}
                onClick={() => void handleGetPricing()}
              >
                {pricingLoading
                  ? t("partnerDashboard.listingForm.pricingSuggestion.loading")
                  : t("partnerDashboard.listingForm.pricingSuggestion.cta")}
              </Button>
            </div>
            {!form.city.trim() || !form.district.trim() ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("partnerDashboard.listingForm.pricingSuggestion.needsAreaCity")}
              </p>
            ) : null}
            {pricingError && <p className="mt-2 text-xs text-destructive">{pricingError}</p>}
            {pricing && (
              <div className="mt-3 space-y-1.5">
                <div className="text-lg font-bold tracking-tight text-ai">
                  SAR {formatSAR(pricing.suggested_nightly_min)} – {formatSAR(pricing.suggested_nightly_max)}
                  <span className="ms-1 text-xs font-normal text-muted-foreground">
                    {t("partnerDashboard.listingForm.pricingSuggestion.perNight")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{pricing.reasoning}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t(
                    pricing.generated_by === "ai"
                      ? "partnerDashboard.listingForm.pricingSuggestion.aiGenerated"
                      : "partnerDashboard.listingForm.pricingSuggestion.estimateGenerated",
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label={t("partnerDashboard.listingForm.bedrooms")}>
              <Input
                type="number"
                min={0}
                value={form.bedrooms}
                onChange={(e) => setForm((f) => ({ ...f, bedrooms: e.target.value }))}
              />
            </FormField>
            <FormField label={t("partnerDashboard.listingForm.bathrooms")}>
              <Input
                type="number"
                min={0}
                value={form.bathrooms}
                onChange={(e) => setForm((f) => ({ ...f, bathrooms: e.target.value }))}
              />
            </FormField>
            <FormField label={t("partnerDashboard.listingForm.areaSqm")}>
              <Input
                type="number"
                min={1}
                value={form.size}
                onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                placeholder={t("partnerDashboard.listingForm.areaPlaceholder")}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("partnerDashboard.listingForm.propertyType")}>
              <select
                value={form.property_type}
                onChange={(e) => setForm((f) => ({ ...f, property_type: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("partnerDashboard.listingForm.selectType")}</option>
                <option value="Apartment">{t("propertyTypes.Apartment")}</option>
                <option value="Villa">{t("propertyTypes.Villa")}</option>
                <option value="Penthouse">{t("propertyTypes.Penthouse")}</option>
                <option value="Townhouse">{t("propertyTypes.Townhouse")}</option>
              </select>
            </FormField>

            <FormField label={t("partnerDashboard.listingForm.furnishedStatus")}>
              <select
                value={form.furnished}
                onChange={(e) => setForm((f) => ({ ...f, furnished: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("partnerDashboard.listingForm.selectDash")}</option>
                <option value="Furnished">{t("furnishing.Furnished")}</option>
                <option value="Semi-furnished">{t("furnishing.Semi-furnished")}</option>
                <option value="Unfurnished">{t("furnishing.Unfurnished")}</option>
              </select>
            </FormField>
          </div>

          <FormField label={t("partnerDashboard.listingForm.ownerName")}>
            <Input
              value={form.owner_name}
              onChange={(e) => setForm((f) => ({ ...f, owner_name: e.target.value }))}
              placeholder={t("partnerDashboard.listingForm.ownerNamePlaceholder")}
            />
          </FormField>

          <FormField label={t("partnerDashboard.listingForm.contactPhone")}>
            <Input
              type="tel"
              value={form.contact_phone}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  contact_phone: e.target.value,
                  whatsapp_phone: f.whatsappSameAsCall ? e.target.value : f.whatsapp_phone,
                }))
              }
              placeholder={t("partnerDashboard.listingForm.contactPhonePlaceholder")}
            />
          </FormField>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.whatsappSameAsCall}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  whatsappSameAsCall: e.target.checked,
                  whatsapp_phone: e.target.checked ? f.contact_phone : f.whatsapp_phone,
                }))
              }
              className="size-3.5 rounded border-border"
            />
            {t("partnerDashboard.listingForm.whatsappSameAsCall")}
          </label>

          {!form.whatsappSameAsCall && (
            <FormField label={t("partnerDashboard.listingForm.whatsappPhone")}>
              <Input
                type="tel"
                value={form.whatsapp_phone}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_phone: e.target.value }))}
                placeholder={t("partnerDashboard.listingForm.whatsappPhonePlaceholder")}
              />
            </FormField>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("partnerDashboard.listingForm.photos")}
          </h2>

          {/* Photo thumbnails */}
          {media.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {media.map((url, i) => (
                <div
                  key={i}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-surface-2"
                >
                  <img src={url} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setMedia((m) => m.filter((_, idx) => idx !== i))}
                    className="absolute end-1 top-1 grid size-6 place-items-center rounded-md bg-background/90 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-1 start-1 rounded bg-foreground/85 px-1.5 py-0.5 text-[10px] font-bold uppercase text-background">
                      {t("partnerDashboard.listingForm.coverBadge")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const val = urlInput.trim();
                  if (val && !media.includes(val)) setMedia((m) => [...m, val]);
                  setUrlInput("");
                }
              }}
              placeholder={t("partnerDashboard.listingForm.urlPlaceholder")}
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const val = urlInput.trim();
                if (val && !media.includes(val)) setMedia((m) => [...m, val]);
                setUrlInput("");
              }}
              disabled={!urlInput.trim()}
            >
              <Plus className="size-4" /> {t("partnerDashboard.listingForm.add")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("partnerDashboard.listingForm.firstPhotoNote")}
          </p>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground pt-2">
            {t("partnerDashboard.listingForm.description")}
          </h2>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={6}
            placeholder={t("partnerDashboard.listingForm.descriptionPlaceholder")}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />

          {/* Status note */}
          <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-muted-foreground">
            {isEdit
              ? t("partnerDashboard.listingForm.editNote")
              : t("partnerDashboard.listingForm.newNote")}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t("partnerDashboard.listingForm.cancel")}
            </Button>
            <Button onClick={submit} disabled={saving} className="flex-1">
              {saving
                ? t("partnerDashboard.listingForm.submitting")
                : isEdit
                  ? t("partnerDashboard.listingForm.saveResubmit")
                  : t("partnerDashboard.listingForm.submitForApproval")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Projects list view ───────────────────────────────────────────────────────

function PartnerProjectsView({
  projects,
  loading,
  onAdd,
  onEdit,
}: {
  projects: ApiProject[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (p: ApiProject) => void;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("partnerDashboard.projectsView.heading")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("partnerDashboard.projectsView.subtitle")}
          </p>
        </div>
        <Button onClick={onAdd} className="shrink-0">
          <Plus className="size-4" /> {t("partnerDashboard.projectsView.addProject")}
        </Button>
      </div>

      {loading && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {t("partnerDashboard.projectsView.loadingProjects")}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center space-y-3">
          <Building2 className="mx-auto size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {t("partnerDashboard.projectsView.noProjectsYet")}
          </p>
          <Button variant="outline" onClick={onAdd}>
            <Plus className="size-4" /> {t("partnerDashboard.projectsView.addProject")}
          </Button>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="space-y-3">
          {projects.map((p) => {
            const canEdit = p.listing_status === "Published";
            return (
              <div key={p.id} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{p.title}</span>
                      <ListingStatusBadge status={p.listing_status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {p.area}, {p.city}
                      {p.unit_count != null ? ` · ${p.unit_count} units` : ""}
                    </p>
                    <p className="text-sm font-semibold text-primary">
                      {p.price_min != null || p.price_max != null
                        ? `SAR ${formatSAR(p.price_min ?? p.price_max ?? 0)}${
                            p.price_max != null && p.price_min !== p.price_max
                              ? ` – ${formatSAR(p.price_max)}`
                              : ""
                          }`
                        : "—"}
                    </p>
                    {p.listing_status === "Pending Approval" && (
                      <p className="text-xs text-muted-foreground">
                        {t("partnerDashboard.listingsView.underReview")}
                      </p>
                    )}
                    {p.listing_status === "Rejected" && (
                      <p className="text-xs text-destructive">
                        {t("partnerDashboard.listingsView.rejectedContact")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => canEdit && onEdit(p)}
                    title={
                      canEdit
                        ? t("partnerDashboard.listingsView.editTitle")
                        : t("partnerDashboard.listingsView.editLockedTitle")
                    }
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors",
                      canEdit
                        ? "border-border text-muted-foreground hover:border-primary hover:text-primary"
                        : "border-border/40 text-muted-foreground/30 cursor-not-allowed",
                    )}
                  >
                    <Pencil className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Project creation / edit form ─────────────────────────────────────────────

type ProjectFormState = {
  title: string;
  city: string;
  district: string;
  developer_name: string;
  developer_logo_url: string;
  image_url: string;
  price_min: string;
  price_max: string;
  area_min: string;
  area_max: string;
  unit_count: string;
  completion_status: string;
  property_category: string;
  intro_document_url: string;
  description: string;
  contact_phone: string;
  whatsapp_phone: string;
  whatsappSameAsCall: boolean;
};

function PartnerProjectForm({
  editing,
  onClose,
  onSave,
}: {
  editing: ApiProject | null;
  onClose: () => void;
  onSave: (p: PartnerProjectPayload) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<ProjectFormState>({
    title: editing?.title ?? "",
    city: editing?.city ?? "",
    district: editing?.area ?? "",
    developer_name: editing?.developer_name ?? "",
    developer_logo_url: editing?.developer_logo_url ?? "",
    image_url: editing?.image_url ?? "",
    price_min: editing?.price_min != null ? String(editing.price_min) : "",
    price_max: editing?.price_max != null ? String(editing.price_max) : "",
    area_min: editing?.area_min != null ? String(editing.area_min) : "",
    area_max: editing?.area_max != null ? String(editing.area_max) : "",
    unit_count: editing?.unit_count != null ? String(editing.unit_count) : "",
    completion_status: editing?.completion_status ?? "",
    property_category: editing?.property_category ?? "",
    intro_document_url: editing?.intro_document_url ?? "",
    description: editing?.description ?? "",
    contact_phone: editing?.contact_phone ?? "",
    whatsapp_phone: editing?.whatsapp_phone ?? "",
    whatsappSameAsCall: !editing || editing.whatsapp_phone === editing.contact_phone,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!form.city.trim()) {
      setError(t("partnerDashboard.listingForm.errors.selectCity"));
      return;
    }
    if (!form.district.trim()) {
      setError(t("partnerDashboard.listingForm.errors.selectDistrict"));
      return;
    }
    if (!form.title.trim()) {
      setError(t("partnerDashboard.projectForm.errors.enterTitle"));
      return;
    }
    if (!form.contact_phone.trim()) {
      setError(t("partnerDashboard.listingForm.errors.enterContactPhone"));
      return;
    }
    const whatsappPhone = form.whatsappSameAsCall ? form.contact_phone : form.whatsapp_phone;
    if (!whatsappPhone.trim()) {
      setError(t("partnerDashboard.listingForm.errors.enterWhatsappPhone"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: form.title.trim(),
        city: form.city.trim(),
        area: form.district.trim(),
        developer_name: form.developer_name.trim() || undefined,
        developer_logo_url: form.developer_logo_url.trim() || undefined,
        image_url: form.image_url.trim() || undefined,
        price_min: form.price_min ? parseFloat(form.price_min) : undefined,
        price_max: form.price_max ? parseFloat(form.price_max) : undefined,
        area_min: form.area_min ? parseInt(form.area_min) : undefined,
        area_max: form.area_max ? parseInt(form.area_max) : undefined,
        unit_count: form.unit_count ? parseInt(form.unit_count) : undefined,
        completion_status: form.completion_status || undefined,
        property_category: form.property_category || undefined,
        intro_document_url: form.intro_document_url.trim() || undefined,
        description: form.description.trim() || undefined,
        contact_phone: form.contact_phone.trim(),
        whatsapp_phone: whatsappPhone.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerDashboard.projectForm.errors.failedToSave"));
      setSaving(false);
    }
  }

  const isEdit = !!editing;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onClose}
            className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("partnerDashboard.projectForm.backToProjects")}
          </button>
          <h1 className="text-2xl font-bold">
            {isEdit ? t("partnerDashboard.projectForm.editHeading") : t("partnerDashboard.projectForm.newHeading")}
          </h1>
          {isEdit && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("partnerDashboard.projectForm.resubmitNote")}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("partnerDashboard.projectForm.projectDetails")}
          </h2>

          <FormField label={t("partnerDashboard.projectForm.projectTitle")}>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("partnerDashboard.projectForm.projectTitlePlaceholder")}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("partnerDashboard.listingForm.city")}>
              <select
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("partnerDashboard.listingForm.selectCity")}</option>
                {CITY_LIST.map((c) => (
                  <option key={c.name} value={c.name}>
                    {t(`cities.${c.name}`)}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label={t("partnerDashboard.listingForm.district")}>
              <Input
                value={form.district}
                onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
              />
            </FormField>
          </div>

          <FormField label={t("partnerDashboard.projectForm.developerName")}>
            <Input
              value={form.developer_name}
              onChange={(e) => setForm((f) => ({ ...f, developer_name: e.target.value }))}
              placeholder={t("partnerDashboard.projectForm.developerNamePlaceholder")}
            />
          </FormField>

          <FormField label={t("partnerDashboard.projectForm.developerLogoUrl")}>
            <Input
              type="url"
              value={form.developer_logo_url}
              onChange={(e) => setForm((f) => ({ ...f, developer_logo_url: e.target.value }))}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("partnerDashboard.projectForm.priceMin")}>
              <Input
                type="number"
                min={0}
                value={form.price_min}
                onChange={(e) => setForm((f) => ({ ...f, price_min: e.target.value }))}
              />
            </FormField>
            <FormField label={t("partnerDashboard.projectForm.priceMax")}>
              <Input
                type="number"
                min={0}
                value={form.price_max}
                onChange={(e) => setForm((f) => ({ ...f, price_max: e.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("partnerDashboard.projectForm.areaMin")}>
              <Input
                type="number"
                min={0}
                value={form.area_min}
                onChange={(e) => setForm((f) => ({ ...f, area_min: e.target.value }))}
              />
            </FormField>
            <FormField label={t("partnerDashboard.projectForm.areaMax")}>
              <Input
                type="number"
                min={0}
                value={form.area_max}
                onChange={(e) => setForm((f) => ({ ...f, area_max: e.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("partnerDashboard.projectForm.unitCount")}>
              <Input
                type="number"
                min={0}
                value={form.unit_count}
                onChange={(e) => setForm((f) => ({ ...f, unit_count: e.target.value }))}
              />
            </FormField>
            <FormField label={t("partnerDashboard.projectForm.completionStatus")}>
              <select
                value={form.completion_status}
                onChange={(e) => setForm((f) => ({ ...f, completion_status: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("partnerDashboard.listingForm.selectDash")}</option>
                <option value="Off-plan">Off-plan</option>
                <option value="Under Construction">Under Construction</option>
                <option value="Ready">Ready</option>
              </select>
            </FormField>
          </div>

          <FormField label={t("partnerDashboard.projectForm.propertyCategory")}>
            <select
              value={form.property_category}
              onChange={(e) => setForm((f) => ({ ...f, property_category: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">{t("partnerDashboard.listingForm.selectType")}</option>
              <option value="Apartment">{t("propertyTypes.Apartment")}</option>
              <option value="Villa">{t("propertyTypes.Villa")}</option>
              <option value="Floor">{t("propertyTypes.Floor")}</option>
              <option value="Townhouse">{t("propertyTypes.Townhouse")}</option>
            </select>
          </FormField>

          <FormField label={t("partnerDashboard.listingForm.contactPhone")}>
            <Input
              type="tel"
              value={form.contact_phone}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  contact_phone: e.target.value,
                  whatsapp_phone: f.whatsappSameAsCall ? e.target.value : f.whatsapp_phone,
                }))
              }
              placeholder={t("partnerDashboard.listingForm.contactPhonePlaceholder")}
            />
          </FormField>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.whatsappSameAsCall}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  whatsappSameAsCall: e.target.checked,
                  whatsapp_phone: e.target.checked ? f.contact_phone : f.whatsapp_phone,
                }))
              }
              className="size-3.5 rounded border-border"
            />
            {t("partnerDashboard.listingForm.whatsappSameAsCall")}
          </label>

          {!form.whatsappSameAsCall && (
            <FormField label={t("partnerDashboard.listingForm.whatsappPhone")}>
              <Input
                type="tel"
                value={form.whatsapp_phone}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_phone: e.target.value }))}
                placeholder={t("partnerDashboard.listingForm.whatsappPhonePlaceholder")}
              />
            </FormField>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("partnerDashboard.projectForm.imageUrl")}
          </h2>
          <Input
            type="url"
            value={form.image_url}
            onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
          />

          <FormField label={t("partnerDashboard.projectForm.introDocumentUrl")}>
            <Input
              type="url"
              value={form.intro_document_url}
              onChange={(e) => setForm((f) => ({ ...f, intro_document_url: e.target.value }))}
            />
          </FormField>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground pt-2">
            {t("partnerDashboard.projectForm.description")}
          </h2>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={6}
            placeholder={t("partnerDashboard.projectForm.descriptionPlaceholder")}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />

          <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-muted-foreground">
            {isEdit ? t("partnerDashboard.listingForm.editNote") : t("partnerDashboard.listingForm.newNote")}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t("partnerDashboard.listingForm.cancel")}
            </Button>
            <Button onClick={submit} disabled={saving} className="flex-1">
              {saving
                ? t("partnerDashboard.listingForm.submitting")
                : isEdit
                  ? t("partnerDashboard.listingForm.saveResubmit")
                  : t("partnerDashboard.listingForm.submitForApproval")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

// ── Partner login gate ───────────────────────────────────────────────────────

function PartnerApprovalGate({
  state,
  email,
  onSignOut,
}: {
  state: "pending" | "rejected";
  email?: string;
  onSignOut: () => void;
}) {
  const { t } = useLanguage();
  const pending = state === "pending";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div
        className={cn(
          "grid size-16 place-items-center rounded-2xl",
          pending ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive",
        )}
      >
        {pending ? <Clock className="size-8" /> : <X className="size-8" />}
      </div>
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">
          {pending
            ? t("partnerDashboard.approvalGate.pendingHeading")
            : t("partnerDashboard.approvalGate.rejectedHeading")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {pending
            ? t("partnerDashboard.approvalGate.pendingDesc")
            : t("partnerDashboard.approvalGate.rejectedDesc")}
        </p>
        {email && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs text-muted-foreground">
            <Mail className="size-3.5" /> {email}
          </p>
        )}
      </div>
      <Button variant="outline" onClick={onSignOut}>
        <LogOut className="size-4" /> {t("partnerDashboard.approvalGate.signOut")}
      </Button>
    </div>
  );
}

function PartnerLoginGate() {
  const { setAuth } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await login({ email, password });
      setAuth(response.user, response.access_token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg && !msg.includes("Request failed") ? msg : t("partnerDashboard.loginGate.invalidCreds"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow">
            <Briefcase className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">{t("partnerDashboard.loginGate.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("partnerDashboard.loginGate.subtitle")}
            </p>
          </div>
        </div>
        <form
          className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card"
          onSubmit={handleSubmit}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("partnerDashboard.loginGate.email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("partnerDashboard.loginGate.password")}
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("partnerDashboard.loginGate.password")}
                className="h-11 w-full rounded-lg border border-border bg-background pe-10 ps-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute end-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !email || !password}>
            {loading
              ? t("partnerDashboard.loginGate.signingIn")
              : t("partnerDashboard.loginGate.signInCta")}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("partnerDashboard.loginGate.notPartnerYet")}{" "}
          <a href="/partner/register" className="font-semibold text-primary hover:underline">
            {t("partnerDashboard.loginGate.registerHere")}
          </a>
        </p>
      </div>
    </div>
  );
}
