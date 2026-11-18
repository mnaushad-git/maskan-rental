import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/maskan/LegalDocumentPage";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Use — Maskan" }] }),
  component: () => <LegalDocumentPage kind="terms" />,
});
