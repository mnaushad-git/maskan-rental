import { createFileRoute } from "@tanstack/react-router";
import { NotificationCenter } from "@/components/maskan/NotificationCenter";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Maskan" },
      { name: "description", content: "Property alerts, digests, and platform updates." },
    ],
  }),
  component: () => <NotificationCenter variant="customer" />,
});
