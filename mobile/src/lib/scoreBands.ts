/**
 * Shared 0-100 score → color/label banding, used everywhere myMakan shows a
 * score ring/bar/chip (property decision score, area intelligence score,
 * individual area dimensions) so "green" means the same thing across the
 * app. Single source of truth — previously duplicated (and drifted) between
 * `areas/index.tsx`'s local `scoreColor()` and `methodology.tsx`'s `BANDS`,
 * while `ScoreIndicator.tsx` used a third, disconnected 2-tone scale that
 * never actually rendered green.
 */
import { colors } from "@/lib/colors";

export const SCORE_BANDS = [
  { key: "excellent", min: 85, range: "85–100", color: colors.success },
  { key: "strong", min: 70, range: "70–84", color: "#65A30D" },
  { key: "good", min: 55, range: "55–69", color: "#B45309" },
  { key: "belowAverage", min: 0, range: "40–54", color: colors.destructive },
] as const;

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return colors.neutral400;
  for (const band of SCORE_BANDS) {
    if (score >= band.min) return band.color;
  }
  return colors.destructive;
}
