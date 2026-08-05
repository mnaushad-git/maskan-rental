import { useEffect } from "react";
import { Modal, Pressable, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { duration, easing } from "@/lib/theme";
import { colors } from "@/lib/colors";

const DISMISS_THRESHOLD = 120;

/**
 * Generic dismissible bottom sheet: backdrop fade + slide-up sheet, drag
 * down (past the threshold or with enough velocity) or tap the backdrop to
 * dismiss. For filter panels, action menus, and confirmation prompts — the
 * always-visible drag-to-peek map overlay on the home screen has different
 * behavior (never dismisses, no backdrop) and stays as its own component
 * (HomeSheet.tsx), not built on this one.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  style,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(400);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: duration.base, easing: easing.decelerate });
      backdropOpacity.value = withTiming(1, { duration: duration.base });
    }
  }, [visible, translateY, backdropOpacity]);

  const close = () => {
    translateY.value = withTiming(400, { duration: duration.fast, easing: easing.accelerate });
    backdropOpacity.value = withTiming(0, { duration: duration.fast }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (translateY.value > DISMISS_THRESHOLD || e.velocityY > 800) {
        runOnJS(close)();
      } else {
        translateY.value = withTiming(0, { duration: duration.fast });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[{ flex: 1, backgroundColor: "#000000B3" }, backdropStyle]}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingBottom: insets.bottom,
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: "85%",
            },
            sheetStyle,
            style,
          ]}
        >
          <View className="items-center py-2.5">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          {children}
        </Animated.View>
      </GestureDetector>
    </Modal>
  );
}
