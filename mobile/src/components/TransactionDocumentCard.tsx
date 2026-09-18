import { useState } from "react";
import { View, Text } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { AlertTriangle, Trash2, Upload } from "lucide-react-native";
import { Badge } from "@/components/Badges";
import { Button } from "@/components/ui/Button";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import {
  deleteTransactionDocument,
  uploadTransactionDocument,
  type ApiPropertyTransactionDetail,
  type ApiTransactionDocument,
} from "@/lib/api/maskan";

// Per-document card for the mobile Documents section (brief §11's mobile
// counterpart to web's TransactionDocumentCard.tsx) — status/required badge/
// upload (via expo-document-picker, since RN has no <input type="file">)/
// delete, all driven directly off the backend's own TransactionDocument row.
// Mirrors web's gating exactly: (re)upload while not_uploaded/needs_update,
// delete only while needs_update.
const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  not_uploaded: "neutral",
  uploaded: "info",
  accepted: "success",
  needs_update: "warning",
};

// Mirrors app/services/property_transaction.py's ALLOWED_DOCUMENT_CONTENT_TYPES.
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

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
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = document.status === "not_uploaded" || document.status === "needs_update";
  const canDelete = document.status === "needs_update";

  async function handlePick() {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: ACCEPTED_TYPES, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const updated = await uploadTransactionDocument(transactionId, document.id, {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
      });
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

  return (
    <View className="gap-2 rounded-2xl border border-border bg-background p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 flex-row flex-wrap items-center gap-2">
          <Text className="font-medium text-foreground">{document.label}</Text>
          <Badge tone={document.required ? "secondary" : "neutral"}>
            {t(document.required ? "transactionPage.documents.requiredBadge" : "transactionPage.documents.optionalBadge")}
          </Badge>
        </View>
        <Badge tone={STATUS_TONE[document.status] ?? "neutral"}>{t(`transactionPage.documents.statusChip.${document.status}`)}</Badge>
      </View>

      {document.status === "needs_update" && document.review_note && (
        <View className="flex-row items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
          <AlertTriangle size={14} color={colors.warning} style={{ marginTop: 2 }} />
          <View className="flex-1">
            <Text className="text-xs font-semibold" style={{ color: colors.warning }}>
              {t("transactionPage.documents.updateRequiredLabel")}
            </Text>
            <Text className="mt-0.5 text-xs" style={{ color: colors.warning }}>
              {document.review_note}
            </Text>
          </View>
        </View>
      )}

      {error && <Text className="text-xs text-destructive">{error}</Text>}

      <View className="flex-row flex-wrap gap-2 pt-1">
        {canUpload && (
          <Button variant="outline" size="sm" icon={<Upload size={14} color={colors.foreground} />} onPress={() => void handlePick()} loading={uploading}>
            {uploading
              ? t("transactionPage.documents.uploading")
              : document.status === "needs_update"
                ? t("transactionPage.documents.replaceButton")
                : t("transactionPage.documents.uploadButton")}
          </Button>
        )}
        {canDelete && (
          <Button variant="outline" size="sm" icon={<Trash2 size={14} color={colors.destructive} />} onPress={() => void handleDelete()} loading={deleting}>
            {deleting ? t("transactionPage.documents.deleting") : t("transactionPage.documents.deleteButton")}
          </Button>
        )}
      </View>
    </View>
  );
}
