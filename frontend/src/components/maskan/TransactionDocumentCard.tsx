import { useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";
import {
  deleteTransactionDocument,
  downloadTransactionDocument,
  uploadTransactionDocument,
  type ApiPropertyTransactionDetail,
  type ApiTransactionDocument,
} from "@/lib/api/maskan";

// Per-document card for the Documents tab (brief §11) — status
// chip/required badge/upload/delete/"Update Required" reason all driven
// directly off the backend's own TransactionDocument row, never
// recomputed here. Pulled out under components/maskan/ (rather than kept
// inline in transaction.$id.tsx) so a later mobile equivalent has a single
// well-defined shape to mirror, per Prompt 9's own scope note.
const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  not_uploaded: "neutral",
  uploaded: "info",
  accepted: "success",
  needs_update: "warning",
};

// Mirrors app/services/property_transaction.py's ALLOWED_DOCUMENT_CONTENT_TYPES.
const ACCEPTED_FILE_TYPES = "application/pdf,image/jpeg,image/png";

export function TransactionDocumentCard({
  transactionId,
  document,
  onUpdated,
}: {
  transactionId: number;
  document: ApiTransactionDocument;
  onUpdated: (updated: ApiPropertyTransactionDetail) => void;
}) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors backend `_document_editable()` — (re)upload allowed while
  // not_uploaded/needs_update; delete only while needs_update (there's
  // nothing to delete in the not_uploaded state).
  const canUpload = document.status === "not_uploaded" || document.status === "needs_update";
  const canDelete = document.status === "needs_update";
  const canDownload = document.file_reference != null;

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await uploadTransactionDocument(transactionId, document.id, file);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactionPage.documents.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const updated = await deleteTransactionDocument(transactionId, document.id);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactionPage.documents.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadTransactionDocument(transactionId, document.id);
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = document.label;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactionPage.documents.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{document.label}</span>
            {document.required ? (
              <Badge tone="secondary">{t("transactionPage.documents.requiredBadge")}</Badge>
            ) : (
              <Badge tone="neutral">{t("transactionPage.documents.optionalBadge")}</Badge>
            )}
          </div>
        </div>
        <Badge tone={STATUS_TONE[document.status] ?? "neutral"}>
          {t(`transactionPage.documents.statusChip.${document.status}`)}
        </Badge>
      </div>

      {document.status === "needs_update" && document.review_note && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <div className="font-semibold">
              {t("transactionPage.documents.updateRequiredLabel")}
            </div>
            <div className="mt-0.5">{document.review_note}</div>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {canUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              className="sr-only"
              onChange={(e) => void handleFilePicked(e)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {uploading
                ? t("transactionPage.documents.uploading")
                : document.status === "needs_update"
                  ? t("transactionPage.documents.replaceButton")
                  : t("transactionPage.documents.uploadButton")}
            </Button>
          </>
        )}
        {canDelete && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            {deleting
              ? t("transactionPage.documents.deleting")
              : t("transactionPage.documents.deleteButton")}
          </Button>
        )}
        {canDownload && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {downloading
              ? t("transactionPage.documents.downloading")
              : t("transactionPage.documents.downloadButton")}
          </Button>
        )}
      </div>
    </div>
  );
}
