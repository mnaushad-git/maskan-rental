import { createFileRoute, redirect } from "@tanstack/react-router";

// Analytics moved to /admin/analytics so it uses the admin session
// (see routes/admin_.analytics.tsx). Kept as a redirect for old bookmarks.
export const Route = createFileRoute("/analytics")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/analytics" });
  },
});
