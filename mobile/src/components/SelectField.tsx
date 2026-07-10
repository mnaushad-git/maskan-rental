import type { ReactNode } from "react";
import { View, Text, Pressable, Modal, FlatList } from "react-native";

export function SelectField({
  label,
  value,
  onPress,
  icon,
}: {
  label: string;
  value: string;
  onPress: () => void;
  icon?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} className="flex-1 flex-row items-center gap-3 border-t border-border px-4 py-3">
      {icon}
      <View className="flex-1">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Text>
        <Text numberOfLines={1} className="text-sm font-medium text-foreground">
          {value}
        </Text>
      </View>
    </Pressable>
  );
}

export function OptionModal({
  visible,
  onClose,
  options,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  options: { key: string; label: string }[];
  onSelect: (key: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <View className="max-h-[70%] rounded-t-2xl bg-background p-2">
          <FlatList
            data={options}
            keyExtractor={(o) => o.key}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onSelect(item.key);
                  onClose();
                }}
                className="px-4 py-3"
              >
                <Text className="text-sm text-foreground">{item.label}</Text>
              </Pressable>
            )}
          />
        </View>
      </Pressable>
    </Modal>
  );
}
