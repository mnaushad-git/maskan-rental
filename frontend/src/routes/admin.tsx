import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import prop1 from "@/assets/prop-1.jpg";
import prop2 from "@/assets/prop-2.jpg";
import prop3 from "@/assets/prop-3.jpg";
import prop4 from "@/assets/prop-4.jpg";

const PROP_IMAGES = [prop1, prop2, prop3, prop4] as const;
import {
  Bath,
  BedDouble,
  Briefcase,
  Building2,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Filter,
  Home,
  Image as ImageIcon,
  ListChecks,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  MessageSquare,
  Send,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  UserPlus,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/maskan/Badges";
import { formatSAR, cities } from "@/lib/maskan-data"; // cities: { name, listings }[]
import {
  adminAiChat,
  adminCreateUser,
  adminUpdateUser,
  fetchAdminUsers,
  createLead,
  createProperty,
  fetchAdminProperties,
  fetchAdminLeads,
  fetchAdminMediators,
  adminCreatePartner,
  approvePartner,
  rejectPartner,
  fetchAreas,
  adminApproveLead,
  adminRejectLead,
  adminApproveClosure,
  adminRejectClosure,
  adminForceCloseLead,
  adminSendMessage,
  adminFetchMessages,
  fetchAllReviews,
  moderateReview,
  login,
  mapApiProperty,
  patchMediatorAdmin,
  patchProperty,
  removeProperty,
  addPropertyImage,
  deletePropertyImage,
  type ApiAreaSummary,
  type ApiProperty,
  type ApiPartner,
  type ApiUser,
  type ApiLeadDetail,
  type ApiLeadMessage,
  type ApiReviewAdmin,
  type AuthUser,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Console — Maskan" },
      {
        name: "description",
        content:
          "Manage property listings, approvals and publishing for the Maskan marketplace.",
      },
    ],
  }),
  component: AdminPage,
});

// ---------- Types ----------

type ListingStatus = "Draft" | "Pending Approval" | "Published" | "Suspended" | "Rejected";

type Listing = {
  id: string;
  title: string;
  city: string;
  district: string;
  rent: number;
  status: ListingStatus;
  owner: string;
  createdAt: string; // ISO
  image: string;
  images: { id: number; url: string; display_order: number }[];
  areaSqm?: number;
  bedrooms?: number;
  bathrooms?: number;
  description?: string;
  property_type?: string;
  furnished?: string;
};


// ---------- Page ----------

type AdminView = "listings" | "mediators" | "leads" | "users" | "reviews";

function AdminPage() {
  const { user, authLoading, setAuth } = useAuth();
  const [view, setView] = useState<AdminView>("listings");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [mediators, setMediators] = useState<ApiPartner[]>([]);
  const [loadingMediators, setLoadingMediators] = useState(false);
  const [leads, setLeads] = useState<ApiLeadDetail[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ApiReviewAdmin[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListingStatus | "All">("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewing, setViewing] = useState<Listing | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const [sortKey, setSortKey] = useState<"city" | "district" | "rent" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (authLoading) return;
    if (!user || !user.is_admin) return;

    let cancelled = false;

    async function loadAll() {
      try {
        setLoadingListings(true);
        const listingsData = await fetchAdminProperties();
        if (!cancelled) setListings(listingsData.map(toListing));
      } catch (err) {
        if (!cancelled) console.error("fetchAdminProperties failed:", err);
      } finally {
        if (!cancelled) setLoadingListings(false);
      }
    }

    void loadAll();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  // Load pending review count on mount for badge
  useEffect(() => {
    if (!user?.is_admin) return;
    fetchAllReviews("pending").then(r => setPendingReviewCount(r.length)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (view === "mediators" && mediators.length === 0 && !loadingMediators) {
      setLoadingMediators(true);
      fetchAdminMediators().then(m => setMediators(m)).catch(() => {}).finally(() => setLoadingMediators(false));
    }
    if (view === "leads" && leads.length === 0 && !loadingLeads) {
      setLoadingLeads(true);
      fetchAdminLeads().then(l => setLeads(l)).catch(err => console.error("fetchAdminLeads failed:", err)).finally(() => setLoadingLeads(false));
    }
    if (view === "reviews" && !loadingReviews) {
      setLoadingReviews(true);
      fetchAllReviews().then(r => { setReviews(r); setPendingReviewCount(r.filter(x => x.status === "pending").length); }).catch(() => {}).finally(() => setLoadingReviews(false));
    }
  }, [view]);

  function loadUsers() {
    setLoadingUsers(true);
    setUsersError(null);
    fetchAdminUsers()
      .then(u => setUsers(u))
      .catch(err => {
        console.error("fetchAdminUsers failed:", err);
        setUsersError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingUsers(false));
  }

  const stats = useMemo(
    () => ({
      total: listings.length,
      pending: listings.filter((l) => l.status === "Pending Approval").length,
      published: listings.filter((l) => l.status === "Published").length,
      rejected: listings.filter((l) => l.status === "Rejected").length,
      draft: listings.filter((l) => l.status === "Draft").length,
      suspended: listings.filter((l) => l.status === "Suspended").length,
    }),
    [listings],
  );

  function toggleSort(key: "city" | "district" | "rent") {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    setPage(0);
    const list = listings.filter((l) => {
      if (statusFilter !== "All" && l.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          l.title.toLowerCase().includes(q) ||
          l.city.toLowerCase().includes(q) ||
          l.district.toLowerCase().includes(q) ||
          l.owner.toLowerCase().includes(q) ||
          l.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
    if (!sortKey) return list;
    return [...list].sort((a, b) => {
      const valA = sortKey === "rent" ? a.rent : a[sortKey].toLowerCase();
      const valB = sortKey === "rent" ? b.rent : b[sortKey].toLowerCase();
      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [listings, query, statusFilter, sortKey, sortDir]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === paginated.length ? new Set() : new Set(paginated.map((l) => l.id)),
    );
  }
  async function setStatus(id: string, status: ListingStatus) {
    const numericId = Number(id);
    if (Number.isFinite(numericId)) {
      try {
        await patchProperty(numericId, { status });
        const fresh = await fetchAdminProperties();
        setListings(fresh.map(toListing));
      } catch (err) {
        alert(`Failed to update status: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    setListings((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
  }
  async function remove(id: string) {
    const numericId = Number(id);
    if (Number.isFinite(numericId)) {
      await removeProperty(numericId);
    }
    setListings((prev) => prev.filter((l) => l.id !== id));
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  }
  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(l: Listing) {
    setDetailOpen(false);
    setEditing(l);
    setFormOpen(true);
  }
  function openView(l: Listing) {
    setViewing(l);
    setDetailOpen(true);
  }
  async function bulkSetStatus(status: ListingStatus) {
    await Promise.all([...selected].map((id) => setStatus(id, status)));
    setSelected(new Set());
  }

  async function saveListing(data: Listing, newImageUrls: string[]) {
    const numericId = Number(data.id);
    const payload = {
      title: data.title,
      area: data.district,
      city: data.city,
      size_sq_m: data.areaSqm ?? 200,
      monthly_rent: data.rent,
      bedrooms: data.bedrooms ?? 3,
      bathrooms: data.bathrooms ?? 3,
      owner_name: data.owner,
      status: data.status,
      description: data.description ?? "",
      property_type: data.property_type || undefined,
      furnished: data.furnished || undefined,
    };

    try {
      const saved = await (Number.isFinite(numericId)
        ? patchProperty(numericId, payload)
        : createProperty({ ...payload, external_id: `MSK-${Date.now()}` }));

      // Sync images: add new URLs, delete removed ones
      const existingImages = saved.images ?? [];
      const existingUrls = new Set(existingImages.map(i => i.url));
      const newUrlSet = new Set(newImageUrls);

      await Promise.all([
        ...newImageUrls.filter(u => !existingUrls.has(u)).map(u => addPropertyImage(saved.id, u)),
        ...existingImages.filter(i => !newUrlSet.has(i.url)).map(i => deletePropertyImage(saved.id, i.id)),
      ]);

      const fresh = await fetchAdminProperties();
      setListings(fresh.map(toListing));
      setFormOpen(false);
    } catch (err) {
      alert(`Failed to save listing: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleVerifyMediator(id: number, is_verified: boolean) {
    const updated = await patchMediatorAdmin(id, { is_verified });
    setMediators(m => m.map(med => med.id === updated.id ? updated : med));
  }

  async function handleApprovePartner(id: number) {
    const updated = await approvePartner(id);
    setMediators(m => m.map(med => med.id === updated.id ? updated : med));
  }

  async function handleRejectPartner(id: number) {
    const updated = await rejectPartner(id);
    setMediators(m => m.map(med => med.id === updated.id ? updated : med));
  }

  async function handleAddPartner(payload: Parameters<typeof adminCreatePartner>[0]) {
    const created = await adminCreatePartner(payload);
    setMediators(m => [created, ...m]);
  }

  async function handleAddUser(payload: Parameters<typeof adminCreateUser>[0]) {
    const created = await adminCreateUser(payload);
    setUsers(u => [created, ...u]);
  }

  async function handleUpdateUser(id: number, payload: Parameters<typeof adminUpdateUser>[1]) {
    const updated = await adminUpdateUser(id, payload);
    setUsers(u => u.map(x => x.id === updated.id ? updated : x));
    return updated;
  }

  async function handleAddLead(payload: Parameters<typeof createLead>[0]) {
    const created = await createLead(payload);
    setLeads(l => [created, ...l]);
    return created;
  }

  function updateLead(updated: ApiLeadDetail) {
    setLeads(l => l.map(lead => lead.id === updated.id ? updated : lead));
  }

  async function handleApproveLead(id: number) {
    const updated = await adminApproveLead(id);
    updateLead(updated);
  }

  async function handleRejectLead(id: number) {
    const updated = await adminRejectLead(id);
    updateLead(updated);
  }

  async function handleApproveClosure(id: number) {
    const updated = await adminApproveClosure(id);
    updateLead(updated);
  }

  async function handleRejectClosure(id: number) {
    const updated = await adminRejectClosure(id);
    updateLead(updated);
  }

  async function handleForceCloseLead(id: number, status: "closed_won" | "closed_lost") {
    const updated = await adminForceCloseLead(id, status);
    updateLead(updated);
  }

  if (authLoading) return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  if (!user || !user.is_admin) return <AdminLoginGate onAuth={setAuth} nonAdminUser={user !== null} />;

  return (
    <div className="flex min-h-screen bg-surface">
      <AdminSidebar activeView={view} onViewChange={setView} pendingReviewCount={pendingReviewCount} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar onAiOpen={() => setAiPanelOpen(true)} />
        <AdminMobileNav activeView={view} onViewChange={setView} pendingReviewCount={pendingReviewCount} />

        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
          {/* Users view */}
          {view === "users" && (
            <UsersView
              users={users}
              loading={loadingUsers}
              error={usersError}
              onRetry={loadUsers}
              onAdd={handleAddUser}
              onUpdate={handleUpdateUser}
            />
          )}

          {/* Mediators view */}
          {view === "mediators" && (
            <MediatorsView mediators={mediators} loading={loadingMediators} onVerify={handleVerifyMediator} onApprove={handleApprovePartner} onReject={handleRejectPartner} onAdd={handleAddPartner} />
          )}

          {/* Leads view */}
          {view === "leads" && (
            <LeadsView
              leads={leads}
              loading={loadingLeads}
              onAddLead={handleAddLead}
              onApproveLead={handleApproveLead}
              onRejectLead={handleRejectLead}
              onApproveClosure={handleApproveClosure}
              onRejectClosure={handleRejectClosure}
              onForceClose={handleForceCloseLead}
            />
          )}

          {/* Reviews moderation view */}
          {view === "reviews" && (
            <ReviewsModerationView
              reviews={reviews}
              loading={loadingReviews}
              onModerate={async (id, status) => {
                const updated = await moderateReview(id, status);
                setReviews(prev => prev.map(r => r.id === id ? { ...r, ...updated } : r));
                setPendingReviewCount(c => status === "approved" ? Math.max(0, c - 1) : Math.max(0, c - 1));
              }}
            />
          )}

          {/* Listings view */}
          {view === "listings" && <>
          {/* Heading */}
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Listings
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                Listing Console
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Review submissions, publish properties and manage agent inventory.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/import"><Upload className="size-4" /> Import CSV</Link>
              </Button>
              <Button size="sm" onClick={openNew}>
                <Plus className="size-4" /> New listing
              </Button>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total listings"
              value={stats.total}
              delta="+12 this week"
              icon={<Home className="size-4" />}
              tone="primary"
            />
            <StatCard
              label="Pending approval"
              value={stats.pending}
              delta="Needs review"
              icon={<Clock className="size-4" />}
              tone="warning"
            />
            <StatCard
              label="Published"
              value={stats.published}
              delta="+4.2% MoM"
              icon={<CheckCircle2 className="size-4" />}
              tone="success"
            />
            <StatCard
              label="Rejected"
              value={stats.rejected}
              delta="-1 vs last week"
              icon={<ShieldAlert className="size-4" />}
              tone="destructive"
            />
          </div>

          {/* Table panel */}
          <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by title, owner, city or ID…"
                  className="ps-9"
                />
              </div>
              <StatusFilter value={statusFilter} onChange={setStatusFilter} stats={stats} />
              <Button variant="outline" size="sm">
                <Filter className="size-4" /> More filters
              </Button>
              {selected.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold">
                  {selected.size} selected
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void bulkSetStatus("Published")}>
                    Approve
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void bulkSetStatus("Suspended")}>
                    Suspend
                  </Button>
                </div>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2/60 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.size === paginated.length && paginated.length > 0}
                        onChange={toggleAll}
                        className="size-4 cursor-pointer rounded border-border"
                      />
                    </th>
                    <th className="w-52 px-4 py-3 text-start font-semibold">Property</th>
                    <th className="px-4 py-3 text-start font-semibold">
                      <button type="button" onClick={() => toggleSort("city")} className="inline-flex items-center gap-1 hover:text-foreground">
                        City <SortIcon active={sortKey === "city"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">
                      <button type="button" onClick={() => toggleSort("district")} className="inline-flex items-center gap-1 hover:text-foreground">
                        District <SortIcon active={sortKey === "district"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">
                      <button type="button" onClick={() => toggleSort("rent")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Rent / mo <SortIcon active={sortKey === "rent"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-start font-semibold">Status</th>
                    <th className="px-4 py-3 text-start font-semibold">Owner</th>
                    <th className="w-24 px-4 py-3 sticky right-0 bg-surface-2/60"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginated.map((l) => (
                    <ListingRow
                      key={l.id}
                      l={l}
                      checked={selected.has(l.id)}
                      onCheck={() => toggleSelect(l.id)}
                      onStatus={(s) => void setStatus(l.id, s)}
                      onView={() => openView(l)}
                      onEdit={() => openEdit(l)}
                      onRemove={() => void remove(l.id)}
                    />
                  ))}
                  {loadingListings && (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-sm text-muted-foreground">
                        Loading listings…
                      </td>
                    </tr>
                  )}
                  {!loadingListings && filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-sm text-muted-foreground">
                        No listings match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>
                Showing{" "}
                <span className="font-semibold text-foreground">
                  {filtered.length === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)}
                </span>{" "}
                of <span className="font-semibold text-foreground">{filtered.length}</span> listings
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </section>
          </>}
        </main>
      </div>

      {aiPanelOpen && (
        <AdminAIPanel
          onClose={() => setAiPanelOpen(false)}
          onCreateListing={(prefill) => { setAiPanelOpen(false); setEditing(prefill ?? null); setFormOpen(true); setView("listings"); }}
          onCreatePartner={() => { setAiPanelOpen(false); setView("mediators"); }}
          onCreateLead={() => { setAiPanelOpen(false); setView("leads"); }}
        />
      )}

      {detailOpen && viewing && (
        <ListingDetailDrawer
          listing={viewing}
          onClose={() => setDetailOpen(false)}
          onEdit={() => openEdit(viewing)}
          onStatus={(s) => { void setStatus(viewing.id, s); setViewing({ ...viewing, status: s }); }}
        />
      )}

      {formOpen && (
        <ListingFormDrawer
          listing={editing}
          onClose={() => setFormOpen(false)}
          onSave={saveListing}
        />
      )}
    </div>
  );
}

// ---------- Reviews moderation ----------

const STATUS_LABELS: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const STATUS_TONES: Record<string, string> = {
  pending:  "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

function ReviewStaticStars({ score }: { score: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={cn("size-3.5", i <= score ? "fill-warning text-warning" : "text-muted-foreground/20")} strokeWidth={1.5} />
      ))}
    </span>
  );
}

function ReviewsModerationView({
  reviews, loading, onModerate,
}: {
  reviews: ApiReviewAdmin[];
  loading: boolean;
  onModerate: (id: number, status: "approved" | "rejected") => Promise<void>;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [acting, setActing] = useState<number | null>(null);

  const visible = filter === "all" ? reviews : reviews.filter(r => r.status === filter);
  const pendingCount = reviews.filter(r => r.status === "pending").length;

  async function act(id: number, status: "approved" | "rejected") {
    setActing(id);
    try { await onModerate(id, status); }
    finally { setActing(null); }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Moderation</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Tenant Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">Approve or reject reviews before they appear on partner profiles.</p>
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            {f === "pending" && pendingCount > 0 ? `Pending (${pendingCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading reviews…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="size-8 text-success/60" />
          {filter === "pending" ? "No reviews pending — all caught up!" : "No reviews in this category."}
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(review => (
            <div key={review.id} className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {(review.reviewer_name ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{review.reviewer_name ?? "Anonymous"}</span>
                      <ReviewStaticStars score={review.rating} />
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONES[review.status])}>
                        {STATUS_LABELS[review.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      For: <span className="font-medium text-foreground">{review.mediator_agency_name ?? `Partner #${review.mediator_id}`}</span>
                      {" · "}{new Date(review.created_at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  </div>
                </div>

                {review.status === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={acting === review.id}
                      onClick={() => void act(review.id, "approved")}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-success/10 px-3 py-1.5 text-sm font-semibold text-success hover:bg-success/20 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="size-4" /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={acting === review.id}
                      onClick={() => void act(review.id, "rejected")}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-1.5 text-sm font-semibold text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                    >
                      <X className="size-4" /> Reject
                    </button>
                  </div>
                )}

                {review.status !== "pending" && (
                  <div className="flex gap-2 shrink-0">
                    {review.status === "approved" && (
                      <button
                        type="button"
                        disabled={acting === review.id}
                        onClick={() => void act(review.id, "rejected")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                      >
                        <X className="size-4" /> Revoke
                      </button>
                    )}
                    {review.status === "rejected" && (
                      <button
                        type="button"
                        disabled={acting === review.id}
                        onClick={() => void act(review.id, "approved")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="size-4" /> Re-approve
                      </button>
                    )}
                  </div>
                )}
              </div>

              {review.comment && (
                <blockquote className="mt-3 rounded-xl border-l-4 border-border pl-4 text-sm leading-relaxed text-muted-foreground italic">
                  "{review.comment}"
                </blockquote>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Sidebar ----------

function adminNavItems(pendingReviewCount: number): { view: AdminView; icon: React.ElementType; label: string; badge?: number }[] {
  return [
    { view: "listings",  icon: ListChecks, label: "Listings"  },
    { view: "mediators", icon: Briefcase,  label: "Partners"  },
    { view: "leads",     icon: Users,      label: "Leads"     },
    { view: "users",     icon: UserPlus,   label: "Users"     },
    { view: "reviews",   icon: Star,       label: "Reviews", badge: pendingReviewCount },
  ];
}

// Mobile nav dropdown — the sidebar is hidden below lg, so admins navigate with
// this hamburger drawer (mirrors the customer portal's mobile menu).
function AdminMobileNav({ activeView, onViewChange, pendingReviewCount }: { activeView: AdminView; onViewChange: (v: AdminView) => void; pendingReviewCount: number }) {
  const [open, setOpen] = useState(false);
  const items = adminNavItems(pendingReviewCount);
  const active = items.find((it) => it.view === activeView);

  return (
    <div className="relative border-b border-border bg-background lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex w-full items-center justify-between gap-3 px-4 py-3"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {active && <active.icon className="size-4" />}
          {active?.label ?? "Menu"}
          {!!active?.badge && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
              {active.badge}
            </span>
          )}
        </span>
        {open ? <X className="size-5 text-muted-foreground" /> : <Menu className="size-5 text-muted-foreground" />}
      </button>

      {open && (
        <nav className="absolute inset-x-0 top-full z-50 flex flex-col gap-0.5 border-b border-border bg-background p-3 shadow-lg">
          {items.map((it) => (
            <button
              key={it.view}
              type="button"
              onClick={() => { onViewChange(it.view); setOpen(false); }}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-medium transition-colors",
                activeView === it.view ? "bg-primary-soft text-accent-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              <it.icon className="size-4" />
              <span className="flex-1 text-start">{it.label}</span>
              {!!it.badge && (
                <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-destructive-foreground">
                  {it.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function AdminSidebar({ activeView, onViewChange, pendingReviewCount }: { activeView: AdminView; onViewChange: (v: AdminView) => void; pendingReviewCount: number }) {
  const { user, clearAuth } = useAuth();
  const navItems = adminNavItems(pendingReviewCount);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-border bg-background lg:flex">
      <div className="flex items-center gap-2 border-b border-border px-5 py-5">
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="size-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight">Maskan</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Admin console
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map((it) => (
          <button
            key={it.view}
            type="button"
            onClick={() => onViewChange(it.view)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-start transition-colors",
              activeView === it.view ? "bg-primary-soft text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface-2",
            )}
          >
            <it.icon className="size-4" />
            <span className="flex-1">{it.label}</span>
            {!!it.badge && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-destructive-foreground">
                {it.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t border-border p-3 space-y-1">
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
          <div className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
            {(user?.full_name ?? user?.email ?? "A").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 leading-tight flex-1">
            <div className="truncate text-sm font-semibold">{user?.full_name ?? "Admin"}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={clearAuth}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}

// ---------- Admin AI Panel ----------

type AiMsg = { role: "user" | "assistant"; content: string };

type AiAction = { type: "create_listing" | "create_partner" | "create_lead"; data?: Record<string, unknown> };

function parseAction(reply: string): AiAction | null {
  const m = reply.match(/<action>([\s\S]*?)<\/action>/);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()) as AiAction; } catch { return null; }
}

function stripAction(reply: string) {
  return reply.replace(/<action>[\s\S]*?<\/action>/g, "").trim();
}

const QUICK_PROMPTS = [
  "Summarise platform health",
  "Which leads are stuck in pending review?",
  "Show partner performance",
  "List properties with zero rent",
  "How many leads this month?",
  "Which districts have no Published listings?",
];

function AdminAIPanel({
  onClose,
  onCreateListing,
  onCreatePartner,
  onCreateLead,
}: {
  onClose: () => void;
  onCreateListing: (prefill?: Partial<Listing>) => void;
  onCreatePartner: () => void;
  onCreateLead: () => void;
}) {
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<AiAction | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: AiMsg = { role: "user", content: text };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setPendingAction(null);
    try {
      const { reply } = await adminAiChat(text, history);
      const action = parseAction(reply);
      const clean = stripAction(reply);
      setMessages(prev => [...prev, { role: "assistant", content: clean }]);
      if (action) setPendingAction(action);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleAction() {
    if (!pendingAction) return;
    if (pendingAction.type === "create_listing") {
      const d = pendingAction.data ?? {};
      const prefill: Partial<Listing> = {
        title: String(d.title ?? ""),
        city: String(d.city ?? "Riyadh"),
        district: String(d.area ?? d.district ?? ""),
        rent: Number(d.monthly_rent ?? d.rent ?? 0),
        owner: String(d.owner_name ?? d.owner ?? ""),
        bedrooms: Number(d.bedrooms ?? 3),
        bathrooms: Number(d.bathrooms ?? 2),
        areaSqm: Number(d.size_sq_m ?? d.area_sqm ?? 200),
        description: String(d.description ?? ""),
        status: "Draft",
        id: "",
        image: "",
        createdAt: new Date().toISOString(),
      };
      onCreateListing(prefill);
    } else if (pendingAction.type === "create_partner") {
      onCreatePartner();
    } else {
      onCreateLead();
    }
    setPendingAction(null);
  }

  const actionLabel: Record<string, string> = {
    create_listing: "Open New Listing form",
    create_partner: "Open Add Partner form",
    create_lead: "Open New Lead form",
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close" className="flex-1 bg-foreground/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-xl flex-col bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none">Admin AI Assistant</p>
              <p className="text-xs text-muted-foreground">Powered by Claude · Full platform access</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.length === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">Ask me anything about the platform, or pick a prompt:</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_PROMPTS.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void send(p)}
                    className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-left text-xs font-medium hover:bg-surface-2 hover:border-primary/30 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="mt-2 rounded-xl border border-border bg-surface-2/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">You can also ask me to create:</p>
                <p>• "Create a 3BR listing in Al Olaya, Riyadh at SAR 12,000/mo"</p>
                <p>• "Add a partner: Abdullah Real Estate, license RE-1234, phone +966 5X"</p>
                <p>• "New lead: Mohammed Al-Ghamdi looking for 2BR in Jeddah under SAR 8,000"</p>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"}`}>
                {m.role === "user" ? "A" : <Sparkles className="size-3.5" />}
              </div>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-surface-2 text-foreground rounded-tl-sm"}`}>
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2">
                <Sparkles className="size-3.5 text-muted-foreground animate-pulse" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
                Thinking…
              </div>
            </div>
          )}

          {pendingAction && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
              <p className="text-xs font-semibold text-primary">AI suggested action:</p>
              <button
                type="button"
                onClick={handleAction}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="size-4" /> {actionLabel[pendingAction.type]}
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border px-4 py-4">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              placeholder="Ask about data, or describe what to create…"
              disabled={loading}
              className="flex-1"
            />
            <Button onClick={() => void send(input)} disabled={loading || !input.trim()} size="icon">
              <Send className="size-4" />
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground text-center">Press Enter to send · AI has full read access to all platform data</p>
        </div>
      </aside>
    </div>
  );
}

// ---------- Topbar ----------

function AdminTopbar({ onAiOpen }: { onAiOpen: () => void }) {
  const { clearAuth } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onAiOpen}>
            <Sparkles className="size-4" /> AI assistant
          </Button>
        </div>
        {/* Sign out — sidebar (which holds the desktop sign-out) is hidden below lg */}
        <button
          type="button"
          onClick={clearAuth}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors lg:hidden"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </header>
  );
}

// ---------- Stat card ----------

function StatCard({
  label,
  value,
  delta,
  icon,
  tone,
}: {
  label: string;
  value: number;
  delta: string;
  icon: React.ReactNode;
  tone: "primary" | "warning" | "success" | "destructive";
}) {
  const toneMap = {
    primary: "bg-primary-soft text-accent-foreground",
    warning: "bg-warning/15 text-warning-foreground",
    success: "bg-success/15 text-success",
    destructive: "bg-destructive/12 text-destructive",
  } as const;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className={cn("grid size-8 place-items-center rounded-lg", toneMap[tone])}>
          {icon}
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{delta}</div>
    </div>
  );
}

// ---------- Status helpers ----------

function statusTone(s: ListingStatus) {
  switch (s) {
    case "Published":
      return { tone: "success" as const, icon: <CheckCircle2 className="size-3" /> };
    case "Pending Approval":
      return { tone: "warning" as const, icon: <Clock className="size-3" /> };
    case "Draft":
      return { tone: "neutral" as const, icon: <CircleDashed className="size-3" /> };
    case "Suspended":
      return { tone: "info" as const, icon: <ShieldAlert className="size-3" /> };
    case "Rejected":
      return { tone: "neutral" as const, icon: <X className="size-3" /> };
  }
}

function RoleBadge({ role }: { role: "admin" | "partner" | "customer" }) {
  const map = {
    admin:    { label: "Admin",    cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
    partner:  { label: "Partner",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    customer: { label: "Customer", cls: "bg-surface-2 text-muted-foreground" },
  };
  const { label, cls } = map[role] ?? map.customer;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={active ? "text-primary" : "text-muted-foreground/40"}>
      {!active || dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function StatusBadge({ s }: { s: ListingStatus }) {
  const { tone, icon } = statusTone(s);
  return (
    <Badge tone={tone} icon={icon}>
      {s}
    </Badge>
  );
}

// ---------- Status filter ----------

function StatusFilter({
  value,
  onChange,
  stats,
}: {
  value: ListingStatus | "All";
  onChange: (v: ListingStatus | "All") => void;
  stats: { total: number; pending: number; published: number; draft: number; suspended: number; rejected: number };
}) {
  const options: { label: ListingStatus | "All"; count: number }[] = [
    { label: "All", count: stats.total },
    { label: "Published", count: stats.published },
    { label: "Pending Approval", count: stats.pending },
    { label: "Draft", count: stats.draft },
    { label: "Suspended", count: stats.suspended },
    { label: "Rejected", count: stats.rejected },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(o.label)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
            value === o.label
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {o.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- Listing row ----------

function ListingRow({
  l,
  checked,
  onCheck,
  onStatus,
  onView,
  onEdit,
  onRemove,
}: {
  l: Listing;
  checked: boolean;
  onCheck: () => void;
  onStatus: (s: ListingStatus) => void;
  onView: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <tr className="group hover:bg-surface-2/40 cursor-pointer" onClick={onView}>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onCheck}
          className="size-4 cursor-pointer rounded border-border"
        />
      </td>
      <td className="w-52 max-w-[208px] px-4 py-3">
        <div className="flex items-center gap-2">
          <img
            src={l.image}
            alt=""
            className="size-8 shrink-0 rounded-md object-cover"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{l.title}</div>
            <div className="truncate text-[11px] font-mono text-muted-foreground">{l.id}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm">{l.city}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{l.district}</td>
      <td className="px-4 py-3 text-end text-sm font-semibold tabular-nums">
        SAR {formatSAR(l.rent)}
      </td>
      <td className="px-4 py-3">
        <StatusBadge s={l.status} />
      </td>
      <td className="px-4 py-3 text-sm">{l.owner}</td>
      <td className="relative sticky right-0 bg-card px-4 py-3 group-hover:bg-surface-2/40" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            aria-label="Edit listing"
            title="Edit listing"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            aria-label="Row actions"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
        {menuOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            />
            <div className="absolute end-2 z-40 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-popover py-1 text-sm shadow-elevated">
              <MenuItem
                icon={<Pencil className="size-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
              >
                Edit listing
              </MenuItem>
              <MenuItem
                icon={<CheckCircle2 className="size-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  onStatus("Published");
                }}
              >
                Approve & publish
              </MenuItem>
              <MenuItem
                icon={<ShieldAlert className="size-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  onStatus("Suspended");
                }}
              >
                Suspend
              </MenuItem>
              <MenuItem
                icon={<X className="size-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  onStatus("Rejected");
                }}
              >
                Reject
              </MenuItem>
              <div className="my-1 h-px bg-border" />
              <MenuItem
                icon={<Trash2 className="size-3.5" />}
                tone="destructive"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
              >
                Delete
              </MenuItem>
            </div>
          </>
        )}
      </td>
    </tr>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-surface-2",
        tone === "destructive" ? "text-destructive" : "text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------- Form drawer ----------

const AMENITIES = [
  "Parking",
  "Gym",
  "Swimming Pool",
  "Balcony",
  "Maid Room",
  "Central A/C",
  "Smart Home",
  "Garden",
  "Elevator",
  "Concierge",
];

// ---------- Listing detail drawer (read-only) ----------

function ListingDetailDrawer({
  listing,
  onClose,
  onEdit,
  onStatus,
}: {
  listing: Listing;
  onClose: () => void;
  onEdit: () => void;
  onStatus: (s: ListingStatus) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close" className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Property details</p>
            <h2 className="mt-1 truncate text-lg font-bold tracking-tight">{listing.title}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{listing.id}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Image */}
          <img src={listing.image} alt="" className="w-full h-48 rounded-xl object-cover" />

          {/* Status + quick actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge s={listing.status} />
            {listing.status !== "Published" && (
              <button type="button" onClick={() => onStatus("Published")} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                <CheckCircle2 className="size-3.5" /> Approve & Publish
              </button>
            )}
            {listing.status === "Published" && (
              <button type="button" onClick={() => onStatus("Suspended")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-2">
                <ShieldAlert className="size-3.5" /> Suspend
              </button>
            )}
          </div>

          {/* Core details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">City</p>
              <p className="mt-1 text-sm font-medium">{listing.city}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">District</p>
              <p className="mt-1 text-sm font-medium">{listing.district}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Monthly rent</p>
              <p className="mt-1 text-sm font-semibold">SAR {formatSAR(listing.rent)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Area</p>
              <p className="mt-1 text-sm font-medium">{listing.areaSqm ?? "—"} m²</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bedrooms</p>
              <p className="mt-1 text-sm font-medium">{listing.bedrooms ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bathrooms</p>
              <p className="mt-1 text-sm font-medium">{listing.bathrooms ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Owner</p>
              <p className="mt-1 text-sm font-medium">{listing.owner}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Listed on</p>
              <p className="mt-1 text-sm font-medium">{new Date(listing.createdAt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
          </div>

          {/* Description */}
          {listing.description && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description</p>
              <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{listing.description}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4">
          <button type="button" onClick={onEdit} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Pencil className="size-4" /> Edit property
          </button>
        </div>
      </aside>
    </div>
  );
}

function ListingFormDrawer({
  listing,
  onClose,
  onSave,
}: {
  listing: Listing | null;
  onClose: () => void;
  onSave: (l: Listing, imageUrls: string[]) => void | Promise<void>;
}) {
  const isEdit = !!listing;
  const [areas, setAreas] = useState<ApiAreaSummary[]>([]);
  const [form, setForm] = useState({
    id: listing?.id ?? `MSK-${Math.floor(1000 + Math.random() * 9000)}`,
    title: listing?.title ?? "",
    city: listing?.city ?? "Riyadh",
    district: listing?.district ?? "",
    rent: listing?.rent?.toString() ?? "",
    status: listing?.status ?? ("Draft" as ListingStatus),
    owner: listing?.owner ?? "",
    bedrooms: listing?.bedrooms ?? 3,
    bathrooms: listing?.bathrooms ?? 3,
    area: listing?.areaSqm ?? 200,
    description: listing?.description ?? "",
    property_type: listing?.property_type ?? "",
    furnished: listing?.furnished ?? "",
  });

  useEffect(() => {
    fetchAreas().then(setAreas).catch(() => {});
  }, []);
  const [amenities, setAmenities] = useState<Set<string>>(
    new Set(["Parking", "Central A/C"]),
  );
  const [media, setMedia] = useState<string[]>(
    listing?.images?.length
      ? listing.images.sort((a, b) => a.display_order - b.display_order).map(i => i.url)
      : listing?.image && !listing.image.startsWith("data:")
        ? [listing.image]
        : [],
  );
  const [urlInput, setUrlInput] = useState("");

  function toggleAmenity(a: string) {
    setAmenities((prev) => {
      const n = new Set(prev);
      n.has(a) ? n.delete(a) : n.add(a);
      return n;
    });
  }

  function submit(nextStatus: ListingStatus) {
    const rentNum = parseFloat(form.rent);
    if (!form.district) { alert("Please select a district."); return; }
    if (!rentNum || rentNum <= 0) { alert("Please enter a valid monthly rent."); return; }
    void onSave({
      id: form.id,
      title: form.title || "Untitled listing",
      city: form.city,
      district: form.district,
      rent: rentNum,
      status: nextStatus,
      owner: form.owner || "Unassigned",
      createdAt: listing?.createdAt ?? new Date().toISOString().slice(0, 10),
      image: media[0] ?? "",
      images: listing?.images ?? [],
      areaSqm: form.area,
      bedrooms: form.bedrooms,
      bathrooms: form.bathrooms,
      description: form.description,
      property_type: form.property_type || undefined,
      furnished: form.furnished || undefined,
    }, media);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close"
        className="flex-1 bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isEdit ? "Edit listing" : "New listing"}
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-tight">
              {isEdit ? form.title || "Untitled listing" : "Create property listing"}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{form.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Property details */}
          <Section icon={<FileText className="size-4" />} title="Property details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Listing title" className="sm:col-span-2">
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Skyline Residence — Al Olaya"
                />
              </Field>
              <Field label="City">
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field label="District">
                <select
                  value={areas.some(a => a.name === form.district) ? form.district : (form.district ? "__custom__" : "")}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setForm({ ...form, district: "" });
                    } else {
                      const sel = areas.find(a => a.name === e.target.value);
                      setForm({ ...form, district: e.target.value, city: sel?.city ?? form.city });
                    }
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Select district…</option>
                  {areas.map(a => (
                    <option key={`${a.name}|${a.city}`} value={a.name}>{a.name}, {a.city}</option>
                  ))}
                  <option value="__custom__">+ Enter new district…</option>
                </select>
                {(!areas.some(a => a.name === form.district)) && (
                  <Input
                    className="mt-2"
                    value={form.district}
                    onChange={(e) => setForm({ ...form, district: e.target.value })}
                    placeholder="District / neighbourhood name"
                  />
                )}
              </Field>
              <Field label="Monthly rent (SAR)">
                <Input
                  type="number"
                  value={form.rent}
                  onChange={(e) => setForm({ ...form, rent: e.target.value })}
                  placeholder="e.g. 8000"
                />
              </Field>
              <Field label="Owner / agent">
                <Input
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                  placeholder="e.g. Noura Al-Qahtani"
                />
              </Field>
              <Field label="Bedrooms">
                <div className="flex items-center gap-2">
                  <BedDouble className="size-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={form.bedrooms}
                    onChange={(e) => setForm({ ...form, bedrooms: Number(e.target.value) })}
                  />
                </div>
              </Field>
              <Field label="Bathrooms">
                <div className="flex items-center gap-2">
                  <Bath className="size-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={form.bathrooms}
                    onChange={(e) => setForm({ ...form, bathrooms: Number(e.target.value) })}
                  />
                </div>
              </Field>
              <Field label="Area (m²)">
                <Input
                  type="number"
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: Number(e.target.value) })}
                />
              </Field>
              <Field label="Property type">
                <select
                  value={form.property_type}
                  onChange={(e) => setForm({ ...form, property_type: e.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">— Any —</option>
                  <option>Apartment</option>
                  <option>Villa</option>
                  <option>Penthouse</option>
                  <option>Townhouse</option>
                </select>
              </Field>
              <Field label="Furnished">
                <select
                  value={form.furnished}
                  onChange={(e) => setForm({ ...form, furnished: e.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">— Any —</option>
                  <option>Furnished</option>
                  <option>Semi-furnished</option>
                  <option>Unfurnished</option>
                </select>
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Highlight key features, neighbourhood and proximity to schools…"
                />
              </Field>
            </div>
          </Section>

          {/* Photos */}
          <Section icon={<ImageIcon className="size-4" />} title="Photos">
            <div className="space-y-3">
              {/* Thumbnail grid */}
              {media.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {media.map((url, i) => (
                    <div key={i} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-surface-2">
                      <img src={url} alt="" className="size-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setMedia(m => m.filter((_, idx) => idx !== i))}
                        className="absolute end-1 top-1 grid size-6 place-items-center rounded-md bg-background/90 text-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                        aria-label="Remove image"
                      >
                        <X className="size-3.5" />
                      </button>
                      {i === 0 && (
                        <span className="absolute bottom-1 start-1 rounded bg-foreground/85 px-1.5 py-0.5 text-[10px] font-bold uppercase text-background">Cover</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* URL input */}
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const trimmed = urlInput.trim();
                      if (trimmed && !media.includes(trimmed)) setMedia(m => [...m, trimmed]);
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
                    const trimmed = urlInput.trim();
                    if (trimmed && !media.includes(trimmed)) setMedia(m => [...m, trimmed]);
                    setUrlInput("");
                  }}
                  disabled={!urlInput.trim()}
                >
                  <Plus className="size-4" /> Add
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Paste a direct image URL (from Cloudinary, Unsplash, etc.). First photo is the cover.</p>
            </div>
          </Section>

          {/* Amenities */}
          <Section icon={<MapPin className="size-4" />} title="Amenities">
            <div className="flex flex-wrap gap-2">
              {AMENITIES.map((a) => {
                const on = amenities.has(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleAmenity(a)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {on && <CheckCircle2 className="size-3.5" />}
                    {a}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Publish controls */}
          <Section icon={<Sparkles className="size-4" />} title="Publish controls">
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-muted-foreground">
                  Listing status
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["Draft", "Pending Approval", "Published", "Suspended"] as ListingStatus[]).map(
                    (s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForm({ ...form, status: s })}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                          form.status === s
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {s}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <ToggleRow
                label="Feature on homepage"
                description="Show this property in the curated 'Best matches' rail."
              />
              <ToggleRow
                label="Allow AI advisor recommendations"
                description="Let Maskan AI suggest this listing to matching renters."
                defaultOn
              />
              <ToggleRow
                label="Enable instant booking"
                description="Renters can request viewings without manual approval."
              />
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface/50 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => submit("Draft")}>
              Save draft
            </Button>
            {!isEdit && (
              <Button variant="outline" onClick={() => submit("Pending Approval")}>
                Submit for review
              </Button>
            )}
            {isEdit && (
              <Button variant="outline" onClick={() => submit(form.status)}>
                Save changes
              </Button>
            )}
            <Button onClick={() => submit("Published")}>
              <CheckCircle2 className="size-4" />
              Approve & Publish
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ---------- Users view ----------

function UsersView({
  users,
  loading,
  error,
  onRetry,
  onAdd,
  onUpdate,
}: {
  users: ApiUser[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAdd: (p: Parameters<typeof adminCreateUser>[0]) => Promise<void>;
  onUpdate: (id: number, p: Parameters<typeof adminUpdateUser>[1]) => Promise<ApiUser>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [detailUser, setDetailUser] = useState<ApiUser | null>(null);
  const [editUser, setEditUser] = useState<ApiUser | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (users.length === 0 && !loading && !error) {
      onRetry();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = users.filter(u => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (u.email.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q) || (u.phone ?? "").includes(q));
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Portal accounts</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage customer accounts, enable or disable access.</p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="shrink-0">
          <UserPlus className="size-4" /> Add User
        </Button>
      </div>

      {/* Search */}
      <div className="mb-4 relative max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, email or phone…" className="ps-9" />
      </div>

      {formOpen && (
        <UserFormDrawer
          onClose={() => setFormOpen(false)}
          onSave={async p => { await onAdd(p); setFormOpen(false); }}
        />
      )}
      {detailUser && (
        <UserDetailDrawer
          user={detailUser}
          onClose={() => setDetailUser(null)}
          onEdit={() => { setEditUser(detailUser); setDetailUser(null); }}
          onToggle={async () => {
            const updated = await onUpdate(detailUser.id, { is_active: !detailUser.is_active });
            setDetailUser(updated);
          }}
        />
      )}
      {editUser && (
        <UserEditDrawer
          user={editUser}
          onClose={() => setEditUser(null)}
          onSave={async p => { await onUpdate(editUser.id, p); setEditUser(null); }}
        />
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">User</th>
                <th className="px-4 py-3 text-start font-semibold">Email</th>
                <th className="px-4 py-3 text-start font-semibold">Role</th>
                <th className="px-4 py-3 text-start font-semibold">Phone</th>
                <th className="px-4 py-3 text-start font-semibold">Status</th>
                <th className="px-4 py-3 text-start font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">Loading users…</td></tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <p className="text-sm text-destructive mb-3">Failed to load users: {error}</p>
                    <button type="button" onClick={onRetry} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2">Retry</button>
                  </td>
                </tr>
              )}
              {!loading && !error && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">No users found.</td></tr>
              )}
              {filtered.map(u => (
                <tr
                  key={u.id}
                  className="group cursor-pointer hover:bg-surface-2/40"
                  onClick={() => setDetailUser(u)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted-foreground">
                        {(u.full_name ?? u.email).charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium">{u.full_name ?? <span className="text-muted-foreground italic">No name</span>}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    {u.is_active
                      ? <Badge tone="success">Active</Badge>
                      : <Badge tone="destructive">Disabled</Badge>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UserDetailDrawer({
  user,
  onClose,
  onEdit,
  onToggle,
}: {
  user: ApiUser;
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => Promise<void>;
}) {
  const [toggling, setToggling] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close" className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">User account</p>
            <h2 className="mt-1 text-lg font-bold">{user.full_name ?? "No name"}</h2>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="grid size-14 place-items-center rounded-full bg-surface-2 text-xl font-bold text-muted-foreground">
              {(user.full_name ?? user.email).charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {user.is_active
                  ? <Badge tone="success">Active</Badge>
                  : <Badge tone="destructive">Disabled</Badge>}
                <RoleBadge role={user.role} />
              </div>
              <p className="text-xs text-muted-foreground">User #{user.id}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Full name</p>
              <p className="mt-1 text-sm">{user.full_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phone</p>
              <p className="mt-1 text-sm">{user.phone ?? "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</p>
              <p className="mt-1 text-sm">{user.email}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Joined</p>
              <p className="mt-1 text-sm">{new Date(user.created_at).toLocaleDateString("en-SA", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            disabled={toggling}
            onClick={async () => { setToggling(true); try { await onToggle(); } finally { setToggling(false); } }}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors",
              user.is_active
                ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                : "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10",
            )}
          >
            {user.is_active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {toggling ? "Updating…" : user.is_active ? "Disable user" : "Enable user"}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Pencil className="size-4" /> Edit user
          </button>
        </div>
      </aside>
    </div>
  );
}

function UserEditDrawer({
  user,
  onClose,
  onSave,
}: {
  user: ApiUser;
  onClose: () => void;
  onSave: (p: Parameters<typeof adminUpdateUser>[1]) => Promise<void>;
}) {
  const [form, setForm] = useState({
    full_name: user.full_name ?? "",
    email: user.email,
    phone: user.phone ?? "",
    password: "",
    role: user.role,
  });
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  async function submit() {
    if (!form.email.trim()) { alert("Email is required."); return; }
    setSaving(true);
    try {
      const payload: Parameters<typeof adminUpdateUser>[1] = {
        full_name: form.full_name.trim() || undefined,
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        role: form.role,
      };
      if (form.password.trim()) payload.password = form.password;
      await onSave(payload);
    } catch (err) {
      alert(`Failed to update user: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const ROLES: { value: "admin" | "partner" | "customer"; label: string; description: string }[] = [
    { value: "customer", label: "Customer", description: "Regular portal user" },
    { value: "partner",  label: "Partner",  description: "Realtor / mediator" },
    { value: "admin",    label: "Admin",    description: "Full dashboard access" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close" className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Edit account</p>
            <h2 className="mt-1 text-lg font-bold">{user.full_name ?? user.email}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          <Field label="Role">
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, role: r.value }))}
                  className={cn(
                    "flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors",
                    form.role === r.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border/80 hover:bg-surface-2/50",
                  )}
                >
                  <RoleBadge role={r.value} />
                  <span className="mt-1.5 text-[11px] text-muted-foreground leading-tight">{r.description}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Full name">
            <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Mohammed Al-Ghamdi" />
          </Field>
          <Field label="Email *">
            <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+966 5X XXX XXXX" />
          </Field>
          <Field label="New password">
            <div className="relative">
              <Input
                type={showPwd ? "text" : "password"}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Leave blank to keep current password"
                className="pr-10"
              />
              <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function UserFormDrawer({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (p: Parameters<typeof adminCreateUser>[0]) => Promise<void>;
}) {
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "", role: "customer" });
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  async function submit() {
    if (!form.email.trim()) { alert("Email is required."); return; }
    if (!form.password.trim()) { alert("Password is required."); return; }
    setSaving(true);
    try {
      await onSave({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim() || undefined,
        phone: form.phone.trim() || undefined,
        role: form.role,
      });
    } catch (err) {
      alert(`Failed to create user: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const ROLES = [
    { value: "customer", label: "Customer", description: "Regular portal user — can search and submit leads" },
    { value: "partner",  label: "Partner",  description: "Realtor / mediator — receives and manages leads" },
    { value: "admin",    label: "Admin",    description: "Full admin access to this dashboard" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close" className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Portal accounts</p>
            <h2 className="mt-1 text-lg font-bold">Add new user</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {/* Role picker */}
          <Field label="Role *">
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, role: r.value }))}
                  className={cn(
                    "flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors",
                    form.role === r.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-border/80 hover:bg-surface-2/50",
                  )}
                >
                  <RoleBadge role={r.value as "admin" | "partner" | "customer"} />
                  <span className="mt-1.5 text-[11px] text-muted-foreground leading-tight">{r.description}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Full name">
            <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Mohammed Al-Ghamdi" />
          </Field>
          <Field label="Email *">
            <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+966 5X XXX XXXX" />
          </Field>
          <Field label="Password *">
            <div className="relative">
              <Input
                type={showPwd ? "text" : "password"}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Minimum 8 characters"
                className="pr-10"
              />
              <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <UserPlus className="size-4" />
            {saving ? "Creating…" : `Add ${form.role.charAt(0).toUpperCase() + form.role.slice(1)}`}
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ---------- Partner form drawer ----------

function PartnerFormDrawer({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (payload: Parameters<typeof adminCreatePartner>[0]) => Promise<void>;
}) {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    agency_name: "",
    license_number: "",
    phone: "",
    bio: "",
    profile_image_url: "",
    is_verified: true,
    subscription_status: "active",
  });
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [imgPreview, setImgPreview] = useState<string | null>(null);

  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImgPreview(dataUrl);
      setForm(f => ({ ...f, profile_image_url: dataUrl }));
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!form.email.trim()) { alert("Email is required."); return; }
    if (!form.password.trim()) { alert("Password is required."); return; }
    if (!form.license_number.trim()) { alert("License number is required."); return; }
    if (!form.phone.trim()) { alert("Phone is required."); return; }
    setSaving(true);
    try {
      await onSave({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim() || undefined,
        agency_name: form.agency_name.trim() || undefined,
        license_number: form.license_number.trim(),
        phone: form.phone.trim(),
        bio: form.bio.trim() || undefined,
        profile_image_url: form.profile_image_url.trim() || undefined,
        is_verified: form.is_verified,
        subscription_status: form.subscription_status,
      });
    } catch (err) {
      alert(`Failed to add partner: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close" className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Partner platform</p>
            <h2 className="mt-1 text-lg font-bold tracking-tight">Add new partner</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Creates a login account and partner profile in one step.</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <Section icon={<Users className="size-4" />} title="Account details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" className="sm:col-span-2">
                <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Abdullah Al-Rashid" />
              </Field>
              <Field label="Email *" className="sm:col-span-2">
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="partner@example.com" />
              </Field>
              <Field label="Password *" className="sm:col-span-2">
                <div className="relative">
                  <Input
                    type={showPwd ? "text" : "password"}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="Minimum 8 characters"
                    className="pr-10"
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            </div>
          </Section>

          <Section icon={<Briefcase className="size-4" />} title="Partner profile">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Profile photo upload */}
              <Field label="Profile photo" className="sm:col-span-2">
                <div className="flex items-center gap-4">
                  {/* Preview */}
                  <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-surface">
                    {imgPreview ? (
                      <img src={imgPreview} alt="Preview" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-muted-foreground">No photo</div>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={handleImagePick}
                      />
                      Upload photo
                    </label>
                    <p className="text-[11px] text-muted-foreground">Or paste a URL below</p>
                    <Input
                      value={form.profile_image_url.startsWith("data:") ? "" : form.profile_image_url}
                      onChange={e => {
                        setForm(f => ({ ...f, profile_image_url: e.target.value }));
                        setImgPreview(e.target.value || null);
                      }}
                      placeholder="https://example.com/photo.jpg"
                      className="text-xs"
                    />
                  </div>
                </div>
              </Field>

              <Field label="Agency / company name" className="sm:col-span-2">
                <Input value={form.agency_name} onChange={e => setForm({ ...form, agency_name: e.target.value })} placeholder="Al-Rashid Real Estate" />
              </Field>
              <Field label="License number *">
                <Input value={form.license_number} onChange={e => setForm({ ...form, license_number: e.target.value })} placeholder="RE-12345" />
              </Field>
              <Field label="Phone *">
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+966 5X XXX XXXX" />
              </Field>
              <Field label="Bio" className="sm:col-span-2">
                <Textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} placeholder="Brief description of the partner's expertise…" rows={3} />
              </Field>
            </div>
          </Section>

          <Section icon={<ShieldCheck className="size-4" />} title="Status">
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_verified}
                  onChange={e => setForm({ ...form, is_verified: e.target.checked })}
                  className="size-4 rounded border-border cursor-pointer"
                />
                <span className="text-sm font-medium">Mark as verified</span>
              </label>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Subscription</p>
                <div className="flex gap-2 flex-wrap">
                  {["active", "pending_payment", "expired"].map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm({ ...form, subscription_status: s })}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        form.subscription_status === s
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface/50 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <UserPlus className="size-4" />
            {saving ? "Adding…" : "Add Partner"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ---------- Mediators view ----------

function MediatorsView({
  mediators,
  loading,
  onVerify,
  onApprove,
  onReject,
  onAdd,
}: {
  mediators: ApiPartner[];
  loading: boolean;
  onVerify: (id: number, verified: boolean) => void;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
  onAdd: (payload: Parameters<typeof adminCreatePartner>[0]) => Promise<void>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function run(id: number, fn: (id: number) => Promise<void>) {
    setBusyId(id);
    try { await fn(id); } finally { setBusyId(null); }
  }

  const pendingCount = mediators.filter(m => m.approval_status === "pending").length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Partner platform</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Partners</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approve or reject partner accounts, verify profiles and manage subscriptions.
            {pendingCount > 0 && (
              <span className="ml-1 font-semibold text-warning">{pendingCount} pending approval.</span>
            )}
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="shrink-0">
          <UserPlus className="size-4" /> Add Partner
        </Button>
      </div>

      {formOpen && (
        <PartnerFormDrawer
          onClose={() => setFormOpen(false)}
          onSave={async (payload) => { await onAdd(payload); setFormOpen(false); }}
        />
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">Partner</th>
                <th className="px-4 py-3 text-start font-semibold">License</th>
                <th className="px-4 py-3 text-start font-semibold">Approval</th>
                <th className="px-4 py-3 text-start font-semibold">Subscription</th>
                <th className="px-4 py-3 text-start font-semibold">Areas</th>
                <th className="px-4 py-3 text-end font-semibold">Leads</th>
                <th className="px-4 py-3 text-start font-semibold">Verified</th>
                <th className="w-44 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-muted-foreground">Loading partners…</td></tr>
              )}
              {!loading && mediators.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-muted-foreground">No partners registered yet.</td></tr>
              )}
              {mediators.map(m => (
                <tr key={m.id} className="hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{m.agency_name ?? `Partner #${m.id}`}</div>
                    <div className="text-xs text-muted-foreground">{m.phone}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.license_number}</td>
                  <td className="px-4 py-3">
                    <Badge tone={m.approval_status === "approved" ? "success" : m.approval_status === "rejected" ? "destructive" : "warning"}>
                      {m.approval_status === "approved" ? "Approved" : m.approval_status === "rejected" ? "Rejected" : "Pending"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={m.subscription_status === "active" ? "success" : "warning"}>
                      {m.subscription_status}
                    </Badge>
                    {m.subscription_expires_at && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        exp {new Date(m.subscription_expires_at).toLocaleDateString("en-SA")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(m.areas ?? []).slice(0, 3).map(a => (
                        <span key={a.id} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium">{a.area_name}</span>
                      ))}
                      {(m.areas ?? []).length > 3 && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">+{(m.areas ?? []).length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-end font-semibold tabular-nums">{m.total_leads_accepted}</td>
                  <td className="px-4 py-3">
                    {m.is_verified ? (
                      <Badge tone="success" icon={<ShieldCheck className="size-3" />}>Verified</Badge>
                    ) : (
                      <Badge tone="neutral">Unverified</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.approval_status !== "approved" && (
                        <Button
                          size="sm"
                          variant="default"
                          className="text-xs"
                          disabled={busyId === m.id}
                          onClick={() => void run(m.id, onApprove)}
                        >
                          <CheckCircle2 className="size-3.5" /> Approve
                        </Button>
                      )}
                      {m.approval_status !== "rejected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs text-destructive hover:bg-destructive/10"
                          disabled={busyId === m.id}
                          onClick={() => void run(m.id, onReject)}
                        >
                          <X className="size-3.5" /> Reject
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={m.is_verified ? "outline" : "default"}
                        className="text-xs"
                        onClick={() => onVerify(m.id, !m.is_verified)}
                      >
                        {m.is_verified ? "Unverify" : "Verify"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- New lead drawer (admin creates on behalf of customer) ----------

function NewLeadDrawer({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (payload: Parameters<typeof createLead>[0]) => Promise<void>;
}) {
  const [areas, setAreas] = useState<ApiAreaSummary[]>([]);
  const [form, setForm] = useState({
    city: "Riyadh",
    area_name: "",
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    min_budget: "",
    max_budget: "",
    bedrooms_needed: "",
    move_in_date: "",
    requirements_note: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAreas().then(setAreas).catch(() => {}); }, []);

  const districtOptions = areas.filter(a => !form.city || a.city === form.city);

  async function submit() {
    if (!form.area_name.trim()) { alert("District / area is required."); return; }
    if (!form.customer_name.trim()) { alert("Customer name is required."); return; }
    if (!form.customer_phone.trim()) { alert("Customer phone is required."); return; }
    if (!form.customer_email.trim()) { alert("Customer email is required."); return; }
    setSaving(true);
    try {
      await onSave({
        area_name: form.area_name.trim(),
        city: form.city,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        customer_email: form.customer_email.trim(),
        min_budget: form.min_budget ? Number(form.min_budget) : undefined,
        max_budget: form.max_budget ? Number(form.max_budget) : undefined,
        bedrooms_needed: form.bedrooms_needed ? Number(form.bedrooms_needed) : undefined,
        move_in_date: form.move_in_date || undefined,
        requirements_note: form.requirements_note || undefined,
      });
    } catch (err) {
      alert(`Failed to create lead: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Close" className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Partner platform</p>
            <h2 className="mt-1 text-lg font-bold tracking-tight">New lead</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Lead enters pending review and follows the normal assignment flow.</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <Section icon={<MapPin className="size-4" />} title="Location">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="City">
                <select
                  value={form.city}
                  onChange={e => setForm({ ...form, city: e.target.value, area_name: "" })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {cities.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="District / area *">
                <select
                  value={form.area_name}
                  onChange={e => setForm({ ...form, area_name: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select district…</option>
                  {districtOptions.map(a => <option key={`${a.name}|${a.city}`} value={a.name}>{a.name}</option>)}
                </select>
                {!districtOptions.length && (
                  <Input className="mt-2" value={form.area_name} onChange={e => setForm({ ...form, area_name: e.target.value })} placeholder="Type district name…" />
                )}
              </Field>
            </div>
          </Section>

          <Section icon={<Users className="size-4" />} title="Customer details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name *" className="sm:col-span-2">
                <Input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} placeholder="Mohammed Al-Ghamdi" />
              </Field>
              <Field label="Phone *">
                <Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} placeholder="+966 5X XXX XXXX" />
              </Field>
              <Field label="Email *">
                <Input type="email" value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })} placeholder="customer@example.com" />
              </Field>
            </div>
          </Section>

          <Section icon={<Home className="size-4" />} title="Requirements">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Min budget (SAR/mo)">
                <Input type="number" value={form.min_budget} onChange={e => setForm({ ...form, min_budget: e.target.value })} placeholder="5000" />
              </Field>
              <Field label="Max budget (SAR/mo)">
                <Input type="number" value={form.max_budget} onChange={e => setForm({ ...form, max_budget: e.target.value })} placeholder="15000" />
              </Field>
              <Field label="Bedrooms needed">
                <Input type="number" min={0} max={10} value={form.bedrooms_needed} onChange={e => setForm({ ...form, bedrooms_needed: e.target.value })} placeholder="3" />
              </Field>
              <Field label="Move-in date">
                <Input type="date" value={form.move_in_date} onChange={e => setForm({ ...form, move_in_date: e.target.value })} />
              </Field>
              <Field label="Notes / requirements" className="sm:col-span-2">
                <Textarea value={form.requirements_note} onChange={e => setForm({ ...form, requirements_note: e.target.value })} placeholder="Near school, ground floor preferred, pet-friendly…" rows={3} />
              </Field>
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface/50 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <Plus className="size-4" />
            {saving ? "Creating…" : "Create Lead"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ---------- Leads view ----------

function leadStatusTone(s: string): "info" | "warning" | "success" | "neutral" {
  if (s === "pending_review") return "warning";
  if (s === "open") return "info";
  if (s === "in_progress") return "warning";
  if (s === "pending_closure") return "warning";
  if (s === "closed_won") return "success";
  return "neutral";
}

function leadStatusLabel(s: string) {
  return s.replace(/_/g, " ");
}

function LeadsView({
  leads,
  loading,
  onAddLead,
  onApproveLead,
  onRejectLead,
  onApproveClosure,
  onRejectClosure,
  onForceClose,
}: {
  leads: ApiLeadDetail[];
  loading: boolean;
  onAddLead: (payload: Parameters<typeof createLead>[0]) => Promise<ApiLeadDetail>;
  onApproveLead: (id: number) => Promise<void>;
  onRejectLead: (id: number) => Promise<void>;
  onApproveClosure: (id: number) => Promise<void>;
  onRejectClosure: (id: number) => Promise<void>;
  onForceClose: (id: number, status: "closed_won" | "closed_lost") => Promise<void>;
}) {
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [confirmingClose, setConfirmingClose] = useState<number | null>(null);
  const [expandedConvos, setExpandedConvos] = useState<Set<number>>(new Set());
  const [convoMessages, setConvoMessages] = useState<Record<number, ApiLeadMessage[]>>({});
  const [adminDraft, setAdminDraft] = useState<Record<number, string>>({});
  const [sendingMsg, setSendingMsg] = useState<number | null>(null);

  async function act(id: number, fn: () => Promise<void>) {
    setActingId(id);
    try { await fn(); } finally { setActingId(null); }
  }

  async function toggleConvo(leadId: number) {
    const next = new Set(expandedConvos);
    if (next.has(leadId)) {
      next.delete(leadId);
    } else {
      next.add(leadId);
      if (!convoMessages[leadId]) {
        const msgs = await adminFetchMessages(leadId).catch(() => []);
        setConvoMessages(m => ({ ...m, [leadId]: msgs }));
      }
    }
    setExpandedConvos(next);
  }

  async function handleSendMessage(leadId: number) {
    const content = (adminDraft[leadId] ?? "").trim();
    if (!content) return;
    setSendingMsg(leadId);
    try {
      const msg = await adminSendMessage(leadId, content);
      setConvoMessages(m => ({ ...m, [leadId]: [...(m[leadId] ?? []), msg] }));
      setAdminDraft(d => ({ ...d, [leadId]: "" }));
    } catch {
      // swallow
    } finally {
      setSendingMsg(null);
    }
  }

  const pendingReview  = leads.filter(l => l.status === "pending_review");
  const pendingClosure = leads.filter(l => l.status === "pending_closure");
  const otherLeads     = leads;
  const isClosed = (s: string) => s === "closed_won" || s === "closed_lost" || s === "rejected";

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Partner platform</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Customer Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review submissions and closure requests before they take effect.</p>
        </div>
        <Button onClick={() => setNewLeadOpen(true)} className="shrink-0">
          <Plus className="size-4" /> New Lead
        </Button>
      </div>

      {newLeadOpen && (
        <NewLeadDrawer
          onClose={() => setNewLeadOpen(false)}
          onSave={async (payload) => { await onAddLead(payload); setNewLeadOpen(false); }}
        />
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* ── Gate 1: Pending review ── */}
      {!loading && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Pending review</h2>
            {pendingReview.length > 0 && (
              <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-bold text-warning">
                {pendingReview.length}
              </span>
            )}
          </div>
          {pendingReview.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
              No leads awaiting review.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingReview.map(lead => (
                <div key={lead.id} className="rounded-2xl border border-warning/30 bg-warning/5 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-xs font-mono text-muted-foreground">Lead #{lead.id}</div>
                      <div className="font-semibold">{lead.customer_name}</div>
                      <div className="text-sm text-muted-foreground">{lead.customer_phone} · {lead.customer_email}</div>
                      <div className="text-sm font-medium">{lead.area_name}, {lead.city}</div>
                      {lead.max_budget && <div className="text-sm text-muted-foreground">Up to SAR {formatSAR(lead.max_budget)}/mo{lead.bedrooms_needed ? ` · ${lead.bedrooms_needed} BR` : ""}</div>}
                      {lead.requirements_note && <div className="text-sm text-foreground line-clamp-2 mt-1">"{lead.requirements_note}"</div>}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString("en-SA")}</span>
                  </div>

                  {/* Conversation thread */}
                  <div>
                    <button
                      type="button"
                      onClick={() => toggleConvo(lead.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <MessageSquare className="size-3.5" />
                      {expandedConvos.has(lead.id) ? "Hide conversation" : "Ask customer a question"}
                    </button>

                    {expandedConvos.has(lead.id) && (
                      <div className="mt-3 space-y-2">
                        {/* Message thread */}
                        {(convoMessages[lead.id] ?? []).length === 0 && (
                          <p className="text-xs text-muted-foreground italic">No messages yet. Type below to ask the customer a question.</p>
                        )}
                        {(convoMessages[lead.id] ?? []).map(msg => (
                          <div key={msg.id} className={`flex ${msg.sender_role === "admin" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-sm rounded-xl px-3 py-2 text-sm ${msg.sender_role === "admin" ? "bg-primary text-primary-foreground" : "bg-background border border-border"}`}>
                              {msg.sender_role !== "admin" && (
                                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Customer</div>
                              )}
                              {msg.sender_role === "admin" && (
                                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/70">You (Admin)</div>
                              )}
                              <div>{msg.content}</div>
                              <div className={`mt-0.5 text-[10px] ${msg.sender_role === "admin" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                                {new Date(msg.created_at).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            </div>
                          </div>
                        ))}
                        {/* Input */}
                        <div className="flex gap-2 pt-1">
                          <textarea
                            value={adminDraft[lead.id] ?? ""}
                            onChange={e => setAdminDraft(d => ({ ...d, [lead.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(lead.id); } }}
                            placeholder="Type your question to the customer…"
                            rows={2}
                            className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleSendMessage(lead.id)}
                            disabled={sendingMsg === lead.id || !(adminDraft[lead.id] ?? "").trim()}
                            className="self-end"
                          >
                            <Send className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-success hover:bg-success/90"
                      disabled={actingId === lead.id}
                      onClick={() => act(lead.id, () => onApproveLead(lead.id))}
                    >
                      <CheckCircle2 className="size-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/5"
                      disabled={actingId === lead.id}
                      onClick={() => act(lead.id, () => onRejectLead(lead.id))}
                    >
                      <X className="size-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Gate 2: Pending closure ── */}
      {!loading && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Closure requests</h2>
            {pendingClosure.length > 0 && (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary">
                {pendingClosure.length}
              </span>
            )}
          </div>
          {pendingClosure.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
              No closure requests pending.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingClosure.map(lead => {
                const accepted = lead.assignments.find(a => a.status === "accepted");
                return (
                  <div key={lead.id} className="rounded-2xl border border-border bg-card p-5 space-y-3 shadow-card">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-xs font-mono text-muted-foreground">Lead #{lead.id} · {lead.area_name}, {lead.city}</div>
                        <div className="font-semibold">{lead.customer_name}</div>
                        <div className="text-sm text-muted-foreground">{lead.customer_phone}</div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {lead.closure_requested_at ? new Date(lead.closure_requested_at).toLocaleDateString("en-SA") : ""}
                      </span>
                    </div>
                    <div className="rounded-lg bg-surface p-3 space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Partner</span>
                        <span className="font-semibold">{accepted?.mediator_agency_name ?? `Partner #${accepted?.mediator_id}`}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Outcome</span>
                        <Badge tone={lead.closure_outcome === "closed_won" ? "success" : "neutral"}>
                          {lead.closure_outcome === "closed_won" ? "Found a property" : "No match found"}
                        </Badge>
                      </div>
                      {lead.closure_note && (
                        <div className="pt-1 text-foreground">"{lead.closure_note}"</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-success hover:bg-success/90"
                        disabled={actingId === lead.id}
                        onClick={() => act(lead.id, () => onApproveClosure(lead.id))}
                      >
                        <CheckCircle2 className="size-3.5" /> Approve closure
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/30 hover:bg-destructive/5"
                        disabled={actingId === lead.id}
                        onClick={() => act(lead.id, () => onRejectClosure(lead.id))}
                      >
                        <X className="size-3.5" /> Reject — keep open
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── All leads table ── */}
      <section className="space-y-3">
        <h2 className="font-semibold">All leads</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/60 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">ID</th>
                  <th className="px-4 py-3 text-start font-semibold">Customer</th>
                  <th className="px-4 py-3 text-start font-semibold">Area</th>
                  <th className="px-4 py-3 text-start font-semibold">Budget/mo</th>
                  <th className="px-4 py-3 text-start font-semibold">Status</th>
                  <th className="px-4 py-3 text-start font-semibold">Accepted by</th>
                  <th className="px-4 py-3 text-start font-semibold">Created</th>
                  <th className="px-4 py-3 text-start font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!loading && otherLeads.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">No leads yet.</td></tr>
                )}
                {otherLeads.map(lead => {
                  const accepted = lead.assignments.find(a => a.status === "accepted");
                  const isConfirming = confirmingClose === lead.id;
                  const isActing = actingId === lead.id;
                  const closed = isClosed(lead.status);
                  return (
                    <tr key={lead.id} className="hover:bg-surface-2/40 align-top">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{lead.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{lead.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{lead.customer_phone}</div>
                        <div className="text-[10px] text-muted-foreground">{lead.customer_email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{lead.area_name}</div>
                        <div className="text-xs text-muted-foreground">{lead.city}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lead.max_budget ? `SAR ${formatSAR(lead.max_budget)}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={leadStatusTone(lead.status)}>{leadStatusLabel(lead.status)}</Badge>
                        {lead.closed_at && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{new Date(lead.closed_at).toLocaleDateString("en-SA")}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {accepted ? (
                          <div>
                            <div className="font-semibold text-sm">{accepted.mediator_agency_name ?? `Partner #${accepted.mediator_id}`}</div>
                            {accepted.mediator_phone && <div className="text-xs text-muted-foreground">{accepted.mediator_phone}</div>}
                            {accepted.accepted_at && <div className="text-[10px] text-muted-foreground">Accepted {new Date(accepted.accepted_at).toLocaleDateString("en-SA")}</div>}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(lead.created_at).toLocaleDateString("en-SA")}
                      </td>
                      <td className="px-4 py-3 min-w-[160px]">
                        {closed ? (
                          <span className="text-xs text-muted-foreground">Closed</span>
                        ) : isConfirming ? (
                          <div className="space-y-1">
                            <p className="text-[11px] text-muted-foreground font-medium mb-1.5">Force close as:</p>
                            <div className="flex gap-1.5">
                              <Button size="sm" className="h-7 px-2 text-xs bg-success hover:bg-success/90" onClick={() => act(lead.id, async () => { await onForceClose(lead.id, "closed_won"); setConfirmingClose(null); })} disabled={isActing}>Won</Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => act(lead.id, async () => { await onForceClose(lead.id, "closed_lost"); setConfirmingClose(null); })} disabled={isActing}>Lost</Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmingClose(null)} disabled={isActing}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setConfirmingClose(lead.id)}>
                            Force close
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function toListing(property: ApiProperty): Listing {
  const uiProperty = mapApiProperty(property);
  return {
    id: String(property.id),
    title: property.title,
    city: property.city,
    district: property.area,
    rent: property.monthly_rent,
    status: (property.status as ListingStatus) ?? "Draft",
    owner: property.owner_name ?? "Unassigned",
    createdAt: property.created_at,
    image: uiProperty.image,
    images: property.images ?? [],
    areaSqm: property.size_sq_m ?? uiProperty.area,
    bedrooms: property.bedrooms ?? undefined,
    bathrooms: property.bathrooms ?? undefined,
    description: property.description ?? undefined,
    property_type: property.property_type ?? undefined,
    furnished: property.furnished ?? undefined,
  };
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-primary-soft text-accent-foreground">
          {icon}
        </span>
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  defaultOn = false,
}: {
  label: string;
  description: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-primary" : "bg-surface-2",
        )}
        aria-pressed={on}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-background shadow transition-all",
            on ? "start-[22px]" : "start-0.5",
          )}
        />
      </button>
    </div>
  );
}

// ---------- Inline admin login gate (shown when unauthenticated at /admin) ----------

function AdminLoginGate({ onAuth, nonAdminUser }: { onAuth: (user: AuthUser, token: string) => void; nonAdminUser: boolean }) {
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
      if (!response.user.is_admin) {
        setError("This account does not have admin access.");
        return;
      }
      onAuth(response.user, response.access_token);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow">
            <ShieldCheck className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">Admin Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {nonAdminUser
                ? "Your current account does not have admin access. Sign in with an admin account."
                : "Sign in with an admin account to continue"}
            </p>
          </div>
        </div>
        {nonAdminUser && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <ShieldAlert className="size-4 shrink-0" />
            Current session has no admin privileges.
          </div>
        )}
        <form className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@maskan.sa"
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
            {loading ? "Signing in…" : "Sign in to Admin Console"}
          </Button>
        </form>
      </div>
    </div>
  );
}
