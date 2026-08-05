import prop1 from "@/assets/prop-1.jpg";
import prop2 from "@/assets/prop-2.jpg";
import prop3 from "@/assets/prop-3.jpg";
import prop4 from "@/assets/prop-4.jpg";

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
  agentProfileImage: string | null;
  mediatorId: number | null;
};

export const properties: Property[] = [
  {
    id: "MSK-1042",
    title: "Skyline Residence — Al Olaya",
    district: "Al Olaya",
    city: "Riyadh",
    price: 145000,
    listingType: "rent" as const,
    bedrooms: 3,
    bathrooms: 3,
    area: 210,
    type: "Apartment",
    image: prop1,
    images: [prop1],
    matchScore: 96,
    badges: ["Best Match", "Verified"],
    status: "Available",
    pricePerSqm: 690,
    agent: "Faisal Al-Harbi",
    agentPhone: null,
    agentProfileImage: null,
    mediatorId: null,
  },
  {
    id: "MSK-2210",
    title: "Najdi Modern Villa — Al Yasmin",
    district: "Al Yasmin",
    city: "Riyadh",
    price: 235000,
    listingType: "rent" as const,
    bedrooms: 5,
    bathrooms: 6,
    area: 480,
    type: "Villa",
    image: prop2,
    images: [prop2],
    matchScore: 91,
    badges: ["Verified", "New"],
    status: "Available",
    pricePerSqm: 489,
    agent: "Noura Al-Qahtani",
    agentPhone: null,
    agentProfileImage: null,
    mediatorId: null,
  },
  {
    id: "MSK-3398",
    title: "KAFD Penthouse with City View",
    district: "King Abdullah Financial District",
    city: "Riyadh",
    price: 420000,
    listingType: "rent" as const,
    bedrooms: 4,
    bathrooms: 5,
    area: 360,
    type: "Penthouse",
    image: prop3,
    images: [prop3],
    matchScore: 88,
    badges: ["Hot", "Verified"],
    status: "Reserved",
    pricePerSqm: 1166,
    agent: "Omar Bin Saleh",
    agentPhone: null,
    agentProfileImage: null,
    mediatorId: null,
  },
  {
    id: "MSK-4521",
    title: "Coastal Townhouse — Al Shati",
    district: "Al Shati",
    city: "Jeddah",
    price: 168000,
    listingType: "rent" as const,
    bedrooms: 4,
    bathrooms: 4,
    area: 260,
    type: "Townhouse",
    image: prop4,
    images: [prop4],
    matchScore: 84,
    badges: ["Price Drop", "Verified"],
    status: "Available",
    pricePerSqm: 646,
    agent: "Layla Al-Subaie",
    agentPhone: null,
    agentProfileImage: null,
    mediatorId: null,
  },
  {
    id: "MSK-5630",
    title: "Family Apartment — Al Narjis",
    district: "Al Narjis",
    city: "Riyadh",
    price: 98000,
    listingType: "rent" as const,
    bedrooms: 3,
    bathrooms: 3,
    area: 195,
    type: "Apartment",
    image: prop1,
    images: [prop1],
    matchScore: 89,
    badges: ["Verified", "New"],
    status: "Available",
    pricePerSqm: 502,
    agent: "Saad Al-Dosari",
    agentPhone: null,
    agentProfileImage: null,
    mediatorId: null,
  },
  {
    id: "MSK-6712",
    title: "Garden Villa — Al Malqa",
    district: "Al Malqa",
    city: "Riyadh",
    price: 205000,
    listingType: "rent" as const,
    bedrooms: 4,
    bathrooms: 5,
    area: 380,
    type: "Villa",
    image: prop2,
    images: [prop2],
    matchScore: 92,
    badges: ["Best Match", "Verified"],
    status: "Available",
    pricePerSqm: 539,
    agent: "Hanan Al-Rashid",
    agentPhone: null,
    agentProfileImage: null,
    mediatorId: null,
  },
];

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
