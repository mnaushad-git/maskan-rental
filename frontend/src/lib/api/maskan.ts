import prop1 from "@/assets/prop-1.jpg";
import prop2 from "@/assets/prop-2.jpg";
import prop3 from "@/assets/prop-3.jpg";
import prop4 from "@/assets/prop-4.jpg";
import type { Property as UiProperty, Project as UiProject } from "@/lib/maskan-data";
import type { SearchProperty as UiSearchProperty } from "@/lib/maskan-search-data";
import { currentScope, readStoredToken, clearStoredAuth } from "@/lib/auth-storage";

// Browser uses the public VITE_ URL baked at build time.
// SSR server (inside Docker) uses the internal network URL via INTERNAL_API_URL env var
// to avoid routing out to the public internet and back on every server-rendered request.
const API_BASE_URL =
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_URL ??
      import.meta.env.VITE_API_BASE_URL ??
      "http://localhost:8000/api")
    : (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api");
const PROPERTY_IMAGES = [prop1, prop2, prop3, prop4] as const;

export class UnauthorizedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "UnauthorizedError";
  }
}

export type ApiListingImage = {
  id: number;
  url: string;
  display_order: number;
};

export type ApiProperty = {
  id: number;
  external_id: string | null;
  title: string;
  area: string;
  city: string;
  size_sq_m: number | null;
  listing_type: "rent" | "sale";
  monthly_rent: number | null;
  sale_price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  owner_name: string | null;
  status: string;
  description: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  mediator_id: number | null;
  images: ApiListingImage[];
  mediator_phone: string | null;
  contact_phone: string | null;
  whatsapp_phone: string | null;
  call_phone: string | null;
  whatsapp_number: string | null;
  mediator_profile_image_url: string | null;
  mediator_agent_name: string | null;
  mediator_is_verified: boolean;
  property_type: string | null;
  furnished: string | null;
  latitude: number | null;
  longitude: number | null;
  living_rooms: number | null;
  property_age_years: number | null;
  commission_percent: number | null;
  has_kitchen: boolean;
  has_water: boolean;
  has_electricity: boolean;
  has_private_roof: boolean;
  in_villa: boolean;
  has_two_entrances: boolean;
  has_separate_electrical_meter: boolean;
  license_number: string | null;
  license_expiration_date: string | null;
  deed_area: number | null;
  views_count: number;
  mediator_rating: number | null;
  mediator_review_count: number;
};

export type AuthUser = {
  id: number;
  email: string;
  full_name: string | null;
  is_admin: boolean;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

export type AnalyticsSummary = {
  total_properties: number;
  total_users: number;
  kpis: Array<{
    label: string;
    value: string;
    delta: string;
    sub: string;
    trend: "up" | "down";
    accent: string;
  }>;
  searchDemand: Array<{ day: string; riyadh: number; jeddah: number; dammam: number }>;
  popularAreas: Array<{ name: string; city: string; searches: number; share: number }>;
  funnel: Array<{ stage: string; value: number; color: string }>;
  aiTrends: Array<{ label: string; value: number; delta: string }>;
  dataQuality: Array<{ label: string; value: number; target: number }>;
  inventory: Array<{ city: string; available: number; reserved: number; rented: number }>;
  activity: Array<{ tone: string; title: string; meta: string; time: string }>;
};

export type ApiSavedProperty = {
  id: number;
  user_id: number;
  property_id: number;
  status: string;
  notes: string | null;
  viewing_at: string | null;
  created_at: string;
  property: ApiProperty;
};

function imageForProperty(id: number) {
  return PROPERTY_IMAGES[(id - 1) % PROPERTY_IMAGES.length];
}

function inferPropertyType(property: ApiProperty): UiProperty["type"] {
  if (property.property_type) return property.property_type;
  const title = property.title.toLowerCase();
  if (title.includes("penthouse")) return "Penthouse";
  if (title.includes("townhouse")) return "Townhouse";
  if ((property.bedrooms ?? 0) >= 4 || title.includes("villa")) return "Villa";
  return "Apartment";
}

function estimateAreaSqm(property: ApiProperty) {
  if (property.size_sq_m) return property.size_sq_m;
  return 95 + (property.bedrooms ?? 2) * 38 + (property.bathrooms ?? 2) * 12;
}

export function computePropertyScore(
  monthlyRent: number,
  bedrooms: number,
  areaScore?: number | null,
  avgMonthly?: number | null,
): number {
  // Price fairness (35%): monthly rent vs district average
  let priceScore = 72;
  if (avgMonthly && avgMonthly > 0) {
    const ratio = monthlyRent / avgMonthly;
    priceScore =
      ratio <= 0.8
        ? 97
        : ratio <= 0.9
          ? 90
          : ratio <= 1.0
            ? 82
            : ratio <= 1.1
              ? 70
              : ratio <= 1.2
                ? 58
                : 46;
  }
  // Area quality (35%): district score from Maskan platform intelligence
  const districtScore = areaScore != null && areaScore > 0 ? areaScore : 70;
  // Size adequacy (20%): bedroom count proxy
  const sizeScore =
    bedrooms <= 0
      ? 58
      : bedrooms === 1
        ? 65
        : bedrooms === 2
          ? 72
          : bedrooms === 3
            ? 80
            : bedrooms === 4
              ? 87
              : 92;
  // Listing completeness (10%): fixed 80 — all DB listings have owner + description
  const total = 0.35 * priceScore + 0.35 * districtScore + 0.2 * sizeScore + 0.1 * 80;
  return Math.round(Math.max(55, Math.min(97, total)));
}

function estimateAreaScore(property: ApiProperty) {
  return Math.min(96, 76 + (property.bedrooms ?? 0) * 3);
}

function estimateRentalScore(property: ApiProperty) {
  if (property.listing_type === "sale" || property.monthly_rent == null) {
    return Math.max(72, Math.min(95, 82 + (property.bedrooms ?? 0) * 2));
  }
  const score = 90 - Math.floor(property.monthly_rent / 50000) + (property.bedrooms ?? 0) * 2;
  return Math.max(72, Math.min(95, score));
}

export function mapApiProperty(property: ApiProperty): UiProperty {
  const estimatedArea = estimateAreaSqm(property);
  const isSale = property.listing_type === "sale";
  const displayPrice = isSale ? (property.sale_price ?? 0) : (property.monthly_rent ?? 0) * 12;
  const matchScore = isSale
    ? computePropertyScore(0, property.bedrooms ?? 0)
    : computePropertyScore(property.monthly_rent ?? 0, property.bedrooms ?? 0);
  const imageUrls = (property.images ?? []).map((i) => i.url);
  const primaryImage = imageUrls[0] ?? property.image_url ?? imageForProperty(property.id);

  const badges: UiProperty["badges"] = [];
  if (property.mediator_is_verified) badges.push("Verified");
  if (matchScore >= 90) badges.push("Best Match");
  const createdAtMs = Date.parse(property.created_at);
  const isRecent = !Number.isNaN(createdAtMs) && Date.now() - createdAtMs < 14 * 24 * 60 * 60 * 1000;
  if (isRecent && !badges.includes("Best Match")) badges.push("New");

  return {
    id: String(property.id),
    title: property.title,
    district: property.area,
    city: property.city,
    price: displayPrice,
    listingType: property.listing_type,
    bedrooms: property.bedrooms ?? 0,
    bathrooms: property.bathrooms ?? 0,
    area: estimatedArea,
    type: inferPropertyType(property),
    image: primaryImage,
    images: imageUrls.length > 0 ? imageUrls : [primaryImage],
    matchScore,
    badges,
    status:
      property.status === "Published"
        ? "Available"
        : property.status === "Suspended"
          ? "Reserved"
          : "Available",
    pricePerSqm: estimatedArea > 0 ? Math.round(displayPrice / estimatedArea) : 0,
    agent: property.mediator_agent_name ?? property.owner_name ?? "myMakan Agent",
    agentPhone: property.call_phone ?? property.mediator_phone ?? null,
    agentWhatsapp: property.whatsapp_number ?? property.mediator_phone ?? null,
    agentProfileImage: property.mediator_profile_image_url ?? null,
    mediatorId: property.mediator_id ?? null,
    description: property.description ?? null,
    furnished: property.furnished ?? null,
    livingRooms: property.living_rooms ?? null,
    propertyAgeYears: property.property_age_years ?? null,
    commissionPercent: property.commission_percent ?? null,
    features: {
      kitchen: property.has_kitchen,
      water: property.has_water,
      electricity: property.has_electricity,
      privateRoof: property.has_private_roof,
      inVilla: property.in_villa,
      twoEntrances: property.has_two_entrances,
      separateElectricalMeter: property.has_separate_electrical_meter,
    },
    licenseNumber: property.license_number ?? null,
    licenseExpirationDate: property.license_expiration_date ?? null,
    deedArea: property.deed_area ?? null,
    viewsCount: property.views_count ?? 0,
    createdAt: property.created_at,
    updatedAt: property.updated_at,
    mediatorRating: property.mediator_rating ?? null,
    mediatorReviewCount: property.mediator_review_count ?? 0,
  };
}

export function mapApiSearchProperty(property: ApiProperty): UiSearchProperty {
  const uiProperty = mapApiProperty(property);

  return {
    id: uiProperty.id,
    title: uiProperty.title,
    city: uiProperty.city,
    district: uiProperty.district,
    price: uiProperty.price,
    listingType: uiProperty.listingType,
    bedrooms: uiProperty.bedrooms,
    bathrooms: uiProperty.bathrooms,
    area: uiProperty.area,
    type: uiProperty.type,
    furnished: (property.furnished as UiSearchProperty["furnished"]) ?? "Semi-furnished",
    image: uiProperty.image,
    rentalScore: estimateRentalScore(property),
    areaScore: estimateAreaScore(property),
    matchScore: uiProperty.matchScore,
    amenities: {
      parking: true,
      balcony: (property.bedrooms ?? 0) >= 2,
      gym: (property.bedrooms ?? 0) >= 3,
      pool: (property.bedrooms ?? 0) >= 3,
    },
    reasons: [
      "Verified listing",
      `${property.area} location`,
      property.description ? "Detailed description available" : "Fresh inventory",
      "Good rental value",
    ],
    agentPhone: property.call_phone ?? property.mediator_phone ?? null,
    agentWhatsapp: property.whatsapp_number ?? property.mediator_phone ?? null,
  };
}

// Call after area intel + avg rents load to replace the initial estimate with a real score.
export function enrichPropertiesWithScores(
  properties: UiSearchProperty[],
  intelList: ApiAreaIntelligenceSummary[],
  areaAvgMap: Record<string, number>, // district_name_lowercase → avg monthly rent SAR
): UiSearchProperty[] {
  return properties.map((p) => {
    const intel = intelList.find((s) => s.area_name.toLowerCase() === p.district.toLowerCase());
    const avgMonthly = areaAvgMap[p.district.toLowerCase()];
    const monthlyRent = p.price / 12;

    const matchScore = computePropertyScore(monthlyRent, p.bedrooms, intel?.area_score, avgMonthly);

    // Real area quality from intelligence (replaces bedroom-count estimate)
    const areaScore = intel?.area_score != null ? Math.round(intel.area_score) : p.areaScore;

    // Price fairness — same bands used on the property detail page
    let rentalScore = p.rentalScore;
    if (avgMonthly) {
      const ratio = monthlyRent / avgMonthly;
      rentalScore =
        ratio < 0.85 ? 97 : ratio < 0.95 ? 88 : ratio < 1.05 ? 82 : ratio < 1.15 ? 68 : 52;
    }

    return {
      ...p,
      matchScore,
      areaScore,
      rentalScore,
      badges: ["Verified", matchScore >= 88 ? "Best Match" : "New"],
    };
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  // Send the token for the portal the request originates from, so admin /
  // partner / user sessions stay isolated even with several tabs open.
  const token = typeof window !== "undefined" ? readStoredToken(currentScope()) : null;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        detail?: string | Array<{ msg: string; loc?: string[] }>;
      };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        // Pydantic 422 validation errors — extract the first human-readable message
        detail = body.detail[0].msg.replace(/^Value error,\s*/i, "");
      }
    } catch {
      /* ignore parse errors */
    }
    if (response.status === 401) {
      if (typeof window !== "undefined") {
        clearStoredAuth(currentScope());
      }
      throw new UnauthorizedError(detail);
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function fetchProperties() {
  return requestJson<ApiProperty[]>("/properties/?limit=500");
}

export type PropertySearchFilters = {
  listingType?: string;
  city?: string;
  area?: string;
  propertyType?: string;
  furnished?: string;
  minBedrooms?: number;
  minBathrooms?: number;
  minMonthlyRent?: number;
  maxMonthlyRent?: number;
  minSalePrice?: number;
  maxSalePrice?: number;
};

// Server-side filtered + paginated property search. Unlike fetchProperties()
// (a flat capped batch meant for small datasets), this scales past the
// catalog's total size — filtering happens in Postgres, not the browser.
export async function fetchPropertiesPaged(
  filters: PropertySearchFilters,
  skip: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ data: ApiProperty[]; total: number }> {
  const params = new URLSearchParams();
  params.set("skip", String(skip));
  params.set("limit", String(limit));
  if (filters.listingType) params.set("listing_type", filters.listingType);
  if (filters.city) params.set("city", filters.city);
  if (filters.area) params.set("area", filters.area);
  if (filters.propertyType) params.set("property_type", filters.propertyType);
  if (filters.furnished) params.set("furnished", filters.furnished);
  if (filters.minBedrooms != null) params.set("min_bedrooms", String(filters.minBedrooms));
  if (filters.minBathrooms != null) params.set("min_bathrooms", String(filters.minBathrooms));
  if (filters.minMonthlyRent != null)
    params.set("min_monthly_rent", String(filters.minMonthlyRent));
  if (filters.maxMonthlyRent != null)
    params.set("max_monthly_rent", String(filters.maxMonthlyRent));
  if (filters.minSalePrice != null) params.set("min_sale_price", String(filters.minSalePrice));
  if (filters.maxSalePrice != null) params.set("max_sale_price", String(filters.maxSalePrice));

  const token = typeof window !== "undefined" ? readStoredToken(currentScope()) : null;
  const response = await fetch(`${API_BASE_URL}/properties/?${params.toString()}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  const data = (await response.json()) as ApiProperty[];
  const total = Number(response.headers.get("X-Total-Count") ?? data.length);
  return { data, total };
}

export function fetchProperty(id: number) {
  return requestJson<ApiProperty>(`/properties/${id}`);
}

export function fetchSimilarProperties(id: number, limit = 6) {
  return requestJson<ApiProperty[]>(`/properties/${id}/similar?limit=${limit}`);
}

export function fetchAdminProperties() {
  return requestJson<ApiProperty[]>("/properties/?include_all=true&limit=500");
}

export function createProperty(payload: {
  title: string;
  area: string;
  city: string;
  size_sq_m: number;
  listing_type?: "rent" | "sale";
  monthly_rent?: number;
  sale_price?: number;
  bedrooms: number;
  bathrooms: number;
  owner_name: string;
  status: string;
  description: string;
  external_id: string;
}) {
  return requestJson<ApiProperty>("/properties/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchProperty(
  id: number,
  payload: Partial<Omit<ApiProperty, "id" | "created_at">>,
) {
  return requestJson<ApiProperty>(`/properties/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function removeProperty(id: number) {
  return requestJson<void>(`/properties/${id}`, { method: "DELETE" });
}

export function addPropertyImage(propertyId: number, url: string) {
  return requestJson<ApiListingImage>(`/properties/${propertyId}/images`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function deletePropertyImage(propertyId: number, imageId: number) {
  return requestJson<void>(`/properties/${propertyId}/images/${imageId}`, { method: "DELETE" });
}

export function addPartnerPropertyImage(propertyId: number, url: string) {
  return requestJson<ApiListingImage>(`/properties/partner/${propertyId}/images`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function deletePartnerPropertyImage(propertyId: number, imageId: number) {
  return requestJson<void>(`/properties/partner/${propertyId}/images/${imageId}`, {
    method: "DELETE",
  });
}

export type PartnerPropertyPayload = {
  title: string;
  area: string;
  city: string;
  size_sq_m?: number;
  listing_type: "rent" | "sale";
  monthly_rent?: number;
  sale_price?: number;
  bedrooms?: number;
  bathrooms?: number;
  owner_name?: string;
  description?: string;
  property_type?: string;
  furnished?: string;
  contact_phone: string;
  whatsapp_phone: string;
};

export function fetchPartnerListings() {
  return requestJson<ApiProperty[]>("/properties/partner/mine");
}

export function createPartnerListing(payload: PartnerPropertyPayload) {
  return requestJson<ApiProperty>("/properties/partner/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchPartnerListing(id: number, payload: Partial<PartnerPropertyPayload>) {
  return requestJson<ApiProperty>(`/properties/partner/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// ── Partner Listing Quality (Trust Center, Prompt 8) ────────────────────────
// Backend: backend/app/api/routes/partner_quality.py (Prompt 3), mounted at
// /partner/properties. Types mirror backend/app/schemas/partner_quality.py
// exactly — see docs/implementation/mymakan-trust-center.md "Full API
// surface (Prompts 2-6)". `completeness` reuses the same `ApiTrustCompleteness`
// shape defined below for the customer Trust Center (Prompt 7) — both wrap
// the identical `compute_listing_completeness` result on the backend, so the
// two objects agree by construction.

export type ApiImageQualityIssue = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
};

export type ApiImageQuality = {
  image_count: number;
  issues: ApiImageQualityIssue[];
  has_blocking_issues: boolean;
};

export type ApiPartnerListingQuality = {
  property_id: number;
  completeness: ApiTrustCompleteness;
  missing_field_suggestions: string[];
  image_quality: ApiImageQuality;
  availability_confirmed_at: string | null;
};

// Mediator-authenticated, ownership-checked — only ever called for the
// partner's own listing, and only once the listing has an id (a brand-new,
// not-yet-saved draft has nothing to call this against; see
// PartnerListingQualityPanel in routes/partner.tsx for the client-side
// estimate shown before that point).
export function fetchPartnerListingQuality(propertyId: number) {
  return requestJson<ApiPartnerListingQuality>(`/partner/properties/${propertyId}/quality`);
}

export type ApiPartnerAvailabilityConfirm = {
  property_id: number;
  availability_confirmed_at: string;
};

export function confirmPartnerListingAvailability(propertyId: number) {
  return requestJson<ApiPartnerAvailabilityConfirm>(
    `/partner/properties/${propertyId}/confirm-availability`,
    { method: "POST" },
  );
}

export type ApiPartnerImproveWithAi = {
  property_id: number;
  suggested_title: string | null;
  suggested_description: string | null;
  generated_by: "ai" | "fallback";
  note: string;
};

// Returns a suggestion only — the caller must show it to the partner for
// explicit approval and, if approved, apply it to the (unsaved) form state
// themselves. This function never writes to the property; the backend
// endpoint it calls doesn't either.
export function improvePartnerListingWithAi(
  propertyId: number,
  body: { focus?: "title" | "description" | "both"; language?: "en" | "ar" } = {},
) {
  return requestJson<ApiPartnerImproveWithAi>(`/partner/properties/${propertyId}/improve-with-ai`, {
    method: "POST",
    body: JSON.stringify({ focus: body.focus ?? "both", language: body.language ?? "en" }),
  });
}

export type ApiProjectUnit = {
  id: number;
  unit_type: string;
  price: number;
  area_sq_m: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  living_rooms: number | null;
  status: string;
};

export type ApiProjectImage = {
  id: number;
  url: string;
  display_order: number;
};

export type ApiProject = {
  id: number;
  external_id: string | null;
  title: string;
  city: string;
  area: string;
  description: string | null;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  completion_status: string | null;
  property_category: string | null;
  price_min: number | null;
  price_max: number | null;
  area_min: number | null;
  area_max: number | null;
  unit_count: number | null;
  intro_document_url: string | null;
  is_featured: boolean;
  developer_name: string | null;
  developer_logo_url: string | null;
  mediator_id: number | null;
  contact_phone: string | null;
  whatsapp_phone: string | null;
  listing_status: string;
  created_at: string;
  updated_at: string;
  views_count: number;
  units: ApiProjectUnit[];
  images: ApiProjectImage[];
  mediator_phone: string | null;
  call_phone: string | null;
  whatsapp_number: string | null;
};

function imageForProject(id: number) {
  return PROPERTY_IMAGES[(id - 1) % PROPERTY_IMAGES.length];
}

export function mapApiProject(project: ApiProject): UiProject {
  const imageUrls = (project.images ?? []).map((i) => i.url);
  const primaryImage = imageUrls[0] ?? project.image_url ?? imageForProject(project.id);

  return {
    id: String(project.id),
    title: project.title,
    district: project.area,
    city: project.city,
    description: project.description ?? null,
    image: primaryImage,
    images: imageUrls.length > 0 ? imageUrls : [primaryImage],
    status: project.status,
    completionStatus: project.completion_status ?? null,
    category: project.property_category ?? null,
    priceMin: project.price_min ?? null,
    priceMax: project.price_max ?? null,
    areaMin: project.area_min ?? null,
    areaMax: project.area_max ?? null,
    unitCount: project.unit_count ?? null,
    introDocumentUrl: project.intro_document_url ?? null,
    isFeatured: project.is_featured,
    developerName: project.developer_name ?? null,
    developerLogoUrl: project.developer_logo_url ?? null,
    latitude: project.latitude ?? null,
    longitude: project.longitude ?? null,
    units: (project.units ?? []).map((u) => ({
      id: u.id,
      unitType: u.unit_type,
      price: u.price,
      areaSqm: u.area_sq_m ?? null,
      bedrooms: u.bedrooms ?? null,
      bathrooms: u.bathrooms ?? null,
      livingRooms: u.living_rooms ?? null,
      status: u.status,
    })),
    viewsCount: project.views_count,
    agentPhone: project.call_phone ?? project.mediator_phone ?? null,
    agentWhatsapp: project.whatsapp_number ?? project.mediator_phone ?? null,
    mediatorId: project.mediator_id ?? null,
    listingStatus: project.listing_status,
  };
}

export function fetchProjects(params?: { city?: string; area?: string; status?: string }) {
  const search = new URLSearchParams();
  if (params?.city) search.set("city", params.city);
  if (params?.area) search.set("area", params.area);
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  return requestJson<ApiProject[]>(`/projects/${qs ? `?${qs}` : ""}`);
}

export function fetchProject(id: number) {
  return requestJson<ApiProject>(`/projects/${id}`);
}

export function fetchSimilarProjects(id: number, limit = 6) {
  return requestJson<ApiProject[]>(`/projects/${id}/similar?limit=${limit}`);
}

export function fetchAdminProjects() {
  return requestJson<ApiProject[]>("/projects/?include_all=true&limit=500");
}

export function patchProjectAdmin(id: number, payload: Partial<ApiProject>) {
  return requestJson<ApiProject>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type PartnerProjectPayload = {
  title: string;
  city: string;
  area: string;
  description?: string;
  image_url?: string;
  status?: string;
  completion_status?: string;
  property_category?: string;
  price_min?: number;
  price_max?: number;
  area_min?: number;
  area_max?: number;
  unit_count?: number;
  intro_document_url?: string;
  developer_name?: string;
  developer_logo_url?: string;
  contact_phone: string;
  whatsapp_phone: string;
};

export function fetchPartnerProjects() {
  return requestJson<ApiProject[]>("/projects/partner/mine");
}

export function createPartnerProject(payload: PartnerProjectPayload) {
  return requestJson<ApiProject>("/projects/partner/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function patchPartnerProject(id: number, payload: Partial<PartnerProjectPayload>) {
  return requestJson<ApiProject>(`/projects/partner/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function saveProperty(userId: number, propertyId: number) {
  return requestJson<ApiSavedProperty>("/saved-properties/", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, property_id: propertyId, status: "none" }),
  });
}

export function fetchSavedProperties(userId: number) {
  return requestJson<ApiSavedProperty[]>(`/saved-properties/?user_id=${userId}`);
}

export function updateSavedProperty(
  id: number,
  payload: { status?: string; notes?: string | null; viewing_at?: string | null },
) {
  return requestJson<ApiSavedProperty>(`/saved-properties/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSavedProperty(id: number) {
  return requestJson<void>(`/saved-properties/${id}`, { method: "DELETE" });
}

export function fetchAnalyticsSummary() {
  return requestJson<AnalyticsSummary>("/analytics/summary");
}

export function signup(payload: { email: string; password: string; full_name?: string }) {
  return requestJson<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { email: string; password: string }) {
  return requestJson<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMe(token: string) {
  return requestJson<AuthUser>("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
}

export type ApiAreaSummary = {
  name: string;
  city: string;
  property_count: number;
  average_rent: number; // monthly average in SAR
};

export function fetchAreas() {
  return requestJson<ApiAreaSummary[]>("/areas/");
}

export type BulkImportRow = {
  external_id?: string;
  title: string;
  area: string;
  city: string;
  monthly_rent: number;
  bedrooms?: number;
  bathrooms?: number;
  size_sq_m?: number;
  owner_name?: string;
  status?: string;
};

export function bulkImportProperties(rows: BulkImportRow[]) {
  return requestJson<{ inserted: number; skipped: number; total: number }>("/properties/bulk", {
    method: "POST",
    body: JSON.stringify(rows),
  });
}

export function fetchPropertyStats() {
  return requestJson<{ listing_count: number }>("/properties/stats");
}

export function chatWithAdvisor(
  message: string,
  history: Array<{ role: string; content: string }>,
) {
  return requestJson<{ reply: string }>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

// Streams the advisor's reply token-by-token via SSE instead of waiting for
// the full response — the AI's tool-use round trips can take 10+ seconds,
// so this is what makes the first words appear almost immediately.
export async function chatWithAdvisorStream(
  message: string,
  history: Array<{ role: string; content: string }>,
  onDelta: (text: string) => void,
): Promise<void> {
  const token = typeof window !== "undefined" ? readStoredToken(currentScope()) : null;
  const response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, history }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6)) as
        | { type: "text"; delta: string }
        | { type: "done" }
        | { type: "error"; message: string };
      if (payload.type === "text") onDelta(payload.delta);
      else if (payload.type === "error") throw new Error(payload.message);
    }
  }
}

export function adminAiChat(message: string, history: Array<{ role: string; content: string }>) {
  return requestJson<{ reply: string }>("/ai/admin-chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

// ── Area Intelligence ────────────────────────────────────────────────────────

export type ApiSchool = { name: string; type: string; rating: number; distance_km: number };
export type ApiHospital = { name: string; tier: string; rating: number; distance_km: number };
export type ApiLifestylePlace = { name: string; rating?: number; distance_km: number };
export type ApiLifestyleCategory = {
  count: number;
  avg_rating: number | null;
  places?: ApiLifestylePlace[];
};
export type ApiLifestyle = {
  // All categories are optional — area records may omit any of them (e.g. mosques
  // is not always present), so consumers must guard with optional chaining.
  restaurants?: ApiLifestyleCategory;
  gyms?: ApiLifestyleCategory;
  mosques?: ApiLifestyleCategory;
  malls?: ApiLifestyleCategory;
  parks?: ApiLifestyleCategory;
};
export type ApiRentTrendPoint = { year: string; avg_rent_annual: number };

export type ApiAreaIntelligence = {
  id: number;
  area_name: string;
  city: string;
  center_lat: number | null;
  center_lng: number | null;
  schools: ApiSchool[];
  hospitals: ApiHospital[];
  lifestyle: ApiLifestyle;
  commute_minutes_to_center: number | null;
  school_score: number | null;
  healthcare_score: number | null;
  lifestyle_score: number | null;
  traffic_score: number | null;
  family_score: number | null;
  area_score: number | null;
  rent_trend: ApiRentTrendPoint[];
  tags: string[];
  overview: string | null;
  market_notes: string[];
  last_refreshed_at: string | null;
};

export type ApiAreaIntelligenceSummary = {
  area_name: string;
  city: string;
  school_score: number | null;
  healthcare_score: number | null;
  lifestyle_score: number | null;
  traffic_score: number | null;
  family_score: number | null;
  area_score: number | null;
  tags: string[];
  overview: string | null;
  last_refreshed_at: string | null;
};

export function fetchAreaIntelligenceList() {
  return requestJson<ApiAreaIntelligenceSummary[]>("/areas/intelligence");
}

export function fetchAreaIntelligence(areaName: string, city?: string) {
  const q = city ? `?city=${encodeURIComponent(city)}` : "";
  return requestJson<ApiAreaIntelligence>(
    `/areas/${encodeURIComponent(areaName)}/intelligence${q}`,
  );
}

// ── Property Intelligence ───────────────────────────────────────────────────
// GET /properties/{id}/intelligence — assembles the deterministic Decision
// Score / Price Intelligence / Comparables / Data Confidence / Personalized
// Fit / Highlights / Smart Questions / Negotiation Insight services into one
// payload. See backend/app/schemas/property_intelligence.py (source of
// truth for this shape) and docs/implementation/mymakan-property-intelligence.md.

export type ApiDimensionScore = { score: number; reason: string };

export type ApiDataConfidence = { level: "High" | "Moderate"; reason: string };

export type ApiPriceIntelligence = {
  type: "rent" | "buy";
  sufficient_data: boolean;
  asking_price: number | null;
  fair_range_low: number | null;
  fair_range_high: number | null;
  market_midpoint: number | null;
  price_per_sqm: number | null;
  comparable_median_price_per_sqm: number | null;
  estimated_value_low: number | null;
  estimated_value_high: number | null;
  percent_difference: number | null;
  classification: string | null;
  factors_used: string[];
  comparable_count: number;
  explanation: string | null;
};

export type ApiComparablePropertySummary = {
  property_id: number;
  title: string;
  image_url: string | null;
  price: number | null;
  price_difference: number | null;
  price_per_sqm: number | null;
  match_similarity_percent: number;
  value_label: string | null;
};

export type ApiComparableSummary = {
  count: number;
  items: ApiComparablePropertySummary[];
};

export type ApiPersonalizedFitRow = { label: string; status: "match" | "moderate" | "miss"; detail: string };

export type ApiPersonalizedFit = {
  rows: ApiPersonalizedFitRow[];
  priorities_matched: number;
  priorities_total: number;
  summary: string;
};

export type ApiNegotiationInsight = {
  asking_price: number;
  market_midpoint: number;
  discussion_range_low: number;
  discussion_range_high: number;
  approach: string;
};

export type ApiAreaIntelligenceRef = {
  area_name: string;
  city: string;
  area_score: number | null;
  summary: string | null;
};

export type ApiPropertyIntelligence = {
  decision_score: number;
  component_scores: Record<string, ApiDimensionScore>;
  omitted_score_dimensions: string[];
  data_confidence: ApiDataConfidence;
  price_intelligence: ApiPriceIntelligence;
  comparable_summary: ApiComparableSummary;
  strengths: string[];
  considerations: string[];
  things_to_verify: string[];
  personalized_fit: ApiPersonalizedFit | null;
  smart_questions: string[];
  negotiation_intelligence: ApiNegotiationInsight | null;
  area_intelligence: ApiAreaIntelligenceRef | null;
};

export type PropertyIntelligenceCriteria = {
  maxPrice?: number;
  minPrice?: number;
  bedrooms?: number;
  districts?: string[];
  requiredAmenities?: string[];
};

export function fetchPropertyIntelligence(propertyId: number, criteria?: PropertyIntelligenceCriteria) {
  const params = new URLSearchParams();
  if (criteria?.maxPrice != null) params.set("max_price", String(criteria.maxPrice));
  if (criteria?.minPrice != null) params.set("min_price", String(criteria.minPrice));
  if (criteria?.bedrooms != null) params.set("bedrooms", String(criteria.bedrooms));
  for (const d of criteria?.districts ?? []) params.append("districts", d);
  for (const a of criteria?.requiredAmenities ?? []) params.append("required_amenities", a);
  const qs = params.toString();
  return requestJson<ApiPropertyIntelligence>(`/properties/${propertyId}/intelligence${qs ? `?${qs}` : ""}`);
}

export function fetchPropertyAiSummary(
  propertyId: number,
  language: "en" | "ar",
  variant: "summary" | "negotiation_message" = "summary",
  // Prompt 8: grounds a "Draft with AI" call made from the Negotiation
  // Detail screen's Counter Again panel in that negotiation's own real
  // numbers — see backend/app/api/routes/properties.py's
  // PropertyAiSummaryRequest.negotiation_id (Prompt 6). Omitted entirely
  // when undefined, leaving the pre-existing Property Detail call path
  // (Prompt 7's MakeOfferModal draft, before any negotiation exists)
  // unchanged.
  negotiationId?: number,
) {
  return requestJson<{ summary: string; generated_by: "ai" | "fallback" }>(
    `/properties/${propertyId}/ai-summary`,
    {
      method: "POST",
      body: JSON.stringify({ language, variant, ...(negotiationId != null ? { negotiation_id: negotiationId } : {}) }),
    },
  );
}

// ── Trust Center (Prompt 7 — Property Verification & Trust Center) ─────────
// Types mirror backend/app/schemas/trust.py, trust_summary.py, duplicate.py,
// property_report.py exactly — see docs/implementation/mymakan-trust-center.md
// "Full API surface (Prompts 2-6)" for the authoritative shape reference.

export type ApiTrustCompleteness = {
  score: number;
  present_fields: string[];
  missing_fields: string[];
  missing_required: string[];
  tier_breakdown: Record<string, { present: number; total: number }>;
};

export type ApiTrustConsistencyIssue = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
};

export type ApiTrustConsistency = {
  score: number;
  issues: ApiTrustConsistencyIssue[];
  has_blocking_issues: boolean;
};

export type ApiTrustMediatorTrust = {
  score: number;
  is_verified: boolean;
  review_count: number;
  avg_rating: number | null;
  listing_count: number;
  reason: string;
};

export type ApiTrustFreshness = {
  score: number;
  category: "Recently Confirmed" | "Recently Updated" | "Needs Reconfirmation" | "Potentially Stale";
  days_since_reference: number;
  reason: string;
};

export type ApiTrustMarketplaceConfidence = {
  score: number;
  level: "High" | "Moderate";
  reason: string;
};

export type ApiTrustComponentScores = {
  completeness: ApiTrustCompleteness | null;
  consistency: ApiTrustConsistency | null;
  mediator_trust: ApiTrustMediatorTrust | null;
  freshness: ApiTrustFreshness | null;
  marketplace_confidence: ApiTrustMarketplaceConfidence | null;
};

export type ApiTrustAssessment = {
  property_id: number;
  overall_score: number;
  trust_level: "High" | "Good" | "Moderate" | "Limited Confidence";
  component_scores: ApiTrustComponentScores;
  omitted_components: string[];
  positive_signals: string[];
  missing_information: string[];
  things_to_verify: string[];
  data_confidence: ApiDataConfidence | null;
};

export function fetchPropertyTrust(propertyId: number) {
  return requestJson<ApiTrustAssessment>(`/properties/${propertyId}/trust`);
}

export type ApiTrustSummary = {
  property_id: number;
  summary: string;
  generated_by: "ai" | "fallback";
};

// Deliberately a separate call from fetchPropertyTrust — the deterministic
// assessment must render instantly; this AI explanation is fetched
// separately, after, so it never blocks the trust badge (mirrors the
// existing fetchPropertyIntelligence / fetchPropertyAiSummary split above).
export function fetchPropertyTrustSummary(propertyId: number, language: "en" | "ar" = "en") {
  return requestJson<ApiTrustSummary>(`/properties/${propertyId}/trust-summary?language=${language}`);
}

export type ApiDuplicateMatch = {
  property_id: number;
  title: string;
  reasons: string[];
  match_score: number;
};

export type ApiDuplicateCheck = {
  is_possible_duplicate: boolean;
  confidence: "none" | "low" | "medium" | "high";
  matches: ApiDuplicateMatch[];
  reasons: string[];
};

export function fetchDuplicateCheck(propertyId: number) {
  return requestJson<ApiDuplicateCheck>(`/properties/${propertyId}/duplicate-check`);
}

// Matches backend PROPERTY_REPORT_REASONS (app/models/property_report.py).
export const PROPERTY_REPORT_REASONS = [
  "duplicate_listing",
  "incorrect_information",
  "no_longer_available",
  "fraudulent_or_scam",
  "inappropriate_content",
  "other",
] as const;
export type PropertyReportReason = (typeof PROPERTY_REPORT_REASONS)[number];

export type ApiPropertyReport = {
  id: number;
  property_id: number;
  reporter_user_id: number | null;
  reason: string;
  comment: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: number | null;
  resolution_notes: string | null;
};

// Not called yet in Prompt 7's UI (the "Report a Concern" trigger is a stub
// until Prompt 9 builds the actual report modal) — exported now so that
// modal can wire straight into this without touching maskan.ts again.
export function submitPropertyReport(propertyId: number, body: { reason: PropertyReportReason; comment?: string }) {
  return requestJson<ApiPropertyReport>(`/properties/${propertyId}/reports`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Mediators ────────────────────────────────────────────────────────────────

export type ApiPartnerArea = {
  id: number;
  mediator_id: number;
  area_name: string;
  city: string;
  created_at: string;
};
export type ApiPartner = {
  id: number;
  user_id: number;
  license_number: string;
  agency_name: string | null;
  phone: string;
  bio: string | null;
  profile_image_url: string | null;
  subscription_status: string;
  subscription_tier: string;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  total_leads_accepted: number;
  is_verified: boolean;
  approval_status: string; // "pending" | "approved" | "rejected"
  created_at: string;
  areas: ApiPartnerArea[];
};

export type ApiPartnerPublic = {
  id: number;
  agency_name: string | null;
  phone: string;
  bio: string | null;
  profile_image_url: string | null;
  is_verified: boolean;
  total_leads_accepted: number;
  created_at: string;
  areas: ApiPartnerArea[];
  // Trust & Activity (Prompt 4 — Property Verification & Trust Center,
  // spec section 11; consumed by Prompt 9's mediator profile page).
  // Mirrors schemas/mediator.py::MediatorPublicOut's added fields exactly.
  // `verification_label` is either the single allowed
  // "✓ Verified by myMakan" phrase or null — never a different claim.
  verification_label: string | null;
  avg_rating: number | null;
  review_count: number;
  active_listing_count: number;
  rental_listing_count: number;
  sale_listing_count: number;
  member_since: string | null;
  response_rate: number | null;
  avg_response_time_hours: number | null;
};

export function fetchPublicPartners(city?: string) {
  const q = city ? `?city=${encodeURIComponent(city)}` : "";
  return requestJson<ApiPartnerPublic[]>(`/mediators/public${q}`);
}

export function fetchPublicPartner(id: number) {
  return requestJson<ApiPartnerPublic>(`/mediators/${id}/public`);
}

export function fetchPropertiesByMediator(mediatorId: number) {
  return requestJson<ApiProperty[]>(`/properties/?mediator_id=${mediatorId}&limit=50`);
}

// AI-generated mediator Review Summary (Prompt 4/9 — Property Verification &
// Trust Center's "Review Summary" block, spec section 12). Deliberately a
// distinct name/type from ApiReviewSummary below (the deterministic rating
// distribution from GET /reviews/mediator/{id}/summary, used by the
// pre-existing aggregate card on this page) — this hits a different
// endpoint (GET /mediators/{id}/review-summary) that AI-summarizes review
// TEXT into positive themes/considerations, gated behind a minimum review
// count with a deterministic {avg_rating, review_count, note} fallback
// below it. Mirrors schemas/review_summary.py::ReviewSummaryOut.
export type ApiMediatorAiReviewSummary = {
  mediator_id: number;
  avg_rating: number | null;
  review_count: number;
  positive_themes: string[];
  considerations: string[];
  generated_by: "ai" | "fallback";
  note: string | null;
};

export function fetchMediatorAiReviewSummary(mediatorId: number, language: "en" | "ar" = "en") {
  return requestJson<ApiMediatorAiReviewSummary>(
    `/mediators/${mediatorId}/review-summary?language=${language}`,
  );
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export type ApiReview = {
  id: number;
  mediator_id: number;
  user_id: number | null;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  status: string; // "pending" | "approved" | "rejected"
  created_at: string;
};

export type ApiReviewAdmin = ApiReview & {
  mediator_agency_name: string | null;
};

export type ApiReviewSummary = {
  avg_rating: number | null;
  review_count: number;
  distribution: Record<string, number>; // "1"–"5" → count
};

export function fetchMediatorReviews(mediatorId: number) {
  return requestJson<ApiReview[]>(`/reviews/mediator/${mediatorId}`);
}

export function fetchMediatorReviewSummary(mediatorId: number) {
  return requestJson<ApiReviewSummary>(`/reviews/mediator/${mediatorId}/summary`);
}

export function fetchMyReview(mediatorId: number) {
  return requestJson<ApiReview | null>(`/reviews/my/${mediatorId}`);
}

export function submitReview(payload: { mediator_id: number; rating: number; comment?: string }) {
  return requestJson<ApiReview>("/reviews/", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchPendingReviews() {
  return requestJson<ApiReviewAdmin[]>("/reviews/admin/pending");
}

export function fetchAllReviews(status?: string) {
  const q = status ? `?status=${status}` : "";
  return requestJson<ApiReviewAdmin[]>(`/reviews/admin/all${q}`);
}

export function moderateReview(id: number, status: "approved" | "rejected") {
  return requestJson<ApiReviewAdmin>(`/reviews/admin/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function fetchMyPartnerProfile() {
  return requestJson<ApiPartner>("/mediators/me");
}

export function registerPartner(payload: {
  license_number: string;
  agency_name?: string;
  phone: string;
  bio?: string;
}) {
  return requestJson<ApiPartner>("/mediators/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMediatorProfile(payload: {
  agency_name?: string;
  phone?: string;
  bio?: string;
}) {
  return requestJson<ApiPartner>("/mediators/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function subscribePartnerMock() {
  return requestJson<{ status: string; subscription_expires_at: string }>(
    "/mediators/me/subscribe",
    { method: "POST" },
  );
}

export function addPartnerArea(area_name: string, city: string) {
  return requestJson<ApiPartnerArea>("/mediators/me/areas", {
    method: "POST",
    body: JSON.stringify({ area_name, city }),
  });
}

export function removePartnerArea(area_id: number) {
  return requestJson<void>(`/mediators/me/areas/${area_id}`, { method: "DELETE" });
}

// ── Leads ────────────────────────────────────────────────────────────────────

export type ApiLeadSuggestion = {
  id: number;
  lead_id: number;
  property_id: number | null;
  match_score: number;
  reason: string | null;
  created_at: string;
  property_title: string | null;
  monthly_rent: number | null;
  bedrooms: number | null;
};
export type ApiLeadAssignment = {
  id: number;
  lead_id: number;
  mediator_id: number | null;
  status: string;
  assigned_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  expires_at: string;
  mediator_agency_name: string | null;
  mediator_phone: string | null;
};
export type ApiLeadSummary = {
  id: number;
  area_name: string;
  city: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  max_budget: number | null;
  bedrooms_needed: number | null;
  created_at: string;
};
export type ApiLeadDetail = {
  id: number;
  customer_user_id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  area_name: string;
  city: string;
  min_budget: number | null;
  max_budget: number | null;
  bedrooms_needed: number | null;
  move_in_date: string | null;
  requirements_note: string | null;
  status: string;
  source: string;
  created_at: string;
  closed_at: string | null;
  closure_outcome: string | null;
  closure_note: string | null;
  closure_requested_at: string | null;
  suggestions: ApiLeadSuggestion[];
  assignments: ApiLeadAssignment[];
};
export type ApiLeadMessage = {
  id: number;
  lead_id: number;
  sender_user_id: number | null;
  sender_role: string;
  content: string;
  is_read: boolean;
  created_at: string;
};

export function createLead(payload: {
  area_name: string;
  city: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  min_budget?: number;
  max_budget?: number;
  bedrooms_needed?: number;
  move_in_date?: string;
  requirements_note?: string;
}) {
  return requestJson<ApiLeadDetail>("/leads/", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchMyLeads() {
  return requestJson<ApiLeadSummary[]>("/leads/my");
}

export function fetchUnreadCount() {
  return requestJson<{ count: number }>("/leads/my/unread-count");
}

export type ApiNotification = {
  lead_id: number;
  area_name: string;
  city: string;
  unread_count: number;
  latest_message: string;
  latest_message_at: string;
  sender_role: string;
};

export function fetchNotifications() {
  return requestJson<ApiNotification[]>("/leads/my/notifications");
}

export function fetchLead(lead_id: number) {
  return requestJson<ApiLeadDetail>(`/leads/${lead_id}`);
}

export function fetchPartnerLeads(status?: string) {
  const q = status ? `?status_filter=${status}` : "";
  return requestJson<ApiLeadDetail[]>(`/leads/mediator/assigned${q}`);
}

export type ApiLeadAvailable = {
  id: number;
  area_name: string;
  city: string;
  min_budget: number | null;
  max_budget: number | null;
  bedrooms_needed: number | null;
  move_in_date: string | null;
  requirements_note: string | null;
  status: string;
  created_at: string;
  suggestions: ApiLeadSuggestion[];
};

export function fetchAvailableLeads() {
  return requestJson<ApiLeadAvailable[]>("/leads/available");
}

export function acceptLead(lead_id: number) {
  return requestJson<{ status: string; payment_amount: number }>(`/leads/${lead_id}/accept`, {
    method: "POST",
  });
}

export function rejectLead(lead_id: number) {
  return requestJson<{ status: string }>(`/leads/${lead_id}/reject`, { method: "POST" });
}

export function fetchLeadMessages(lead_id: number) {
  return requestJson<ApiLeadMessage[]>(`/leads/${lead_id}/messages`);
}

export function sendLeadMessage(lead_id: number, content: string) {
  return requestJson<ApiLeadMessage>(`/leads/${lead_id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

// ── Visit & Viewing Management (Prompt 7) ───────────────────────────────────
// Types mirror backend/app/schemas/property_viewing.py exactly — see
// docs/implementation/mymakan-viewings.md "APIs" for the full endpoint list.

export type ApiPropertyViewing = {
  id: number;
  property_id: number;
  customer_user_id: number;
  mediator_id: number | null;
  lead_id: number | null;
  requested_start_at: string;
  requested_end_at: string;
  confirmed_start_at: string | null;
  confirmed_end_at: string | null;
  timezone: string;
  status: string;
  customer_note: string | null;
  mediator_note: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  proposed_start_at: string | null;
  proposed_end_at: string | null;
  proposed_by: string | null;
  interest_level: string | null;
  feedback_reason: string | null;
  feedback_note: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  property_title: string | null;
  property_image_url: string | null;
  property_area: string | null;
  property_city: string | null;
  mediator_agent_name: string | null;
  // Only present on the customer-facing detail response
  // (GET/PATCH /viewings/{id}, PropertyViewingDetailOut on the backend) —
  // undefined on list responses (PropertyViewingOut, no checklist embedded
  // there) and never present at all on the mediator-facing schema (Prompt 5:
  // private_notes/checklist are customer-only).
  checklist?: ApiViewingChecklist | null;
  private_notes?: ApiViewingPrivateNote[];
};

export type ApiViewingChecklistItem = {
  id: string;
  text: string;
  why_it_matters: string | null;
};

export type ApiViewingChecklistSection = {
  key: string;
  title: string;
  items: ApiViewingChecklistItem[];
};

export type ApiViewingChecklist = {
  sections: ApiViewingChecklistSection[];
  visit_plan_summary: string | null;
  generated_by: "ai" | "deterministic";
  checked: Record<string, boolean>;
};

export type ApiViewingPrivateNote = {
  text: string;
  created_at: string;
};

// Statuses that mean "no longer active" — mirrors the backend's
// PROPERTY_VIEWING_INACTIVE_STATUSES (app/models/property_viewing.py).
export const VIEWING_INACTIVE_STATUSES = [
  "cancelled_by_customer",
  "cancelled_by_mediator",
  "completed",
  "no_show_customer",
  "no_show_mediator",
] as const;

export function createViewing(payload: {
  property_id: number;
  requested_start_at: string;
  requested_end_at: string;
  timezone?: string;
  customer_note?: string;
}) {
  return requestJson<ApiPropertyViewing>("/viewings", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchMyViewings(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return requestJson<ApiPropertyViewing[]>(`/viewings${q}`);
}

export function fetchViewing(id: number) {
  return requestJson<ApiPropertyViewing>(`/viewings/${id}`);
}

export function cancelViewing(id: number, reason: string, note?: string) {
  return requestJson<ApiPropertyViewing>(`/viewings/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason, note }),
  });
}

export function proposeViewingTime(id: number, payload: { start_at: string; end_at: string; note?: string }) {
  return requestJson<ApiPropertyViewing>(`/viewings/${id}/propose-time`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function acceptViewingReschedule(id: number) {
  return requestJson<ApiPropertyViewing>(`/viewings/${id}/accept-reschedule`, { method: "POST" });
}

export const VIEWING_CUSTOMER_CANCEL_REASONS = [
  "Plans changed",
  "Found another property",
  "Time no longer works",
  "Other",
] as const;

// ── AI Viewing Checklist + post-viewing feedback/next-steps (Prompt 9) ─────
// No dedicated GET-checklist endpoint — the backend embeds `checklist` +
// `private_notes` straight onto GET /viewings/{id}'s response
// (PropertyViewingDetailOut), so `fetchViewing` above already returns it;
// nothing extra to fetch here beyond that.

export function updateViewingChecklist(id: number, patch: { checked?: Record<string, boolean>; note?: string }) {
  return requestJson<ApiPropertyViewing>(`/viewings/${id}/checklist`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export const VIEWING_INTEREST_LEVELS = ["Very Interested", "Maybe", "Not Interested"] as const;
export const VIEWING_FEEDBACK_REASONS = ["Price", "Location", "Size", "Condition", "Amenities", "Other"] as const;

export function submitViewingFeedback(id: number, payload: { interest_level: string; note?: string; reason?: string }) {
  return requestJson<ApiPropertyViewing>(`/viewings/${id}/feedback`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchViewingNextSteps(id: number) {
  return requestJson<{ visit_summary: string; next_steps: string[]; generated_by: "ai" | "fallback" }>(
    `/viewings/${id}/ai-next-steps`,
    { method: "POST" },
  );
}

// ── Partner portal viewing requests (Prompt 10) ─────────────────────────────
// Mirrors backend/app/api/routes/partner_viewings.py exactly — see
// docs/implementation/mymakan-viewings.md "APIs" for the full endpoint list.

export type ApiPartnerPropertyViewing = ApiPropertyViewing & {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
};

export const VIEWING_MEDIATOR_CANCEL_REASONS = [
  "Property unavailable",
  "Owner unavailable",
  "Schedule conflict",
  "Other",
] as const;

export function fetchPartnerViewings(status?: string) {
  const q = status ? `?status_filter=${encodeURIComponent(status)}` : "";
  return requestJson<ApiPartnerPropertyViewing[]>(`/partner/viewings${q}`);
}

export function fetchPartnerViewing(id: number) {
  return requestJson<ApiPartnerPropertyViewing>(`/partner/viewings/${id}`);
}

export function confirmViewing(id: number, mediatorNote?: string) {
  return requestJson<ApiPartnerPropertyViewing>(`/partner/viewings/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ mediator_note: mediatorNote }),
  });
}

export function proposeViewingTimeAsPartner(id: number, payload: { start_at: string; end_at: string; note?: string }) {
  return requestJson<ApiPartnerPropertyViewing>(`/partner/viewings/${id}/propose-time`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelViewingAsPartner(id: number, reason: string, note?: string) {
  return requestJson<ApiPartnerPropertyViewing>(`/partner/viewings/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason, note }),
  });
}

export function completeViewing(id: number) {
  return requestJson<ApiPartnerPropertyViewing>(`/partner/viewings/${id}/complete`, { method: "POST" });
}

export function markViewingNoShow(id: number, who: "customer" | "mediator") {
  return requestJson<ApiPartnerPropertyViewing>(`/partner/viewings/${id}/no-show`, {
    method: "POST",
    body: JSON.stringify({ who }),
  });
}

export function markLeadMessagesRead(lead_id: number) {
  return requestJson<{ marked_read: number }>(`/leads/${lead_id}/messages/read`, {
    method: "POST",
  });
}

// ── AI Negotiation & Offer Management (Prompt 7) ────────────────────────────
// Mirrors backend/app/schemas/property_negotiation.py exactly — see
// docs/implementation/mymakan-negotiations.md "Models"/"APIs" for the
// authoritative shape reference. `ApiNegotiationInsight` (defined above,
// under "Property Intelligence") already matches NegotiationInsightOut's
// shape field-for-field, so it's reused here rather than redeclared.

// NOTE on amount fields: the backend declares these `Decimal` (not `float`,
// unlike e.g. Property.monthly_rent/sale_price) — pydantic v2 serializes
// Decimal to a JSON STRING by default to avoid float precision loss, unlike
// Property's plain-float price fields. Verified against a live dev-server
// response (`"current_offer_amount":"13500.00"`, quoted). Always wrap these
// in `Number(...)` before doing arithmetic/formatting.
export type ApiNegotiationOffer = {
  id: number;
  negotiation_id: number;
  offered_by_user_id: number | null;
  amount: string;
  message: string | null;
  offer_type: "customer_offer" | "mediator_counter" | "customer_counter";
  status: "pending" | "accepted" | "rejected" | "superseded";
  expires_at: string | null;
  created_at: string;
};

export type ApiPropertyNegotiation = {
  id: number;
  property_id: number;
  customer_user_id: number;
  mediator_id: number | null;
  lead_id: number | null;
  viewing_id: number | null;
  transaction_type: string;
  status: "submitted" | "countered" | "accepted" | "rejected" | "withdrawn" | "closed";
  current_offer_amount: string;
  original_listing_amount: string;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  closed_at: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  // Denormalized by the backend so list/detail screens don't need N+1 fetches.
  property_title: string | null;
  property_image_url: string | null;
  property_area: string | null;
  property_district: string | null;
  property_listing_amount: string | null;
  mediator_agent_name: string | null;
  // Added in Prompt 12 — now populated on list/create/action responses too
  // (previously detail-only), so the My Negotiations / partner inbox list
  // cards can render the same strength badge the detail screens already do.
  negotiation_signal: ApiNegotiationSignal | null;
};

export type ApiAgreementSummary = {
  property_id: number;
  property_title: string | null;
  customer_name: string | null;
  mediator_agent_name: string | null;
  transaction_type: string;
  original_listing_amount: string;
  final_agreed_amount: string;
  agreed_at: string | null;
  negotiation_reference: string;
};

// Echo of backend/app/services/negotiation_signals.py::NegotiationSignal —
// the real deterministic strength classification (see
// negotiations.$id.tsx, which used to approximate this client-side before
// the backend started embedding it).
export type ApiNegotiationSignal = {
  signal:
    | "within_market_range"
    | "below_market_range"
    | "above_market_range"
    | "close_to_asking_price"
    | "significant_discount_requested"
    | "limited_comparable_data";
  label: string;
};

export type ApiPropertyNegotiationDetail = ApiPropertyNegotiation & {
  offers: ApiNegotiationOffer[];
  negotiation_insight: ApiNegotiationInsight | null;
  // negotiation_signal itself now comes from the base ApiPropertyNegotiation
  // (Prompt 12 — see that type).
  summary_text: string;
  agreement_summary: ApiAgreementSummary | null;
};

// POST /properties/{id}/negotiations — creates a negotiation from the
// customer's first offer. `viewing_id` is only trusted server-side after the
// service layer verifies it belongs to this customer + property and is
// `completed` — see create_negotiation()'s docstring.
export function createNegotiation(
  propertyId: number,
  payload: { amount: number; message?: string; viewing_id?: number },
) {
  return requestJson<ApiPropertyNegotiation>(`/properties/${propertyId}/negotiations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMyNegotiations(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return requestJson<ApiPropertyNegotiation[]>(`/negotiations${q}`);
}

// GET /negotiations/{id} — full detail (offer history, negotiation_insight,
// the deterministic myMakan Summary, and — once accepted — the Agreement
// Summary). `language` only affects the deterministic `summary_text` field.
export function fetchNegotiation(id: number, language?: "en" | "ar") {
  const q = language ? `?language=${language}` : "";
  return requestJson<ApiPropertyNegotiationDetail>(`/negotiations/${id}${q}`);
}

// GET /properties/{id}/negotiations/active — 404s (thrown as an Error by
// requestJson) when the caller has no active negotiation for this property;
// callers are expected to `.catch(() => null)` this, same idiom as
// fetchAreaIntelligence/fetchPropertyIntelligence's own soft-fail calls.
export function fetchActiveNegotiation(propertyId: number) {
  return requestJson<ApiPropertyNegotiation>(`/properties/${propertyId}/negotiations/active`);
}

// ── Negotiation Detail actions (Prompt 8) ───────────────────────────────────
// Counter Again / Accept / Withdraw / Ask myMakan, backing
// frontend/src/routes/negotiations.$id.tsx. All four mutating actions return
// only PropertyNegotiationOut (no offers/summary_text/negotiation_insight —
// see backend/app/api/routes/negotiations.py's response_model on each
// route), so callers re-fetch via fetchNegotiation() after a successful call
// to refresh the timeline/signal/summary rather than trying to merge a
// partial response into local state.

// POST /negotiations/{id}/offer — customer's "Counter Again" action.
export function submitCounterOffer(id: number, payload: { amount: number; message?: string }) {
  return requestJson<ApiPropertyNegotiation>(`/negotiations/${id}/offer`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// POST /negotiations/{id}/accept — customer accepting the mediator's latest
// counter. 409 (surfaced as a thrown Error by requestJson) if there's no
// pending offer to accept, or if the latest pending offer was placed by this
// same customer (self-accept blocked — see tracking doc "Status flow").
export function acceptNegotiation(id: number) {
  return requestJson<ApiPropertyNegotiation>(`/negotiations/${id}/accept`, { method: "POST" });
}

// Closed reason list from brief §11 (customer withdrawal) — the backend
// accepts any string (NegotiationWithdrawRequest.reason has no enum
// validation), but the frontend is expected to offer this closed list, same
// convention VIEWING_CUSTOMER_CANCEL_REASONS already established.
export const NEGOTIATION_CUSTOMER_WITHDRAW_REASONS = [
  "Changed mind",
  "Found another property",
  "Budget changed",
  "Other",
] as const;

// POST /negotiations/{id}/withdraw
export function withdrawNegotiation(id: number, reason: string) {
  return requestJson<ApiPropertyNegotiation>(`/negotiations/${id}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// POST /negotiations/{id}/ai-guidance — "Ask myMakan". Rate-limited on the
// backend (20/10min per user) same as every other on-request AI endpoint;
// `generated_by` is "ai" | "fallback" — never throws on an AI failure, the
// backend degrades to a deterministic reply instead (see negotiation_ai.
// generate_guidance's docstring).
export function fetchNegotiationGuidance(id: number, question: string | undefined, language: "en" | "ar") {
  return requestJson<{ guidance: string; generated_by: "ai" | "fallback" }>(`/negotiations/${id}/ai-guidance`, {
    method: "POST",
    body: JSON.stringify({ question: question || undefined, language }),
  });
}

// ── Partner portal negotiations (Prompt 10) ─────────────────────────────────
// Mirrors backend/app/api/routes/partner_negotiations.py exactly — see
// docs/implementation/mymakan-negotiations.md "APIs" (Prompt 4) for the
// authoritative endpoint list. Follows the exact same
// extend-the-customer-type-with-denormalized-contact-fields shape
// ApiPartnerPropertyViewing already established for viewings above
// (PartnerNegotiationOut/PartnerNegotiationDetailOut in
// backend/app/schemas/property_negotiation.py). Note:
// PartnerNegotiationDetailOut does NOT declare summary_text/agreement_summary
// (see that schema's docstring — Agreement Summary stayed customer-side-only
// as of Prompt 6), so ApiPartnerNegotiationDetail intentionally omits them
// too rather than declaring fields the backend will never send.

export type ApiPartnerNegotiation = ApiPropertyNegotiation & {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
};

export type ApiPartnerNegotiationDetail = ApiPartnerNegotiation & {
  offers: ApiNegotiationOffer[];
  negotiation_insight: ApiNegotiationInsight | null;
  // negotiation_signal comes from the base ApiPropertyNegotiation (Prompt 12).
};

export function fetchPartnerNegotiations(status?: string) {
  const q = status ? `?status_filter=${encodeURIComponent(status)}` : "";
  return requestJson<ApiPartnerNegotiation[]>(`/partner/negotiations${q}`);
}

export function fetchPartnerNegotiation(id: number) {
  return requestJson<ApiPartnerNegotiationDetail>(`/partner/negotiations/${id}`);
}

// POST /partner/negotiations/{id}/counter — mediator's "Counter Offer"
// action. 409 if the negotiation isn't currently submitted/countered, 422
// for a non-positive amount (same rules as the customer's submitCounterOffer).
export function counterNegotiationAsPartner(id: number, payload: { amount: number; message?: string }) {
  return requestJson<ApiPartnerNegotiation>(`/partner/negotiations/${id}/counter`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// POST /partner/negotiations/{id}/accept — mediator accepting the customer's
// latest offer/counter. 409 if there's no pending offer to accept, OR if the
// latest pending offer was placed by this same mediator's own user account
// (self-accept blocked — see tracking doc "Status flow").
export function acceptNegotiationAsPartner(id: number) {
  return requestJson<ApiPartnerNegotiation>(`/partner/negotiations/${id}/accept`, { method: "POST" });
}

// Closed reason list from brief §11 (mediator rejection) — mirrors
// NEGOTIATION_CUSTOMER_WITHDRAW_REASONS' convention; the backend accepts any
// string (NegotiationRejectRequest.reason has no enum validation).
export const NEGOTIATION_MEDIATOR_REJECT_REASONS = [
  "Offer too low",
  "Property no longer available",
  "Owner declined",
  "Other",
] as const;

// POST /partner/negotiations/{id}/reject — mediator-only, no customer-side
// equivalent. Valid from submitted/countered (409 otherwise).
export function rejectNegotiationAsPartner(id: number, reason: string) {
  return requestJson<ApiPartnerNegotiation>(`/partner/negotiations/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ── Contracts ────────────────────────────────────────────────────────────────

export type ApiContract = {
  id: number;
  lead_id: number;
  tenant_user_id: number;
  landlord_mediator_id: number;
  property_id: number | null;
  rent_amount: number;
  deposit_amount: number | null;
  start_date: string;
  end_date: string;
  status: string; // draft | pending_signature | active | expired
  tenant_signed_at: string | null;
  landlord_signed_at: string | null;
  created_at: string;
  updated_at: string;
  tenant_name: string | null;
  landlord_agency_name: string | null;
  property_title: string | null;
};

export function createContract(payload: {
  lead_id: number;
  property_id?: number;
  rent_amount: number;
  deposit_amount?: number;
  start_date: string;
  end_date: string;
}) {
  return requestJson<ApiContract>("/contracts/", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchMyContracts() {
  return requestJson<ApiContract[]>("/contracts/my");
}

export function fetchContract(contract_id: number) {
  return requestJson<ApiContract>(`/contracts/${contract_id}`);
}

export function signContract(contract_id: number) {
  return requestJson<ApiContract>(`/contracts/${contract_id}/sign`, { method: "POST" });
}

export type ApiContractFlag = {
  category: string;
  severity: "info" | "warning" | "high";
  message: string;
};

export type ApiContractFlagsResponse = {
  flags: ApiContractFlag[];
  district_avg_monthly_rent: number | null;
  generated_by: "ai" | "fallback";
};

export function fetchContractFlags(contract_id: number) {
  return requestJson<ApiContractFlagsResponse>("/ai/contract-flags", {
    method: "POST",
    body: JSON.stringify({ contract_id }),
  });
}

// ── AI Rental Score ──────────────────────────────────────────────────────────

export type ApiRentalScoreRequest = {
  listing_type: "rent" | "sale";
  monthly_rent?: number | null;
  sale_price?: number | null;
  bedrooms?: number | null;
  area: string;
  city: string;
};

export type ApiRentalScoreResponse = {
  score: number;
  reasoning: string;
  generated_by: "ai" | "fallback";
  district_avg_monthly_rent: number | null;
  district_area_score: number | null;
};

export function fetchRentalScore(payload: ApiRentalScoreRequest) {
  return requestJson<ApiRentalScoreResponse>("/ai/rental-score", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchAdminMediators() {
  return requestJson<ApiPartner[]>("/mediators/");
}

export function patchMediatorAdmin(
  mediator_id: number,
  payload: { is_verified?: boolean; subscription_status?: string; approval_status?: string },
) {
  return requestJson<ApiPartner>(`/mediators/${mediator_id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function approvePartner(mediator_id: number) {
  return requestJson<ApiPartner>(`/mediators/${mediator_id}/approve`, { method: "POST" });
}

export function rejectPartner(mediator_id: number) {
  return requestJson<ApiPartner>(`/mediators/${mediator_id}/reject`, { method: "POST" });
}

export type AdminPartnerCreatePayload = {
  email: string;
  password: string;
  full_name?: string;
  license_number: string;
  agency_name?: string;
  phone: string;
  bio?: string;
  profile_image_url?: string;
  is_verified?: boolean;
  subscription_status?: string;
};

export function adminCreatePartner(payload: AdminPartnerCreatePayload) {
  return requestJson<ApiPartner>("/mediators/admin/create", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiUser = {
  id: number;
  email: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  role: "admin" | "partner" | "customer";
};

export function fetchAdminUsers() {
  return requestJson<ApiUser[]>("/users/");
}

export function adminCreateUser(payload: {
  email: string;
  password: string;
  full_name?: string;
  phone?: string;
  role?: string;
}) {
  return requestJson<ApiUser>("/users/", { method: "POST", body: JSON.stringify(payload) });
}

export function adminUpdateUser(
  id: number,
  payload: {
    full_name?: string;
    phone?: string;
    email?: string;
    is_active?: boolean;
    password?: string;
    role?: string;
  },
) {
  return requestJson<ApiUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function fetchAdminLeads() {
  return requestJson<ApiLeadDetail[]>("/leads/admin/all");
}

export function adminForceCloseLead(lead_id: number, status: "closed_won" | "closed_lost") {
  return requestJson<ApiLeadDetail>(`/leads/admin/${lead_id}/close`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function patchLeadStatus(lead_id: number, status: string, note?: string) {
  return requestJson<ApiLeadDetail>(`/leads/${lead_id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, note }),
  });
}

export function adminApproveLead(lead_id: number) {
  return requestJson<ApiLeadDetail>(`/leads/admin/${lead_id}/approve`, { method: "PATCH" });
}

export function adminRejectLead(lead_id: number) {
  return requestJson<ApiLeadDetail>(`/leads/admin/${lead_id}/reject`, { method: "PATCH" });
}

export function adminApproveClosure(lead_id: number) {
  return requestJson<ApiLeadDetail>(`/leads/admin/${lead_id}/approve-closure`, { method: "PATCH" });
}

export function adminRejectClosure(lead_id: number) {
  return requestJson<ApiLeadDetail>(`/leads/admin/${lead_id}/reject-closure`, { method: "PATCH" });
}

export function adminSendMessage(lead_id: number, content: string) {
  return requestJson<ApiLeadMessage>(`/leads/admin/${lead_id}/message`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function adminFetchMessages(lead_id: number) {
  return requestJson<ApiLeadMessage[]>(`/leads/admin/${lead_id}/messages`);
}

// ── Saved search alerts ────────────────────────────────────────────────────
// Mirrors the backend's canonical `PropertyFilterCriteria`
// (app/core/search/filters.py) — the one filter shape saved searches, the
// matching engine, and the preview endpoint all agree on.
export type ApiPropertyFilterCriteria = {
  keyword?: string;
  transaction_type?: "rent" | "sale" | null;
  property_type?: string | null;
  city?: string | null;
  districts?: string[];
  min_price?: number | null;
  max_price?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  min_area_sq_m?: number | null;
  max_area_sq_m?: number | null;
  furnishing?: string | null;
  amenities?: string[];
  mediator_id?: number | null;
  verified_only?: boolean;
  min_lat?: number | null;
  max_lat?: number | null;
  min_lng?: number | null;
  max_lng?: number | null;
  sort?: "newest" | "price_asc" | "price_desc";
};

export type AlertFrequency = "instant" | "daily" | "weekly" | "off";
export type NotificationChannel = "in_app" | "push" | "email";

export type ApiSavedSearch = {
  id: number;
  name: string;
  locale: string;
  filters: ApiPropertyFilterCriteria;
  filter_schema_version: number;
  alert_enabled: boolean;
  alert_frequency: AlertFrequency;
  channels: NotificationChannel[];
  last_evaluated_at: string | null;
  last_notified_at: string | null;
  status: "active" | "disabled";
  user_id: number;
  created_at: string;
  updated_at: string;
  latest_matches_count: number;
};

export type SavedSearchDuplicateError = {
  message: string;
  duplicate_of: { id: number; name: string };
};

export class DuplicateSavedSearchError extends Error {
  duplicateOf: { id: number; name: string };
  constructor(detail: SavedSearchDuplicateError) {
    super(detail.message);
    this.name = "DuplicateSavedSearchError";
    this.duplicateOf = detail.duplicate_of;
  }
}

export function fetchSavedSearches() {
  return requestJson<ApiSavedSearch[]>("/saved-searches/");
}

// Direct fetch (bypasses requestJson's string-only `detail` parsing) so the
// structured 409 duplicate-candidate payload can be surfaced as a typed error.
export async function createSavedSearch(payload: {
  name: string;
  locale?: string;
  filters: ApiPropertyFilterCriteria;
  alert_enabled?: boolean;
  alert_frequency?: AlertFrequency;
  channels?: NotificationChannel[];
  confirm_duplicate?: boolean;
}) {
  const token = typeof window !== "undefined" ? readStoredToken(currentScope()) : null;
  const response = await fetch(`${API_BASE_URL}/saved-searches/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 409) {
    const body = (await response.json()) as { detail?: SavedSearchDuplicateError | string };
    if (body.detail && typeof body.detail === "object" && "duplicate_of" in body.detail) {
      throw new DuplicateSavedSearchError(body.detail);
    }
    throw new Error(
      typeof body.detail === "string" ? body.detail : "This saved search already exists.",
    );
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<ApiSavedSearch>;
}

export function updateSavedSearch(
  id: number,
  payload: Partial<{
    name: string;
    filters: ApiPropertyFilterCriteria;
    alert_enabled: boolean;
    alert_frequency: AlertFrequency;
    channels: NotificationChannel[];
    status: "active" | "disabled";
  }>,
) {
  return requestJson<ApiSavedSearch>(`/saved-searches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSavedSearch(id: number) {
  return requestJson<void>(`/saved-searches/${id}`, { method: "DELETE" });
}

export function enableSavedSearchAlerts(id: number) {
  return requestJson<ApiSavedSearch>(`/saved-searches/${id}/enable-alerts`, { method: "POST" });
}

export function disableSavedSearchAlerts(id: number) {
  return requestJson<ApiSavedSearch>(`/saved-searches/${id}/disable-alerts`, { method: "POST" });
}

export type ApiSavedSearchPreview = {
  estimated_count: number;
  duplicate_of: { id: number; name: string; created_at: string } | null;
};

export function previewSavedSearch(filters: ApiPropertyFilterCriteria) {
  return requestJson<ApiSavedSearchPreview>("/saved-searches/preview", {
    method: "POST",
    body: JSON.stringify(filters),
  });
}

export function previewExistingSavedSearch(id: number) {
  return requestJson<ApiSavedSearchPreview>(`/saved-searches/${id}/preview`, { method: "POST" });
}

export type ApiSavedSearchMatch = {
  id: number;
  property_id: number;
  change_type: string;
  match_reasons: Array<{ code: string; [key: string]: unknown }>;
  match_score: number;
  notified: boolean;
  created_at: string;
};

export function fetchSavedSearchMatches(id: number, params?: { skip?: number; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.skip) q.set("skip", String(params.skip));
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return requestJson<ApiSavedSearchMatch[]>(`/saved-searches/${id}/matches${qs ? `?${qs}` : ""}`);
}

// ── Notification Center ─────────────────────────────────────────────────────
export type ApiNotificationRecord = {
  id: number;
  type: string;
  title: string;
  body: string;
  locale: string;
  entity_type: string | null;
  entity_id: number | null;
  saved_search_id: number | null;
  property_id: number | null;
  match_reasons: Array<{ code: string; [key: string]: unknown }> | null;
  deep_link: string | null;
  read_at: string | null;
  seen_at: string | null;
  delivery_status: Record<string, string>;
  ai_generated: boolean;
  created_at: string;
  expires_at: string | null;
  meta: { ai_explanation?: string; rule_based_explanation?: string; [key: string]: unknown };
};

export type ApiNotificationList = {
  items: ApiNotificationRecord[];
  next_cursor: string | null;
  unread_count: number;
};

export function fetchNotificationCenter(params?: {
  cursor?: string;
  type?: string;
  unreadOnly?: boolean;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.cursor) q.set("cursor", params.cursor);
  if (params?.type) q.set("type", params.type);
  if (params?.unreadOnly) q.set("unread_only", "true");
  q.set("limit", String(params?.limit ?? 20));
  return requestJson<ApiNotificationList>(`/notifications/?${q.toString()}`);
}

export function fetchUnreadNotificationCount() {
  return requestJson<{ unread_count: number }>("/notifications/unread-count");
}

export function markNotificationRead(id: number) {
  return requestJson<ApiNotificationRecord>(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return requestJson<{ updated: number }>("/notifications/read-all", { method: "POST" });
}

export function deleteNotificationRecord(id: number) {
  return requestJson<void>(`/notifications/${id}`, { method: "DELETE" });
}

export type NotificationCategoryKey =
  | "property_alerts"
  | "price_changes"
  | "saved_search_digest"
  | "lead_updates"
  | "lead_messages"
  | "review_updates"
  | "subscription_payments"
  | "ai_recommendations"
  | "product_announcements"
  | "security";

export type CategoryPreference = {
  channels: NotificationChannel[];
  frequency: AlertFrequency;
};

export type ApiNotificationPreferences = {
  in_app_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
  category_preferences: Record<NotificationCategoryKey, CategoryPreference>;
  digest_hour: number;
  weekly_digest_day: number;
  timezone: string;
  next_daily_digest_at: string | null;
  next_weekly_digest_at: string | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_allow_urgent: boolean;
  hide_message_preview: boolean;
};

export function fetchNotificationPreferences() {
  return requestJson<ApiNotificationPreferences>("/notification-preferences/");
}

export function updateNotificationPreferences(
  payload: Partial<Omit<ApiNotificationPreferences, "category_preferences">> & {
    category_preferences?: Partial<Record<NotificationCategoryKey, CategoryPreference>>;
  },
) {
  return requestJson<ApiNotificationPreferences>("/notification-preferences/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function resetNotificationPreferences() {
  return requestJson<ApiNotificationPreferences>("/notification-preferences/reset-defaults", {
    method: "POST",
  });
}

export type ApiTestPushResult = { device_id: number; status: string; detail: string | null };
export type ApiTestPushResponse = { sent: number; results: ApiTestPushResult[] };

export function sendTestPush() {
  return requestJson<ApiTestPushResponse>("/notification-preferences/test-push", {
    method: "POST",
  });
}

// ── Devices ──────────────────────────────────────────────────────────────────
export type ApiDevice = {
  id: number;
  platform: string;
  installation_id: string;
  device_id: string | null;
  app_version: string | null;
  os_version: string | null;
  locale: string | null;
  device_timezone: string | null;
  enabled: boolean;
  failure_count: number;
  invalidated_at: string | null;
  last_active_at: string | null;
  last_success_push_at: string | null;
  last_failed_push_at: string | null;
  created_at: string;
};

export function fetchDevices() {
  return requestJson<ApiDevice[]>("/devices/");
}

// ── Admin: Notification Operations ──────────────────────────────────────────
export type ApiNotificationAdminOverview = {
  window: string;
  notifications_created: number;
  notifications_opened: number;
  notification_open_rate: number;
  push_attempted: number;
  push_accepted: number;
  push_failed: number;
  push_invalid_tokens: number;
  digest_volume: number;
  digest_failures: number;
  queue_backlog: number;
  active_devices: number;
  lead_notification_volume: number;
};

export function fetchNotificationAdminOverview() {
  return requestJson<ApiNotificationAdminOverview>("/notifications/admin/overview");
}

export type ApiNotificationDelivery = {
  id: number;
  notification_id: number;
  device_id: number | null;
  channel: string;
  provider: string | null;
  provider_message_id: string | null;
  attempt_number: number;
  status: string;
  failure_code: string | null;
  failure_message: string | null;
  attempted_at: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  created_at: string;
  trace_id: string | null;
};

export function fetchNotificationDeliveries(params?: {
  notification_id?: number;
  device_id?: number;
  status?: string;
  channel?: string;
  skip?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.notification_id != null) q.set("notification_id", String(params.notification_id));
  if (params?.device_id != null) q.set("device_id", String(params.device_id));
  if (params?.status) q.set("status", params.status);
  if (params?.channel) q.set("channel", params.channel);
  q.set("skip", String(params?.skip ?? 0));
  q.set("limit", String(params?.limit ?? 50));
  return requestJson<ApiNotificationDelivery[]>(`/notifications/admin/deliveries?${q.toString()}`);
}

export function retryNotificationDelivery(id: number) {
  return requestJson<{ status: string; task_id: string | null }>(
    `/notifications/admin/deliveries/${id}/retry`,
    { method: "POST" },
  );
}

export function rerunUserDigest(userId: number, period: "daily" | "weekly") {
  return requestJson<{
    user_id: number;
    period: string;
    run_date: string;
    matches_included: number;
  }>(`/notifications/admin/digest/${userId}/rerun?period=${period}`, { method: "POST" });
}

export function sendAdminTestNotification(userId: number) {
  return requestJson<{ sent: boolean }>(`/notifications/admin/test-send?user_id=${userId}`, {
    method: "POST",
  });
}

export function fetchAdminDevices(params?: {
  platform?: string;
  enabled?: boolean;
  skip?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (params?.platform) q.set("platform", params.platform);
  if (params?.enabled != null) q.set("enabled", String(params.enabled));
  q.set("skip", String(params?.skip ?? 0));
  q.set("limit", String(params?.limit ?? 50));
  return requestJson<Array<ApiDevice & { user_id: number; user_email: string | null }>>(
    `/devices/admin/all?${q.toString()}`,
  );
}

export function disableAdminDevice(id: number) {
  return requestJson<{ status: string; device_id: number }>(`/devices/admin/${id}/disable`, {
    method: "POST",
  });
}

// ── Property Requests ────────────────────────────────────────────────────────
// The "Property Request + AI Property Agent" feature: a persistent, AI-assisted
// request that the matching engine continuously scores new/updated listings
// against — unlike a one-off saved-search alert (point-in-time filter) or a
// single-shot lead (one mediator hand-off). Endpoints live under three scopes:
// customer (`/property-requests`), partner marketplace (`/partner/property-requests`),
// and admin (`/admin/property-requests`).

export type PropertyRequestStatus =
  | "draft"
  | "awaiting_clarification"
  | "active"
  | "paused"
  | "matched"
  | "negotiating"
  | "fulfilled"
  | "expired"
  | "closed"
  | "cancelled";

export type PropertyRequestMediatorPreference = "owner_only" | "mediator_only" | "either";

export type ApiPriorityWeighting = Partial<{
  hard_fit: number;
  location_commute: number;
  budget_fit: number;
  property_specs: number;
  lifestyle_area: number;
  listing_quality: number;
  user_behavior: number;
}>;

// The exact vocabulary the backend accepts inside must_have_fields /
// nice_to_have_fields / flexible_fields — anything outside this list is
// rejected by the API, so the checklist UI must only ever offer these.
export const PROPERTY_REQUEST_FIELD_VOCAB = [
  "transaction_type",
  "city",
  "max_price",
  "min_price",
  "bedrooms_min",
  "bedrooms_max",
  "bathrooms_min",
  "bathrooms_max",
  "min_area_sq_m",
  "max_area_sq_m",
  "furnishing",
  "property_category",
  "verified_only",
  "preferred_districts",
] as const;
export type PropertyRequestFieldKey = (typeof PROPERTY_REQUEST_FIELD_VOCAB)[number];

export type ApiPropertyRequestFields = {
  title: string;
  description?: string | null;
  locale?: "en" | "ar";
  transaction_type?: "rent" | "sale" | null;
  property_category?: string | null;
  city?: string | null;
  preferred_districts?: string[];
  excluded_districts?: string[];
  min_price?: number | null;
  max_price?: number | null;
  bedrooms_min?: number | null;
  bedrooms_max?: number | null;
  bathrooms_min?: number | null;
  bathrooms_max?: number | null;
  min_area_sq_m?: number | null;
  max_area_sq_m?: number | null;
  furnishing?: string | null;
  required_amenities?: string[];
  preferred_amenities?: string[];
  property_age_preference?: string | null;
  availability_date?: string | null;
  move_in_date?: string | null;
  rental_payment_frequency?: string | null;
  mediator_preference?: PropertyRequestMediatorPreference;
  verified_only?: boolean;
  max_commute_minutes?: number | null;
  commute_destination_name?: string | null;
  commute_destination_lat?: number | null;
  commute_destination_lng?: number | null;
  school_preference?: boolean;
  hospital_preference?: boolean;
  lifestyle_preferences?: string[];
  family_size?: number | null;
  household_type?: string | null;
  accessibility_requirements?: string[];
  pet_preference?: string | null;
  notes?: string | null;
  must_have_fields?: PropertyRequestFieldKey[];
  nice_to_have_fields?: PropertyRequestFieldKey[];
  flexible_fields?: PropertyRequestFieldKey[];
  priority_weighting?: ApiPriorityWeighting;
  matching_enabled?: boolean;
  mediator_responses_enabled?: boolean;
  alert_frequency?: AlertFrequency;
};

export type PropertyRequestUpdatePayload = Partial<ApiPropertyRequestFields>;

// Out shape: every optional Create/Update field is always present (nullable
// where the field itself is nullable), plus server-computed metadata.
export type ApiPropertyRequest = Required<Omit<ApiPropertyRequestFields, "priority_weighting">> & {
  priority_weighting: ApiPriorityWeighting | null;
  id: number;
  user_id: number;
  ai_extracted_criteria: Record<string, unknown> | null;
  ai_confidence: number | null;
  clarification_status: "none" | "pending" | "resolved";
  clarification_rounds: number;
  status: PropertyRequestStatus;
  expiry_date: string | null;
  last_matched_at: string | null;
  last_customer_activity_at: string | null;
  created_at: string;
  updated_at: string;
  revision_number: number;
  match_count: number;
  new_match_count: number;
  mediator_response_count: number;
};

export type ApiPropertyRequestSummary = {
  id: number;
  title: string;
  status: PropertyRequestStatus;
  transaction_type: "rent" | "sale" | null;
  city: string | null;
  min_price: number | null;
  max_price: number | null;
  bedrooms_min: number | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
  match_count: number;
  new_match_count: number;
  mediator_response_count: number;
};

export type PropertyRequestFromTextResult = {
  draft: ApiPropertyRequest;
  ai_confidence: number;
  missing_fields: string[];
  clarifying_questions: string[];
  ai_trace_id: string | null;
};

export type ApiClarification = {
  id: number;
  round_number: number;
  question: string;
  question_locale: string;
  field_hint: string | null;
  status: "pending" | "answered";
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

export type ApiPropertyRequestMatch = {
  id: number | null;
  property_id: number;
  match_score: number;
  flexible_coverage: number;
  preference_score: number;
  price_fit_score: number;
  area_fit_score: number;
  commute_fit_score: number;
  listing_quality_score: number;
  confidence: number;
  match_reasons: Array<{ code: string; [key: string]: unknown }>;
  trade_offs: Array<{ code: string; [key: string]: unknown }>;
  match_version: string;
  status: "new" | "viewed" | "saved" | "contacted" | "dismissed" | "shortlisted" | "expired";
  created_at: string;
  updated_at: string;
};

export type ApiPropertyRequestActivity = {
  id: number;
  actor_type: "customer" | "mediator" | "admin" | "system" | "ai";
  actor_id: number | null;
  activity_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ApiNoMatchDiagnostic = {
  field: string;
  candidates_with_field: number;
  candidates_if_relaxed: number;
};

export type AreaSuggestionLabel =
  | "best_overall"
  | "best_value"
  | "best_commute"
  | "best_family"
  | "premium"
  | "flexible_alternative";

export type ApiAreaSuggestion = {
  area_name: string;
  city: string;
  fit_score: number;
  label: AreaSuggestionLabel;
  typical_price_range: [number | null, number | null] | null;
  estimated_availability: number;
  commute_estimate_minutes: number | null;
  reasons: string[];
  trade_offs: string[];
  data_confidence: number;
};

export type PropertyRequestAiAgentResult = { reply: string; ai_trace_id: string | null };

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createPropertyRequest(payload: ApiPropertyRequestFields) {
  return requestJson<ApiPropertyRequest>("/property-requests/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createPropertyRequestFromText(text: string, locale: "en" | "ar") {
  return requestJson<PropertyRequestFromTextResult>("/property-requests/from-text", {
    method: "POST",
    body: JSON.stringify({ text, locale }),
  });
}

// Direct fetch (not requestJson) so the X-Total-Count header survives —
// mirrors fetchPropertiesPaged's pattern for the same reason.
export async function fetchPropertyRequests(params?: {
  status?: PropertyRequestStatus;
  skip?: number;
  limit?: number;
}): Promise<{ data: ApiPropertyRequestSummary[]; total: number }> {
  const qs = buildQuery({ status: params?.status, skip: params?.skip, limit: params?.limit });
  const token = typeof window !== "undefined" ? readStoredToken(currentScope()) : null;
  const response = await fetch(`${API_BASE_URL}/property-requests/${qs}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = (await response.json()) as ApiPropertyRequestSummary[];
  const total = Number(response.headers.get("X-Total-Count") ?? data.length);
  return { data, total };
}

export function fetchPropertyRequest(id: number) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}`);
}

export function updatePropertyRequest(id: number, payload: PropertyRequestUpdatePayload) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function cancelPropertyRequest(id: number) {
  return requestJson<void>(`/property-requests/${id}`, { method: "DELETE" });
}

export function activatePropertyRequest(id: number) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}/activate`, { method: "POST" });
}

export function pausePropertyRequest(id: number) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}/pause`, { method: "POST" });
}

export function resumePropertyRequest(id: number) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}/resume`, { method: "POST" });
}

export function closePropertyRequest(id: number) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}/close`, { method: "POST" });
}

export function fulfillPropertyRequest(id: number) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}/fulfill`, { method: "POST" });
}

export function requestPropertyRequestClarifications(id: number) {
  return requestJson<ApiClarification[]>(`/property-requests/${id}/clarifications`, {
    method: "POST",
  });
}

export function answerPropertyRequestClarification(
  id: number,
  clarificationId: number,
  answer: string,
) {
  return requestJson<ApiClarification>(
    `/property-requests/${id}/clarifications/${clarificationId}/answer`,
    {
      method: "POST",
      body: JSON.stringify({ answer }),
    },
  );
}

export function fetchPropertyRequestMatches(
  id: number,
  params?: { status?: string; skip?: number; limit?: number },
) {
  const qs = buildQuery({ status: params?.status, skip: params?.skip, limit: params?.limit });
  return requestJson<ApiPropertyRequestMatch[]>(`/property-requests/${id}/matches${qs}`);
}

export function dismissPropertyRequestMatch(id: number, matchId: number) {
  return requestJson<ApiPropertyRequestMatch>(
    `/property-requests/${id}/matches/${matchId}/dismiss`,
    { method: "POST" },
  );
}

export function savePropertyRequestMatch(id: number, matchId: number) {
  return requestJson<ApiPropertyRequestMatch>(`/property-requests/${id}/matches/${matchId}/save`, {
    method: "POST",
  });
}

export function contactPropertyRequestMatch(id: number, matchId: number) {
  return requestJson<ApiPropertyRequestMatch>(
    `/property-requests/${id}/matches/${matchId}/contact`,
    { method: "POST" },
  );
}

export function fetchPropertyRequestActivity(
  id: number,
  params?: { skip?: number; limit?: number },
) {
  const qs = buildQuery({ skip: params?.skip, limit: params?.limit });
  return requestJson<ApiPropertyRequestActivity[]>(`/property-requests/${id}/activity${qs}`);
}

export function fetchNoMatchDiagnostics(id: number) {
  return requestJson<ApiNoMatchDiagnostic[]>(`/property-requests/${id}/no-match-diagnostics`);
}

export function fetchAreaSuggestions(id: number) {
  return requestJson<ApiAreaSuggestion[]>(`/property-requests/${id}/area-suggestions`);
}

export function previewPropertyRequestMatches(id: number) {
  return requestJson<ApiPropertyRequestMatch[]>(`/property-requests/${id}/preview-matches`, {
    method: "POST",
  });
}

export function chatWithPropertyRequestAgent(
  id: number,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  return requestJson<PropertyRequestAiAgentResult>(`/property-requests/${id}/ai-agent`, {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

// ── Partner marketplace: Property Requests ──────────────────────────────────
// Privacy-safe summaries only — no customer identity is ever present in this
// payload shape, by backend design, until a mediator engages via /respond.

export type ApiPartnerRequestSummary = {
  id: number;
  transaction_type: "rent" | "sale" | null;
  property_category: string | null;
  city: string | null;
  preferred_districts: string[];
  min_price: number | null;
  max_price: number | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  must_have_fields: string[];
  flexible_fields: string[];
  created_at: string;
  expiry_date: string | null;
  inventory_match_count: number;
  already_responded: boolean;
};

export type PartnerPropertyRequestResponseType =
  | "submit_property"
  | "submit_multiple"
  | "upcoming_inventory"
  | "clarification_question"
  | "decline";

export type ApiPartnerPropertyRequestResponse = {
  id: number;
  request_id: number;
  mediator_id: number;
  response_type: PartnerPropertyRequestResponseType;
  message: string | null;
  status: string;
  created_at: string;
  property_ids: number[];
};

export function fetchPartnerPropertyRequests(params?: {
  city?: string;
  district?: string;
  transactionType?: string;
  maxBudget?: number;
  skip?: number;
  limit?: number;
}) {
  const qs = buildQuery({
    city: params?.city,
    district: params?.district,
    transaction_type: params?.transactionType,
    max_budget: params?.maxBudget,
    skip: params?.skip,
    limit: params?.limit,
  });
  return requestJson<ApiPartnerRequestSummary[]>(`/partner/property-requests/${qs}`);
}

export function fetchPartnerPropertyRequest(id: number) {
  return requestJson<ApiPartnerRequestSummary>(`/partner/property-requests/${id}`);
}

export function fetchEligibleProperties(id: number) {
  return requestJson<ApiPropertyRequestMatch[]>(
    `/partner/property-requests/${id}/eligible-properties`,
  );
}

export function respondToPropertyRequest(
  id: number,
  payload: {
    response_type: PartnerPropertyRequestResponseType;
    message?: string;
    property_ids?: number[];
  },
) {
  return requestJson<ApiPartnerPropertyRequestResponse>(
    `/partner/property-requests/${id}/respond`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function ignorePropertyRequest(id: number) {
  return requestJson<void>(`/partner/property-requests/${id}/ignore`, { method: "POST" });
}

export function bookmarkPropertyRequest(id: number) {
  return requestJson<void>(`/partner/property-requests/${id}/save`, { method: "POST" });
}

// ── Admin: Property Requests ────────────────────────────────────────────────

export type ApiAdminPropertyRequest = {
  id: number;
  user_id: number;
  status: PropertyRequestStatus;
  city: string | null;
  transaction_type: "rent" | "sale" | null;
  min_price: number | null;
  max_price: number | null;
  created_at: string;
  expiry_date: string | null;
  match_count: number;
  mediator_response_count: number;
  ai_trace_id: string | null;
};

export type ApiPropertyRequestAnalytics = {
  total_requests: number;
  active_requests: number;
  by_status: Record<string, number>;
  by_city: Record<string, number>;
  no_match_rate: number;
  avg_time_to_first_match_hours: number | null;
  match_to_save_rate: number;
  match_to_contact_rate: number;
  mediator_response_rate: number;
  fulfillment_rate: number;
  expiry_rate: number;
};

export async function fetchAdminPropertyRequests(params?: {
  status?: string;
  city?: string;
  userId?: number;
  skip?: number;
  limit?: number;
}): Promise<{ data: ApiAdminPropertyRequest[]; total: number }> {
  const qs = buildQuery({
    status: params?.status,
    city: params?.city,
    user_id: params?.userId,
    skip: params?.skip,
    limit: params?.limit,
  });
  const token = typeof window !== "undefined" ? readStoredToken(currentScope()) : null;
  const response = await fetch(`${API_BASE_URL}/admin/property-requests/${qs}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = (await response.json()) as ApiAdminPropertyRequest[];
  const total = Number(response.headers.get("X-Total-Count") ?? data.length);
  return { data, total };
}

export function fetchAdminPropertyRequestAnalytics() {
  return requestJson<ApiPropertyRequestAnalytics>(
    "/admin/property-requests/property-request-analytics",
  );
}

export function fetchAdminPropertyRequest(id: number) {
  return requestJson<ApiAdminPropertyRequest>(`/admin/property-requests/${id}`);
}

export function adminPausePropertyRequest(id: number) {
  return requestJson<ApiAdminPropertyRequest>(`/admin/property-requests/${id}/pause`, {
    method: "POST",
  });
}

export function adminClosePropertyRequest(id: number) {
  return requestJson<ApiAdminPropertyRequest>(`/admin/property-requests/${id}/close`, {
    method: "POST",
  });
}

export function adminRetryPropertyRequestMatching(id: number) {
  return requestJson<{ status: string }>(`/admin/property-requests/${id}/retry-matching`, {
    method: "POST",
  });
}

export function adminModeratePropertyRequestResponse(
  id: number,
  responseId: number,
  action: "approve" | "reject" | "flag",
) {
  return requestJson<{ status: string }>(
    `/admin/property-requests/${id}/moderate-response?response_id=${responseId}&action=${action}`,
    { method: "POST" },
  );
}

// ── Admin: Trust & Moderation (Prompt 11 — Property Verification & Trust
// Center). Backend: backend/app/api/routes/admin_trust.py (Prompt 6),
// mounted at /admin/trust. Types mirror backend/app/schemas/admin_trust.py
// exactly — see docs/implementation/mymakan-trust-center.md "Full API
// surface (Prompts 2-6)". Reuses ApiTrustAssessment/ApiTrustCompleteness
// (Prompt 7), ApiImageQuality (Prompt 8), ApiPartnerPublic (Prompt 9),
// ApiPropertyReport (Prompt 7), and ApiPropertyIntelligence (pre-existing) —
// the admin review-detail response wraps the identical backend shapes those
// endpoints already return, so no separate types are redefined here. Gated
// purely by the existing `user.is_admin` check (same as every other
// admin_.*.tsx route) — no new permission system.

export type ApiAdminTrustDashboard = {
  listings_requiring_review: number;
  low_completeness_listings: number;
  stale_listings: number;
  open_reports: number;
  mediators_pending_verification: number;
  recently_reported_properties: number;
};

export function fetchAdminTrustDashboard() {
  return requestJson<ApiAdminTrustDashboard>("/admin/trust/dashboard");
}

export type ApiAdminModerationListItem = {
  property_id: number;
  title: string;
  transaction_type: string;
  city: string;
  area: string;
  status: string;
  mediator_id: number | null;
  mediator_name: string | null;
  mediator_verified: boolean;
  trust_score: number;
  trust_level: "High" | "Good" | "Moderate" | "Limited Confidence";
  completeness_score: number;
  freshness_category: string;
  open_report_count: number;
  updated_at: string;
};

// Direct fetch (not requestJson) so the X-Total-Count header survives —
// mirrors fetchAdminPropertyRequests's identical pattern above.
export async function fetchAdminModerationProperties(params?: {
  transactionType?: "rent" | "sale";
  city?: string;
  status?: string;
  trustLevel?: string;
  lowCompleteness?: boolean;
  reported?: boolean;
  stale?: boolean;
  mediatorVerified?: boolean;
  skip?: number;
  limit?: number;
}): Promise<{ data: ApiAdminModerationListItem[]; total: number }> {
  const qs = buildQuery({
    transaction_type: params?.transactionType,
    city: params?.city,
    status: params?.status,
    trust_level: params?.trustLevel,
    low_completeness: params?.lowCompleteness,
    reported: params?.reported,
    stale: params?.stale,
    mediator_verified: params?.mediatorVerified,
    skip: params?.skip,
    limit: params?.limit,
  });
  const token = typeof window !== "undefined" ? readStoredToken(currentScope()) : null;
  const response = await fetch(`${API_BASE_URL}/admin/trust/properties${qs}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = (await response.json()) as ApiAdminModerationListItem[];
  const total = Number(response.headers.get("X-Total-Count") ?? data.length);
  return { data, total };
}

export type ApiAdminDataQuality = {
  completeness: ApiTrustCompleteness;
  missing_field_suggestions: string[];
  image_quality: ApiImageQuality;
};

export type ApiAdminModerationHistoryEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: number | null;
  extra_metadata: Record<string, unknown>;
  created_at: string;
};

// `mediator` reuses ApiPartnerPublic — backend's MediatorPublicOut (Prompt 4)
// and ApiPartnerPublic (Prompt 9) are already field-for-field identical, so
// no duplicate type is defined here.
export type ApiAdminPropertyReviewDetail = {
  property_id: number;
  title: string;
  transaction_type: string;
  city: string;
  area: string;
  status: string;
  trust: ApiTrustAssessment;
  data_quality: ApiAdminDataQuality;
  mediator: ApiPartnerPublic | null;
  mediator_approval_status: string | null;
  reports: ApiPropertyReport[];
  property_intelligence: ApiPropertyIntelligence | null;
  moderation_history: ApiAdminModerationHistoryEntry[];
};

export function fetchAdminPropertyReviewDetail(propertyId: number) {
  return requestJson<ApiAdminPropertyReviewDetail>(`/admin/trust/properties/${propertyId}`);
}

export type ApiAdminModerationAction = { property_id: number; status: string };

export function adminHideProperty(propertyId: number, reason?: string) {
  return requestJson<ApiAdminModerationAction>(`/admin/trust/properties/${propertyId}/hide`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
  });
}

export function adminRestoreProperty(propertyId: number) {
  return requestJson<ApiAdminModerationAction>(`/admin/trust/properties/${propertyId}/restore`, {
    method: "POST",
  });
}

export type ApiAdminReportResolve = {
  id: number;
  property_id: number;
  status: string;
  resolved_at: string | null;
  resolved_by: number | null;
  resolution_notes: string | null;
};

export function adminResolveReport(
  reportId: number,
  payload: { status: "Under Review" | "Resolved" | "Dismissed"; resolution_notes?: string },
) {
  return requestJson<ApiAdminReportResolve>(`/admin/trust/reports/${reportId}/resolve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Short-term stay bookings ────────────────────────────────────────────────

export type ApiBooking = {
  id: number;
  property_id: number;
  renter_user_id: number;
  check_in: string;
  check_out: string;
  total_price: number;
  status: "confirmed" | "cancelled";
  created_at: string;
  updated_at: string;
  property_title: string | null;
  renter_name: string | null;
};

export type ApiAvailability = {
  property_id: number;
  check_in: string;
  check_out: string;
  available: boolean;
};

export type ApiAvailabilityInsight = {
  property_id: number;
  average_lead_time_days: number | null;
  sample_size: number;
  note: string;
};

export function fetchAvailability(propertyId: number, checkIn: string, checkOut: string) {
  const params = new URLSearchParams({
    property_id: String(propertyId),
    check_in: checkIn,
    check_out: checkOut,
  });
  return requestJson<ApiAvailability>(`/bookings/availability?${params.toString()}`);
}

export function fetchBookingInsights(propertyId: number) {
  return requestJson<ApiAvailabilityInsight>(`/bookings/property/${propertyId}/insights`);
}

export function createBooking(payload: {
  property_id: number;
  check_in: string;
  check_out: string;
  total_price: number;
}) {
  return requestJson<ApiBooking>("/bookings/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMyBookings() {
  return requestJson<ApiBooking[]>("/bookings/my");
}

export function cancelBooking(id: number) {
  return requestJson<ApiBooking>(`/bookings/${id}/cancel`, { method: "POST" });
}

// ── AI dynamic pricing suggestion (short-term nightly rate) ────────────────

export type ApiPricingSuggestion = {
  suggested_nightly_min: number;
  suggested_nightly_max: number;
  reasoning: string;
  season: string;
  generated_by: "ai" | "fallback";
};

export function fetchPricingSuggestion(payload: {
  area: string;
  city: string;
  monthly_rent?: number;
}) {
  return requestJson<ApiPricingSuggestion>("/ai/pricing-suggestion", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── AI Home Finder ──────────────────────────────────────────────────────────
// Backend: app/api/routes/home_finder.py + app/schemas/home_finder.py.
// Interpretation/refinement go through the AI gateway server-side; search
// itself is always the deterministic scoring engine — the frontend never
// computes a match score, it only renders what the server already scored.

export type ApiHomeFinderCriteria = {
  transaction_type?: "rent" | "sale" | null;
  city?: string | null;
  districts: string[];
  property_type?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  bedrooms?: number | null;
  required_amenities: string[];
  preferred_amenities: string[];
  unsupported_requests: string[];
  preferences: string[];
  commute_destination?: string | null;
};

export const EMPTY_HOME_FINDER_CRITERIA: ApiHomeFinderCriteria = {
  transaction_type: null,
  city: null,
  districts: [],
  property_type: null,
  min_price: null,
  max_price: null,
  bedrooms: null,
  required_amenities: [],
  preferred_amenities: [],
  unsupported_requests: [],
  preferences: [],
  commute_destination: null,
};

export type ApiHomeFinderInterpretResponse = {
  criteria: ApiHomeFinderCriteria;
  ai_confidence: number;
  missing_fields: string[];
  clarifying_questions: string[];
  generated_by: "ai" | "fallback";
};

export function interpretHomeFinderQuery(payload: {
  text: string;
  locale: "en" | "ar";
  transaction_type_hint?: "rent" | "sale" | null;
}) {
  return requestJson<ApiHomeFinderInterpretResponse>("/ai/home-finder/interpret", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiHomeFinderCriteriaChange = { field: string; from: string; to: string };

export type ApiHomeFinderRefineResponse = {
  criteria: ApiHomeFinderCriteria;
  changes: ApiHomeFinderCriteriaChange[];
  generated_by: "ai" | "fallback";
};

export function refineHomeFinderCriteria(payload: {
  criteria: ApiHomeFinderCriteria;
  instruction: string;
  locale: "en" | "ar";
}) {
  return requestJson<ApiHomeFinderRefineResponse>("/ai/home-finder/refine", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiHomeFinderResult = {
  property: ApiProperty;
  match_score: number;
  dimension_scores: Record<string, number>;
  reasons: string[];
  trade_offs: string[];
};

export type ApiHomeFinderCategories = {
  best_overall?: number | null;
  best_value?: number | null;
  best_location?: number | null;
  best_family?: number | null;
  best_investment?: number | null;
};

export type ApiHomeFinderEmptyResultSuggestion = {
  label: string;
  criteria_patch: ApiHomeFinderCriteria;
  estimated_count: number;
};

export type ApiHomeFinderEmptyResult = {
  message: string;
  restrictive_reasons: string[];
  suggestions: ApiHomeFinderEmptyResultSuggestion[];
};

export type ApiHomeFinderSearchResponse = {
  results: ApiHomeFinderResult[];
  categories: ApiHomeFinderCategories;
  exact_match_count: number;
  pool_count: number;
  empty_result: ApiHomeFinderEmptyResult | null;
};

export function searchHomeFinder(payload: {
  criteria: ApiHomeFinderCriteria;
  limit?: number;
  query_text?: string | null;
}) {
  return requestJson<ApiHomeFinderSearchResponse>("/ai/home-finder/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiHomeFinderExplainResponse = {
  summary: string;
  match_score: number;
  reasons: string[];
  trade_offs: string[];
  generated_by: "ai" | "fallback";
};

export function explainHomeFinderMatch(payload: { criteria: ApiHomeFinderCriteria; property_id: number }) {
  return requestJson<ApiHomeFinderExplainResponse>("/ai/home-finder/explain", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiHomeFinderHistoryItem = {
  id: number;
  query_text: string;
  criteria: ApiHomeFinderCriteria;
  result_count: number;
  created_at: string;
};

export function fetchHomeFinderHistory() {
  return requestJson<ApiHomeFinderHistoryItem[]>("/ai/home-finder/history");
}

// ── Rent financing interest waitlist (stub — no real payment integration) ──

export type ApiFinancingInterest = {
  id: number;
  renter_user_id: number;
  property_id: number;
  stated_budget: number;
  ai_note: string | null;
  ai_generated_by: "ai" | "fallback" | null;
  created_at: string;
  property_title: string | null;
  renter_name: string | null;
};

export function submitFinancingInterest(payload: { property_id: number; stated_budget: number }) {
  return requestJson<ApiFinancingInterest>("/financing/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
