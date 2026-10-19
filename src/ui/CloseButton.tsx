//
// CloseButton.tsx
//
// The survey's close button, drawn to match the iOS SDK on the same device:
//   • iOS 26+: a glass circle (`UIButton.Configuration.glass()`, 44pt, bold xmark).
//   • iOS < 26: `xmark.circle.fill` tinted secondary label (the cross is cut out).
//   • Android: a neutral filled circle.
// The cross is two rounded bars rather than a text glyph, so its weight matches
// SF Symbols instead of depending on the font's "✕".
//

import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";
import { usesGlassChrome } from "./platform";
import type { SurveyTheme } from "./theme";

export function CloseButton({ theme, onPress, style }: { theme: SurveyTheme; onPress: () => void; style?: ViewStyle }) {
  let circle: ViewStyle;
  let cross: { color: string; length: number; thickness: number };
  if (usesGlassChrome) {
    circle = {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.dark ? "rgba(72, 72, 74, 0.92)" : "rgba(255, 255, 255, 0.94)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.dark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.14)",
      shadowColor: "#000",
      shadowOpacity: theme.dark ? 0.3 : 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    };
    cross = { color: theme.dark ? "rgba(255, 255, 255, 0.92)" : "rgba(0, 0, 0, 0.88)", length: 19, thickness: 2.6 };
  } else if (Platform.OS === "ios") {
    circle = { width: 31, height: 31, borderRadius: 15.5, backgroundColor: theme.dark ? "rgba(235, 235, 245, 0.6)" : "rgba(60, 60, 67, 0.6)" };
    cross = { color: theme.surface, length: 12, thickness: 2.4 };
  } else {
    circle = { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.track };
    cross = { color: theme.secondaryText, length: 13, thickness: 2 };
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close survey" onPress={onPress} hitSlop={6} style={[styles.hit, style]}>
      {({ pressed }) => (
        <View style={[circle, styles.center, pressed && { opacity: 0.7 }]}>
          {[45, -45].map((deg) => (
            <View
              key={deg}
              style={{
                position: "absolute",
                width: cross.length,
                height: cross.thickness,
                borderRadius: cross.thickness / 2,
                backgroundColor: cross.color,
                transform: [{ rotate: `${deg}deg` }],
              }}
            />
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { position: "absolute", width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center" },
});
