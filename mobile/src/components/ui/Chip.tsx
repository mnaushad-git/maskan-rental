import { Pressable, Text, type PressableProps } from "react-native";

export type ChipProps = Omit<PressableProps, "children"> & {
  children: string;
  selected?: boolean;
};

/** Single-choice or toggle chip — the pattern HomeSearchHeader's property-
 * type row and HomeFilterSheet's budget/bedroom rows each rebuilt with
 * their own inline className strings. Use for filter selections, category
 * pickers, and quick-toggle groups. */
export function Chip({ children, selected = false, className = "", ...props }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-full border px-4 py-2 ${
        selected ? "border-primary bg-primary" : "border-border bg-background"
      } ${className}`}
      {...props}
    >
      <Text className={`text-sm font-medium ${selected ? "text-white" : "text-foreground"}`}>{children}</Text>
    </Pressable>
  );
}
