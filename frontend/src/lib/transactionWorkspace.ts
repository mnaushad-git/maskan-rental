// Shared Transaction Workspace display helpers (Prompt 8) — the single
// source of truth for how every surface (My Transactions list cards,
// Transaction Workspace header/NBA card) renders the backend's own
// deterministic fields (checklist/progress/next_best_action/readiness_label
// from app/services/transaction_progress.py, never recomputed client-side —
// see docs/implementation/mymakan-transaction-workspace.md "Checklist /
// Progress methodology"). Mirrors @/lib/negotiationSignal's own
// "one shared mapping, not independent copies per page" convention.
import type { ApiNextBestAction } from "@/lib/api/maskan";

type Tone = "primary" | "secondary" | "ai" | "success" | "warning" | "info" | "neutral" | "destructive";

const STATUS_TONE: Record<string, Tone> = {
  initiated: "info",
  information_required: "warning",
  documents_required: "warning",
  under_review: "info",
  ready_for_next_step: "success",
  external_process_pending: "success",
  completed: "success",
  cancelled: "destructive",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

// `readiness_label` is one of exactly four backend-computed English strings
// (READY_LABELS + "Not Ready"/"Almost Ready" — see transaction_progress.py).
// Mapped by VALUE, not translated as free text, so the non-negotiable exact
// wording (READY_LABELS) stays intact everywhere it's used verbatim (e.g.
// transaction_notifications.py embeds the same string in both en/ar bodies)
// while this UI still renders a real Arabic phrase, not raw English, for
// every tier.
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

// next_best_action.message is backend-composed English free text; the two
// document-referencing keys embed a document's own `label` (also
// English-only — DOCUMENT_TEMPLATES has no Arabic variant, see tracking
// doc's "Known limitations"), so this only localizes the surrounding verb
// phrase, not the document name itself.
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
        document: nba.message.startsWith(REVIEW_UPDATE_PREFIX)
          ? nba.message.slice(REVIEW_UPDATE_PREFIX.length)
          : nba.message,
      });
    case "ready":
      return t("transactionPage.nba.ready", { state: readinessLabel });
    default:
      return nba.message;
  }
}
