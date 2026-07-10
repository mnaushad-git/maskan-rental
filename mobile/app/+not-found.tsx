import { Link, Stack } from "expo-router";
import { View, Text } from "react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View className="flex-1 items-center justify-center gap-4 p-5">
        <Text className="text-foreground text-lg font-bold">This screen doesn't exist.</Text>
        <Link href="/">
          <Text className="text-primary text-sm font-semibold">Go to home screen!</Text>
        </Link>
      </View>
    </>
  );
}
