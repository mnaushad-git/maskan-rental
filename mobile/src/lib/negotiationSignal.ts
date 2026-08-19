// Shared negotiation-strength signal display mapping (brief §14) — mirrors
// frontend/src/lib/negotiationSignal.ts exactly, so the mobile badge uses
// the identical color/label mapping the web surfaces do. Extracted in the
// Prompt 12 polish pass — previously app/negotiations/[id].tsx alone defined
// this inline.
export type NegotiationSignalKey =
  | "within_market_range"
  | "below_market_range"
  | "above_market_range"
  | "close_to_asking_price"
  | "significant_discount_requested"
  | "limited_comparable_data";

export const NEGOTIATION_SIGNAL_TONE: Record<NegotiationSignalKey, "success" | "info" | "warning" | "neutral"> = {
  within_market_range: "success",
  below_market_range: "info",
  above_market_range: "warning",
  close_to_asking_price: "neutral",
  significant_discount_requested: "warning",
  limited_comparable_data: "neutral",
};

// Maps onto the existing negotiationDetail.signal.tag.* / .signal.label.*
// i18n namespaces (mobile/src/lib/i18n/{en,ar}.ts) — no new keys needed.
export const NEGOTIATION_SIGNAL_I18N_KEY: Record<NegotiationSignalKey, string> = {
  within_market_range: "withinMarketRange",
  below_market_range: "belowMarketRange",
  above_market_range: "aboveMarketRange",
  close_to_asking_price: "closeToAskingPrice",
  significant_discount_requested: "significantDiscountRequested",
  limited_comparable_data: "limitedComparableData",
};
