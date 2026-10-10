import { router } from "expo-router";
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
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Don't have creator gadgets?</Text>
          <Text style={styles.note}>You will need creator gadgets to train Buildo skills and deploy apps.</Text>
        </View>
      </View>

      <View style={styles.row}>
        <Button
          label="Order Now"
          variant="cream"
          onPress={() => Linking.openURL(PURCHASE_URL)}
          style={styles.half}
        />
        <Button
          label="Use wallet"
          variant="secondary"
          onPress={() => router.push("/gadgets/order")}
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
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
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
