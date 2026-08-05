import { useEffect, useState } from "react";
import { Bell, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  createSavedSearch,
  previewSavedSearch,
  DuplicateSavedSearchError,
  type AlertFrequency,
  type ApiPropertyFilterCriteria,
  type ApiSavedSearch,
  type NotificationChannel,
} from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const FREQUENCIES: AlertFrequency[] = ["instant", "daily", "weekly", "off"];

export function SaveSearchDialog({
  open,
  onOpenChange,
  filters,
  suggestedName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ApiPropertyFilterCriteria;
  suggestedName: string;
  onSaved?: (search: ApiSavedSearch) => void;
}) {
  const { t, lang } = useLanguage();
  const tSave = (key: string, vars?: Record<string, string | number>) => t(`savedSearches.saveDialog.${key}`, vars);

  const [name, setName] = useState(suggestedName);
  const [frequency, setFrequency] = useState<AlertFrequency>("instant");
  const [channels, setChannels] = useState<NotificationChannel[]>(["in_app"]);
  const [saving, setSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    setFrequency("instant");
    setChannels(["in_app"]);
    setDuplicateOf(null);
    setPreviewLoading(true);
    setPreviewCount(null);
    previewSavedSearch(filters)
      .then((res) => {
        setPreviewCount(res.estimated_count);
        if (res.duplicate_of) setDuplicateOf(res.duplicate_of);
      })
      .catch(() => setPreviewCount(null))
      .finally(() => setPreviewLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleChannel(channel: NotificationChannel) {
    if (channel === "in_app") return;
    setChannels((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  }

  async function handleSave(confirmDuplicate: boolean) {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await createSavedSearch({
        name: name.trim(),
        locale: lang,
        filters,
        alert_enabled: frequency !== "off",
        alert_frequency: frequency,
        channels,
        confirm_duplicate: confirmDuplicate,
      });
      toast.success(tSave("savedToast"));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof DuplicateSavedSearchError) {
        setDuplicateOf(err.duplicateOf);
      } else if (err instanceof Error && err.message.toLowerCase().includes("limit")) {
        toast.error(tSave("limitReachedToast"));
      } else {
        toast.error(tSave("errorToast"));
      }
    } finally {
      setSaving(false);
    }
  }

  const frequencyLabel: Record<AlertFrequency, string> = {
    instant: t("savedSearches.card.frequencyInstant"),
    daily: t("savedSearches.card.frequencyDaily"),
    weekly: t("savedSearches.card.frequencyWeekly"),
    off: t("savedSearches.card.frequencyOff"),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="size-5 text-primary" />
            {tSave("title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="save-search-name" className="text-xs font-medium text-muted-foreground">
              {tSave("nameLabel")}
            </label>
            <Input id="save-search-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tSave("namePlaceholder")} maxLength={150} />
          </div>

          <div className="rounded-xl bg-surface px-3.5 py-3">
            {previewLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {tSave("estimatedMatchesLoading")}
              </div>
            ) : previewCount !== null ? (
              <p className="text-sm font-semibold text-foreground">
                {tSave(previewCount === 1 ? "estimatedMatchesSingular" : "estimatedMatchesPlural", { count: previewCount })}
              </p>
            ) : null}
          </div>

          {duplicateOf && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-xs text-foreground">{tSave("duplicateWarning", { name: duplicateOf.name })}</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{tSave("frequencyLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {FREQUENCIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                    frequency === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-surface",
                  )}
                >
                  {frequencyLabel[f]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{tSave("channelsLabel")}</span>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-primary bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground">
                {tSave("channelInApp")}
              </span>
              <button
                type="button"
                onClick={() => toggleChannel("email")}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  channels.includes("email") ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-surface",
                )}
              >
                {tSave("channelEmail")}
              </button>
              <button
                type="button"
                onClick={() => toggleChannel("push")}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  channels.includes("push") ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-surface",
                )}
              >
                {tSave("channelPush")}
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tSave("cancel")}
          </Button>
          <Button onClick={() => handleSave(!!duplicateOf)} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {duplicateOf ? tSave("duplicateSaveAnyway") : tSave("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
