import { useCallback, useState } from "react";
import { View, Text, FlatList, RefreshControl, TextInput, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Heart, StickyNote, X, Plus } from "lucide-react-native";
import {
  fetchSavedProperties,
  mapApiSearchProperty,
  updateSavedProperty,
  type ApiSavedProperty,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { PropertyCard } from "@/components/PropertyCard";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PropertyCardSkeleton } from "@/components/ui/Skeleton";
import { toCardProperty, type Property } from "@/lib/maskan-data";
import { colors } from "@/lib/colors";

function toUiProperty(saved: ApiSavedProperty): Property {
  return toCardProperty(mapApiSearchProperty(saved.property));
}

function notesOf(item: ApiSavedProperty): string[] {
  return item.notes ? item.notes.split("\n").filter(Boolean) : [];
}

/** Per-saved-property note list — the mobile counterpart of the web Saved
 * page's note-taking UI. `updateSavedProperty`'s `notes` field already
 * existed in the API client with no screen wiring it up; this closes that
 * parity gap using the same "\n-joined string" wire format the web app
 * uses. */
function SavedNotes({
  item,
  onChange,
}: {
  item: ApiSavedProperty;
  onChange: (id: number, notes: string) => void;
}) {
  const { t } = useLanguage();
  const showToast = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const notes = notesOf(item);

  async function persist(nextNotes: string[]) {
    const joined = nextNotes.join("\n");
    setSaving(true);
    try {
      await updateSavedProperty(item.id, { notes: joined });
      onChange(item.id, joined);
    } catch {
      showToast(t("saved.failedToSave"), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void persist([...notes, text]);
  }

  function handleRemove(idx: number) {
    void persist(notes.filter((_, i) => i !== idx));
  }

  return (
    <View className="mt-2 rounded-2xl border border-border bg-card p-4">
      <View className="mb-2 flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <StickyNote size={14} color={colors.mutedForeground} />
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("saved.yourNotes")}
          </Text>
        </View>
        {notes.length > 0 && (
          <Text className="text-[11px] text-muted-foreground">
            {t(notes.length === 1 ? "saved.notesCountSingular" : "saved.notesCountPlural", { count: notes.length })}
          </Text>
        )}
      </View>
      {notes.length > 0 && (
        <View className="gap-1.5">
          {notes.map((n, idx) => (
            <View key={idx} className="flex-row items-start justify-between gap-2 rounded-lg bg-ai-soft/60 px-3 py-2">
              <Text className="flex-1 text-sm text-foreground">{n}</Text>
              <Pressable
                onPress={() => handleRemove(idx)}
                accessibilityRole="button"
                accessibilityLabel={t("saved.removeNote")}
                hitSlop={8}
              >
                <X size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View className="mt-2 flex-row items-end gap-2">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("saved.addNotePlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          multiline
          className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          style={{ textAlignVertical: "top", minHeight: 40 }}
        />
        <IconButton
          variant="primary"
          size={40}
          onPress={handleAdd}
          disabled={!draft.trim() || saving}
          accessibilityLabel={t("saved.yourNotes")}
          className={!draft.trim() || saving ? "opacity-50" : ""}
        >
          <Plus size={18} color="#FFFFFF" />
        </IconButton>
      </View>
    </View>
  );
}

export default function SavedScreen() {
  const { t } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const [saved, setSaved] = useState<ApiSavedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!user) {
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);
      fetchSavedProperties(user.id)
        .then(setSaved)
        .catch(() => setError(true))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [user],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Stack.Screen options={{ title: t("saved.heading") }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("saved.heading") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("myLeads.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("myLeads.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error && saved.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("saved.heading") }} />
        <ErrorState onRetry={() => load(false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("saved.heading") }} />
      <FlatList
        data={saved}
        keyExtractor={(s) => String(s.id)}
        contentContainerClassName="gap-4 p-4"
        renderItem={({ item }) => (
          <View>
            <PropertyCard
              p={toUiProperty(item)}
              initialSavedId={item.id}
              onUnsaved={() => setSaved((prev) => prev.filter((s) => s.id !== item.id))}
            />
            <SavedNotes
              item={item}
              onChange={(id, notes) =>
                setSaved((prev) => prev.map((s) => (s.id === id ? { ...s, notes } : s)))
              }
            />
          </View>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
        ListEmptyComponent={
          <EmptyState
            icon={<Heart size={32} color={colors.mutedForeground} />}
            title={t("saved.empty.heading")}
            description={t("saved.empty.desc")}
            actionLabel={t("saved.empty.browseProperties")}
            onAction={() => router.push("/search")}
          />
        }
      />
    </SafeAreaView>
  );
}
