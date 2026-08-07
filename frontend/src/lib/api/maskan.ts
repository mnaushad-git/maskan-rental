import prop1 from "@/assets/prop-1.jpg";
import prop2 from "@/assets/prop-2.jpg";
import prop3 from "@/assets/prop-3.jpg";
import prop4 from "@/assets/prop-4.jpg";
import type { Property as UiProperty } from "@/lib/maskan-data";
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
    agent: property.mediator_agent_name ?? property.owner_name ?? "Maskan Agent",
    agentPhone: property.mediator_phone ?? null,
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
    agentPhone: property.mediator_phone ?? null,
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
  monthly_rent: number;
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
  monthly_rent: number;
  bedrooms?: number;
  bathrooms?: number;
  owner_name?: string;
  description?: string;
  property_type?: string;
  furnished?: string;
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

export function markLeadMessagesRead(lead_id: number) {
  return requestJson<{ marked_read: number }>(`/leads/${lead_id}/messages/read`, {
    method: "POST",
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
