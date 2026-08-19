// Shared negotiation-strength signal display mapping (brief §14) — the
// single source of truth for how every surface renders the backend's real
// negotiation_signal field (app/services/negotiation_signals.py, never
// re-derived client-side). Extracted in the Prompt 12 polish pass so all
// four surfaces (My Negotiations list cards, Negotiation Detail, partner
// inbox list cards, Partner Negotiation Detail) share one color/label
// mapping instead of drifting apart across independent copies — previously
// negotiations.$id.tsx alone defined this inline.
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
// i18n namespaces (frontend/src/lib/i18n/{en,ar}.ts) — no new keys needed,
// every surface reuses these.
export const NEGOTIATION_SIGNAL_I18N_KEY: Record<NegotiationSignalKey, string> = {
  within_market_range: "withinMarketRange",
  below_market_range: "belowMarketRange",
  above_market_range: "aboveMarketRange",
  close_to_asking_price: "closeToAskingPrice",
  significant_discount_requested: "significantDiscountRequested",
  limited_comparable_data: "limitedComparableData",
};
