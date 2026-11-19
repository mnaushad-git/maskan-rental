import { createFileRoute } from "@tanstack/react-router";
import { NotificationCenter } from "@/components/maskan/NotificationCenter";

// Partner Portal notification center. Lives under /partner so it uses the
// partner session (auth-storage portalScope) — the customer /notifications
// page asked a signed-in partner to sign in.
export const Route = createFileRoute("/partner/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Maskan Partner" }] }),
  component: () => <NotificationCenter variant="partner" />,
});
