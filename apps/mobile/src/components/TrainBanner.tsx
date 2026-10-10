import { router } from "expo-router";
import { ArrowUpRight, GraduationCap } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fonts, radii, spacing } from "../theme";

export function TrainBanner() {
  return (
    <Pressable
      onPress={() => router.push("/(app)/train")}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>
        <GraduationCap size={20} color={colors.black} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Train skills and earn $$</Text>
        <Text style={styles.subtitle}>Make anywhere from $2000–$4000/month with the skills you'll train</Text>
      </View>
      <ArrowUpRight size={18} color={colors.sand} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.black,
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
    backgroundColor: colors.sand,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.white,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
  },
});
