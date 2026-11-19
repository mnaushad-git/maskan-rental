import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicy } from "@/components/maskan/PrivacyPolicy";

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
  component: PrivacyPolicy,
});
