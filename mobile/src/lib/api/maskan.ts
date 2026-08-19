import { Image, type ImageSourcePropType } from "react-native";
import type { Property as UiProperty, Project as UiProject } from "@/lib/maskan-data";
import type { SearchProperty as UiSearchProperty } from "@/lib/maskan-search-data";
import { readStoredToken, clearStoredAuth } from "@/lib/auth-storage";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

function resolveLocalImage(mod: ImageSourcePropType): string {
  if (typeof Image.resolveAssetSource === "function") return Image.resolveAssetSource(mod).uri;
  return typeof mod === "string" ? mod : (mod as { uri: string; default?: string }).default ?? (mod as { uri: string }).uri;
}

const PROPERTY_IMAGES = [
  resolveLocalImage(require("../../assets/prop-1.jpg")),
  resolveLocalImage(require("../../assets/prop-2.jpg")),
  resolveLocalImage(require("../../assets/prop-3.jpg")),
  resolveLocalImage(require("../../assets/prop-4.jpg")),
];

export class UnauthorizedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "UnauthorizedError";
  }
}

// Fired when a request comes back 401 so AuthProvider can clear its in-memory
// session immediately — there's no page reload on mobile to naturally resync
// with cleared SecureStore state, so this has to be pushed explicitly.
type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
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
  is_bookable: boolean;
  nightly_rate: number | null;
  has_elevator: boolean;
  has_airconditioners: boolean;
  arrival_time: string | null;
  departure_time: string | null;
  latest_booking_time: string | null;
  insurance_amount: number;
};

export type VerificationStatus = "unverified" | "pending" | "approved" | "rejected";

export type SubscriptionStatus = "inactive" | "pending_payment" | "active" | "cancelled" | "expired";
export type SubscriptionTier = "free" | "premium";

export type AuthUser = {
  id: number;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  verification_status: VerificationStatus;
  is_verified: boolean;
  subscription_status: SubscriptionStatus;
  subscription_tier: SubscriptionTier;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
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
  let priceScore = 72;
  if (avgMonthly && avgMonthly > 0) {
    const ratio = monthlyRent / avgMonthly;
    priceScore = ratio <= 0.80 ? 97 : ratio <= 0.90 ? 90 : ratio <= 1.00 ? 82 : ratio <= 1.10 ? 70 : ratio <= 1.20 ? 58 : 46;
  }
  const districtScore = (areaScore != null && areaScore > 0) ? areaScore : 70;
  const sizeScore = bedrooms <= 0 ? 58 : bedrooms === 1 ? 65 : bedrooms === 2 ? 72 : bedrooms === 3 ? 80 : bedrooms === 4 ? 87 : 92;
  const total = 0.35 * priceScore + 0.35 * districtScore + 0.20 * sizeScore + 0.10 * 80;
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

  // Only claim what's actually backed by data: "Verified" reflects the
  // listing's mediator having a verified profile (not applied to every
  // listing regardless of status), and "New" reflects real listing age.
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
    status: property.status === "Published" ? "Available" : property.status === "Suspended" ? "Reserved" : "Available",
    pricePerSqm: estimatedArea > 0 ? Math.round(displayPrice / estimatedArea) : 0,
    agent: property.mediator_agent_name ?? property.owner_name ?? "myMakan Agent",
    agentPhone: property.call_phone ?? property.mediator_phone ?? null,
    agentWhatsapp: property.whatsapp_number ?? property.mediator_phone ?? null,
    agentProfileImage: property.mediator_profile_image_url ?? null,
    mediatorId: property.mediator_id ?? null,
    latitude: property.latitude,
    longitude: property.longitude,
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
      elevator: property.has_elevator,
      airconditioners: property.has_airconditioners,
    },
    licenseNumber: property.license_number ?? null,
    licenseExpirationDate: property.license_expiration_date ?? null,
    deedArea: property.deed_area ?? null,
    viewsCount: property.views_count ?? 0,
    createdAt: property.created_at,
    updatedAt: property.updated_at,
    mediatorRating: property.mediator_rating ?? null,
    mediatorReviewCount: property.mediator_review_count ?? 0,
    isBookable: property.is_bookable,
    nightlyRate: property.nightly_rate ?? null,
    arrivalTime: property.arrival_time ?? null,
    departureTime: property.departure_time ?? null,
    latestBookingTime: property.latest_booking_time ?? null,
    insuranceAmount: property.insurance_amount ?? 0,
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
    isVerified: property.mediator_is_verified,
    agentPhone: property.call_phone ?? property.mediator_phone ?? null,
    agentWhatsapp: property.whatsapp_number ?? property.mediator_phone ?? null,
    latitude: property.latitude,
    longitude: property.longitude,
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await readStoredToken();
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
      const body = (await response.json()) as { detail?: string | Array<{ msg: string; loc?: string[] }> };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        detail = body.detail[0].msg.replace(/^Value error,\s*/i, "");
      }
    } catch {
      /* ignore parse errors */
    }
    if (response.status === 401) {
      await clearStoredAuth();
      unauthorizedListeners.forEach((l) => l());
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

export type BookableSearchParams = {
  checkIn?: string;
  checkOut?: string;
  city?: string;
  limit?: number;
};

// Browse/search for short-term bookable stays — reuses the general
// GET /properties/ endpoint (is_bookable + optional check_in/check_out
// filters) rather than a separate endpoint, since bookable stays are just
// Property rows with is_bookable=true, not a distinct model.
export function fetchBookableProperties(params: BookableSearchParams = {}) {
  const q = new URLSearchParams({ is_bookable: "true", limit: String(params.limit ?? 50) });
  if (params.checkIn) q.set("check_in", params.checkIn);
  if (params.checkOut) q.set("check_out", params.checkOut);
  if (params.city && params.city !== "Any") q.set("city", params.city);
  return requestJsonWithCount<ApiProperty[]>(`/properties/?${q.toString()}`);
}

export type PropertySearchParams = {
  q?: string;
  area?: string;
  city?: string;
  listingType?: string;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
};

// Server-side keyword search (title/description) + filtering + pagination —
// unlike fetchProperties() (a flat capped batch), this scales past the
// catalog's total size and reports a real `total` for "N results"/paging.
export function searchProperties(params: PropertySearchParams) {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.area) q.set("area", params.area);
  if (params.city) q.set("city", params.city);
  if (params.listingType) q.set("listing_type", params.listingType);
  if (params.minPrice != null) q.set("min_price", String(params.minPrice));
  if (params.maxPrice != null) q.set("max_price", String(params.maxPrice));
  q.set("limit", String(params.limit ?? 20));
  q.set("offset", String(params.offset ?? 0));
  return requestJson<{ count: number; total: number; results: ApiProperty[] }>(`/search/?${q.toString()}`);
}

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

// Search-as-you-move-the-map: only the properties whose (district-derived)
// pin falls within the currently visible map region.
export function fetchPropertiesInBounds(bounds: MapBounds) {
  const params = new URLSearchParams({
    limit: "500",
    min_lat: String(bounds.minLat),
    max_lat: String(bounds.maxLat),
    min_lng: String(bounds.minLng),
    max_lng: String(bounds.maxLng),
  });
  return requestJson<ApiProperty[]>(`/properties/?${params.toString()}`);
}

export function fetchProperty(id: number) {
  return requestJson<ApiProperty>(`/properties/${id}`);
}

export function fetchSimilarProperties(id: number, limit = 6) {
  return requestJson<ApiProperty[]>(`/properties/${id}/similar?limit=${limit}`);
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

export function signup(payload: { email: string; password: string; full_name?: string }) {
  return requestJson<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(payload) });
}

export function login(payload: { email: string; password: string }) {
  return requestJson<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchMe(token: string) {
  return requestJson<AuthUser>("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
}

// ── Renter identity verification (mock — no real Nafath call) ─────────────

export type ApiVerification = {
  verification_status: VerificationStatus;
  is_verified: boolean;
  verification_document_ref: string | null;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
};

export function fetchMyVerification() {
  return requestJson<ApiVerification>("/verification/me");
}

export function submitVerification(documentReference: string) {
  return requestJson<ApiVerification>("/verification/me", {
    method: "POST",
    body: JSON.stringify({ document_reference: documentReference }),
  });
}

// ── Renter premium tier ("AI Alert Plus") ───────────────────────────────────

export type ApiSubscription = {
  subscription_status: SubscriptionStatus;
  subscription_tier: SubscriptionTier;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
};

export function fetchMySubscription() {
  return requestJson<ApiSubscription>("/subscriptions/me");
}

export type ApiSubscribeResult = {
  status: string;
  message?: string;
  payment_url?: string;
  payment_id?: number;
  subscription_expires_at?: string | null;
};

export function subscribeToPremium() {
  return requestJson<ApiSubscribeResult>("/subscriptions/me/subscribe", { method: "POST" });
}

export function renewPremium() {
  return requestJson<{ status: string; subscription_expires_at: string | null }>("/subscriptions/me/renew", {
    method: "POST",
  });
}

export function unsubscribeFromPremium() {
  return requestJson<{ status: string }>("/subscriptions/me/unsubscribe", { method: "POST" });
}

// ── AI Trust Badge inputs — the weighted-score formula lives client-side,
// see src/lib/trustScore.ts ───────────────────────────────────────────────

export type ApiTrustMetrics = {
  is_verified: boolean;
  verification_status: VerificationStatus;
  review_count: number;
  responded_leads: number;
  total_leads_with_contact: number;
};

export function fetchMyTrustMetrics() {
  return requestJson<ApiTrustMetrics>("/users/me/trust-metrics");
}

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

// ── My leads ────────────────────────────────────────────────────────────────
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

export type ApiLeadMessage = {
  id: number;
  lead_id: number;
  sender_user_id: number | null;
  sender_role: string; // "customer" | "mediator" | "admin"
  content: string;
  is_read: boolean;
  created_at: string;
};

export function fetchMyLeads() {
  return requestJson<ApiLeadSummary[]>("/leads/my");
}

export function fetchLead(id: number) {
  return requestJson<ApiLeadDetail>(`/leads/${id}`);
}

export function fetchLeadMessages(id: number) {
  return requestJson<ApiLeadMessage[]>(`/leads/${id}/messages`);
}

export function sendLeadMessage(id: number, content: string) {
  return requestJson<ApiLeadMessage>(`/leads/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function markLeadMessagesRead(id: number) {
  return requestJson<void>(`/leads/${id}/messages/read`, { method: "POST" });
}

// ── Visit & Viewing Management (Prompt 11) ──────────────────────────────────
// Mirrors frontend/src/lib/api/maskan.ts's function names/shapes exactly —
// same backend endpoints, see docs/implementation/mymakan-viewings.md.

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
  // Only present on the customer-facing detail response (GET/PATCH
  // /viewings/{id}) — see Prompt 12 for the checklist UI that consumes these.
  checklist?: ApiViewingChecklist | null;
  private_notes?: ApiViewingPrivateNote[];
};

export type ApiViewingChecklistItem = { id: string; text: string; why_it_matters: string | null };
export type ApiViewingChecklistSection = { key: string; title: string; items: ApiViewingChecklistItem[] };
export type ApiViewingChecklist = {
  sections: ApiViewingChecklistSection[];
  visit_plan_summary: string | null;
  generated_by: "ai" | "deterministic";
  checked: Record<string, boolean>;
};
export type ApiViewingPrivateNote = { text: string; created_at: string };

export const VIEWING_INACTIVE_STATUSES = [
  "cancelled_by_customer",
  "cancelled_by_mediator",
  "completed",
  "no_show_customer",
  "no_show_mediator",
] as const;

export const VIEWING_CUSTOMER_CANCEL_REASONS = [
  "Plans changed",
  "Found another property",
  "Time no longer works",
  "Other",
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

// ── AI Viewing Checklist + post-viewing feedback/next-steps (Prompt 12) ────
// No dedicated GET-checklist endpoint — the backend embeds `checklist` +
// `private_notes` straight onto GET /viewings/{id}'s response, so
// `fetchViewing` above already returns it.

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

// ── AI Negotiation & Offer Management (Prompt 11) ───────────────────────────
// Mirrors frontend/src/lib/api/maskan.ts's function names/shapes exactly —
// same backend endpoints, see docs/implementation/mymakan-negotiations.md
// "APIs"/"Models" for the authoritative shape reference. `ApiNegotiationInsight`
// (defined above, under Property Intelligence) already matches
// NegotiationInsightOut's shape field-for-field, so it's reused here rather
// than redeclared — same decision the web client made.

// NOTE on amount fields: the backend declares these `Decimal` (not `float`),
// which pydantic v2 serializes to a JSON STRING (e.g. "13500.00"), unlike
// Property.monthly_rent/sale_price which are plain floats. Always wrap these
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
  // (previously detail-only), so the My Negotiations list cards can render
  // the same strength badge the detail screen already does.
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
// the real deterministic strength classification, embedded on
// GET /negotiations/{id} — never re-derived client-side.
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
  // negotiation_signal now comes from the base ApiPropertyNegotiation (Prompt 12).
  summary_text: string;
  agreement_summary: ApiAgreementSummary | null;
};

// POST /properties/{id}/negotiations — creates a negotiation from the
// customer's first offer. `viewing_id` is only trusted server-side after the
// service layer verifies it belongs to this customer + property and is
// `completed`.
export function createNegotiation(propertyId: number, payload: { amount: number; message?: string; viewing_id?: number }) {
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
// callers are expected to `.catch(() => null)` this, same soft-fail idiom
// fetchMyViewings/fetchPropertyIntelligence already use elsewhere.
export function fetchActiveNegotiation(propertyId: number) {
  return requestJson<ApiPropertyNegotiation>(`/properties/${propertyId}/negotiations/active`);
}

// Counter Again / Accept / Withdraw / Ask myMakan — backing
// app/negotiations/[id].tsx. All three mutating actions below return only
// PropertyNegotiationOut (no offers/summary_text/negotiation_insight), so
// callers re-fetch via fetchNegotiation() after a successful call to refresh
// the timeline/signal/summary rather than merging a partial response.

// POST /negotiations/{id}/offer — customer's "Counter Again" action.
export function submitCounterOffer(id: number, payload: { amount: number; message?: string }) {
  return requestJson<ApiPropertyNegotiation>(`/negotiations/${id}/offer`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// POST /negotiations/{id}/accept — customer accepting the mediator's latest
// counter. 409 if there's no pending offer to accept, or if the latest
// pending offer was placed by this same customer (self-accept blocked).
export function acceptNegotiation(id: number) {
  return requestJson<ApiPropertyNegotiation>(`/negotiations/${id}/accept`, { method: "POST" });
}

// Closed reason list from brief §11 (customer withdrawal) — the backend
// accepts any string, but the frontend is expected to offer this closed
// list, same convention VIEWING_CUSTOMER_CANCEL_REASONS already established.
export const NEGOTIATION_CUSTOMER_WITHDRAW_REASONS = ["Changed mind", "Found another property", "Budget changed", "Other"] as const;

// POST /negotiations/{id}/withdraw
export function withdrawNegotiation(id: number, reason: string) {
  return requestJson<ApiPropertyNegotiation>(`/negotiations/${id}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// POST /negotiations/{id}/ai-guidance — "Ask myMakan". Rate-limited on the
// backend (20/10min per user), same as every other on-request AI endpoint;
// `generated_by` is "ai" | "fallback" — never throws on an AI failure, the
// backend degrades to a deterministic reply instead.
export function fetchNegotiationGuidance(id: number, question: string | undefined, language: "en" | "ar") {
  return requestJson<{ guidance: string; generated_by: "ai" | "fallback" }>(`/negotiations/${id}/ai-guidance`, {
    method: "POST",
    body: JSON.stringify({ question: question || undefined, language }),
  });
}

// ── Area intelligence / averages ──────────────────────────────────────────────
export type ApiAreaSummary = {
  name: string;
  city: string;
  property_count: number;
  average_rent: number; // monthly average in SAR
};

export function fetchAreas() {
  return requestJson<ApiAreaSummary[]>("/areas/");
}

export type ApiSchool = { name: string; type: string; rating: number; distance_km: number };
export type ApiHospital = { name: string; tier: string; rating: number; distance_km: number };
export type ApiLifestylePlace = { name: string; rating?: number; distance_km: number };
export type ApiLifestyleCategory = { count: number; avg_rating: number | null; places?: ApiLifestylePlace[] };
export type ApiLifestyle = {
  restaurants?: ApiLifestyleCategory;
  gyms?: ApiLifestyleCategory;
  mosques?: ApiLifestyleCategory;
  malls?: ApiLifestyleCategory;
  parks?: ApiLifestyleCategory;
};
export type ApiRentTrendPoint = { year: string; avg_rent_annual: number };

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

export type ApiAreaIntelligence = ApiAreaIntelligenceSummary & {
  id: number;
  center_lat: number | null;
  center_lng: number | null;
  schools: ApiSchool[];
  hospitals: ApiHospital[];
  lifestyle: ApiLifestyle;
  commute_minutes_to_center: number | null;
  rent_trend: ApiRentTrendPoint[];
  market_notes: string[];
};

export function fetchAreaIntelligenceList() {
  return requestJson<ApiAreaIntelligenceSummary[]>("/areas/intelligence");
}

export function fetchAreaIntelligence(areaName: string, city?: string) {
  const q = city ? `?city=${encodeURIComponent(city)}` : "";
  return requestJson<ApiAreaIntelligence>(`/areas/${encodeURIComponent(areaName)}/intelligence${q}`);
}

// ── Property Intelligence ───────────────────────────────────────────────────
// Backend: app/api/routes/properties.py (GET/POST .../intelligence,
// .../ai-summary) + app/schemas/property_intelligence.py. Same shapes as the
// web client (frontend/src/lib/api/maskan.ts) — kept in sync manually since
// mobile and web don't share a client package.

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

export type ApiComparableSummary = { count: number; items: ApiComparablePropertySummary[] };

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

export type ApiAreaIntelligenceRef = { area_name: string; city: string; area_score: number | null; summary: string | null };

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
  // Prompt 11 (mirrors frontend's Prompt 8 change): grounds a "Draft with
  // AI" call made from the Negotiation Detail screen's Counter Again sheet
  // in that negotiation's own real numbers — see backend/app/api/routes/
  // properties.py's PropertyAiSummaryRequest.negotiation_id. Omitted
  // entirely when undefined, leaving the pre-existing Property Detail call
  // path (NegotiationInsightCard's draft, before any negotiation exists)
  // unchanged.
  negotiationId?: number,
) {
  return requestJson<{ summary: string; generated_by: "ai" | "fallback" }>(`/properties/${propertyId}/ai-summary`, {
    method: "POST",
    body: JSON.stringify({ language, variant, ...(negotiationId != null ? { negotiation_id: negotiationId } : {}) }),
  });
}

// ── Trust Center (Prompt 10 — mirrors frontend/src/lib/api/maskan.ts's
// Prompt 7/9 additions field-for-field; see docs/implementation/
// mymakan-trust-center.md). Named PropertyTrust*/ListingVerification* on the
// component side — NOT TrustBadge/ApiTrustMetrics (mobile/src/components/
// TrustBadge.tsx + this file's ApiTrustMetrics below), which is the
// renter's own identity-verification score, an unrelated concept.

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
// fetchPropertyIntelligence / fetchPropertyAiSummary split above).
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

// Not called anywhere in mobile's UI (Prompt 10 is customer-only — no
// partner-portal surface exists on mobile) — exported for API-surface parity
// with the web client, same as web's own "exported for a later prompt" note.
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

export function submitPropertyReport(propertyId: number, body: { reason: PropertyReportReason; comment?: string }) {
  return requestJson<ApiPropertyReport>(`/properties/${propertyId}/reports`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── AI Home Finder ──────────────────────────────────────────────────────────
// Backend: app/api/routes/home_finder.py + app/schemas/home_finder.py.
// Same shapes as the web client (frontend/src/lib/api/maskan.ts) — kept in
// sync manually since mobile and web don't share a client package.

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

// ── AI advisor ────────────────────────────────────────────────────────────────
export function chatWithAdvisor(
  message: string,
  history: Array<{ role: string; content: string }>,
) {
  return requestJson<{ reply: string }>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

type StreamHandlers = {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

// The advisor's tool-using replies take 20–40s and, on the non-streaming
// endpoint, arrive all at once — long enough to trip okhttp's read timeout on
// Android. The SSE endpoint streams text deltas as they're generated, keeping
// the socket active. RN's fetch can't read a streaming body, so we use XHR and
// parse `data: {…}\n\n` events out of the growing responseText.
export function streamAdvisorChat(
  message: string,
  history: Array<{ role: string; content: string }>,
  handlers: StreamHandlers,
): () => void {
  let cancelled = false;
  let finished = false;
  const xhr = new XMLHttpRequest();

  const finish = (fn: () => void) => {
    if (finished || cancelled) return;
    finished = true;
    fn();
  };

  let processed = 0;
  const consume = (upTo: number) => {
    const parts = xhr.responseText.split("\n\n");
    for (let i = processed; i < upTo; i++) {
      const line = parts[i].trim();
      if (!line.startsWith("data:")) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim());
        if (evt.type === "text") handlers.onDelta(evt.delta);
        else if (evt.type === "done") finish(handlers.onDone);
        else if (evt.type === "error") finish(() => handlers.onError(evt.message));
      } catch {
        /* incomplete / non-JSON line — ignore */
      }
    }
    processed = upTo;
  };

  readStoredToken().then((token) => {
    if (cancelled) return;
    xhr.open("POST", `${API_BASE_URL}/ai/chat/stream`);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Process only complete events (all but the trailing, possibly-partial chunk).
    xhr.onprogress = () => consume(xhr.responseText.split("\n\n").length - 1);
    xhr.onload = () => {
      // A 403 means _enforce_free_chat_cap rejected the request before the
      // SSE stream ever started — the body is a plain JSON error, not
      // `data: {...}` events, so it must be special-cased here rather than
      // fed into consume().
      if (xhr.status === 403) {
        finish(() => handlers.onError("premium_required"));
        return;
      }
      consume(xhr.responseText.split("\n\n").length);
      finish(handlers.onDone);
    };
    xhr.onerror = () => finish(() => handlers.onError("network"));
    xhr.ontimeout = () => finish(() => handlers.onError("timeout"));
    xhr.send(JSON.stringify({ message, history }));
  });

  return () => {
    cancelled = true;
    try {
      xhr.abort();
    } catch {
      /* already closed */
    }
  };
}

// ── Mediators / agent profile ─────────────────────────────────────────────────
export type ApiPartnerArea = {
  id: number;
  mediator_id: number;
  area_name: string;
  city: string;
  created_at: string;
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
  // spec section 11; consumed by Prompt 10's agent/[id].tsx Trust & Activity
  // section). Mirrors schemas/mediator.py::MediatorPublicOut's added fields
  // exactly, same as frontend/src/lib/api/maskan.ts's Prompt 9 extension.
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

export function fetchPublicPartner(id: number) {
  return requestJson<ApiPartnerPublic>(`/mediators/${id}/public`);
}

export function fetchPublicPartners(city?: string) {
  const q = city ? `?city=${encodeURIComponent(city)}` : "";
  return requestJson<ApiPartnerPublic[]>(`/mediators/public${q}`);
}

export function fetchPropertiesByMediator(mediatorId: number) {
  return requestJson<ApiProperty[]>(`/properties/?mediator_id=${mediatorId}&limit=50`);
}

export type ApiReview = {
  id: number;
  mediator_id: number;
  user_id: number | null;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  status: string;
  created_at: string;
  reviewer_is_verified: boolean;
};

export type ApiReviewSummary = {
  avg_rating: number | null;
  review_count: number;
  distribution: Record<string, number>;
};

export function fetchMediatorReviews(mediatorId: number) {
  return requestJson<ApiReview[]>(`/reviews/mediator/${mediatorId}`);
}

export function fetchMediatorReviewSummary(mediatorId: number) {
  return requestJson<ApiReviewSummary>(`/reviews/mediator/${mediatorId}/summary`);
}

// AI-generated mediator Review Summary (Prompt 4/10 — Property Verification
// & Trust Center's "Review Summary" block, spec section 12). Deliberately a
// distinct name/type from ApiReviewSummary above (the deterministic rating
// distribution from GET /reviews/mediator/{id}/summary, already consumed by
// this screen's existing header stats) — this hits a different endpoint
// (GET /mediators/{id}/review-summary) that AI-summarizes review TEXT into
// positive themes/considerations, gated behind a minimum review count with a
// deterministic {avg_rating, review_count, note} fallback below it. Mirrors
// schemas/review_summary.py::ReviewSummaryOut, same as frontend's Prompt 9
// fetchMediatorAiReviewSummary().
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

// ── Saved search alerts ────────────────────────────────────────────────────
// Mirrors the backend's canonical `PropertyFilterCriteria`
// (app/core/search/filters.py) — this is the one filter shape saved
// searches, matching, and the preview endpoint all agree on.
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

export async function createSavedSearch(payload: {
  name: string;
  locale?: string;
  filters: ApiPropertyFilterCriteria;
  alert_enabled?: boolean;
  alert_frequency?: AlertFrequency;
  channels?: NotificationChannel[];
  confirm_duplicate?: boolean;
}) {
  const response = await fetch(`${API_BASE_URL}/saved-searches/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await readStoredToken()}` },
    body: JSON.stringify(payload),
  });
  if (response.status === 409) {
    const body = (await response.json()) as { detail?: SavedSearchDuplicateError | string };
    if (body.detail && typeof body.detail === "object" && "duplicate_of" in body.detail) {
      throw new DuplicateSavedSearchError(body.detail);
    }
    throw new Error(typeof body.detail === "string" ? body.detail : "This saved search already exists.");
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
  return requestJson<ApiSavedSearch>(`/saved-searches/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
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
  return requestJson<ApiSavedSearchPreview>("/saved-searches/preview", { method: "POST", body: JSON.stringify(filters) });
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

export function fetchNotificationCenter(params?: { cursor?: string; type?: string; unreadOnly?: boolean; limit?: number }) {
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

export function deleteNotification(id: number) {
  return requestJson<void>(`/notifications/${id}`, { method: "DELETE" });
}

export type NotificationChannelPref = "in_app" | "push" | "email";
export type NotificationFrequency = "instant" | "daily" | "weekly" | "off";

export type NotificationCategory =
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
  channels: NotificationChannelPref[];
  frequency: NotificationFrequency;
};

export type ApiNotificationPreferences = {
  in_app_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
  category_preferences: Record<NotificationCategory, CategoryPreference>;
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

export type ApiNotificationPreferencesUpdate = Partial<
  Omit<ApiNotificationPreferences, "category_preferences" | "next_daily_digest_at" | "next_weekly_digest_at">
> & {
  category_preferences?: Partial<Record<NotificationCategory, Partial<CategoryPreference>>>;
};

export function fetchNotificationPreferences() {
  return requestJson<ApiNotificationPreferences>("/notification-preferences/");
}

export function updateNotificationPreferences(payload: ApiNotificationPreferencesUpdate) {
  return requestJson<ApiNotificationPreferences>("/notification-preferences/", { method: "PATCH", body: JSON.stringify(payload) });
}

export function resetNotificationPreferencesDefaults() {
  return requestJson<ApiNotificationPreferences>("/notification-preferences/reset-defaults", { method: "POST" });
}

export type ApiTestPushResult = {
  sent: number;
  results: Array<{ device_id: number; status: string; detail: string }>;
};

export function sendTestPushNotification() {
  return requestJson<ApiTestPushResult>("/notification-preferences/test-push", { method: "POST" });
}

// ── Push device registration ────────────────────────────────────────────────
export type ApiDevice = {
  id: number;
  platform: "ios" | "android" | "web";
  installation_id: string | null;
  device_id: string | null;
  app_version: string | null;
  os_version: string | null;
  locale: string;
  device_timezone: string | null;
  enabled: boolean;
  failure_count: number;
  invalidated_at: string | null;
  last_active_at: string;
  last_success_push_at: string | null;
  last_failed_push_at: string | null;
  created_at: string;
};

export type RegisterDevicePayload = {
  platform: "ios" | "android" | "web";
  push_token: string;
  installation_id?: string;
  device_id?: string;
  app_version?: string;
  os_version?: string;
  locale?: string;
  device_timezone?: string;
};

export function registerDevice(payload: RegisterDevicePayload) {
  return requestJson<ApiDevice>("/devices/", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchDevices() {
  return requestJson<ApiDevice[]>("/devices/");
}

export function unregisterDevice(id: number) {
  return requestJson<void>(`/devices/${id}`, { method: "DELETE" });
}

// ── Property Requests / AI Property Agent ───────────────────────────────────
// Mirrors the backend's PropertyRequest domain (app/models/property_request.py
// on the backend) — a customer-authored, structured "what I'm looking for"
// request that the matching engine scores live listings against, distinct
// from the simpler one-shot Lead (leads/*) flow above.
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

export type MediatorPreference = "owner_only" | "mediator_only" | "either";

// The exact vocabulary the backend accepts inside must_have_fields /
// nice_to_have_fields / flexible_fields — anything outside this list is
// rejected server-side, so the create/edit UI must only offer these as chips.
export type PropertyRequestFieldName =
  | "transaction_type"
  | "city"
  | "max_price"
  | "min_price"
  | "bedrooms_min"
  | "bedrooms_max"
  | "bathrooms_min"
  | "bathrooms_max"
  | "min_area_sq_m"
  | "max_area_sq_m"
  | "furnishing"
  | "property_category"
  | "verified_only"
  | "preferred_districts";

export type PropertyRequestInput = {
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
  mediator_preference?: MediatorPreference;
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
  must_have_fields?: PropertyRequestFieldName[];
  nice_to_have_fields?: PropertyRequestFieldName[];
  flexible_fields?: PropertyRequestFieldName[];
  priority_weighting?: Record<string, number>;
  matching_enabled?: boolean;
  mediator_responses_enabled?: boolean;
  alert_frequency?: AlertFrequency;
};

export type ApiPropertyRequest = PropertyRequestInput & {
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

export type ApiPropertyRequestFromText = {
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

export type MatchReasonCode = { code: string; [key: string]: unknown };

export type PropertyRequestMatchStatus = "new" | "viewed" | "saved" | "contacted" | "dismissed" | "shortlisted" | "expired";

export type ApiPropertyRequestMatch = {
  // Null on ephemeral preview-matches rows (before activation) — never on a
  // persisted match once the request has real matches.
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
  match_reasons: MatchReasonCode[];
  trade_offs: MatchReasonCode[];
  match_version: number;
  status: PropertyRequestMatchStatus;
  created_at: string;
  updated_at: string;
};

export type ActivityActorType = "customer" | "mediator" | "admin" | "system" | "ai";

export type ApiPropertyRequestActivity = {
  id: number;
  actor_type: ActivityActorType;
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

function propertyRequestQuery(params?: { status?: string; skip?: number; limit?: number }): string {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.skip) q.set("skip", String(params.skip));
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

// Same request/error handling as requestJson, but also surfaces the
// X-Total-Count response header the list endpoint reports — requestJson
// itself only returns the parsed body, so list screens that need a real
// total (for "N requests" headers, pagination) go through this instead.
async function requestJsonWithCount<T>(path: string, init?: RequestInit): Promise<{ data: T; totalCount: number }> {
  const token = await readStoredToken();
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
      const body = (await response.json()) as { detail?: string | Array<{ msg: string; loc?: string[] }> };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        detail = body.detail[0].msg.replace(/^Value error,\s*/i, "");
      }
    } catch {
      /* ignore parse errors */
    }
    if (response.status === 401) {
      await clearStoredAuth();
      unauthorizedListeners.forEach((l) => l());
      throw new UnauthorizedError(detail);
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as T;
  const totalCount = Number(response.headers.get("X-Total-Count") ?? 0);
  return { data, totalCount };
}

export function createPropertyRequest(payload: PropertyRequestInput) {
  return requestJson<ApiPropertyRequest>("/property-requests/", { method: "POST", body: JSON.stringify(payload) });
}

// Kicks off the "describe it" flow — this already creates a real draft (with
// a real id) on the backend, it does not just parse text client-side.
export function createPropertyRequestFromText(text: string, locale: "en" | "ar") {
  return requestJson<ApiPropertyRequestFromText>("/property-requests/from-text", {
    method: "POST",
    body: JSON.stringify({ text, locale }),
  });
}

export async function fetchPropertyRequests(params?: { status?: string; skip?: number; limit?: number }) {
  const { data, totalCount } = await requestJsonWithCount<ApiPropertyRequestSummary[]>(
    `/property-requests/${propertyRequestQuery(params)}`,
  );
  return { items: data, total: totalCount || data.length };
}

export function fetchPropertyRequest(id: number) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}`);
}

export function updatePropertyRequest(id: number, payload: Partial<PropertyRequestInput>) {
  return requestJson<ApiPropertyRequest>(`/property-requests/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deletePropertyRequest(id: number) {
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
  return requestJson<ApiClarification[]>(`/property-requests/${id}/clarifications`, { method: "POST" });
}

export function answerPropertyRequestClarification(id: number, clarificationId: number, answer: string) {
  return requestJson<ApiClarification>(`/property-requests/${id}/clarifications/${clarificationId}/answer`, {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
}

export function fetchPropertyRequestMatches(id: number, params?: { status?: string; skip?: number; limit?: number }) {
  return requestJson<ApiPropertyRequestMatch[]>(`/property-requests/${id}/matches${propertyRequestQuery(params)}`);
}

export function dismissPropertyRequestMatch(id: number, matchId: number) {
  return requestJson<ApiPropertyRequestMatch>(`/property-requests/${id}/matches/${matchId}/dismiss`, { method: "POST" });
}

export function savePropertyRequestMatch(id: number, matchId: number) {
  return requestJson<ApiPropertyRequestMatch>(`/property-requests/${id}/matches/${matchId}/save`, { method: "POST" });
}

export function contactPropertyRequestMatch(id: number, matchId: number) {
  return requestJson<ApiPropertyRequestMatch>(`/property-requests/${id}/matches/${matchId}/contact`, { method: "POST" });
}

export function fetchPropertyRequestActivity(id: number, params?: { skip?: number; limit?: number }) {
  return requestJson<ApiPropertyRequestActivity[]>(`/property-requests/${id}/activity${propertyRequestQuery(params)}`);
}

export function fetchPropertyRequestNoMatchDiagnostics(id: number) {
  return requestJson<ApiNoMatchDiagnostic[]>(`/property-requests/${id}/no-match-diagnostics`);
}

export function fetchPropertyRequestAreaSuggestions(id: number) {
  return requestJson<ApiAreaSuggestion[]>(`/property-requests/${id}/area-suggestions`);
}

// Ephemeral preview (ids null, capped to 10, no side effects) — used in the
// creation flow's review step before the request is activated.
export function previewPropertyRequestMatches(id: number) {
  return requestJson<ApiPropertyRequestMatch[]>(`/property-requests/${id}/preview-matches`, { method: "POST" });
}

// Non-streaming AI Property Agent turn — unlike streamAdvisorChat above,
// this endpoint returns the full reply in one response, so a plain
// requestJson POST is enough (see advisor.tsx's doc comment for why the
// general advisor needs streaming and this one doesn't).
export function propertyRequestAiAgent(
  id: number,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  return requestJson<{ reply: string; ai_trace_id: string | null }>(`/property-requests/${id}/ai-agent`, {
    method: "POST",
    body: JSON.stringify({ message, history }),
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

// ── Projects (off-plan developments) ────────────────────────────────────────

export type ApiProjectImage = {
  id: number;
  url: string;
  display_order: number;
};

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
  views_count: number;
  created_at: string;
  updated_at: string;
  units: ApiProjectUnit[];
  images: ApiProjectImage[];
  mediator_id: number | null;
  contact_phone: string | null;
  whatsapp_phone: string | null;
  listing_status: string;
  mediator_phone: string | null;
  call_phone: string | null;
  whatsapp_number: string | null;
};

export function mapApiProject(project: ApiProject): UiProject {
  const imageUrls = (project.images ?? []).map((i) => i.url);
  const primaryImage = imageUrls[0] ?? project.image_url ?? "";

  return {
    id: String(project.id),
    title: project.title,
    district: project.area,
    city: project.city,
    image: primaryImage,
    images: imageUrls.length > 0 ? imageUrls : [primaryImage],
    priceMin: project.price_min,
    priceMax: project.price_max,
    areaMin: project.area_min,
    areaMax: project.area_max,
    unitCount: project.unit_count,
    status: project.status,
    completionStatus: project.completion_status,
    category: project.property_category,
    developerName: project.developer_name,
    developerLogo: project.developer_logo_url,
    description: project.description,
    latitude: project.latitude,
    longitude: project.longitude,
    introDocumentUrl: project.intro_document_url,
    isFeatured: project.is_featured,
    agentPhone: project.call_phone ?? project.mediator_phone ?? null,
    agentWhatsapp: project.whatsapp_number ?? project.mediator_phone ?? null,
    units: (project.units ?? []).map((u) => ({
      id: String(u.id),
      unitType: u.unit_type,
      price: u.price,
      areaSqm: u.area_sq_m,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      livingRooms: u.living_rooms,
      status: u.status,
    })),
    createdAt: project.created_at,
  };
}

export function fetchProjects() {
  return requestJson<ApiProject[]>("/projects/?limit=100");
}

export function fetchProject(id: number) {
  return requestJson<ApiProject>(`/projects/${id}`);
}

export function fetchSimilarProjects(id: number, limit = 6) {
  return requestJson<ApiProject[]>(`/projects/${id}/similar?limit=${limit}`);
}
