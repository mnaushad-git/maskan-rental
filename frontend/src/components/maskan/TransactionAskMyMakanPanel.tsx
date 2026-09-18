import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/context";
import { fetchTransactionAssistant, TRANSACTION_CUSTOMER_QUICK_ACTIONS } from "@/lib/api/maskan";

// "Ask myMakan" tab (brief §16) — the customer quick-action vocabulary from
// Prompt 6 (transaction_ai.CUSTOMER_QUICK_ACTIONS), never a free-text
// question box (that's the negotiation Ask myMakan panel's own shape, a
// different endpoint). Every reply is rendered as assistant text with a
// visible "ai" badge, mirroring agent.$id.tsx's ReviewSummarySection
// convention, and a deterministic fallback note when generated_by is
// "fallback" rather than "ai".
export function TransactionAskMyMakanPanel({ transactionId }: { transactionId: number }) {
  const { t, lang } = useLanguage();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reply: string; generated_by: "ai" | "fallback" } | null>(
    null,
  );

  async function handleQuickAction(action: string) {
    setActiveAction(action);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchTransactionAssistant(
        transactionId,
        action,
        lang === "ar" ? "ar" : "en",
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("transactionPage.askPanel.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("transactionPage.askPanel.subtitle")}</p>
      <div className="flex flex-wrap gap-2">
        {TRANSACTION_CUSTOMER_QUICK_ACTIONS.map((action) => (
          <Button
            key={action}
            variant={activeAction === action ? "ai" : "outline"}
            size="sm"
            onClick={() => void handleQuickAction(action)}
            disabled={loading}
          >
            {t(`transactionPage.askPanel.quickActions.${action}`)}
          </Button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">{t("transactionPage.askPanel.asking")}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="rounded-2xl border border-ai/20 bg-ai-soft/40 p-5">
          <Badge tone="ai">
            <Sparkles className="size-3.5" /> {t("transactionPage.askPanel.aiLabel")}
          </Badge>
          <p className="mt-3 text-sm leading-relaxed">{result.reply}</p>
          {result.generated_by === "fallback" && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("transactionPage.askPanel.fallbackNote")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
