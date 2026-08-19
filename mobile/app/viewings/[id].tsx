import { useEffect, useState } from "react";
import { View, Text, ScrollView, Image, TextInput, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack, Link } from "expo-router";
import { CheckCircle2, Calendar, MapPin, MessageCircle, X, Sparkles, GitCompare, Handshake, Phone } from "lucide-react-native";
import {
  fetchViewing,
  cancelViewing,
  proposeViewingTime,
  acceptViewingReschedule,
  updateViewingChecklist,
  submitViewingFeedback,
  fetchViewingNextSteps,
  VIEWING_CUSTOMER_CANCEL_REASONS,
  VIEWING_INTEREST_LEVELS,
  VIEWING_FEEDBACK_REASONS,
  type ApiPropertyViewing,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Badge } from "@/components/Badges";
import { Skeleton } from "@/components/ui/Skeleton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { colors } from "@/lib/colors";

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  requested: "info",
  reschedule_proposed: "warning",
  confirmed: "success",
  completed: "neutral",
  cancelled_by_customer: "neutral",
  cancelled_by_mediator: "neutral",
  no_show_customer: "neutral",
  no_show_mediator: "neutral",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ViewingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [viewing, setViewing] = useState<ApiPropertyViewing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user || !id) return;
    const viewingId = Number(id);
    if (Number.isNaN(viewingId)) {
      setError(t("viewingDetail.notFound"));
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchViewing(viewingId)
      .then(setViewing)
      .catch(() => setError(t("viewingDetail.unableToLoad")))
      .finally(() => setLoading(false));
  }, [id, user, authLoading, t]);

  async function handleAccept() {
    if (!viewing) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await acceptViewingReschedule(viewing.id);
      setViewing(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("viewingDetail.acceptFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-5">
        <Skeleton height={140} radius={16} />
        <Skeleton height={200} radius={16} />
      </SafeAreaView>
    );
  }

  if (error || !viewing) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Text className="text-sm text-destructive">{error ?? t("viewingDetail.notFound")}</Text>
        <Button variant="outline" onPress={() => router.push("/viewings")}>
          {t("viewingDetail.back")}
        </Button>
      </SafeAreaView>
    );
  }

  const canAct = viewing.status === "requested" || viewing.status === "confirmed" || viewing.status === "reschedule_proposed";

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: `#${viewing.id}` }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View className="gap-3 rounded-2xl border border-border bg-background p-4">
          <Text className="text-xs font-semibold text-muted-foreground">{t("viewingDetail.propertyBlock.title")}</Text>
          <View className="flex-row items-center gap-3">
            {viewing.property_image_url && <Image source={{ uri: viewing.property_image_url }} className="size-16 rounded-xl" style={{ resizeMode: "cover" }} />}
            <View className="flex-1">
              <Text className="font-semibold text-foreground">{viewing.property_title ?? `#${viewing.property_id}`}</Text>
              {viewing.property_area && (
                <View className="flex-row items-center gap-1">
                  <MapPin size={12} color={colors.mutedForeground} />
                  <Text className="text-xs text-muted-foreground">{viewing.property_area}, {viewing.property_city}</Text>
                </View>
              )}
              <Link href={`/property/${viewing.property_id}`} className="mt-0.5 text-xs font-medium" style={{ color: colors.primary }}>
                {t("viewingDetail.propertyBlock.viewProperty")}
              </Link>
            </View>
          </View>
        </View>

        <View className="gap-2 rounded-2xl border border-border bg-background p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-muted-foreground">{t("viewingDetail.appointmentBlock.title")}</Text>
            <Badge tone={STATUS_TONE[viewing.status] ?? "neutral"}>{t(`myViewings.status.${viewing.status}`)}</Badge>
          </View>
          <DetailRow label={t("viewingDetail.appointmentBlock.requestedTime")} value={formatDateTime(viewing.requested_start_at)} />
          {viewing.confirmed_start_at && <DetailRow label={t("viewingDetail.appointmentBlock.confirmedTime")} value={formatDateTime(viewing.confirmed_start_at)} />}
          {viewing.proposed_start_at && viewing.status === "reschedule_proposed" && (
            <DetailRow label={t("viewingDetail.appointmentBlock.proposedTime")} value={formatDateTime(viewing.proposed_start_at)} />
          )}
          {viewing.mediator_agent_name && <DetailRow label={t("viewingDetail.appointmentBlock.mediator")} value={viewing.mediator_agent_name} />}
        </View>

        <ViewingTimeline viewing={viewing} t={t} />

        {(viewing.status === "confirmed" || viewing.status === "requested" || viewing.status === "reschedule_proposed") && (
          <ChecklistSection viewing={viewing} onUpdated={setViewing} />
        )}

        <View className="gap-2.5 rounded-2xl border border-border bg-background p-4">
          <Text className="mb-1 text-xs font-semibold text-muted-foreground">{t("viewingDetail.actions.title")}</Text>
          {viewing.status === "reschedule_proposed" && viewing.proposed_by === "mediator" && (
            <Button icon={<CheckCircle2 size={16} color="#FFFFFF" />} onPress={() => void handleAccept()} loading={busy}>
              {t("viewingDetail.actions.acceptProposedTime")}
            </Button>
          )}
          {canAct && (
            <Button variant="outline" icon={<Calendar size={16} color={colors.foreground} />} onPress={() => setShowPropose(true)}>
              {t("viewingDetail.actions.proposeAnotherTime")}
            </Button>
          )}
          {canAct && (
            <Button variant="outline" icon={<X size={16} color={colors.foreground} />} onPress={() => setShowCancel(true)}>
              {t("viewingDetail.actions.cancelViewing")}
            </Button>
          )}
          <Link href={`/property/${viewing.property_id}`} asChild>
            <Button variant="outline" icon={<MessageCircle size={16} color={colors.foreground} />}>
              {t("viewingDetail.actions.messageMediator")}
            </Button>
          </Link>
          {actionError && <Text className="text-sm text-destructive">{actionError}</Text>}
        </View>

        {viewing.status === "completed" && <FeedbackSection viewing={viewing} onUpdated={setViewing} />}
        {viewing.status === "completed" && <NextStepsSection viewing={viewing} />}
      </ScrollView>

      {showCancel && (
        <CancelSheet viewing={viewing} onClose={() => setShowCancel(false)} onCancelled={(v) => { setViewing(v); setShowCancel(false); }} />
      )}
      {showPropose && (
        <ProposeSheet viewing={viewing} onClose={() => setShowPropose(false)} onProposed={(v) => { setViewing(v); setShowPropose(false); }} />
      )}
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-end text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

function ViewingTimeline({ viewing, t }: { viewing: ApiPropertyViewing; t: (key: string, vars?: Record<string, string | number>) => string }) {
  const events: { at: string; label: string }[] = [];
  events.push({ at: viewing.created_at, label: t("viewingDetail.timeline.requested") });
  if (viewing.proposed_by) {
    events.push({ at: viewing.updated_at, label: t("viewingDetail.timeline.proposed", { who: viewing.proposed_by === "customer" ? t("viewingDetail.timeline.you") : t("viewingDetail.timeline.mediator") }) });
  }
  if (viewing.confirmed_at) events.push({ at: viewing.confirmed_at, label: t("viewingDetail.timeline.confirmed") });
  if (viewing.cancelled_at) {
    events.push({ at: viewing.cancelled_at, label: t("viewingDetail.timeline.cancelled", { who: viewing.cancelled_by === "customer" ? t("viewingDetail.timeline.you") : t("viewingDetail.timeline.mediator") }) });
  }
  if (viewing.completed_at) events.push({ at: viewing.completed_at, label: t("viewingDetail.timeline.completed") });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <View className="gap-3 rounded-2xl border border-border bg-background p-4">
      <Text className="text-xs font-semibold text-muted-foreground">{t("viewingDetail.timeline.title")}</Text>
      <View className="gap-3">
        {events.map((e, i) => (
          <View key={i} className="flex-row items-start gap-2.5">
            <View className="mt-1.5 size-2 rounded-full" style={{ backgroundColor: colors.primary }} />
            <View>
              <Text className="text-sm font-medium text-foreground">{e.label}</Text>
              <Text className="text-xs text-muted-foreground">{formatDateTime(e.at)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function CancelSheet({
  viewing,
  onClose,
  onCancelled,
}: {
  viewing: ApiPropertyViewing;
  onClose: () => void;
  onCancelled: (v: ApiPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(VIEWING_CUSTOMER_CANCEL_REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await cancelViewing(viewing.id, reason);
      onCancelled(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myViewings.cancelModal.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible onClose={onClose}>
      <View className="gap-3 p-4">
        <Text className="text-base font-bold text-foreground">{t("myViewings.cancelModal.title")}</Text>
        <Text className="text-sm font-medium text-foreground">{t("myViewings.cancelModal.reasonLabel")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {VIEWING_CUSTOMER_CANCEL_REASONS.map((r) => (
            <Chip key={r} selected={reason === r} onPress={() => setReason(r)}>
              {t(`myViewings.cancelModal.reasons.${r}`)}
            </Chip>
          ))}
        </View>
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        <View className="flex-row gap-2.5 pt-2">
          <Button variant="outline" className="flex-1" onPress={onClose} disabled={submitting}>
            {t("myViewings.cancelModal.cancel")}
          </Button>
          <Button variant="destructive" className="flex-1" onPress={() => void handleConfirm()} loading={submitting}>
            {t("myViewings.cancelModal.confirm")}
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}

function ProposeSheet({
  viewing,
  onClose,
  onProposed,
}: {
  viewing: ApiPropertyViewing;
  onClose: () => void;
  onProposed: (v: ApiPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return d;
  });

  async function handleSubmit() {
    if (!date) return;
    setSubmitting(true);
    setError(null);
    try {
      const y = date.getFullYear();
      const mo = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const [h, m] = time.split(":").map(Number);
      const endMinutes = h * 60 + m + 30;
      const endH = String(Math.floor(endMinutes / 60) % 24).padStart(2, "0");
      const endM = String(endMinutes % 60).padStart(2, "0");
      const updated = await proposeViewingTime(viewing.id, {
        start_at: `${y}-${mo}-${d}T${time}:00+03:00`,
        end_at: `${y}-${mo}-${d}T${endH}:${endM}:00+03:00`,
        note: note.trim() || undefined,
      });
      onProposed(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("viewingDetail.proposeModal.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text className="text-base font-bold text-foreground">{t("viewingDetail.proposeModal.title")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {days.map((d) => (
            <Chip key={d.toISOString()} selected={!!date && d.getTime() === date.getTime()} onPress={() => setDate(d)}>
              {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </Chip>
          ))}
        </View>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="HH:MM"
          placeholderTextColor={colors.mutedForeground}
          className="rounded-xl border border-border bg-background p-3 text-sm text-foreground"
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t("property.viewing.modal.notePlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          multiline
          className="rounded-xl border border-border bg-background p-3 text-sm text-foreground"
          style={{ textAlignVertical: "top", minHeight: 80 }}
        />
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        <Button onPress={() => void handleSubmit()} loading={submitting} disabled={!date}>
          {t("viewingDetail.proposeModal.submit")}
        </Button>
      </ScrollView>
    </BottomSheet>
  );
}

// ── AI Viewing Checklist + During Visit mode (Prompt 12, brief §11/§15) ────

function ChecklistSection({ viewing, onUpdated }: { viewing: ApiPropertyViewing; onUpdated: (v: ApiPropertyViewing) => void }) {
  const { t } = useLanguage();
  const checklist = viewing.checklist;
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [pendingItems, setPendingItems] = useState<Set<string>>(new Set());

  if (!checklist) {
    return (
      <View className="gap-2 rounded-2xl border border-ai/20 bg-ai-soft p-4">
        <Text className="text-base font-bold text-foreground">{t("viewingDetail.checklist.title")}</Text>
        <Text className="text-sm text-destructive">{t("viewingDetail.checklist.loadFailed")}</Text>
      </View>
    );
  }

  async function toggleItem(itemId: string, checked: boolean) {
    setPendingItems((prev) => new Set(prev).add(itemId));
    // Optimistic UI — persistence is fire-and-forget, no offline queue per
    // the brief's "keep this lightweight" instruction for During Viewing mode.
    onUpdated({ ...viewing, checklist: checklist ? { ...checklist, checked: { ...checklist.checked, [itemId]: checked } } : checklist });
    try {
      const updated = await updateViewingChecklist(viewing.id, { checked: { [itemId]: checked } });
      onUpdated(updated);
    } catch {
      // best-effort — leave the optimistic state; a later toggle or reload will reconcile
    } finally {
      setPendingItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function saveNote() {
    if (!noteDraft.trim()) return;
    setSavingNote(true);
    try {
      const updated = await updateViewingChecklist(viewing.id, { note: noteDraft.trim() });
      onUpdated(updated);
      setNoteDraft("");
    } catch {
      // best-effort — draft stays in the input so the customer can retry
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <View className="gap-3 rounded-2xl border border-ai/20 bg-ai-soft p-4">
      <View className="flex-row items-center gap-2">
        <Sparkles size={16} color={colors.ai} />
        <Text className="flex-1 text-base font-bold text-foreground">{t("viewingDetail.checklist.title")}</Text>
        <Badge tone="ai">{checklist.generated_by === "ai" ? t("viewingDetail.checklist.aiAnnotated") : t("viewingDetail.checklist.deterministicOnly")}</Badge>
      </View>
      <Text className="text-xs text-muted-foreground">{t("viewingDetail.checklist.subtitle")}</Text>
      {checklist.visit_plan_summary && (
        <Text className="rounded-xl bg-background/60 p-3 text-sm leading-relaxed text-foreground">{checklist.visit_plan_summary}</Text>
      )}

      <View className="gap-4">
        {checklist.sections.map((section) => (
          <View key={section.key} className="gap-2">
            <Text className="text-sm font-semibold text-foreground">{section.title}</Text>
            {section.items.map((item) => {
              const checked = !!checklist.checked[item.id];
              return (
                <Pressable
                  key={item.id}
                  onPress={() => void toggleItem(item.id, !checked)}
                  disabled={pendingItems.has(item.id)}
                  className="flex-row items-start gap-2.5 rounded-xl bg-background/60 p-3"
                >
                  <View
                    className="mt-0.5 size-4 items-center justify-center rounded border"
                    style={{ borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : "transparent" }}
                  >
                    {checked && <CheckCircle2 size={12} color="#FFFFFF" />}
                  </View>
                  <View className="flex-1">
                    <Text className={`text-sm ${checked ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.text}</Text>
                    {item.why_it_matters && (
                      <View className="mt-0.5 flex-row items-start gap-1">
                        <Sparkles size={10} color={colors.ai} />
                        <Text className="flex-1 text-xs" style={{ color: colors.ai }}>{item.why_it_matters}</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View className="gap-2 border-t border-border pt-3">
        <Text className="text-sm font-semibold text-foreground">{t("viewingDetail.checklist.duringVisitTitle")}</Text>
        <Text className="text-xs text-muted-foreground">{t("viewingDetail.checklist.duringVisitHint")}</Text>
        {viewing.private_notes && viewing.private_notes.length > 0 && (
          <View className="gap-2">
            {viewing.private_notes.map((n, i) => (
              <Text key={i} className="rounded-xl bg-background/60 p-3 text-sm text-foreground">{n.text}</Text>
            ))}
          </View>
        )}
        <TextInput
          value={noteDraft}
          onChangeText={setNoteDraft}
          onBlur={() => void saveNote()}
          placeholder={t("viewingDetail.checklist.notesPlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          multiline
          className="rounded-xl border border-border bg-background p-3 text-sm text-foreground"
          style={{ textAlignVertical: "top", minHeight: 60 }}
        />
        {savingNote && <ActivityIndicator size="small" color={colors.primary} />}
      </View>
    </View>
  );
}

// ── Post-viewing feedback (Prompt 12, brief §16) ────────────────────────────

function FeedbackSection({ viewing, onUpdated }: { viewing: ApiPropertyViewing; onUpdated: (v: ApiPropertyViewing) => void }) {
  const { t } = useLanguage();
  const [interestLevel, setInterestLevel] = useState<string | null>(viewing.interest_level);
  const [reason, setReason] = useState<string | undefined>(viewing.feedback_reason ?? undefined);
  const [note, setNote] = useState(viewing.feedback_note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(!!viewing.interest_level);

  async function handleSubmit() {
    if (!interestLevel) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await submitViewingFeedback(viewing.id, {
        interest_level: interestLevel,
        reason: interestLevel === "Not Interested" ? reason : undefined,
        note: note.trim() || undefined,
      });
      onUpdated(updated);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("viewingDetail.feedback.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View className="gap-3 rounded-2xl border border-border bg-background p-4">
      <Text className="text-base font-bold text-foreground">{t("viewingDetail.feedback.title")}</Text>
      <Text className="text-xs text-muted-foreground">{t("viewingDetail.feedback.subtitle")}</Text>

      <Text className="text-sm font-medium text-foreground">{t("viewingDetail.feedback.interestLabel")}</Text>
      <View className="flex-row flex-wrap gap-2">
        {VIEWING_INTEREST_LEVELS.map((level) => (
          <Chip key={level} selected={interestLevel === level} onPress={() => setInterestLevel(level)}>
            {t(`viewingDetail.feedback.interestLevels.${level}`)}
          </Chip>
        ))}
      </View>

      {interestLevel === "Not Interested" && (
        <>
          <Text className="text-sm font-medium text-foreground">{t("viewingDetail.feedback.reasonLabel")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {VIEWING_FEEDBACK_REASONS.map((r) => (
              <Chip key={r} selected={reason === r} onPress={() => setReason(r)}>
                {t(`viewingDetail.feedback.reasons.${r}`)}
              </Chip>
            ))}
          </View>
        </>
      )}

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t("viewingDetail.feedback.noteLabel")}
        placeholderTextColor={colors.mutedForeground}
        multiline
        className="rounded-xl border border-border bg-background p-3 text-sm text-foreground"
        style={{ textAlignVertical: "top", minHeight: 70 }}
      />

      {error && <Text className="text-sm text-destructive">{error}</Text>}

      <Button onPress={() => void handleSubmit()} loading={submitting} disabled={!interestLevel}>
        {t("viewingDetail.feedback.submit")}
      </Button>
      {submitted && !error && <Text className="text-xs text-success">{t("viewingDetail.feedback.submitted")}</Text>}

      {submitted && interestLevel === "Very Interested" && (
        <View className="gap-2 border-t border-border pt-3">
          <Text className="text-sm font-semibold text-foreground">{t("viewingDetail.feedback.suggestedActions.title")}</Text>
          <View className="flex-row flex-wrap gap-2">
            <Link href={`/property/${viewing.property_id}`} asChild>
              <Button variant="outline" size="sm" icon={<Phone size={14} color={colors.foreground} />}>
                {t("viewingDetail.feedback.suggestedActions.contactMediator")}
              </Button>
            </Link>
            {/* Retargeted (Prompt 11, mirrors web's viewings.$id.tsx) — was a
                deep link to /advisor, now opens the Make an Offer flow
                pre-filled with this completed viewing's id, same as web's
                sessionStorage handoff idiom, just via real route params
                instead since expo-router supports that directly. */}
            <Link
              href={{ pathname: "/negotiation/new", params: { propertyId: String(viewing.property_id), viewingId: String(viewing.id) } }}
              asChild
            >
              <Button variant="outline" size="sm" icon={<Handshake size={14} color={colors.foreground} />}>
                {t("viewingDetail.feedback.suggestedActions.askNegotiation")}
              </Button>
            </Link>
            <Link href="/compare" asChild>
              <Button variant="outline" size="sm" icon={<GitCompare size={14} color={colors.foreground} />}>
                {t("viewingDetail.feedback.suggestedActions.compareProperties")}
              </Button>
            </Link>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Ask myMakan What Next? (Prompt 12, brief §17) ───────────────────────────

function NextStepsSection({ viewing }: { viewing: ApiPropertyViewing }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ visit_summary: string; next_steps: string[] } | null>(null);

  async function handleAsk() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchViewingNextSteps(viewing.id);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("viewingDetail.nextSteps.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="gap-3 rounded-2xl border border-ai/20 bg-ai-soft p-4">
      <View className="flex-row items-center gap-2">
        <Sparkles size={16} color={colors.ai} />
        <Text className="flex-1 text-base font-bold text-foreground">{t("viewingDetail.nextSteps.title")}</Text>
      </View>
      <Text className="text-xs text-muted-foreground">{t("viewingDetail.nextSteps.subtitle")}</Text>

      {!result && (
        <Button icon={<Sparkles size={16} color="#FFFFFF" />} onPress={() => void handleAsk()} loading={loading}>
          {t("viewingDetail.nextSteps.cta")}
        </Button>
      )}

      {error && <Text className="text-sm text-destructive">{error}</Text>}

      {result && (
        <View className="gap-3">
          <View>
            <Text className="text-sm font-semibold text-foreground">{t("viewingDetail.nextSteps.summaryTitle")}</Text>
            <Text className="mt-1 text-sm leading-relaxed text-foreground">{result.visit_summary}</Text>
          </View>
          <View>
            <Text className="text-sm font-semibold text-foreground">{t("viewingDetail.nextSteps.stepsTitle")}</Text>
            <View className="mt-1 gap-1.5">
              {result.next_steps.map((step, i) => (
                <View key={i} className="flex-row items-start gap-2">
                  <CheckCircle2 size={14} color={colors.success} />
                  <Text className="flex-1 text-sm text-foreground">{step}</Text>
                </View>
              ))}
            </View>
          </View>
          <Text className="rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground">
            {t("viewingDetail.nextSteps.disclaimer")}
          </Text>
        </View>
      )}
    </View>
  );
}
