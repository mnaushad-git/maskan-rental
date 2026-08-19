// Property Verification & Trust Center — "Report a Concern" modal (Prompt 9,
// spec section 13). Wired into Prompt 7's stubbed trigger on
// PropertyTrustCenter.tsx's PropertyTrustSheet ("Report a Concern" button).
// Submits to Prompt 2's POST /properties/{id}/reports, using the exact
// PROPERTY_REPORT_REASONS list maskan.ts already exports (mirrors
// app/models/property_report.py's tuple). Handles the "already reported"
// 409 case gracefully — shown as a plain notice, not an alarming error —
// and requires sign-in first, mirroring agent.$id.tsx's ReviewsSection
// sign-in-prompt pattern for the identical "must be signed in to submit
// user-generated content" situation.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Flag, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  submitPropertyReport,
  PROPERTY_REPORT_REASONS,
  type PropertyReportReason,
} from "@/lib/api/maskan";

export function ReportListingModal({
  propertyId,
  onClose,
}: {
  propertyId: number;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const rt = (key: string, vars?: Record<string, string | number>) =>
    t(`property.trust.sheet.reportConcern.${key}`, vars);

  const [reason, setReason] = useState<PropertyReportReason | "">("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Any submit failure — including the 409 "already reported" case — is
  // rendered as a plain, non-alarming notice using the backend's own
  // human-readable `detail` message (requestJson already extracts it),
  // never a raw/technical error state.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      await submitPropertyReport(propertyId, { reason, comment: comment.trim() || undefined });
      setSubmitted(true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : rt("genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-foreground/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Flag className="size-4 text-warning" />
            <h3 className="font-display text-base font-bold">{rt("title")}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {!user ? (
            <div className="space-y-1.5 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                <Link to="/auth" className="font-semibold text-primary hover:underline">
                  {t("agent.reviews.signInPrefix")}
                </Link>{" "}
                {rt("signInRequired")}
              </p>
            </div>
          ) : submitted ? (
            <div className="space-y-1.5 py-4 text-center">
              <div className="text-sm font-semibold text-success">{rt("successTitle")}</div>
              <p className="text-xs text-muted-foreground">{rt("successDesc")}</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{rt("subtitle")}</p>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {rt("reasonLabel")}
                </div>
                <div className="space-y-1.5">
                  {PROPERTY_REPORT_REASONS.map((r) => (
                    <label
                      key={r}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                        reason === r
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border hover:bg-surface-2",
                      )}
                    >
                      <input
                        type="radio"
                        name="report-reason"
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                        className="accent-primary"
                      />
                      {rt(`reasons.${r}`)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {rt("commentLabel")}
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={rt("commentPlaceholder")}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {notice && (
                <div className="rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-xs text-warning">
                  {notice}
                </div>
              )}

              <Button className="w-full" disabled={!reason || submitting} onClick={handleSubmit}>
                {submitting ? rt("submitting") : rt("submit")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
