export type PropertyFeatures = {
  kitchen: boolean;
  water: boolean;
  electricity: boolean;
  privateRoof: boolean;
  inVilla: boolean;
  twoEntrances: boolean;
  separateElectricalMeter: boolean;
  elevator: boolean;
  airconditioners: boolean;
};

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
  agentWhatsapp: string | null;
  agentProfileImage: string | null;
  mediatorId: number | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  furnished: string | null;
  livingRooms: number | null;
  propertyAgeYears: number | null;
  commissionPercent: number | null;
  features: PropertyFeatures;
  licenseNumber: string | null;
  licenseExpirationDate: string | null;
  deedArea: number | null;
  viewsCount: number;
  createdAt: string;
  updatedAt: string;
  mediatorRating: number | null;
  mediatorReviewCount: number;
  isBookable: boolean;
  nightlyRate: number | null;
  arrivalTime: string | null;
  departureTime: string | null;
  latestBookingTime: string | null;
  insuranceAmount: number;
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
    agent: "myMakan Agent",
    agentPhone: p.agentPhone,
    agentWhatsapp: p.agentWhatsapp,
    agentProfileImage: null,
    mediatorId: null,
    latitude: p.latitude,
    longitude: p.longitude,
    // SearchProperty (search-result cards) doesn't carry these detail-page-only
    // fields — placeholders here are fine since PropertyCard never renders them.
    description: null,
    furnished: null,
    livingRooms: null,
    propertyAgeYears: null,
    commissionPercent: null,
    features: {
      kitchen: false,
      water: false,
      electricity: false,
      privateRoof: false,
      inVilla: false,
      twoEntrances: false,
      separateElectricalMeter: false,
      elevator: false,
      airconditioners: false,
    },
    licenseNumber: null,
    licenseExpirationDate: null,
    deedArea: null,
    viewsCount: 0,
    createdAt: "",
    updatedAt: "",
    mediatorRating: null,
    mediatorReviewCount: 0,
    isBookable: false,
    nightlyRate: null,
    arrivalTime: null,
    departureTime: null,
    latestBookingTime: null,
    insuranceAmount: 0,
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

export type ProjectUnit = {
  id: string;
  unitType: string;
  price: number;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingRooms: number | null;
  status: string;
};

// Off-plan/new-development "Project" — a developer-built multi-unit
// development, distinct from a single Property listing. See ProjectCard /
// app/project/[id].tsx.
export type Project = {
  id: string;
  title: string;
  district: string;
  city: string;
  image: string;
  images: string[];
  priceMin: number | null;
  priceMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  unitCount: number | null;
  status: string;
  completionStatus: string | null;
  category: string | null;
  developerName: string | null;
  developerLogo: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  introDocumentUrl: string | null;
  isFeatured: boolean;
  units: ProjectUnit[];
  createdAt: string;
  agentPhone: string | null;
  agentWhatsapp: string | null;
};
