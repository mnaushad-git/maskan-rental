import { forwardRef } from "react";
import { ActivityIndicator, Pressable, Text, View, type PressableProps } from "react-native";
import { MIN_TOUCH_TARGET } from "@/lib/theme";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-primary active:bg-primary/90",
  secondary: "bg-secondary active:bg-secondary/90",
  outline: "border border-border bg-transparent active:bg-surface-2",
  ghost: "bg-transparent active:bg-surface-2",
  destructive: "bg-destructive active:bg-destructive/90",
};

const VARIANT_TEXT_CLASS: Record<Variant, string> = {
  primary: "text-primary-foreground",
  secondary: "text-secondary-foreground",
  outline: "text-foreground",
  ghost: "text-foreground",
  destructive: "text-white",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-3 py-2 gap-1.5 rounded-lg",
  md: "px-4 py-3 gap-2 rounded-xl",
  lg: "px-5 py-4 gap-2 rounded-xl",
};

const SIZE_TEXT_CLASS: Record<Size, string> = {
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
  lg: "text-base font-bold",
};

export type ButtonProps = Omit<PressableProps, "children"> & {
  children: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
};

/** The one button component every screen should use — variants/sizes cover
 * the cases HomeSheet/HomeFilterSheet/ErrorState etc. previously hand-rolled
 * with their own one-off Pressable + className combinations. Enforces a
 * minimum 44pt touch target (via hitSlop) even at the "sm" size, where the
 * visual padding alone would fall short of that on its own. */
export const Button = forwardRef<View, ButtonProps>(function Button(
  { children, variant = "primary", size = "md", loading = false, icon, fullWidth = false, disabled, className = "", style, hitSlop, ...props },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      ref={ref}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={hitSlop ?? MIN_TOUCH_TARGET / 4}
      className={`flex-row items-center justify-center ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${
        isDisabled ? "opacity-50" : ""
      } ${fullWidth ? "w-full" : ""} ${className}`}
      style={style}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "outline" || variant === "ghost" ? "#2563EB" : "#FFFFFF"} />
      ) : (
        icon
      )}
      <Text className={`${SIZE_TEXT_CLASS[size]} ${VARIANT_TEXT_CLASS[variant]}`}>{children}</Text>
    </Pressable>
  );
});
