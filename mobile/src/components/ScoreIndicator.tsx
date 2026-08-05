import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "@/lib/colors";

const TONE_COLORS = { primary: colors.primary, secondary: "#B45309", warning: "#B45309" };

export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const tone = score >= 90 ? TONE_COLORS.primary : score >= 75 ? TONE_COLORS.secondary : TONE_COLORS.warning;

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`Property score ${score} of 100`}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={4} stroke={colors.surface2} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={4}
          strokeLinecap="round"
          stroke={tone}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </Svg>
      <View className="absolute inset-0 items-center justify-center">
        <Text className="text-[13px] font-bold tracking-tight text-foreground">{score}</Text>
      </View>
    </View>
  );
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  const tone = value >= 80 ? "bg-primary" : value >= 60 ? "bg-secondary" : "bg-warning";
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground">{label}</Text>
        <Text className="text-xs font-semibold text-foreground">{value}</Text>
      </View>
      <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <View className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </View>
    </View>
  );
}
