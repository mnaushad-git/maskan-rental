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
    ? (process.env.INTERNAL_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api")
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
  monthly_rent: number;
  bedrooms: number | null;
  bathrooms: number | null;
  owner_name: string | null;
  status: string;
  description: string | null;
  image_url: string | null;
  created_at: string;
  mediator_id: number | null;
  images: ApiListingImage[];
  mediator_phone: string | null;
  mediator_profile_image_url: string | null;
  mediator_agent_name: string | null;
  property_type: string | null;
  furnished: string | null;
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
  kpis: Array<{ label: string; value: string; delta: string; sub: string; trend: "up" | "down"; accent: string }>;
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
  if (property.property_type) {
    const t = property.property_type;
    if (t === "Apartment" || t === "Villa" || t === "Penthouse" || t === "Townhouse") return t;
  }
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
    priceScore = ratio <= 0.80 ? 97 : ratio <= 0.90 ? 90 : ratio <= 1.00 ? 82 : ratio <= 1.10 ? 70 : ratio <= 1.20 ? 58 : 46;
  }
  // Area quality (35%): district score from Maskan platform intelligence
  const districtScore = (areaScore != null && areaScore > 0) ? areaScore : 70;
  // Size adequacy (20%): bedroom count proxy
  const sizeScore = bedrooms <= 0 ? 58 : bedrooms === 1 ? 65 : bedrooms === 2 ? 72 : bedrooms === 3 ? 80 : bedrooms === 4 ? 87 : 92;
  // Listing completeness (10%): fixed 80 — all DB listings have owner + description
  const total = 0.35 * priceScore + 0.35 * districtScore + 0.20 * sizeScore + 0.10 * 80;
  return Math.round(Math.max(55, Math.min(97, total)));
}

function estimateAreaScore(property: ApiProperty) {
  return Math.min(96, 76 + (property.bedrooms ?? 0) * 3);
}

function estimateRentalScore(property: ApiProperty) {
  const score = 90 - Math.floor(property.monthly_rent / 50000) + (property.bedrooms ?? 0) * 2;
  return Math.max(72, Math.min(95, score));
}

export function mapApiProperty(property: ApiProperty): UiProperty {
  const estimatedArea = estimateAreaSqm(property);
  const annualRent = property.monthly_rent * 12;
  const matchScore = computePropertyScore(property.monthly_rent, property.bedrooms ?? 0);
  const imageUrls = (property.images ?? []).map(i => i.url);
  const primaryImage = imageUrls[0] ?? property.image_url ?? imageForProperty(property.id);

  return {
    id: String(property.id),
    title: property.title,
    district: property.area,
    city: property.city,
    price: annualRent,
    bedrooms: property.bedrooms ?? 0,
    bathrooms: property.bathrooms ?? 0,
    area: estimatedArea,
    type: inferPropertyType(property),
    image: primaryImage,
    images: imageUrls.length > 0 ? imageUrls : [primaryImage],
    matchScore,
    badges: ["Verified", matchScore >= 90 ? "Best Match" : "New"],
    status: property.status === "Published" ? "Available" : property.status === "Suspended" ? "Reserved" : "Available",
    pricePerSqm: Math.round(annualRent / estimatedArea),
    agent: property.mediator_agent_name ?? property.owner_name ?? "Maskan Agent",
    agentPhone: property.mediator_phone ?? null,
    agentProfileImage: property.mediator_profile_image_url ?? null,
    mediatorId: property.mediator_id ?? null,
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
      rentalScore = ratio < 0.85 ? 97 : ratio < 0.95 ? 88 : ratio < 1.05 ? 82 : ratio < 1.15 ? 68 : 52;
    }

    return { ...p, matchScore, areaScore, rentalScore, badges: ["Verified", matchScore >= 88 ? "Best Match" : "New"] };
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
      const body = await response.json() as { detail?: string | Array<{ msg: string; loc?: string[] }> };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        // Pydantic 422 validation errors — extract the first human-readable message
        detail = body.detail[0].msg.replace(/^Value error,\s*/i, "");
      }
    } catch { /* ignore parse errors */ }
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

export function fetchProperty(id: number) {
  return requestJson<ApiProperty>(`/properties/${id}`);
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
  return requestJson<ApiProperty>("/properties/", { method: "POST", body: JSON.stringify(payload) });
}

export function patchProperty(id: number, payload: Partial<Omit<ApiProperty, "id" | "created_at">>) {
  return requestJson<ApiProperty>(`/properties/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function removeProperty(id: number) {
  return requestJson<void>(`/properties/${id}`, { method: "DELETE" });
}

export function addPropertyImage(propertyId: number, url: string) {
  return requestJson<ApiListingImage>(`/properties/${propertyId}/images`, { method: "POST", body: JSON.stringify({ url }) });
}

export function deletePropertyImage(propertyId: number, imageId: number) {
  return requestJson<void>(`/properties/${propertyId}/images/${imageId}`, { method: "DELETE" });
}

export function addPartnerPropertyImage(propertyId: number, url: string) {
  return requestJson<ApiListingImage>(`/properties/partner/${propertyId}/images`, { method: "POST", body: JSON.stringify({ url }) });
}

export function deletePartnerPropertyImage(propertyId: number, imageId: number) {
  return requestJson<void>(`/properties/partner/${propertyId}/images/${imageId}`, { method: "DELETE" });
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
  return requestJson<ApiProperty>("/properties/partner/", { method: "POST", body: JSON.stringify(payload) });
}

export function patchPartnerListing(id: number, payload: Partial<PartnerPropertyPayload>) {
  return requestJson<ApiProperty>(`/properties/partner/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
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
  return requestJson<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(payload) });
}

export function login(payload: { email: string; password: string }) {
  return requestJson<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) });
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
  return requestJson<{ inserted: number; skipped: number; total: number }>(
    "/properties/bulk",
    { method: "POST", body: JSON.stringify(rows) },
  );
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

export function adminAiChat(
  message: string,
  history: Array<{ role: string; content: string }>,
) {
  return requestJson<{ reply: string }>("/ai/admin-chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

// ── Area Intelligence ────────────────────────────────────────────────────────

export type ApiSchool = { name: string; type: string; rating: number; distance_km: number };
export type ApiHospital = { name: string; tier: string; rating: number; distance_km: number };
export type ApiLifestylePlace = { name: string; rating?: number; distance_km: number };
export type ApiLifestyle = {
  restaurants: { count: number; avg_rating: number | null; places?: ApiLifestylePlace[] };
  gyms: { count: number; avg_rating: number | null; places?: ApiLifestylePlace[] };
  mosques: { count: number; avg_rating: number | null; places?: ApiLifestylePlace[] };
  malls: { count: number; avg_rating: number | null; places?: ApiLifestylePlace[] };
  parks?: { count: number; avg_rating: number | null; places?: ApiLifestylePlace[] };
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
  return requestJson<ApiAreaIntelligence>(`/areas/${encodeURIComponent(areaName)}/intelligence${q}`);
}

// ── Mediators ────────────────────────────────────────────────────────────────

export type ApiPartnerArea = { id: number; mediator_id: number; area_name: string; city: string; created_at: string };
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
  status: string;  // "pending" | "approved" | "rejected"
  created_at: string;
};

export type ApiReviewAdmin = ApiReview & {
  mediator_agency_name: string | null;
};

export type ApiReviewSummary = {
  avg_rating: number | null;
  review_count: number;
  distribution: Record<string, number>;  // "1"–"5" → count
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
  return requestJson<ApiReviewAdmin>(`/reviews/admin/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function fetchMyPartnerProfile() {
  return requestJson<ApiPartner>("/mediators/me");
}

export function registerPartner(payload: { license_number: string; agency_name?: string; phone: string; bio?: string }) {
  return requestJson<ApiPartner>("/mediators/register", { method: "POST", body: JSON.stringify(payload) });
}

export function updateMediatorProfile(payload: { agency_name?: string; phone?: string; bio?: string }) {
  return requestJson<ApiPartner>("/mediators/me", { method: "PATCH", body: JSON.stringify(payload) });
}

export function subscribePartnerMock() {
  return requestJson<{ status: string; subscription_expires_at: string }>("/mediators/me/subscribe", { method: "POST" });
}

export function addPartnerArea(area_name: string, city: string) {
  return requestJson<ApiPartnerArea>("/mediators/me/areas", { method: "POST", body: JSON.stringify({ area_name, city }) });
}

export function removePartnerArea(area_id: number) {
  return requestJson<void>(`/mediators/me/areas/${area_id}`, { method: "DELETE" });
}

// ── Leads ────────────────────────────────────────────────────────────────────

export type ApiLeadSuggestion = { id: number; lead_id: number; property_id: number | null; match_score: number; reason: string | null; created_at: string; property_title: string | null; monthly_rent: number | null; bedrooms: number | null };
export type ApiLeadAssignment = { id: number; lead_id: number; mediator_id: number | null; status: string; assigned_at: string; accepted_at: string | null; rejected_at: string | null; expires_at: string; mediator_agency_name: string | null; mediator_phone: string | null };
export type ApiLeadSummary = { id: number; area_name: string; city: string; status: string; customer_name: string; customer_phone: string; customer_email: string; max_budget: number | null; bedrooms_needed: number | null; created_at: string };
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
export type ApiLeadMessage = { id: number; lead_id: number; sender_user_id: number | null; sender_role: string; content: string; is_read: boolean; created_at: string };

export function createLead(payload: {
  area_name: string; city: string; customer_name: string; customer_phone: string;
  customer_email: string; min_budget?: number; max_budget?: number;
  bedrooms_needed?: number; move_in_date?: string; requirements_note?: string;
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
  return requestJson<{ status: string; payment_amount: number }>(`/leads/${lead_id}/accept`, { method: "POST" });
}

export function rejectLead(lead_id: number) {
  return requestJson<{ status: string }>(`/leads/${lead_id}/reject`, { method: "POST" });
}

export function fetchLeadMessages(lead_id: number) {
  return requestJson<ApiLeadMessage[]>(`/leads/${lead_id}/messages`);
}

export function sendLeadMessage(lead_id: number, content: string) {
  return requestJson<ApiLeadMessage>(`/leads/${lead_id}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}

export function markLeadMessagesRead(lead_id: number) {
  return requestJson<{ marked_read: number }>(`/leads/${lead_id}/messages/read`, { method: "POST" });
}

export function fetchAdminMediators() {
  return requestJson<ApiPartner[]>("/mediators/");
}

export function patchMediatorAdmin(mediator_id: number, payload: { is_verified?: boolean; subscription_status?: string }) {
  return requestJson<ApiPartner>(`/mediators/${mediator_id}`, { method: "PATCH", body: JSON.stringify(payload) });
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
  return requestJson<ApiPartner>("/mediators/admin/create", { method: "POST", body: JSON.stringify(payload) });
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

export function adminCreateUser(payload: { email: string; password: string; full_name?: string; phone?: string; role?: string }) {
  return requestJson<ApiUser>("/users/", { method: "POST", body: JSON.stringify(payload) });
}

export function adminUpdateUser(id: number, payload: { full_name?: string; phone?: string; email?: string; is_active?: boolean; password?: string; role?: string }) {
  return requestJson<ApiUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function fetchAdminLeads() {
  return requestJson<ApiLeadDetail[]>("/leads/admin/all");
}

export function adminForceCloseLead(lead_id: number, status: "closed_won" | "closed_lost") {
  return requestJson<ApiLeadDetail>(`/leads/admin/${lead_id}/close`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function patchLeadStatus(lead_id: number, status: string, note?: string) {
  return requestJson<ApiLeadDetail>(`/leads/${lead_id}/status`, { method: "PATCH", body: JSON.stringify({ status, note }) });
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