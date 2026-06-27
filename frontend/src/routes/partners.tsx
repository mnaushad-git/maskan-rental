import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { NavAuthButton } from "@/components/maskan/NavAuthButton";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  CheckCircle,
  Home,
  MapPin,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { fetchPublicPartners, type ApiPartnerPublic } from "@/lib/api/maskan";
import { cities } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/partners")({
  head: () => ({
    meta: [
      { title: "Find a Partner — Maskan" },
      {
        name: "description",
        content:
          "Browse verified Maskan partners covering every district across Saudi Arabia. Submit a lead and get matched instantly.",
      },
    ],
  }),
  component: PartnersPage,
});

// Deterministic avatar colour per partner id
const AVATAR_COLORS = [
  "bg-primary text-primary-foreground",
  "bg-emerald-600 text-white",
  "bg-violet-600 text-white",
  "bg-amber-600 text-white",
  "bg-rose-600 text-white",
  "bg-sky-600 text-white",
  "bg-teal-600 text-white",
  "bg-indigo-600 text-white",
];

function avatarColor(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function initials(partner: ApiPartnerPublic) {
  const name = partner.agency_name ?? `Partner ${partner.id}`;
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function PartnerCard({ partner }: { partner: ApiPartnerPublic }) {
  const navigate = useNavigate();
  const displayName = partner.agency_name ?? `Partner #${partner.id}`;
  const cities = Array.from(new Set(partner.areas.map((a) => a.city)));
  const districtCount = partner.areas.length;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated">
      {/* Avatar + verified */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          {partner.profile_image_url ? (
            <img
              src={partner.profile_image_url}
              alt={displayName}
              className="size-14 rounded-2xl object-cover"
            />
          ) : (
            <div
              className={cn(
                "grid size-14 shrink-0 place-items-center rounded-2xl text-xl font-bold",
                avatarColor(partner.id)
              )}
            >
              {initials(partner)}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-bold tracking-tight">
              {displayName}
            </h3>
            {partner.is_verified && (
              <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-success">
                <ShieldCheck className="size-3.5" /> Verified partner
              </div>
            )}
          </div>
        </div>
        {partner.total_leads_accepted > 0 && (
          <div className="shrink-0 text-end">
            <div className="text-xl font-bold">{partner.total_leads_accepted}</div>
            <div className="text-[10px] text-muted-foreground">leads closed</div>
          </div>
        )}
      </div>

      {/* Bio */}
      {partner.bio && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{partner.bio}</p>
      )}

      {/* Coverage */}
      {partner.areas.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="size-3.5" />
            {districtCount} district{districtCount !== 1 ? "s" : ""} covered
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cities.map((city) => (
              <span
                key={city}
                className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-foreground"
              >
                {city}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {partner.areas.slice(0, 5).map((a) => (
              <span
                key={a.id}
                className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary"
              >
                {a.area_name}
              </span>
            ))}
            {partner.areas.length > 5 && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">
                +{partner.areas.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      <Button
        size="sm"
        className="mt-auto w-full"
        onClick={() =>
          void navigate({
            to: "/lead/new",
            search: partner.areas[0]
              ? { area: partner.areas[0].area_name, city: partner.areas[0].city }
              : {} as never,
          })
        }
      >
        Submit a lead request
      </Button>
    </div>
  );
}

function PartnersPage() {
  const [partners, setPartners] = useState<ApiPartnerPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState("Any");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchPublicPartners(cityFilter !== "Any" ? cityFilter : undefined)
      .then(setPartners)
      .catch(() => setPartners([]))
      .finally(() => setLoading(false));
  }, [cityFilter]);

  const filtered = useMemo(() => {
    if (!query.trim()) return partners;
    const q = query.toLowerCase();
    return partners.filter(
      (p) =>
        (p.agency_name ?? "").toLowerCase().includes(q) ||
        (p.bio ?? "").toLowerCase().includes(q) ||
        p.areas.some(
          (a) =>
            a.area_name.toLowerCase().includes(q) ||
            a.city.toLowerCase().includes(q)
        )
    );
  }, [partners, query]);

  const hasFilters = cityFilter !== "Any" || query.trim().length > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="container-page flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2.5"
            >
              <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Home className="size-4" />
              </div>
              <span className="font-display text-xl font-bold tracking-tight">Maskan</span>
            </Link>
            <Link
              to="/"
              className="hidden items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:flex"
            >
              <ArrowLeft className="size-4" /> Back to home
            </Link>
          </div>
          <NavAuthButton />
        </div>
      </header>

      {/* Page header */}
      <section className="border-b border-border bg-surface">
        <div className="container-page py-10">
          <Badge tone="primary" className="mb-3">
            <Briefcase className="size-3.5" /> Verified partners
          </Badge>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            Find a Maskan Partner
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Licensed real estate partners covering every district across Saudi Arabia.
            Submit a lead and get matched with the right partner for your area within 24 hours.
          </p>

          {/* Filters */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* Text search */}
            <div className="relative flex-1 min-w-56 max-w-sm">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, area, city…"
                className="h-10 w-full rounded-xl border border-border bg-card ps-9 pe-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* City filter */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-muted-foreground" />
              <select
                value={cityFilter}
                onChange={(e) => {
                  setLoading(true);
                  setCityFilter(e.target.value);
                }}
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary"
              >
                <option value="Any">All cities</option>
                {cities.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={() => { setCityFilter("Any"); setQuery(""); }}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" /> Clear filters
              </button>
            )}

            <div className="ms-auto text-sm text-muted-foreground">
              {loading ? "Loading…" : `${filtered.length} partner${filtered.length !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <main className="container-page py-10">
        {loading && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-2xl bg-surface"
              />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="grid size-16 place-items-center rounded-2xl bg-surface text-muted-foreground">
              <Users className="size-8" />
            </div>
            <div>
              <p className="font-semibold">No partners found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasFilters
                  ? "Try adjusting your filters."
                  : "No active partners are registered yet. Be the first!"}
              </p>
            </div>
            {hasFilters && (
              <Button variant="outline" onClick={() => { setCityFilter("Any"); setQuery(""); }}>
                Clear filters
              </Button>
            )}
            <Link to="/partner/register">
              <Button variant="ghost" size="sm">
                <Briefcase className="size-4" /> Become a partner
              </Button>
            </Link>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => (
                <PartnerCard key={p.id} partner={p} />
              ))}
            </div>

            {/* CTA */}
            <div className="mt-12 flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Star className="size-6" />
              </div>
              <div>
                <h2 className="font-display text-xl font-bold">Are you a licensed agent?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Join Maskan as a partner and receive verified leads in your district for SAR 99/month.
                </p>
              </div>
              <Link to="/partner/register">
                <Button>
                  <Briefcase className="size-4" /> Register as a partner
                </Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
