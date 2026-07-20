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
