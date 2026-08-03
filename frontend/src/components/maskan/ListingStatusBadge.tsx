import { CheckCircle2, Clock, CircleDashed, ShieldAlert, X } from "lucide-react";
import { Badge } from "./Badges";
import { useLanguage } from "@/lib/i18n/context";

export type ListingStatus = "Draft" | "Pending Approval" | "Published" | "Suspended" | "Rejected";

// Single source of truth for listing-workflow status → tone/icon/label.
// Previously admin.tsx and partner.tsx each had their own version of this
// (statusTone()/StatusBadge and ListingStatusBadge) with genuinely different
// tone mappings for the same status values — Suspended read as "info" in one
// portal and "destructive" in the other, and admin's version had no i18n
// label at all. This is the merged, consistent version both now use.
const STATUS_CONFIG: Record<ListingStatus, { tone: "success" | "warning" | "neutral" | "destructive"; icon: React.ReactNode }> = {
  Published: { tone: "success", icon: <CheckCircle2 className="size-3" /> },
  "Pending Approval": { tone: "warning", icon: <Clock className="size-3" /> },
  Draft: { tone: "neutral", icon: <CircleDashed className="size-3" /> },
  Suspended: { tone: "destructive", icon: <ShieldAlert className="size-3" /> },
  Rejected: { tone: "destructive", icon: <X className="size-3" /> },
};

export function ListingStatusBadge({ status }: { status: ListingStatus | (string & {}) }) {
  const { t } = useLanguage();
  // Both callers (admin.tsx, partner.tsx) source `status` from the backend as
  // a plain string — fall back gracefully for any value outside the known
  // workflow states rather than crashing, matching the defensive behavior
  // partner.tsx's version already had (`toneMap[status] ?? "neutral"`).
  const config = STATUS_CONFIG[status as ListingStatus] ?? { tone: "neutral" as const, icon: undefined };
  const label = status in STATUS_CONFIG ? t(`partnerDashboard.listingsView.statusBadges.${status}`) : status;
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {label}
    </Badge>
  );
}
