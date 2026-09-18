// Shared Transaction Workspace display helpers (Prompt 11) — mirrors
// frontend/src/lib/transactionWorkspace.ts exactly, so both platforms
// render the backend's own deterministic readiness_label/next_best_action
// fields (app/services/transaction_progress.py) identically. Never
// recomputed independently — see docs/implementation/
// mymakan-transaction-workspace.md "Checklist / Progress methodology".
import type { ApiNextBestAction } from "@/lib/api/maskan";

const READINESS_LABEL_I18N_KEY: Record<string, string> = {
  "Not Ready": "notReady",
  "Almost Ready": "almostReady",
  "Ready for Rental Contract Process": "readyRent",
  "Ready for Sale Process": "readySale",
};

export function readinessText(t: (key: string) => string, label: string): string {
  const key = READINESS_LABEL_I18N_KEY[label];
  return key ? t(`transactionPage.readiness.${key}`) : label;
}

const UPLOAD_PREFIX = "Upload ";
const REVIEW_UPDATE_PREFIX = "Review mediator's update request for ";

export function nbaText(
  t: (key: string, vars?: Record<string, string | number>) => string,
  nba: ApiNextBestAction,
  readinessLabel: string,
): string {
  switch (nba.key) {
    case "complete_profile_information":
    case "await_mediator_review":
    case "confirm_information":
      return t(`transactionPage.nba.${nba.key}`);
    case "upload_missing_document":
      return t("transactionPage.nba.upload_missing_document", {
        document: nba.message.startsWith(UPLOAD_PREFIX) ? nba.message.slice(UPLOAD_PREFIX.length) : nba.message,
      });
    case "review_update_request":
      return t("transactionPage.nba.review_update_request", {
        document: nba.message.startsWith(REVIEW_UPDATE_PREFIX) ? nba.message.slice(REVIEW_UPDATE_PREFIX.length) : nba.message,
      });
    case "ready":
      return t("transactionPage.nba.ready", { state: readinessLabel });
    default:
      return nba.message;
  }
}
