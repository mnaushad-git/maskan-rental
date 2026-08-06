import { Image, type ImageSourcePropType } from "react-native";
import type { Property as UiProperty } from "@/lib/maskan-data";
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
    agent: property.mediator_agent_name ?? property.owner_name ?? "myHome Agent",
    agentPhone: property.mediator_phone ?? null,
    agentProfileImage: property.mediator_profile_image_url ?? null,
    mediatorId: property.mediator_id ?? null,
    latitude: property.latitude,
    longitude: property.longitude,
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
    agentPhone: property.mediator_phone ?? null,
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
