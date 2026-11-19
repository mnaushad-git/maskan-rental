import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/maskan/LegalDocumentPage";
import { POLICY_APPROVED, PrivacyPolicy } from "@/components/maskan/PrivacyPolicy";

// The draft policy (with its unresolved legal markers) is never served publicly:
// until POLICY_APPROVED is set after legal review, /privacy shows the existing
// "not published yet" notice (or VITE_PRIVACY_POLICY_URL, if configured).
function PrivacyRoute() {
  return POLICY_APPROVED ? <PrivacyPolicy /> : <LegalDocumentPage kind="privacy" />;
}

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Maskan" },
      {
        name: "description",
        content:
          "How Maskan collects, uses and protects personal data, and how to delete your account.",
      },
    ],
  }),
  component: PrivacyRoute,
});
