import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Briefcase,
  Building2,
  CheckCircle,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  History,
  Home,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { ListingStatusBadge } from "@/components/maskan/ListingStatusBadge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { cities as CITY_LIST } from "@/lib/maskan-data";
import { PHASE1_FLAGS } from "@/lib/phase1-flags";
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
  updateMediatorProfile,
  fetchMediatorReviews,
  fetchMediatorReviewSummary,
  subscribePartnerMock,
  type ApiAreaSummary,
  type ApiPartner,
  type ApiLeadDetail,
  type ApiLeadAvailable,
  type ApiProperty,
  type ApiProject,
  type ApiPricingSuggestion,
  type ApiReview,
  type ApiReviewSummary,
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

// "properties" is the single reused listings table for My Properties / Rental
// Listings / Sale Listings — those three nav items just set `listingFilter`
// differently rather than being three separate views (see docs/implementation/
// mymakan-phase1.md "Navigation changed", Prompt 6). "projects" (off-plan) is
// kept only so PHASE1_FLAGS.projects can restore it later without rebuilding
// it — it has no nav entry while that flag is off.
type PartnerView =
  | "dashboard"
  | "properties"
  | "leads"
  | "messages"
  | "profile"
  | "reviews"
  | "areas"
  | "subscription"
  | "projects";
type ListingFilter = "all" | "rent" | "sale";

function PartnerDashboard() {
  const { user, authLoading, clearAuth } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [view, setView] = useState<PartnerView>("dashboard");
  const [listingFilter, setListingFilter] = useState<ListingFilter>("all");
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
    if ((view === "properties" || view === "dashboard") && !loadingListings) {
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

  // Shared by both the desktop sidebar and the mobile top nav so the two
  // never drift out of sync (they used to be two separately hand-written
  // lists). Matches the myMakan Phase-1 partner-portal nav spec exactly —
  // see docs/implementation/mymakan-phase1.md "Navigation changed" (Prompt 6).
  // "Property Requests" (Keep-Phase1, its own route at /partner/requests) was
  // dropped from this list per that spec even though it's in-scope — still
  // reachable by direct URL, flagged there as a judgment call worth revisiting.
  const NAV_ITEMS = [
    {
      key: "dashboard",
      icon: LayoutDashboard,
      label: t("partnerDashboard.sidebar.navDashboard"),
      active: view === "dashboard",
      onClick: () => setView("dashboard"),
    },
    {
      key: "properties",
      icon: Home,
      label: t("partnerDashboard.sidebar.navMyProperties"),
      active: view === "properties" && listingFilter === "all",
      onClick: () => {
        setView("properties");
        setListingFilter("all");
      },
    },
    {
      key: "rental",
      icon: Home,
      label: t("partnerDashboard.sidebar.navRentalListings"),
      active: view === "properties" && listingFilter === "rent",
      onClick: () => {
        setView("properties");
        setListingFilter("rent");
      },
    },
    {
      key: "sale",
      icon: Home,
      label: t("partnerDashboard.sidebar.navSaleListings"),
      active: view === "properties" && listingFilter === "sale",
      onClick: () => {
        setView("properties");
        setListingFilter("sale");
      },
    },
    {
      key: "leads",
      icon: ListChecks,
      label: t("partnerDashboard.sidebar.navLeads"),
      active: view === "leads",
      onClick: () => setView("leads"),
    },
    {
      key: "messages",
      icon: MessageSquare,
      label: t("partnerDashboard.sidebar.navMessages"),
      active: view === "messages",
      onClick: () => setView("messages"),
    },
    {
      key: "profile",
      icon: User,
      label: t("partnerDashboard.sidebar.navProfile"),
      active: view === "profile",
      onClick: () => setView("profile"),
    },
    {
      key: "reviews",
      icon: Star,
      label: t("partnerDashboard.sidebar.navReviews"),
      active: view === "reviews",
      onClick: () => setView("reviews"),
    },
    {
      key: "areas",
      icon: MapPin,
      label: t("partnerDashboard.sidebar.navAreaCoverage"),
      active: view === "areas",
      onClick: () => setView("areas"),
    },
    {
      key: "subscription",
      icon: CreditCard,
      label: t("partnerDashboard.sidebar.navSubscription"),
      active: view === "subscription",
      onClick: () => setView("subscription"),
    },
    // Off-plan projects — Hide-Phase1 (see Prompt 5's PHASE1_FLAGS). Kept
    // fully working, just not linked from the nav while the flag is off.
    ...(PHASE1_FLAGS.projects
      ? [
          {
            key: "projects",
            icon: Building2,
            label: t("partnerDashboard.sidebar.navProjects"),
            active: view === "projects",
            onClick: () => setView("projects" as PartnerView),
          },
        ]
      : []),
  ];

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

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(({ key, icon: Icon, label, active, onClick }) => (
            <button
              key={key}
              type="button"
              onClick={onClick}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
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
          {/* Horizontally scrollable, non-growing pills — same pattern as the
              customer TopNav's mobile strip, needed once the nav grew past a
              handful of items (flex-1 tabs would get unusably narrow). */}
          <nav className="flex gap-2 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV_ITEMS.map(({ key, icon: Icon, label, active, onClick }) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                className={cn(
                  "flex shrink-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
          {/* ══ LEADS VIEW ══ */}
          {view === "leads" && (
            <div className="space-y-8">
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
          )}

          {/* ══ DASHBOARD VIEW ══ */}
          {view === "dashboard" && (
            <PartnerOverviewView
              partner={partner!}
              newLeadsCount={availableLeads.length}
              activeLeadsCount={acceptedLeads.length}
              listingsCount={listings.length}
              onGo={setView}
            />
          )}

          {/* ══ PROPERTIES VIEW (My Properties / Rental Listings / Sale Listings) ══ */}
          {view === "properties" && (
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
                  filter={listingFilter}
                  onFilterChange={setListingFilter}
                  onAdd={() => setListingFormOpen(true)}
                  onEdit={(l) => setEditingListing(l)}
                />
              )}
            </div>
          )}

          {/* ══ MESSAGES VIEW ══ */}
          {view === "messages" && (
            <PartnerMessagesView
              threads={[...acceptedLeads, ...closedLeads]}
              onOpen={(leadId) =>
                navigate({ to: "/partner/leads/$leadId", params: { leadId: String(leadId) } })
              }
            />
          )}

          {/* ══ PROFILE VIEW ══ */}
          {view === "profile" && (
            <PartnerProfileView
              partner={partner!}
              onSaved={(updated) => setPartner(updated)}
            />
          )}

          {/* ══ REVIEWS VIEW ══ */}
          {view === "reviews" && <PartnerReviewsView mediatorId={partner!.id} />}

          {/* ══ AREA COVERAGE VIEW ══ */}
          {view === "areas" && (
            <PartnerAreaCoverageView
              partner={partner!}
              availableAreas={availableAreas}
              newArea={newArea}
              setNewArea={setNewArea}
              addingArea={addingArea}
              onAddArea={handleAddArea}
              onRemoveArea={handleRemoveArea}
            />
          )}

          {/* ══ SUBSCRIPTION VIEW ══ */}
          {view === "subscription" && (
            <PartnerSubscriptionView
              partner={partner!}
              onRenewed={(updates) => setPartner((p) => (p ? { ...p, ...updates } : p))}
            />
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
  filter,
  onFilterChange,
  onAdd,
  onEdit,
}: {
  listings: ApiProperty[];
  loading: boolean;
  filter: ListingFilter;
  onFilterChange: (f: ListingFilter) => void;
  onAdd: () => void;
  onEdit: (l: ApiProperty) => void;
}) {
  const { t } = useLanguage();
  const filtered = filter === "all" ? listings : listings.filter((l) => l.listing_type === filter);
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

      {/* All / Rent / Sale — the only transaction types myMakan Phase-1
          exposes (see docs/implementation/mymakan-phase1.md "Navigation
          changed", Prompt 6). */}
      <div className="mb-4 flex gap-2">
        {(["all", "rent", "sale"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilterChange(f)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-foreground hover:bg-surface-2",
            )}
          >
            {t(
              f === "all"
                ? "partnerDashboard.listingsView.filterAll"
                : f === "rent"
                  ? "partnerDashboard.listingsView.filterRent"
                  : "partnerDashboard.listingsView.filterSale",
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {t("partnerDashboard.listingsView.loadingListings")}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center space-y-3">
          <Home className="mx-auto size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {listings.length === 0
              ? t("partnerDashboard.listingsView.noListingsYet")
              : t("partnerDashboard.listingsView.noMatchingListings")}
          </p>
          <Button variant="outline" onClick={onAdd}>
            <Plus className="size-4" /> {t("partnerDashboard.listingsView.addListing")}
          </Button>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((l) => {
            const canEdit = l.status === "Published";
            return (
              <div key={l.id} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{l.title}</span>
                      <ListingStatusBadge status={l.status} />
                      <Badge tone="neutral">
                        {l.listing_type === "sale"
                          ? t("partnerDashboard.listingsView.filterSale")
                          : t("partnerDashboard.listingsView.filterRent")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {l.area}, {l.city}
                      {l.bedrooms != null ? ` · ${l.bedrooms} BR` : ""}
                      {l.bathrooms != null ? ` · ${l.bathrooms} BA` : ""}
                      {l.size_sq_m ? ` · ${l.size_sq_m} m²` : ""}
                    </p>
                    <p className="text-sm font-semibold text-primary">
                      {l.listing_type === "sale"
                        ? `SAR ${formatSAR(l.sale_price ?? 0)}`
                        : `SAR ${formatSAR(l.monthly_rent ?? 0)}/mo`}
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
  listingType: "rent" | "sale";
  rent: string;
  salePrice: string;
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
    listingType: editing?.listing_type ?? "rent",
    rent: editing && editing.listing_type !== "sale" ? String(editing.monthly_rent ?? "") : "",
    salePrice: editing && editing.listing_type === "sale" ? String(editing.sale_price ?? "") : "",
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
    const salePrice = parseFloat(form.salePrice);
    if (form.listingType === "rent") {
      if (!rent || rent <= 0) {
        setError(t("partnerDashboard.listingForm.errors.invalidRent"));
        return;
      }
    } else if (!salePrice || salePrice <= 0) {
      setError(t("partnerDashboard.listingForm.errors.invalidSalePrice"));
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
          listing_type: form.listingType,
          monthly_rent: form.listingType === "rent" ? rent : undefined,
          sale_price: form.listingType === "sale" ? salePrice : undefined,
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

          {/* myMakan Phase-1 only exposes Rent / Sale as transaction types
              (see docs/implementation/mymakan-phase1.md "Navigation changed",
              Prompt 6). */}
          <FormField label={t("partnerDashboard.listingForm.transactionType")}>
            <div className="grid grid-cols-2 gap-2">
              {(["rent", "sale"] as const).map((lt) => (
                <button
                  key={lt}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, listingType: lt }))}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    form.listingType === lt
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface text-foreground hover:bg-surface-2",
                  )}
                >
                  {t(
                    lt === "rent"
                      ? "partnerDashboard.listingForm.rent"
                      : "partnerDashboard.listingForm.sale",
                  )}
                </button>
              ))}
            </div>
          </FormField>

          {form.listingType === "sale" ? (
            <FormField label={t("partnerDashboard.listingForm.salePrice")}>
              <Input
                type="number"
                min={1}
                value={form.salePrice}
                onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))}
                placeholder={t("partnerDashboard.listingForm.salePricePlaceholder")}
              />
            </FormField>
          ) : (
            <FormField label={t("partnerDashboard.listingForm.monthlyRent")}>
              <Input
                type="number"
                min={1}
                value={form.rent}
                onChange={(e) => setForm((f) => ({ ...f, rent: e.target.value }))}
                placeholder={t("partnerDashboard.listingForm.monthlyRentPlaceholder")}
              />
            </FormField>
          )}

          {/* AI dynamic pricing suggestion — nightly rate for short-term
              (Airbnb-style) bookings, distinct from the long-term monthly
              rent above. Reuses backend/app/api/routes/ai.py's
              /pricing-suggestion endpoint. Rent-only (a nightly rate implies
              a rental) and gated behind PHASE1_FLAGS.booking — short-stay
              bookings are Hide-Phase1 for myMakan, same reasoning as the
              ShortTermBooking widget gated on property.$id.tsx in Prompt 5. */}
          {form.listingType === "rent" && PHASE1_FLAGS.booking && (
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
          )}

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

// ── Dashboard overview ───────────────────────────────────────────────────────
// Lightweight stat tiles built entirely from state the other views already
// load (leads/listings counts, areas, subscription) — no new API calls.

function PartnerOverviewView({
  partner,
  newLeadsCount,
  activeLeadsCount,
  listingsCount,
  onGo,
}: {
  partner: ApiPartner;
  newLeadsCount: number;
  activeLeadsCount: number;
  listingsCount: number;
  onGo: (v: PartnerView) => void;
}) {
  const { t } = useLanguage();
  const stats: Array<{ label: string; value: number; icon: typeof Home; onClick: () => void }> = [
    {
      label: t("partnerDashboard.dashboard.newLeads"),
      value: newLeadsCount,
      icon: ListChecks,
      onClick: () => onGo("leads"),
    },
    {
      label: t("partnerDashboard.dashboard.activeLeads"),
      value: activeLeadsCount,
      icon: MessageSquare,
      onClick: () => onGo("leads"),
    },
    {
      label: t("partnerDashboard.dashboard.myProperties"),
      value: listingsCount,
      icon: Home,
      onClick: () => onGo("properties"),
    },
    {
      label: t("partnerDashboard.dashboard.areasCovered"),
      value: partner.areas.length,
      icon: MapPin,
      onClick: () => onGo("areas"),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("partnerDashboard.dashboard.heading")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("partnerDashboard.dashboard.subtitle")}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={s.onClick}
            className="rounded-2xl border border-border bg-card p-5 text-start shadow-card transition-colors hover:border-primary/40"
          >
            <s.icon className="size-5 text-primary" />
            <div className="mt-3 text-2xl font-bold tracking-tight">{s.value}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{t("partnerDashboard.dashboard.subscriptionLabel")}</div>
            <Badge tone={partner.subscription_status === "active" ? "success" : "warning"} className="mt-1.5">
              {partner.subscription_status === "active" ? (
                <CheckCircle className="size-3" />
              ) : (
                <Clock className="size-3" />
              )}
              {partner.subscription_status}
            </Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => onGo("subscription")}>
            {t("partnerDashboard.dashboard.manageSubscription")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────
// An inbox-style index over the same per-lead chat threads that already exist
// at /partner/leads/$leadId (fetchLeadMessages/sendLeadMessage) — no new
// messaging backend, just a way to see all active/closed threads in one list.

function PartnerMessagesView({
  threads,
  onOpen,
}: {
  threads: ApiLeadDetail[];
  onOpen: (leadId: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("partnerDashboard.messages.heading")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("partnerDashboard.messages.subtitle")}</p>
      <div className="mt-6 space-y-3">
        {threads.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("partnerDashboard.messages.empty")}
          </div>
        )}
        {threads.map((lead) => (
          <button
            key={lead.id}
            type="button"
            onClick={() => onOpen(lead.id)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 text-start shadow-card transition-colors hover:border-primary/40"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-semibold">
                  {lead.area_name}, {lead.city}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{lead.customer_name}</p>
            </div>
            <span className="shrink-0 text-xs font-medium text-primary">
              {t("partnerDashboard.messages.open")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Profile ──────────────────────────────────────────────────────────────────
// Reuses the existing PATCH /mediators/me endpoint (updateMediatorProfile) —
// already used nowhere in this file before, but already existed in the API
// layer. License number / member-since are read-only (backend-assigned).

function PartnerProfileView({
  partner,
  onSaved,
}: {
  partner: ApiPartner;
  onSaved: (p: ApiPartner) => void;
}) {
  const { t } = useLanguage();
  const [agencyName, setAgencyName] = useState(partner.agency_name ?? "");
  const [phone, setPhone] = useState(partner.phone);
  const [bio, setBio] = useState(partner.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateMediatorProfile({
        agency_name: agencyName.trim() || undefined,
        phone: phone.trim(),
        bio: bio.trim() || undefined,
      });
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerDashboard.profile.failedToSave"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">{t("partnerDashboard.profile.heading")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("partnerDashboard.profile.subtitle")}</p>
      <form
        onSubmit={handleSave}
        className="mt-6 space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <FormField label={t("partnerDashboard.profile.agencyName")}>
          <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} />
        </FormField>
        <FormField label={t("partnerDashboard.profile.phone")}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormField>
        <FormField label={t("partnerDashboard.profile.bio")}>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <div>
            {t("partnerDashboard.profile.licenseNumber")}: {partner.license_number}
          </div>
          <div>
            {t("partnerDashboard.profile.memberSince")}:{" "}
            {new Date(partner.created_at).toLocaleDateString()}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && !error && (
          <p className="text-sm text-success">{t("partnerDashboard.profile.saved")}</p>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? t("partnerDashboard.profile.saving") : t("partnerDashboard.profile.save")}
        </Button>
      </form>
    </div>
  );
}

// ── Reviews ──────────────────────────────────────────────────────────────────
// Reuses the existing public review endpoints (fetchMediatorReviews /
// fetchMediatorReviewSummary), scoped to the partner's own mediator id — the
// same data already shown on the public agent profile page (agent.$id.tsx).

function PartnerReviewsView({ mediatorId }: { mediatorId: number }) {
  const { t } = useLanguage();
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [summary, setSummary] = useState<ApiReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchMediatorReviews(mediatorId), fetchMediatorReviewSummary(mediatorId)])
      .then(([r, s]) => {
        if (!cancelled) {
          setReviews(r);
          setSummary(s);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediatorId]);

  const approved = reviews.filter((r) => r.status === "approved");

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("partnerDashboard.reviews.heading")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("partnerDashboard.reviews.subtitle")}</p>

      {summary && summary.review_count > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-5 shadow-card">
          <Star className="size-6 fill-amber-500 text-amber-500" />
          <div>
            <div className="text-2xl font-bold tracking-tight">
              {summary.avg_rating != null ? summary.avg_rating.toFixed(1) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("partnerDashboard.reviews.reviewCount", { count: summary.review_count })}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {loading && (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        )}
        {!loading && approved.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("partnerDashboard.reviews.empty")}
          </div>
        )}
        {approved.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-1.5">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    "size-3.5",
                    i < r.rating ? "fill-amber-500 text-amber-500" : "text-border",
                  )}
                />
              ))}
            </div>
            {r.comment && <p className="text-sm text-foreground">{r.comment}</p>}
            <p className="text-xs text-muted-foreground">
              {r.reviewer_name ?? t("partnerDashboard.reviews.anonymous")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Area coverage ────────────────────────────────────────────────────────────
// Moved out of the leads view's sidebar (Prompt 6) into its own nav item —
// same add/remove-area logic and JSX as before, just no longer squeezed next
// to the leads list.

function PartnerAreaCoverageView({
  partner,
  availableAreas,
  newArea,
  setNewArea,
  addingArea,
  onAddArea,
  onRemoveArea,
}: {
  partner: ApiPartner;
  availableAreas: ApiAreaSummary[];
  newArea: { area_name: string; city: string };
  setNewArea: (updater: (v: { area_name: string; city: string }) => { area_name: string; city: string }) => void;
  addingArea: boolean;
  onAddArea: (e: React.FormEvent) => void;
  onRemoveArea: (area_id: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">{t("partnerDashboard.coveredAreas.heading")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("partnerDashboard.coveredAreas.subtitle")}</p>
      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
        {partner.areas.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("partnerDashboard.coveredAreas.noAreasYet")}
          </p>
        )}
        {partner.areas.map((area) => (
          <div key={area.id} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="size-3.5 text-muted-foreground" />
              <span>{area.area_name}</span>
              <span className="text-xs text-muted-foreground">{area.city}</span>
            </div>
            <button
              onClick={() => onRemoveArea(area.id)}
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <form onSubmit={onAddArea} className="border-t border-border pt-3 space-y-2">
          <select
            value={newArea.area_name ? `${newArea.area_name}|${newArea.city}` : ""}
            onChange={(e) => {
              const [area_name, city] = e.target.value.split("|");
              setNewArea(() => ({ area_name: area_name ?? "", city: city ?? "" }));
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="">{t("partnerDashboard.coveredAreas.selectDistrict")}</option>
            {Array.from(new Set(availableAreas.map((a) => a.city)))
              .sort()
              .map((city) => {
                const taken = new Set(
                  partner.areas.filter((a) => a.city === city).map((a) => a.area_name),
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
                          {taken.has(area.name) ? t("partnerDashboard.coveredAreas.addedSuffix") : ""}
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
    </div>
  );
}

// ── Subscription ─────────────────────────────────────────────────────────────
// Reuses the existing mock subscribe/renew endpoint (subscribePartnerMock →
// POST /mediators/me/subscribe, the same one activated from partner.register.tsx)
// — no new payment flow.

function PartnerSubscriptionView({
  partner,
  onRenewed,
}: {
  partner: ApiPartner;
  onRenewed: (updates: { subscription_status: string; subscription_expires_at: string }) => void;
}) {
  const { t, lang } = useLanguage();
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = partner.subscription_status === "active";

  async function handleRenew() {
    setRenewing(true);
    setError(null);
    try {
      const res = await subscribePartnerMock();
      onRenewed({ subscription_status: res.status, subscription_expires_at: res.subscription_expires_at });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerDashboard.subscriptionView.failed"));
    } finally {
      setRenewing(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">{t("partnerDashboard.subscriptionView.heading")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("partnerDashboard.subscriptionView.subtitle")}</p>
      <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t("partnerDashboard.subscriptionView.status")}</span>
          <Badge tone={active ? "success" : "warning"}>
            {active ? <CheckCircle className="size-3" /> : <Clock className="size-3" />}
            {partner.subscription_status}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t("partnerDashboard.subscriptionView.tier")}</span>
          <span className="text-sm font-medium">{partner.subscription_tier}</span>
        </div>
        {partner.subscription_expires_at && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t("partnerDashboard.subscriptionView.expires")}
            </span>
            <span className="text-sm font-medium">
              {new Date(partner.subscription_expires_at).toLocaleDateString(
                lang === "ar" ? "ar-SA" : "en-SA",
              )}
            </span>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" onClick={() => void handleRenew()} disabled={renewing}>
          {renewing
            ? t("partnerDashboard.subscriptionView.renewing")
            : active
              ? t("partnerDashboard.subscriptionView.renewCta")
              : t("partnerDashboard.subscriptionView.subscribeCta")}
        </Button>
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
