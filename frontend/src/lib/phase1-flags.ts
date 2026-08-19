// myMakan Phase-1 scope gate for the frontend. Mirrors the backend flags
// added in backend/app/core/config.py (see
// docs/implementation/mymakan-phase1.md "Feature flags") — kept as a local
// constant rather than fetched from the backend because there's no existing
// public config/flags endpoint, and adding one felt like scope creep for a
// display/route-guarding cleanup. Flip a value here (and update the doc) if
// a later prompt wires up a real client-side flag fetch.
export const PHASE1_FLAGS = {
  projects: false,
  booking: false,
  shortStay: false,
  financing: false,
  propertyManagement: false,
  externalTransaction: false,
  // Not one of the 6 backend flags from Prompt 2 — contracts.router was
  // deliberately left ungated there (no 1:1 flag existed yet). Added here
  // because property.$id.tsx's "Register lease" banner explicitly advertises
  // the Ejar-equivalent digital rental contract feature, which is
  // Hide-Phase1 per the Prompt 1 classification.
  contracts: false,
} as const;
