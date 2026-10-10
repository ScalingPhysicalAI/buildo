import { Linking, StyleSheet, Text, View } from "react-native";
import { ShoppingBag } from "lucide-react-native";

import { Button } from "./Button";
import { colors, fonts, radii, spacing } from "../theme";

const PURCHASE_URL = "https://starforgerobotics.com/buildo-development-kit/";

export function GadgetsBanner() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <ShoppingBag size={20} color={colors.textPrimary} />
        </View>
        <Text style={styles.title}>Don't have creator gadgets?</Text>
      </View>

      <View style={styles.row}>
        <Button
          label="Order Now"
          onPress={() => Linking.openURL(PURCHASE_URL)}
          style={styles.half}
        />
        <Button
          label={"Buy Now &\nPay Later"}
          variant="secondary"
          onPress={() => Linking.openURL(PURCHASE_URL)}
          style={styles.half}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  half: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
});
