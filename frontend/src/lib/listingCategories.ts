// Category taxonomy for the Rent / Sale toggle — shared by the homepage
// search bar and the /search page so both stay in sync.
export type ListingType = "rent" | "sale";

export const RENT_MAIN = ["Apartment", "Villa", "Big Flat", "Building", "Land", "Store", "Office"] as const;
export const SALE_MAIN = ["Apartment", "Villa", "Land", "Floor", "Building", "Lounge"] as const;

// Shared overflow list shown under "More" for both tabs — Lounge is a main
// chip on the Sale tab, so it's excluded here to avoid appearing twice.
export const MORE_RENT = [
  "Chalet", "Complex", "Factory", "Farm", "Hotel", "Kiosk", "Lounge",
  "Parking", "Room", "School", "Station", "Tower", "Warehouse", "Workshop",
] as const;
export const MORE_SALE = [
  "Chalet", "Complex", "Factory", "Farm", "Hotel", "Kiosk",
  "Parking", "Room", "School", "Station", "Tower", "Warehouse", "Workshop",
] as const;

export function mainCategories(listingType: ListingType): readonly string[] {
  return listingType === "rent" ? RENT_MAIN : SALE_MAIN;
}

export function moreCategories(listingType: ListingType): readonly string[] {
  return listingType === "rent" ? MORE_RENT : MORE_SALE;
}

export function allCategories(listingType: ListingType): string[] {
  return [...mainCategories(listingType), ...moreCategories(listingType)];
}
