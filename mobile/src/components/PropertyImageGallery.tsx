import { useState } from "react";
import {
  View,
  FlatList,
  Image,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";

/** Edge-to-edge swipeable image gallery with a page-dot indicator. Falls
 * back to a single static image when there's only one photo, so it renders
 * identically to the old hero image for listings without a full gallery. */
export function PropertyImageGallery({ images, aspectRatio = 0.75 }: { images: string[]; aspectRatio?: number }) {
  const { width } = useWindowDimensions();
  const height = width * aspectRatio;
  const [page, setPage] = useState(0);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  }

  if (images.length <= 1) {
    return (
      <Image source={{ uri: images[0] }} style={{ width, height }} resizeMode="cover" />
    );
  }

  return (
    <View style={{ width, height }}>
      <FlatList
        data={images}
        keyExtractor={(uri, i) => `${uri}-${i}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        renderItem={({ item }) => (
          <Image source={{ uri: item }} style={{ width, height }} resizeMode="cover" />
        )}
      />
      <View className="absolute inset-x-0 bottom-3 flex-row items-center justify-center gap-1.5">
        {images.map((_, i) => (
          <View
            key={i}
            className="h-1.5 rounded-full bg-background"
            style={{ width: i === page ? 16 : 6, opacity: i === page ? 1 : 0.55 }}
          />
        ))}
      </View>
    </View>
  );
}
