import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { fetchUnreadNotificationCount } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { colors } from "@/lib/colors";
import { addPushReceivedListener } from "@/lib/push";

const POLL_MS = 60_000;

/** Bell + unread badge, wired into the home header and profile screen (see
 * Phase 9C). Polls on a slow interval + refetches on screen focus, PLUS
 * refetches immediately whenever a push notification is received while the
 * app is foregrounded — that gives near-real-time badge updates without a
 * full SSE client (see mobile/src/lib/push.ts's doc comment for why). */
export function NotificationBell({ size = 20, color, className = "" }: { size?: number; color?: string; className?: string }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    if (!user) return;
    fetchUnreadNotificationCount()
      .then((r) => setUnread(r.unread_count))
      .catch(() => {});
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!user) return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    const sub = addPushReceivedListener(load);
    return () => sub.remove();
  }, [user, load]);

  if (!user) return null;

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      accessibilityRole="button"
      accessibilityLabel={t("notificationCenter.bellAria", { count: unread })}
      hitSlop={10}
      className={className}
    >
      <View>
        <Bell size={size} color={color ?? colors.foreground} />
        {unread > 0 && (
          <View
            className="absolute -end-1.5 -top-1.5 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1"
            style={{ height: 16 }}
          >
            <Text className="text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
