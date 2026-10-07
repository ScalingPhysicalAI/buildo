import { Sparkle } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "../theme";

// apps/portal's Logo.tsx uses a pre-rendered wordmark image with light text
// for its dark theme -- unusable here (light-on-light against this app's
// light background). Same brand mark (a four-point star, sand/gold), same
// display font, rebuilt as text+icon so it actually reads on a light
// background.
export function Logo({ tag = "trainer", size = 22 }: { tag?: string; size?: number }) {
  return (
    <View style={styles.row}>
      <Sparkle size={size} color={colors.sandDark} fill={colors.sand} strokeWidth={1.5} />
      <Text style={[styles.wordmark, { fontSize: size }]}>STARFORGE</Text>
      <Text style={styles.tag}>/{tag}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  wordmark: {
    fontFamily: fonts.display,
    color: colors.black,
    letterSpacing: 0.5,
  },
  tag: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.sandDark,
  },
});
