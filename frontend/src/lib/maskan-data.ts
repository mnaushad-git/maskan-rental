export type PropertyFeatures = {
  kitchen: boolean;
  water: boolean;
  electricity: boolean;
  privateRoof: boolean;
  inVilla: boolean;
  twoEntrances: boolean;
  separateElectricalMeter: boolean;
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
  image: string;        // primary image (first in gallery)
  images: string[];     // all image URLs
  matchScore: number; // 0-100
  badges: ("Best Match" | "New" | "Verified" | "Price Drop" | "Hot")[];
  status: "Available" | "Reserved" | "Rented" | "Sold";
  pricePerSqm: number;
  agent: string;
  agentPhone: string | null;
  agentWhatsapp: string | null;
  agentProfileImage: string | null;
  mediatorId: number | null;
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
};

export type ProjectUnit = {
  id: number;
  unitType: string;
  price: number;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingRooms: number | null;
  status: string;
};

export type Project = {
  id: string;
  title: string;
  district: string;
  city: string;
  description: string | null;
  image: string;
  images: string[];
  status: string;
  completionStatus: string | null;
  category: string | null;
  priceMin: number | null;
  priceMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  unitCount: number | null;
  introDocumentUrl: string | null;
  isFeatured: boolean;
  developerName: string | null;
  developerLogoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  units: ProjectUnit[];
  viewsCount: number;
  agentPhone: string | null;
  agentWhatsapp: string | null;
  mediatorId: number | null;
  listingStatus: string;
};

export const marketStats = [
  { label: "Avg. Rent Riyadh", value: "SAR 92K", delta: "+4.2%", trend: "up" as const },
  { label: "Avg. Rent Jeddah", value: "SAR 78K", delta: "+2.1%", trend: "up" as const },
  { label: "Listings This Week", value: "12,480", delta: "+18%", trend: "up" as const },
  { label: "Avg. Days on Market", value: "21", delta: "-3 days", trend: "down" as const },
];

export type Area = {
  name: string;
  city: string;
  avgRent: number; // SAR / year
  areaScore: number;
  familyScore: number;
  rentalValueScore: number;
  highlight: string;
};

export const featuredAreas: Area[] = [
  {
    name: "Al Yasmin",
    city: "Riyadh",
    avgRent: 135000,
    areaScore: 92,
    familyScore: 95,
    rentalValueScore: 88,
    highlight: "Top-rated for families · 8% below market",
  },
  {
    name: "Al Narjis",
    city: "Riyadh",
    avgRent: 98000,
    areaScore: 86,
    familyScore: 90,
    rentalValueScore: 93,
    highlight: "Best value in North Riyadh",
  },
  {
    name: "Al Malqa",
    city: "Riyadh",
    avgRent: 178000,
    areaScore: 94,
    familyScore: 91,
    rentalValueScore: 79,
    highlight: "Premium compounds & schools",
  },
  {
    name: "Al Aqiq",
    city: "Riyadh",
    avgRent: 162000,
    areaScore: 89,
    familyScore: 84,
    rentalValueScore: 85,
    highlight: "Walkable, near KAFD & metro",
  },
];

export const cities = [
  { name: "Riyadh", listings: 6420 },
  { name: "Jeddah", listings: 3180 },
  { name: "Dammam", listings: 1240 },
  { name: "Khobar", listings: 980 },
  { name: "Madinah", listings: 660 },
];

export const aiQuickQuestions = [
  "Which area is best for a family?",
  "Is SAR 5,000 enough for Riyadh?",
  "Compare Al Yasmin and Al Narjis.",
  "Is this rent fair?",
];

// Uses Western digits (numberingSystem: "latn") in both locales — Saudi
// financial UIs conventionally keep 0-9 digits even in Arabic, since that's
// what users read and type. Only the grouping/decimal separator convention
// varies with locale. Reads the language the LanguageProvider has already
// stamped onto <html lang> rather than taking a prop, since formatSAR is
// called from ~80 call sites that don't all have `lang` in scope.
export const formatSAR = (n: number) => {
  const locale =
    typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar-SA" : "en-US";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, numberingSystem: "latn" }).format(n);
};

export type DistrictScores = {
  areaScore: number;
  familyScore: number;
  schoolScore: number;
  healthcareScore: number;
  trafficScore: number;
};

export const DISTRICT_SCORES: Record<string, DistrictScores> = {
  "Al Yasmin":          { areaScore: 92, familyScore: 95, schoolScore: 90, healthcareScore: 86, trafficScore: 78 },
  "Al Narjis":          { areaScore: 86, familyScore: 90, schoolScore: 84, healthcareScore: 80, trafficScore: 82 },
  "Al Malqa":           { areaScore: 94, familyScore: 91, schoolScore: 92, healthcareScore: 90, trafficScore: 70 },
  "Al Olaya":           { areaScore: 88, familyScore: 72, schoolScore: 78, healthcareScore: 88, trafficScore: 60 },
  "Al Shati":           { areaScore: 89, familyScore: 86, schoolScore: 80, healthcareScore: 84, trafficScore: 74 },
  "Al Rawdah":          { areaScore: 84, familyScore: 82, schoolScore: 86, healthcareScore: 82, trafficScore: 68 },
  "Al Faisaliyah":      { areaScore: 81, familyScore: 84, schoolScore: 76, healthcareScore: 80, trafficScore: 86 },
  "University District":{ areaScore: 74, familyScore: 60, schoolScore: 88, healthcareScore: 78, trafficScore: 80 },
};
