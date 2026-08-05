import { useCallback, useState } from "react";
import { View, Text, Pressable, Modal, ActivityIndicator } from "react-native";
import { BellRing, X } from "lucide-react-native";
import * as Notifications from "expo-notifications";
import { registerForPushNotificationsAsync, getPushPermissionStatusAsync } from "@/lib/push";
import { hasSeenPushPrompt, markPushPromptSeen } from "@/lib/push-prompt-storage";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";

/**
 * Contextual push-permission pre-prompt — mirrors LocationOnboarding.tsx's
 * pattern (custom explainer modal shown at a meaningful moment, "Not now" /
 * primary-action pair, AsyncStorage flag so it's shown at most once) rather
 * than requesting the real OS permission on first launch.
 *
 * Usage: call `usePushPermissionPrompt()` from any screen that has one of
 * the contextual trigger moments (saved a search with push on, sent a lead,
 * opened the Notification Center, enabled a saved-search alert), then call
 * the returned `trigger()` after the action succeeds, and render the
 * returned `<Prompt />` somewhere in that screen's tree.
 */
export function usePushPermissionPrompt() {
  const [visible, setVisible] = useState(false);

  const trigger = useCallback(async () => {
    const seen = await hasSeenPushPrompt();
    if (seen) return;
    const status = await getPushPermissionStatusAsync();
    if (status !== Notifications.PermissionStatus.UNDETERMINED) {
      // Already granted, or already permanently denied at the OS level —
      // this custom explainer has nothing useful to add in either case
      // (Notification Settings' toggle handles the "denied" recovery path
      // via Linking.openSettings()), so just stop asking.
      await markPushPromptSeen();
      return;
    }
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    markPushPromptSeen();
  }, []);

  return { visible, trigger, close };
}

export function PushPermissionPrompt({
  visible,
  onClose,
  onEnabled,
}: {
  visible: boolean;
  onClose: () => void;
  onEnabled?: (granted: boolean) => void;
}) {
  const { t, lang } = useLanguage();
  const [enabling, setEnabling] = useState(false);

  async function handleEnable() {
    setEnabling(true);
    const token = await registerForPushNotificationsAsync(lang);
    setEnabling(false);
    onEnabled?.(token != null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 px-4">
        <View className="w-full max-w-md rounded-2xl border border-border bg-background p-6">
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            className="absolute end-4 top-4 z-10 size-8 items-center justify-center rounded-full"
          >
            <X size={16} color={colors.mutedForeground} />
          </Pressable>

          <View className="items-center gap-5">
            <View className="size-14 items-center justify-center rounded-2xl bg-primary-soft">
              <BellRing size={28} color={colors.primary} />
            </View>
            <View className="items-center gap-1.5">
              <Text className="text-center text-xl font-bold text-foreground">{t("pushPrompt.heading")}</Text>
              <Text className="text-center text-sm text-muted-foreground">{t("pushPrompt.desc")}</Text>
            </View>
            <View className="w-full gap-2.5">
              <Pressable
                onPress={handleEnable}
                disabled={enabling}
                className="w-full flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3.5"
                style={{ opacity: enabling ? 0.7 : 1 }}
              >
                {enabling ? <ActivityIndicator size="small" color="#FFFFFF" /> : <BellRing size={16} color="#FFFFFF" />}
                <Text className="text-sm font-semibold text-primary-foreground">
                  {enabling ? t("pushPrompt.enabling") : t("pushPrompt.enable")}
                </Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                disabled={enabling}
                className="w-full items-center rounded-xl border border-border py-3.5"
              >
                <Text className="text-sm font-semibold text-foreground">{t("pushPrompt.notNow")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
