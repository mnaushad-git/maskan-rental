import { Badge } from "./Badges";
import { useLanguage } from "@/lib/i18n/context";
import { statusTone } from "@/lib/propertyRequestDisplay";
import type { PropertyRequestStatus } from "@/lib/api/maskan";

export function PropertyRequestStatusBadge({ status }: { status: PropertyRequestStatus }) {
  const { t } = useLanguage();
  return <Badge tone={statusTone(status)}>{t(`propertyRequest.status.${status}`)}</Badge>;
}
