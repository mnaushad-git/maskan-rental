import { createFileRoute, redirect } from "@tanstack/react-router";

// Data Import moved to /admin/import so it runs with the admin session
// (see routes/admin_.import.tsx). Kept as a redirect for old bookmarks.
export const Route = createFileRoute("/import")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/import" });
  },
});
