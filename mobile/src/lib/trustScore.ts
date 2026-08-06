import type { ApiTrustMetrics } from "@/lib/api/maskan";

export type TrustTier = "trusted" | "building" | "new";

export type TrustBadgeResult = {
  score: number; // 0–100
  tier: TrustTier;
  breakdown: {
    verification: number; // 0–100
    reviews: number; // 0–100
    responseRate: number; // 0–100
  };
};

// Weighted so a verified identity dominates the score (it's the strongest,
// hardest-to-fake signal) while reviews and responsiveness pull a verified
// renter the rest of the way to "Trusted" or hold back an unverified one.
const WEIGHTS = { verification: 0.5, reviews: 0.25, responseRate: 0.25 } as const;

// Reviews: diminishing returns after 3 — a single review shouldn't swing
// the badge as much as having a real history.
const REVIEW_COUNT_FOR_MAX_SCORE = 3;

function verificationScore(status: ApiTrustMetrics["verification_status"], isVerified: boolean): number {
  if (isVerified || status === "approved") return 100;
  if (status === "pending") return 30;
  return 0; // "unverified" | "rejected"
}

function reviewScore(reviewCount: number): number {
  return Math.min(reviewCount, REVIEW_COUNT_FOR_MAX_SCORE) / REVIEW_COUNT_FOR_MAX_SCORE * 100;
}

function responseRateScore(responded: number, totalWithContact: number): number {
  // No mediator has contacted this renter yet — neutral, not penalized.
  if (totalWithContact === 0) return 100;
  return (responded / totalWithContact) * 100;
}

export function computeTrustScore(metrics: ApiTrustMetrics): TrustBadgeResult {
  const breakdown = {
    verification: verificationScore(metrics.verification_status, metrics.is_verified),
    reviews: reviewScore(metrics.review_count),
    responseRate: responseRateScore(metrics.responded_leads, metrics.total_leads_with_contact),
  };

  const score = Math.round(
    breakdown.verification * WEIGHTS.verification +
      breakdown.reviews * WEIGHTS.reviews +
      breakdown.responseRate * WEIGHTS.responseRate,
  );

  const tier: TrustTier = score >= 85 ? "trusted" : score >= 50 ? "building" : "new";

  return { score, tier, breakdown };
}
