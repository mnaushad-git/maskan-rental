import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, XCircle, Info } from "lucide-react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { duration, zIndex } from "@/lib/theme";

type ToastTone = "success" | "error" | "info";
type ToastState = { id: number; message: string; tone: ToastTone } | null;

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

const TONE_ICON: Record<ToastTone, React.ComponentType<{ size: number; color: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};
const TONE_COLOR: Record<ToastTone, string> = { success: "#15803D", error: "#DC2626", info: "#0369A1" };

const AUTO_DISMISS_MS = 3000;

/** App-wide toast/snackbar — mount once at the root (see app/_layout.tsx).
 * Transient confirmation feedback only (saved, sent, copied) — never for
 * anything the user needs to act on or refer back to; those are Banners or
 * inline messages instead. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const opacity = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback(
    (message: string, tone: ToastTone = "success") => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ id: Date.now(), message, tone });
      opacity.value = withTiming(1, { duration: duration.fast });
      timerRef.current = setTimeout(() => {
        opacity.value = withTiming(0, { duration: duration.fast });
      }, AUTO_DISMISS_MS);
    },
    [opacity],
  );

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const Icon = toast ? TONE_ICON[toast.tone] : null;

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 16, zIndex: zIndex.toast }, style]}
        >
          <View className="flex-row items-center gap-2.5 rounded-2xl bg-foreground px-4 py-3 shadow-elevated">
            {Icon ? <Icon size={18} color={TONE_COLOR[toast.tone]} /> : null}
            <Text className="flex-1 text-sm font-medium text-background">{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast() must be used within <ToastProvider>");
  return show;
}
