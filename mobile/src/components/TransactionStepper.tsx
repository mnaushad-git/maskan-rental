import { View, Text } from "react-native";
import { Check } from "lucide-react-native";
import { colors } from "@/lib/colors";

// Vertical progress stepper for the mobile Transaction Workspace header
// (brief §20's mobile counterpart to web's horizontal TransactionStepper.tsx
// — same checklist data from Prompt 3's deterministic engine, just a
// compact vertical layout so it never needs horizontal scroll on a phone
// screen, per Prompt 11's own scope note).
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
  const pct = Math.max(0, Math.min(100, progressPercentage));
  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-muted-foreground">{progressLabel}</Text>
        <Text className="text-xs font-bold text-foreground">{pct}%</Text>
      </View>
      <View className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </View>
      <View>
        {steps.map((step, i) => (
          <View key={step.key} className="flex-row gap-3">
            <View className="items-center">
              <View
                className="size-6 items-center justify-center rounded-full"
                style={{
                  backgroundColor: step.status === "done" ? colors.primary : "transparent",
                  borderWidth: step.status === "pending" ? 2 : step.status === "in_progress" ? 2 : 0,
                  borderColor: step.status === "in_progress" ? colors.primary : colors.border,
                }}
              >
                {step.status === "done" ? (
                  <Check size={13} color="#FFFFFF" />
                ) : (
                  <Text
                    className="text-[11px] font-bold"
                    style={{ color: step.status === "in_progress" ? colors.primary : colors.mutedForeground }}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              {i < steps.length - 1 && (
                <View className="w-px flex-1" style={{ backgroundColor: step.status === "done" ? colors.primary : colors.border, minHeight: 20 }} />
              )}
            </View>
            <View className="flex-1 pb-4">
              <Text className="text-sm font-semibold text-foreground">{step.label}</Text>
              {step.detail && <Text className="text-xs text-muted-foreground">{step.detail}</Text>}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
