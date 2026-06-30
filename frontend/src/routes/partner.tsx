import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Briefcase, CheckCircle, Clock, Eye, EyeOff, History, Home, ListChecks, LogOut, Mail, MapPin, MessageSquare, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
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
  type ApiAreaSummary,
  type ApiPartner,
  type ApiLeadDetail,
  type ApiLeadAvailable,
  type ApiProperty,
  type PartnerPropertyPayload,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/partner")({
  head: () => ({ meta: [{ title: "Partner Dashboard — Maskan" }] }),
  component: PartnerDashboard,
});

type PartnerView = "leads" | "listings";

function PartnerDashboard() {
  const { user, authLoading, clearAuth } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: s => s.location.pathname });

  const [view, setView] = useState<PartnerView>("leads");
  const [partner, setPartner] = useState<ApiPartner | null>(null);
  const [leads, setLeads] = useState<ApiLeadDetail[]>([]);
  const [availableLeads, setAvailableLeads] = useState<ApiLeadAvailable[]>([]);
  const [listings, setListings] = useState<ApiProperty[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
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
      if (!m) { setNoProfile(true); setLoading(false); return; }
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
      fetchPartnerListings().then(setListings).catch(() => {}).finally(() => setLoadingListings(false));
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
      setAcceptError("Could not accept lead. Please try again.");
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
      setPartner(m => m ? { ...m, areas: [...m.areas, area] } : m);
      setNewArea({ area_name: "", city: "Riyadh" });
    } finally {
      setAddingArea(false);
    }
  }

  async function handleRemoveArea(area_id: number) {
    await removePartnerArea(area_id);
    setPartner(m => m ? { ...m, areas: m.areas.filter(a => a.id !== area_id) } : m);
  }

  async function handleSaveListing(payload: PartnerPropertyPayload, imageUrls: string[], editId?: number) {
    let saved: ApiProperty;
    if (editId) {
      saved = await patchPartnerListing(editId, payload);
      setListings(ls => ls.map(l => l.id === editId ? saved : l));
    } else {
      saved = await createPartnerListing(payload);
      setListings(ls => [saved, ...ls]);
    }
    // Sync images
    const existingImages = saved.images ?? [];
    const existingUrls = new Set(existingImages.map(i => i.url));
    const newUrlSet = new Set(imageUrls);
    await Promise.all([
      ...imageUrls.filter(u => !existingUrls.has(u)).map(u => addPartnerPropertyImage(saved.id, u)),
      ...existingImages.filter(i => !newUrlSet.has(i.url)).map(i => deletePartnerPropertyImage(saved.id, i.id)),
    ]);
    // Re-fetch to get updated images
    const fresh = await fetchPartnerListings();
    setListings(fresh);
  }

  if (pathname !== "/partner") return <Outlet />;
  if (authLoading) return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  if (!user) return <PartnerLoginGate />;
  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">Loading…</p></div>;

  if (noProfile) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary"><Briefcase className="size-8" /></div>
      <div className="text-center">
        <h1 className="text-2xl font-bold">Become a Maskan Partner</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">Connect tenants with properties in your area and earn per accepted lead.</p>
      </div>
      <Button onClick={() => navigate({ to: "/partner/register" })}>Register as a partner</Button>
    </div>
  );

  const acceptedLeads = leads.filter(l => l.assignments.some(a => a.status === "accepted") && (l.status === "in_progress" || l.status === "pending_closure"));
  const closedLeads   = leads.filter(l => l.status === "closed_won" || l.status === "closed_lost");

  return (
    <div className="flex min-h-screen bg-surface">
      {/* ── Left sidebar ── */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-e border-border bg-background lg:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-5">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Briefcase className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">Maskan Partner</div>
            <div className="truncate text-xs text-muted-foreground">{user?.full_name ?? user?.email}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {([
            { v: "leads" as const,    icon: ListChecks, label: "Leads" },
            { v: "listings" as const, icon: Home,       label: "My Listings" },
          ]).map(({ v, icon: Icon, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                view === v
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <div className="border-t border-border px-3 py-4 space-y-2">
          <Badge tone={partner!.subscription_status === "active" ? "success" : "warning"} className="w-full justify-center">
            {partner!.subscription_status === "active" ? <CheckCircle className="size-3" /> : <Clock className="size-3" />}
            {partner!.subscription_status}
          </Badge>
          <button
            type="button"
            onClick={clearAuth}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="size-4" /> Sign out
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
              <span className="truncate text-sm font-bold">Maskan Partner</span>
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
            {([
              { v: "leads" as const,    icon: ListChecks, label: "Leads" },
              { v: "listings" as const, icon: Home,       label: "My Listings" },
            ]).map(({ v, icon: Icon, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  view === v
                    ? "bg-primary/10 text-primary"
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
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-8">

                {/* Available Leads */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">Available leads</h2>
                    {availableLeads.length > 0 && (
                      <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">{availableLeads.length} new</span>
                    )}
                  </div>
                  {availableLeads.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                      No new leads right now. Make sure your covered areas are set up.
                    </div>
                  )}
                  {availableLeads.map(lead => {
                    const isConfirming = confirmingId === lead.id;
                    const isAccepting  = acceptingId  === lead.id;
                    return (
                      <div key={lead.id} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <MapPin className="size-4 text-muted-foreground" />
                              <span className="font-semibold">{lead.area_name}, {lead.city}</span>
                              <Badge tone="warning">New</Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {lead.bedrooms_needed ? `${lead.bedrooms_needed} BR · ` : ""}
                              {lead.max_budget ? `Up to SAR ${formatSAR(lead.max_budget)}/mo` : "Budget flexible"}
                              {lead.move_in_date ? ` · Move-in ${lead.move_in_date}` : ""}
                            </div>
                            {lead.requirements_note && <p className="text-sm text-foreground line-clamp-2">{lead.requirements_note}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                          <span className="font-mono tracking-widest select-none">●●● ●●●●●●  ·  ●●●@●●●●.●●●</span>
                          <span className="ml-auto text-xs">Unlocked after payment</span>
                        </div>
                        {!isConfirming ? (
                          <Button className="w-full" onClick={() => { setConfirmingId(lead.id); setAcceptError(null); }}>
                            Accept lead — SAR 25
                          </Button>
                        ) : (
                          <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                            <p className="text-sm"><strong>SAR 25</strong> will be charged from your saved card.</p>
                            {acceptError && <p className="text-xs text-destructive">{acceptError}</p>}
                            <div className="flex gap-2">
                              <Button className="flex-1" onClick={() => handleConfirmAccept(lead.id)} disabled={isAccepting}>
                                {isAccepting ? "Processing…" : "Confirm & pay SAR 25"}
                              </Button>
                              <Button variant="outline" className="flex-1" onClick={() => { setConfirmingId(null); setAcceptError(null); }} disabled={isAccepting}>
                                Cancel
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
                  <h2 className="text-lg font-bold">Accepted leads</h2>
                  {acceptedLeads.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      No accepted leads yet.
                    </div>
                  )}
                  {acceptedLeads.map(lead => (
                    <div
                      key={lead.id}
                      onClick={() => navigate({ to: "/partner/leads/$leadId", params: { leadId: String(lead.id) } })}
                      className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <MapPin className="size-4 text-muted-foreground" />
                            <span className="font-semibold">{lead.area_name}, {lead.city}</span>
                            <Badge tone={lead.status === "pending_closure" ? "warning" : "success"}>
                              {lead.status === "pending_closure" ? "Closing…" : "In progress"}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {lead.bedrooms_needed ? `${lead.bedrooms_needed} BR · ` : ""}
                            {lead.max_budget ? `Up to SAR ${formatSAR(lead.max_budget)}/mo` : "Budget flexible"}
                          </div>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-primary font-medium">
                          <MessageSquare className="size-3.5" /> Open
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                          <Phone className="size-3.5 text-muted-foreground shrink-0" />
                          <a href={`tel:${lead.customer_phone}`} onClick={e => e.stopPropagation()} className="font-medium text-primary hover:underline truncate">{lead.customer_phone}</a>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                          <Mail className="size-3.5 text-muted-foreground shrink-0" />
                          <a href={`mailto:${lead.customer_email}`} onClick={e => e.stopPropagation()} className="truncate text-foreground hover:underline">{lead.customer_email}</a>
                        </div>
                      </div>
                      <p className="text-sm font-medium">{lead.customer_name}</p>
                      {lead.requirements_note && <p className="text-sm text-muted-foreground line-clamp-2">{lead.requirements_note}</p>}
                    </div>
                  ))}
                </section>

                {/* Closed Leads */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">Closed leads</h2>
                    <Badge tone="neutral"><History className="size-3" /> History</Badge>
                  </div>
                  {closedLeads.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      Completed leads will appear here once closed.
                    </div>
                  ) : closedLeads.map(lead => (
                    <div
                      key={lead.id}
                      onClick={() => navigate({ to: "/partner/leads/$leadId", params: { leadId: String(lead.id) } })}
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
                          <span className="font-semibold">{lead.area_name}, {lead.city}</span>
                          <Badge tone={lead.status === "closed_won" ? "success" : "neutral"}>
                            {lead.status === "closed_won" ? "Found" : "No match"}
                          </Badge>
                        </div>
                        {lead.closed_at && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(lead.closed_at).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{lead.customer_name}</p>
                      <p className="text-xs text-primary font-medium">View details →</p>
                    </div>
                  ))}
                </section>
              </div>

              {/* Covered areas sidebar */}
              <div className="space-y-4">
                <h2 className="text-lg font-bold">Your covered areas</h2>
                <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                  {partner!.areas.length === 0 && (
                    <p className="text-sm text-muted-foreground">No areas added yet.</p>
                  )}
                  {partner!.areas.map(area => (
                    <div key={area.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="size-3.5 text-muted-foreground" />
                        <span>{area.area_name}</span>
                        <span className="text-xs text-muted-foreground">{area.city}</span>
                      </div>
                      <button onClick={() => handleRemoveArea(area.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <form onSubmit={handleAddArea} className="border-t border-border pt-3 space-y-2">
                    <select
                      value={newArea.area_name ? `${newArea.area_name}|${newArea.city}` : ""}
                      onChange={e => {
                        const [area_name, city] = e.target.value.split("|");
                        setNewArea({ area_name: area_name ?? "", city: city ?? "" });
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                    >
                      <option value="">— Select a district —</option>
                      {Array.from(new Set(availableAreas.map(a => a.city))).sort().map(city => {
                        const taken = new Set(partner!.areas.filter(a => a.city === city).map(a => a.area_name));
                        return (
                          <optgroup key={city} label={city}>
                            {availableAreas.filter(a => a.city === city).sort((a, b) => a.name.localeCompare(b.name)).map(area => (
                              <option key={`${area.name}|${city}`} value={`${area.name}|${city}`} disabled={taken.has(area.name)}>
                                {area.name}{taken.has(area.name) ? " (added)" : ""}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                    <Button type="submit" size="sm" variant="outline" className="w-full" disabled={addingArea || !newArea.area_name.trim()}>
                      <Plus className="size-3.5" /> Add area
                    </Button>
                  </form>
                </div>
                <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted-foreground space-y-1">
                  <div><strong>Subscription:</strong> {partner!.subscription_status}</div>
                  {partner!.subscription_expires_at && (
                    <div>Expires: {new Date(partner!.subscription_expires_at).toLocaleDateString("en-SA")}</div>
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
                  onClose={() => { setListingFormOpen(false); setEditingListing(null); }}
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
                  onEdit={l => setEditingListing(l)}
                />
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

// ── Status badge helper ──────────────────────────────────────────────────────

function ListingStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "success" | "warning" | "neutral" | "destructive"; label: string }> = {
    "Published":       { tone: "success",     label: "Published" },
    "Pending Approval":{ tone: "warning",     label: "Pending Approval" },
    "Draft":           { tone: "neutral",     label: "Draft" },
    "Rejected":        { tone: "destructive", label: "Rejected" },
    "Suspended":       { tone: "destructive", label: "Suspended" },
  };
  const { tone, label } = map[status] ?? { tone: "neutral", label: status };
  return <Badge tone={tone}>{label}</Badge>;
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
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">My portfolio</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">My Listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Properties you've submitted. Approved listings appear on the portal.</p>
        </div>
        <Button onClick={onAdd} className="shrink-0">
          <Plus className="size-4" /> Add Listing
        </Button>
      </div>

      {loading && (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading listings…</div>
      )}

      {!loading && listings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center space-y-3">
          <Home className="mx-auto size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No listings yet. Add your first property.</p>
          <Button variant="outline" onClick={onAdd}><Plus className="size-4" /> Add Listing</Button>
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="space-y-3">
          {listings.map(l => {
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
                    <p className="text-sm font-semibold text-primary">SAR {formatSAR(l.monthly_rent)}/mo</p>
                    {l.status === "Pending Approval" && (
                      <p className="text-xs text-muted-foreground">Under review by admin — editing is locked until a decision is made.</p>
                    )}
                    {l.status === "Rejected" && (
                      <p className="text-xs text-destructive">This listing was rejected. Contact admin for details.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => canEdit && onEdit(l)}
                    title={canEdit ? "Edit listing" : "Editing locked — not yet approved"}
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
  const [form, setForm] = useState<ListingFormState>({
    title:         editing?.title         ?? "",
    city:          editing?.city          ?? "",
    district:      editing?.area          ?? "",
    rent:          editing ? String(editing.monthly_rent) : "",
    bedrooms:      editing?.bedrooms      != null ? String(editing.bedrooms)  : "3",
    bathrooms:     editing?.bathrooms     != null ? String(editing.bathrooms) : "2",
    size:          editing?.size_sq_m     != null ? String(editing.size_sq_m) : "",
    owner_name:    editing?.owner_name    ?? "",
    description:   editing?.description   ?? "",
    property_type: editing?.property_type ?? "",
    furnished:     editing?.furnished     ?? "",
  });
  const [media, setMedia] = useState<string[]>(
    editing?.images?.length ? editing.images.sort((a, b) => a.display_order - b.display_order).map(i => i.url) : [],
  );
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Districts for the selected city
  const districtOptions = areas
    .filter(a => !form.city || a.city === form.city)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function submit() {
    if (!form.city.trim())     { setError("Please select a city.");     return; }
    if (!form.district.trim()) { setError("Please select a district."); return; }
    const rent = parseFloat(form.rent);
    if (!rent || rent <= 0)    { setError("Please enter a valid monthly rent."); return; }
    if (!form.title.trim())    { setError("Please enter a listing title."); return; }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title:         form.title.trim() || "Untitled listing",
        city:          form.city.trim(),
        area:          form.district.trim(),
        monthly_rent:  rent,
        bedrooms:      form.bedrooms      ? parseInt(form.bedrooms)    : undefined,
        bathrooms:     form.bathrooms     ? parseInt(form.bathrooms)   : undefined,
        size_sq_m:     form.size          ? parseInt(form.size)        : undefined,
        owner_name:    form.owner_name.trim()    || undefined,
        description:   form.description.trim()   || undefined,
        property_type: form.property_type || undefined,
        furnished:     form.furnished     || undefined,
      }, media);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save listing.");
      setSaving(false);
    }
  }

  const isEdit = !!editing;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <button type="button" onClick={onClose} className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            ← Back to listings
          </button>
          <h1 className="text-2xl font-bold">{isEdit ? "Edit listing" : "New listing"}</h1>
          {isEdit && (
            <p className="mt-1 text-sm text-muted-foreground">Saving changes will re-submit this listing for admin approval.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Property details</h2>

          <FormField label="Listing title *">
            <Input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Modern 3BR Apartment — Al Olaya"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="City *">
              <select
                value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value, district: "" }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">— Select city —</option>
                {CITY_LIST.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </FormField>

            <FormField label="District *">
              <select
                value={form.district}
                onChange={e => setForm(f => ({ ...f, district: e.target.value }))}
                disabled={!form.city}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              >
                <option value="">— Select district —</option>
                {districtOptions.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
                {form.district && !districtOptions.find(a => a.name === form.district) && (
                  <option value={form.district}>{form.district}</option>
                )}
              </select>
            </FormField>
          </div>

          <FormField label="Monthly rent (SAR) *">
            <Input
              type="number"
              min={1}
              value={form.rent}
              onChange={e => setForm(f => ({ ...f, rent: e.target.value }))}
              placeholder="e.g. 8000"
            />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Bedrooms">
              <Input type="number" min={0} value={form.bedrooms} onChange={e => setForm(f => ({ ...f, bedrooms: e.target.value }))} />
            </FormField>
            <FormField label="Bathrooms">
              <Input type="number" min={0} value={form.bathrooms} onChange={e => setForm(f => ({ ...f, bathrooms: e.target.value }))} />
            </FormField>
            <FormField label="Area (m²)">
              <Input type="number" min={1} value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} placeholder="e.g. 150" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Property type">
              <select
                value={form.property_type}
                onChange={e => setForm(f => ({ ...f, property_type: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">— Select type —</option>
                <option>Apartment</option>
                <option>Villa</option>
                <option>Penthouse</option>
                <option>Townhouse</option>
              </select>
            </FormField>

            <FormField label="Furnished status">
              <select
                value={form.furnished}
                onChange={e => setForm(f => ({ ...f, furnished: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">— Select —</option>
                <option>Furnished</option>
                <option>Semi-furnished</option>
                <option>Unfurnished</option>
              </select>
            </FormField>
          </div>

          <FormField label="Owner / agent name">
            <Input value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="e.g. Noura Al-Qahtani" />
          </FormField>
        </div>

        {/* Right column */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Photos</h2>

          {/* Photo thumbnails */}
          {media.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {media.map((url, i) => (
                <div key={i} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-surface-2">
                  <img src={url} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setMedia(m => m.filter((_, idx) => idx !== i))}
                    className="absolute end-1 top-1 grid size-6 place-items-center rounded-md bg-background/90 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                  {i === 0 && <span className="absolute bottom-1 start-1 rounded bg-foreground/85 px-1.5 py-0.5 text-[10px] font-bold uppercase text-background">Cover</span>}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const t = urlInput.trim();
                  if (t && !media.includes(t)) setMedia(m => [...m, t]);
                  setUrlInput("");
                }
              }}
              placeholder="Paste image URL and press Enter…"
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const t = urlInput.trim();
                if (t && !media.includes(t)) setMedia(m => [...m, t]);
                setUrlInput("");
              }}
              disabled={!urlInput.trim()}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">First photo is the cover shown on the portal.</p>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground pt-2">Description</h2>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={6}
            placeholder="Describe the property — highlight key features, nearby amenities, access, finishing quality…"
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />

          {/* Status note */}
          <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-muted-foreground">
            {isEdit
              ? "Saving will re-submit this listing for admin review. It will be hidden from the portal until re-approved."
              : "Your listing will be submitted for admin review. Once approved, it will appear on the Maskan portal."}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className="flex-1">
              {saving ? "Submitting…" : isEdit ? "Save & resubmit for approval" : "Submit for approval"}
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

function PartnerLoginGate() {
  const { setAuth } = useAuth();
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
      setError(msg && !msg.includes("Request failed") ? msg : "Invalid email or password.");
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
            <h1 className="text-2xl font-bold">Partner Portal</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to access your partner dashboard</p>
          </div>
        </div>
        <form className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                className="h-11 w-full rounded-lg border border-border bg-background pe-10 ps-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute end-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !email || !password}>
            {loading ? "Signing in…" : "Sign in to Partner Portal"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Not yet a partner?{" "}
          <a href="/partner/register" className="font-semibold text-primary hover:underline">Register here</a>
        </p>
      </div>
    </div>
  );
}
