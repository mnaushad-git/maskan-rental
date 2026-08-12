export type SearchProperty = {
  id: string;
  title: string;
  city: string;
  district: string;
  // Rent listings: SAR / year. Sale listings: total SAR sale price.
  price: number;
  listingType: "rent" | "sale";
  bedrooms: number;
  bathrooms: number;
  area: number;
  type: string;
  furnished: "Furnished" | "Unfurnished" | "Semi-furnished";
  image: string;
  rentalScore: number;
  areaScore: number;
  matchScore: number;
  isVerified: boolean;
  agentPhone: string | null;
  agentWhatsapp: string | null;
  latitude: number | null;
  longitude: number | null;
};

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
