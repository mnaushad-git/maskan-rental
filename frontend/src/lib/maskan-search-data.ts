import prop1 from "@/assets/prop-1.jpg";
import prop2 from "@/assets/prop-2.jpg";
import prop3 from "@/assets/prop-3.jpg";
import prop4 from "@/assets/prop-4.jpg";

export type SearchProperty = {
  id: string;
  title: string;
  city: string;
  district: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  area: number;
  type: "Apartment" | "Villa" | "Penthouse" | "Townhouse";
  furnished: "Furnished" | "Unfurnished" | "Semi-furnished";
  image: string;
  rentalScore: number;
  areaScore: number;
  matchScore: number;
  amenities: {
    parking: boolean;
    balcony: boolean;
    gym: boolean;
    pool: boolean;
  };
  reasons: string[];
  agentPhone: string | null;
};

const IMGS = [prop1, prop2, prop3, prop4];

const baseTitles: Array<Omit<SearchProperty, "id" | "image">> = [
  {
    title: "Skyline Residence",
    city: "Riyadh", district: "Al Olaya",
    price: 145000, bedrooms: 3, bathrooms: 3, area: 210, type: "Apartment",
    furnished: "Semi-furnished",
    rentalScore: 92, areaScore: 88, matchScore: 96,
    amenities: { parking: true, balcony: true, gym: true, pool: true },
    reasons: ["Within Budget", "Family Friendly", "Near Schools", "Good Rental Value"],
  },
  {
    title: "Najdi Modern Villa",
    city: "Riyadh", district: "Al Yasmin",
    price: 235000, bedrooms: 5, bathrooms: 6, area: 480, type: "Villa",
    furnished: "Unfurnished",
    rentalScore: 88, areaScore: 92, matchScore: 91,
    amenities: { parking: true, balcony: true, gym: false, pool: true },
    reasons: ["Family Friendly", "Spacious Layout", "Near Schools", "Top-rated Area"],
  },
  {
    title: "KAFD Penthouse",
    city: "Riyadh", district: "KAFD",
    price: 420000, bedrooms: 4, bathrooms: 5, area: 360, type: "Penthouse",
    furnished: "Furnished",
    rentalScore: 79, areaScore: 95, matchScore: 88,
    amenities: { parking: true, balcony: true, gym: true, pool: true },
    reasons: ["Prime Location", "Premium Finishings", "Concierge", "Skyline View"],
  },
  {
    title: "Coastal Townhouse",
    city: "Jeddah", district: "Al Shati",
    price: 168000, bedrooms: 4, bathrooms: 4, area: 260, type: "Townhouse",
    furnished: "Unfurnished",
    rentalScore: 90, areaScore: 86, matchScore: 84,
    amenities: { parking: true, balcony: true, gym: false, pool: false },
    reasons: ["Within Budget", "Beach Access", "Family Friendly", "Good Rental Value"],
  },
  {
    title: "Family Apartment",
    city: "Riyadh", district: "Al Narjis",
    price: 98000, bedrooms: 3, bathrooms: 3, area: 195, type: "Apartment",
    furnished: "Unfurnished",
    rentalScore: 94, areaScore: 86, matchScore: 89,
    amenities: { parking: true, balcony: true, gym: false, pool: false },
    reasons: ["Within Budget", "Family Friendly", "Near Schools", "Best Value"],
  },
  {
    title: "Garden Villa",
    city: "Riyadh", district: "Al Malqa",
    price: 205000, bedrooms: 4, bathrooms: 5, area: 380, type: "Villa",
    furnished: "Semi-furnished",
    rentalScore: 85, areaScore: 94, matchScore: 92,
    amenities: { parking: true, balcony: true, gym: true, pool: true },
    reasons: ["Family Friendly", "Near Schools", "Premium Compound", "Good Rental Value"],
  },
  {
    title: "Marina View Apartment",
    city: "Jeddah", district: "Al Hamra",
    price: 132000, bedrooms: 3, bathrooms: 3, area: 220, type: "Apartment",
    furnished: "Furnished",
    rentalScore: 87, areaScore: 89, matchScore: 86,
    amenities: { parking: true, balcony: true, gym: true, pool: true },
    reasons: ["Sea View", "Within Budget", "Modern Building", "Good Amenities"],
  },
  {
    title: "Diplomatic Quarter Villa",
    city: "Riyadh", district: "Al Safarat",
    price: 290000, bedrooms: 5, bathrooms: 6, area: 520, type: "Villa",
    furnished: "Unfurnished",
    rentalScore: 81, areaScore: 96, matchScore: 87,
    amenities: { parking: true, balcony: true, gym: true, pool: true },
    reasons: ["Top-rated Area", "Family Friendly", "Premium Security", "Near Schools"],
  },
  {
    title: "Corniche Apartment",
    city: "Khobar", district: "Al Aqrabiyah",
    price: 76000, bedrooms: 2, bathrooms: 2, area: 140, type: "Apartment",
    furnished: "Semi-furnished",
    rentalScore: 93, areaScore: 82, matchScore: 83,
    amenities: { parking: true, balcony: true, gym: false, pool: false },
    reasons: ["Within Budget", "Sea View", "Walkable", "Good Rental Value"],
  },
  {
    title: "Modern Family Townhouse",
    city: "Riyadh", district: "Al Aqiq",
    price: 152000, bedrooms: 4, bathrooms: 4, area: 280, type: "Townhouse",
    furnished: "Unfurnished",
    rentalScore: 89, areaScore: 88, matchScore: 90,
    amenities: { parking: true, balcony: true, gym: true, pool: true },
    reasons: ["Within Budget", "Family Friendly", "Near KAFD", "Compound Amenities"],
  },
  {
    title: "Business Bay Apartment",
    city: "Dammam", district: "Al Shati",
    price: 84000, bedrooms: 2, bathrooms: 2, area: 155, type: "Apartment",
    furnished: "Furnished",
    rentalScore: 91, areaScore: 80, matchScore: 81,
    amenities: { parking: true, balcony: true, gym: true, pool: false },
    reasons: ["Within Budget", "Furnished", "Near Workplaces", "Good Value"],
  },
  {
    title: "Hittin Premium Villa",
    city: "Riyadh", district: "Hittin",
    price: 268000, bedrooms: 5, bathrooms: 6, area: 460, type: "Villa",
    furnished: "Semi-furnished",
    rentalScore: 83, areaScore: 93, matchScore: 89,
    amenities: { parking: true, balcony: true, gym: true, pool: true },
    reasons: ["Family Friendly", "Near International Schools", "Premium Area", "Spacious"],
  },
];

export const searchProperties: SearchProperty[] = baseTitles.map((b, i) => ({
  ...b,
  id: `MSK-${7000 + i}`,
  image: IMGS[i % IMGS.length],
  agentPhone: null,
}));

export const districtsByCity: Record<string, string[]> = {
  Riyadh: [
    "Al Yasmin", "Al Narjis", "Al Malqa", "Al Olaya", "Al Rawdah",
    "Al Faisaliyah", "University District", "Hitteen", "Al Sahafah",
    "Al Nakheel", "Diplomatic Quarter", "Qurtuba", "Al Sulimaniyah",
  ],
  Jeddah: [
    "Al Hamra", "Al Zahraa", "Obhur Al Shamaliyah", "Al Khalidiyyah",
    "Al Rawdah", "Al Shati", "Al Andalus", "Al Murjaan", "Al Naim", "Al Basateen",
  ],
  Dammam: [
    "Al Faisaliyyah", "Al Adamah", "Al Mazrouiyah", "Al Nuzha",
    "Al Badiyah", "Al Shulah", "Al Fursan", "Al Shati",
  ],
  Khobar: [
    "Al Aqrabiyah", "Al Thuqbah", "Al Bandariyah", "Al Aziziyah", "Al Rawabi",
  ],
  Madinah: [
    "Al Khalidiyya", "Al Aziziyya", "Quba", "Al Salam",
    "Al Bayan", "Bani Haritha", "Al Aqoul",
  ],
};
