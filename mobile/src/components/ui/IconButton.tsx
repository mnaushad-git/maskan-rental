import { forwardRef } from "react";
import { Pressable, View, type PressableProps } from "react-native";
import { MIN_TOUCH_TARGET } from "@/lib/theme";

type Variant = "surface" | "ghost" | "primary";

const VARIANT_CLASS: Record<Variant, string> = {
  surface: "bg-surface active:bg-surface-2",
  ghost: "bg-transparent active:bg-surface-2",
  primary: "bg-primary active:bg-primary/90",
};

export type IconButtonProps = Omit<PressableProps, "children"> & {
  children: React.ReactNode;
  variant?: Variant;
  accessibilityLabel: string; // required, not optional — an icon-only button with no label is invisible to screen readers
  size?: number;
};

/** Icon-only button (map controls, header actions, close buttons) with the
 * accessible label required at the type level — every existing icon-only
 * Pressable in the app sets accessibilityLabel by convention already; this
 * makes it impossible to forget on new ones. */
export const IconButton = forwardRef<View, IconButtonProps>(function IconButton(
  { children, variant = "surface", size = MIN_TOUCH_TARGET, className = "", style, ...props },
  ref,
) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      hitSlop={8}
      className={`items-center justify-center rounded-full ${VARIANT_CLASS[variant]} ${className}`}
      style={(state) => [{ width: size, height: size }, typeof style === "function" ? style(state) : style]}
      {...props}
    >
      {children}
    </Pressable>
  );
});
