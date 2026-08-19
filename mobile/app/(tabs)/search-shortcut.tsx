// Placeholder route backing the "Search" tab button — its tabPress
// listener in _layout.tsx always intercepts before this ever mounts,
// pushing app/search.tsx instead. Exists only so Expo Router has a file
// to associate with the Tabs.Screen name.
export default function SearchShortcut() {
  return null;
}
