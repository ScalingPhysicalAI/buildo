import { router } from "expo-router";
import { ArrowUpRight, GraduationCap } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatUSD } from "../lib/format";
import { colors, fonts, radii, spacing } from "../theme";

export function TrainBanner() {
  return (
    <Pressable
      onPress={() => router.push("/(app)/train")}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>
        <GraduationCap size={20} color={colors.sandDark} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Collect skills and earn $$ with robot apps you will build</Text>
        <Text style={styles.subtitle}>
          Make anywhere from {formatUSD(2000)}–{formatUSD(4000)} per month with the skills you'll train
        </Text>
      </View>
      <ArrowUpRight size={18} color={colors.sandDark} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.sandSurface,
    borderWidth: 1,
    borderColor: colors.sandLight,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.88,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
