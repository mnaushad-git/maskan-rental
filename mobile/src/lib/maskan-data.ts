export type Property = {
  id: string;
  title: string;
  district: string;
  city: string;
  // Rent listings: SAR / year. Sale listings: total SAR sale price.
  price: number;
  listingType: "rent" | "sale";
  bedrooms: number;
  bathrooms: number;
  area: number; // sqm
  type: string;
  image: string; // primary image (first in gallery)
  images: string[]; // all image URLs
  matchScore: number; // 0-100
  badges: ("Best Match" | "New" | "Verified" | "Price Drop" | "Hot")[];
  status: "Available" | "Reserved" | "Rented" | "Sold";
  pricePerSqm: number;
  agent: string;
  agentPhone: string | null;
  agentProfileImage: string | null;
  mediatorId: number | null;
  latitude: number | null;
  longitude: number | null;
};

import { I18nManager } from "react-native";
import type { SearchProperty } from "./maskan-search-data";

/** Adapts a search-result property (from /properties or /search) into the
 * card-display shape — shared by every screen that renders SearchProperty
 * items through PropertyCard (search, saved, similar-listings rail), so the
 * mapping lives in exactly one place. `mediatorId` is always null here
 * because SearchProperty doesn't carry it — only the full ApiProperty
 * (mapApiProperty) does. */
export function toCardProperty(p: SearchProperty): Property {
  return {
    id: p.id,
    title: p.title,
    district: p.district,
    city: p.city,
    price: p.price,
    listingType: p.listingType,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    area: p.area,
    type: p.type,
    image: p.image,
    images: [p.image],
    matchScore: p.matchScore,
    badges: p.isVerified ? ["Verified"] : [],
    status: "Available",
    pricePerSqm: p.area > 0 ? Math.round(p.price / p.area) : 0,
    agent: "myHome Agent",
    agentPhone: p.agentPhone,
    agentProfileImage: null,
    mediatorId: null,
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

// Uses Western digits (numberingSystem: "latn") in both locales — Saudi
// financial UIs conventionally keep 0-9 digits even in Arabic, since that's
// what users read and type. Only the grouping/decimal separator convention
// varies with locale. Reads I18nManager.isRTL rather than taking a `lang`
// prop, since formatSAR is called from many screens that don't all have
// language in scope, and a language switch always triggers a full app
// reload (see i18n/context.tsx), so this stays in sync.
export const formatSAR = (n: number) => {
  const locale = I18nManager.isRTL ? "ar-SA" : "en-US";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, numberingSystem: "latn" }).format(n);
};
