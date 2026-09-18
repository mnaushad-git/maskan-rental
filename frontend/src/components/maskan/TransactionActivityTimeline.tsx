import {
  CheckCircle2,
  Clock,
  FileCheck,
  FileClock,
  FileWarning,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";
import { readinessText } from "@/lib/transactionWorkspace";
import type { ApiPropertyTransactionDetail } from "@/lib/api/maskan";

// Activity tab (brief §14) — a timeline built purely from the timestamps
// already present on the transaction/document rows (created_at, per-document
// uploaded_at/reviewed_at, customer_info_confirmed_at,
// mediator_info_confirmed_at, ready_at, completed_at, cancelled_at). No
// dedicated backend timeline endpoint exists for the customer surface (that
// admin-only OutboxEvent-backed timeline is Prompt 7's own, read-only,
// non-customer-facing addition) — deriving client-side from timestamps
// mirrors how negotiations.$id.tsx's own NegotiationTimeline already works,
// and deliberately never touches the lead/chat message list.
type TimelineEvent = {
  at: string;
  icon: typeof Clock;
  label: string;
  detail?: string;
};

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TransactionActivityTimeline({
  transaction,
}: {
  transaction: ApiPropertyTransactionDetail;
}) {
  const { t, lang } = useLanguage();

  const events: TimelineEvent[] = [
    {
      at: transaction.created_at,
      icon: Sparkles,
      label: t("transactionPage.activity.events.created"),
    },
  ];

  for (const doc of transaction.documents) {
    if (doc.uploaded_at) {
      events.push({
        at: doc.uploaded_at,
        icon: UploadCloud,
        label: t("transactionPage.activity.events.documentUploaded", { document: doc.label }),
      });
    }
    if (doc.reviewed_at && doc.status === "accepted") {
      events.push({
        at: doc.reviewed_at,
        icon: FileCheck,
        label: t("transactionPage.activity.events.documentAccepted", { document: doc.label }),
      });
    }
    if (doc.reviewed_at && doc.status === "needs_update") {
      events.push({
        at: doc.reviewed_at,
        icon: FileWarning,
        label: t("transactionPage.activity.events.documentNeedsUpdate", { document: doc.label }),
        detail: doc.review_note ?? undefined,
      });
    }
  }

  if (transaction.customer_info_confirmed_at) {
    events.push({
      at: transaction.customer_info_confirmed_at,
      icon: FileClock,
      label: t("transactionPage.activity.events.informationConfirmed"),
    });
  }
  if (transaction.mediator_info_confirmed_at) {
    events.push({
      at: transaction.mediator_info_confirmed_at,
      icon: FileClock,
      label: t("transactionPage.activity.events.mediatorInformationConfirmed"),
    });
  }
  if (transaction.ready_at) {
    events.push({
      at: transaction.ready_at,
      icon: CheckCircle2,
      label: t("transactionPage.activity.events.ready", {
        state: readinessText(t, transaction.readiness_label),
      }),
    });
  }
  if (transaction.completed_at) {
    events.push({
      at: transaction.completed_at,
      icon: CheckCircle2,
      label: t("transactionPage.activity.events.completed"),
    });
  }
  if (transaction.cancelled_at) {
    events.push({
      at: transaction.cancelled_at,
      icon: XCircle,
      label: t("transactionPage.activity.events.cancelled"),
      detail: transaction.cancellation_reason ?? undefined,
    });
  }

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("transactionPage.activity.empty")}</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((e, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground">
            <e.icon className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{e.label}</div>
            {e.detail && <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div>}
            <div className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(e.at, lang)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
