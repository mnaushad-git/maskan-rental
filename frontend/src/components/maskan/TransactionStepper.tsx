import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Progress stepper for the Transaction Workspace header (brief §20) —
// renders Prompt 3's own deterministic checklist verbatim (step order,
// status, detail fraction like "1/2"), never recomputed here. Shared by
// transaction.$id.tsx (Prompt 8); mobile builds its own vertical variant
// later (Prompt 11) rather than reusing this web-only component.
export type TransactionStepperStep = {
  key: string;
  label: string;
  status: "done" | "in_progress" | "pending" | string;
  detail?: string | null;
};

export function TransactionStepper({
  steps,
  progressPercentage,
  progressLabel,
}: {
  steps: TransactionStepperStep[];
  progressPercentage: number;
  progressLabel: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-muted-foreground">{progressLabel}</span>
        <span className="font-bold tabular-nums">{progressPercentage}%</span>
      </div>
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.max(0, Math.min(100, progressPercentage))}%` }}
        />
      </div>
      <ol className="flex items-start gap-1 overflow-x-auto pb-1">
        {steps.map((step, i) => (
          <li key={step.key} className="flex min-w-[92px] flex-1 flex-col items-center gap-1.5 text-center">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "h-px flex-1",
                  i === 0 ? "opacity-0" : step.status === "pending" ? "bg-border" : "bg-primary",
                )}
              />
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                  step.status === "done"
                    ? "bg-primary text-primary-foreground"
                    : step.status === "in_progress"
                      ? "border-2 border-primary bg-background text-primary"
                      : "border-2 border-border bg-background text-muted-foreground",
                )}
              >
                {step.status === "done" ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "h-px flex-1",
                  i === steps.length - 1 ? "opacity-0" : step.status === "done" ? "bg-primary" : "bg-border",
                )}
              />
            </div>
            <span className="text-[11px] font-medium leading-tight">{step.label}</span>
            {step.detail && <span className="text-[10px] text-muted-foreground">{step.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
