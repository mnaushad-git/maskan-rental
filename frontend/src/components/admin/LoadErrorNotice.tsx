import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown in place of an empty state / zero count when the data behind it
 * failed to load — so an outage is never mistaken for "nothing to review".
 */
export function LoadErrorNotice({
  what,
  message,
  onRetry,
  className,
}: {
  what: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={
        "flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm " +
        (className ?? "")
      }
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-destructive">Couldn't load {what}.</span>{" "}
        <span className="text-muted-foreground">{message}</span>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="size-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}
