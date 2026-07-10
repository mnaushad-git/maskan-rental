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
};

export const formatSAR = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
