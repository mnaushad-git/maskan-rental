// Shared Property Request display helpers — status tones, structured
// reason-code → localized-copy mappings (match_reasons / trade_offs / area
// suggestion reasons), and activity-feed icon/label lookups. Centralized here
// so the list, detail, partner, and admin routes don't each hand-roll their
// own copies, mirroring lib/notificationDisplay.ts's pattern for the
// notification center.
import {
  CheckCircle2,
  CircleDashed,
  Handshake,
  Heart,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Sparkles,
  Ban,
  Clock,
  HelpCircle,
  Pencil,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { PropertyRequestStatus } from "@/lib/api/maskan";

export type BadgeTone =
  | "primary"
  | "secondary"
  | "ai"
  | "success"
  | "warning"
  | "info"
  | "neutral"
  | "destructive";

export function statusTone(status: PropertyRequestStatus): BadgeTone {
  switch (status) {
    case "active":
    case "matched":
      return "success";
    case "negotiating":
      return "ai";
    case "draft":
    case "awaiting_clarification":
      return "info";
    case "paused":
      return "warning";
    case "fulfilled":
      return "primary";
    case "expired":
    case "closed":
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function humanize(code: string): string {
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function matchReasonLabel(
  t: Translator,
  reason: { code: string; [key: string]: unknown },
): string {
  const key = `propertyRequest.matchReasons.${reason.code}`;
  const translated = t(key);
  return translated === key ? humanize(reason.code) : translated;
}

export function tradeOffLabel(
  t: Translator,
  tradeOff: { code: string; [key: string]: unknown },
): string {
  const key = `propertyRequest.tradeOffs.${tradeOff.code}`;
  const translated = t(key);
  return translated === key ? humanize(tradeOff.code) : translated;
}

export function areaSuggestionReasonLabel(t: Translator, code: string): string {
  const key = `propertyRequest.areaSuggestionReasons.${code}`;
  const translated = t(key);
  return translated === key ? humanize(code) : translated;
}

export function areaSuggestionLabelText(t: Translator, label: string): string {
  const key = `propertyRequest.detail.areaSuggestionLabels.${label}`;
  const translated = t(key);
  return translated === key ? humanize(label) : translated;
}

export function areaSuggestionLabelTone(label: string): BadgeTone {
  switch (label) {
    case "best_overall":
      return "ai";
    case "best_value":
      return "success";
    case "best_commute":
      return "info";
    case "best_family":
      return "primary";
    case "premium":
      return "secondary";
    case "flexible_alternative":
      return "neutral";
    default:
      return "neutral";
  }
}

export function activityTypeLabel(t: Translator, activityType: string): string {
  const key = `propertyRequest.activityTypes.${activityType}`;
  const translated = t(key);
  return translated === key ? t("propertyRequest.activityTypes.generic") : translated;
}

export function activityIconFor(activityType: string): LucideIcon {
  switch (activityType) {
    case "created":
      return Plus;
    case "activated":
      return Play;
    case "edited":
      return Pencil;
    case "paused":
      return Pause;
    case "resumed":
      return Play;
    case "closed":
      return Ban;
    case "fulfilled":
      return CheckCircle2;
    case "match_contacted":
      return Handshake;
    case "match_saved":
      return Heart;
    case "match_dismissed":
      return XCircle;
    case "clarification_answered":
      return MessageSquare;
    case "clarification_requested":
      return HelpCircle;
    case "mediator_responded":
      return MessageSquare;
    case "expired":
      return Clock;
    case "ai_extracted":
      return Sparkles;
    default:
      return CircleDashed;
  }
}

export function fieldKeyLabel(t: Translator, key: string): string {
  const path = `propertyRequest.fieldKeyToLabel.${key}`;
  const translated = t(path);
  return translated === path ? humanize(key) : translated;
}
