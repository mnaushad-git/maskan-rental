// Property Verification & Trust Center — "Report a Concern" bottom sheet
// (mirrors frontend/src/components/maskan/ReportListingModal.tsx's
// behavior/copy as a native BottomSheet instead of a web modal overlay).
// Submits to the shared POST /properties/{id}/reports endpoint, using the
// PROPERTY_REPORT_REASONS list maskan.ts exports (mirrors
// app/models/property_report.py's exact tuple). Handles the "already
// reported" 409 case gracefully — shown as a plain notice, not an alarming
// error — and requires sign-in first, reusing agent.reviews.signInPrefix's
// existing "must be signed in to submit user-generated content" copy.
import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Flag } from "lucide-react-native";
import { useLanguage } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/colors";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { submitPropertyReport, PROPERTY_REPORT_REASONS, type PropertyReportReason } from "@/lib/api/maskan";

export function ReportListingSheet({
  visible,
  onClose,
  propertyId,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: number;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const rt = (key: string, vars?: Record<string, string | number>) =>
    t(`property.trust.sheet.reportConcern.${key}`, vars);

  const [reason, setReason] = useState<PropertyReportReason | "">("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Any submit failure — including the backend's 409 "already reported" case
  // — is rendered as a plain, non-alarming notice using the backend's own
  // human-readable `detail` message (requestJson already extracts it),
  // never a raw/technical error state.
  const [notice, setNotice] = useState<string | null>(null);

  const close = () => {
    onClose();
    // Reset after the close animation finishes, mirroring
    // property/[id].tsx's FinancingSheet close() pattern, so the form
    // doesn't visibly flash back to empty while still sliding away.
    setTimeout(() => {
      setReason("");
      setComment("");
      setSubmitted(false);
      setNotice(null);
    }, 300);
  };

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
    <BottomSheet visible={visible} onClose={close}>
      <View className="gap-4 p-5">
        <View className="flex-row items-center gap-2">
          <Flag size={16} color={colors.warning} />
          <Text className="text-base font-bold text-foreground">{rt("title")}</Text>
        </View>

        {!user ? (
          <View className="items-center py-2">
            {/* Mirrors agent/[id].tsx's ReviewsSection sign-in-prompt
                pattern (agent.reviews.signInPrefix + a locale-specific
                suffix) for the identical "must be signed in to submit
                user-generated content" situation. */}
            <Text className="text-center text-sm text-muted-foreground">
              <Text
                className="font-semibold text-primary"
                onPress={() => {
                  close();
                  router.push("/auth/login");
                }}
              >
                {t("agent.reviews.signInPrefix")}
              </Text>
              {rt("signInRequired")}
            </Text>
          </View>
        ) : submitted ? (
          <View className="items-center gap-1.5 py-2">
            <Text className="text-sm font-semibold text-success">{rt("successTitle")}</Text>
            <Text className="text-center text-xs text-muted-foreground">{rt("successDesc")}</Text>
          </View>
        ) : (
          <>
            <Text className="text-sm text-muted-foreground">{rt("subtitle")}</Text>

            <View className="gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {rt("reasonLabel")}
              </Text>
              <View className="gap-1.5">
                {PROPERTY_REPORT_REASONS.map((r) => {
                  const selected = reason === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setReason(r)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      className="flex-row items-center gap-2.5 rounded-xl border px-3 py-2.5"
                      style={{
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primarySoft : "transparent",
                      }}
                    >
                      <View
                        className="size-4 items-center justify-center rounded-full border"
                        style={{ borderColor: selected ? colors.primary : colors.border }}
                      >
                        {selected && <View className="size-2 rounded-full" style={{ backgroundColor: colors.primary }} />}
                      </View>
                      <Text className={`flex-1 text-sm ${selected ? "font-medium" : ""} text-foreground`}>
                        {rt(`reasons.${r}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="gap-1.5">
              <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {rt("commentLabel")}
              </Text>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder={rt("commentPlaceholder")}
                multiline
                numberOfLines={3}
                className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground"
                style={{ textAlignVertical: "top" }}
              />
            </View>

            {notice && (
              <View className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
                <Text className="text-xs text-warning-foreground">{notice}</Text>
              </View>
            )}

            <Button fullWidth disabled={!reason || submitting} loading={submitting} onPress={handleSubmit}>
              {submitting ? rt("submitting") : rt("submit")}
            </Button>
          </>
        )}
      </View>
    </BottomSheet>
  );
}
