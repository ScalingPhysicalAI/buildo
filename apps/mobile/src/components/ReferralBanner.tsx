import { Gift, ArrowUpRight } from "lucide-react-native";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fonts, radii, spacing } from "../theme";

const REFERRAL_URL = "https://startforgerobotics.goaffpro.com/";

export function ReferralBanner() {
  return (
    <Pressable
      onPress={() => Linking.openURL(REFERRAL_URL)}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>
        <Gift size={20} color={colors.sandDark} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Refer Buildo to a friend</Text>
        <Text style={styles.subtitle}>Get $500 reward on every purchase</Text>
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
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.sandLight,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.85,
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
    color: colors.sandDark,
    marginTop: 2,
  },
});
