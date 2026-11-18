import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/maskan/LegalDocumentPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — Maskan" }] }),
  component: () => <LegalDocumentPage kind="privacy" />,
});
