import { View, Pressable, Text } from "react-native";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
};

/** Two-or-three-way toggle in a single pill-shaped track (the Rent/Buy
 * pattern in HomeSearchHeader, generalized) — for the rent calculator's
 * payment-frequency toggle, listing-type switches, or any other small
 * exclusive-choice control. Not for more than ~3 options; use Chip rows for
 * longer lists. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row items-center rounded-2xl border border-border bg-background p-1.5 shadow-card">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl px-4 py-2 ${active ? "bg-primary" : ""}`}
          >
            {opt.icon}
            <Text className={`text-sm font-semibold ${active ? "text-white" : "text-muted-foreground"}`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
