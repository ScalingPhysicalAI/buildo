import { StyleSheet, Text, View } from "react-native";

import { colors, fonts, radii, spacing } from "../theme";

type Tone = "neutral" | "success" | "warning" | "error" | "recording";

const TONE_STYLES: Record<Tone, { bg: string; dot: string; text: string }> = {
  neutral: { bg: colors.backgroundAlt, dot: colors.textMuted, text: colors.textMuted },
  success: { bg: colors.successSurface, dot: colors.success, text: colors.success },
  warning: { bg: colors.sandSurface, dot: colors.sandDark, text: colors.sandDark },
  error: { bg: colors.errorSurface, dot: colors.error, text: colors.error },
  recording: { bg: colors.errorSurface, dot: colors.recording, text: colors.recording },
};

export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const t = TONE_STYLES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});
