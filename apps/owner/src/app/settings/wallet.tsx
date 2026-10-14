import { router } from "expo-router";
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/TextField";
import { useAuth } from "../../lib/auth-context";
import { colors, fonts, radii, spacing } from "../../theme";

const PRESET_AMOUNTS = [10, 25, 50, 100];

function closeOrGoSettings() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/settings");
  }
}

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { user, topUp } = useAuth();
  const [customAmount, setCustomAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // See store/[id].tsx -- same guard against a dev reload or Expo Go replay
  // landing directly on this modal with no history beneath it.
  const isLandingScreen = !router.canGoBack();

  useEffect(() => {
    if (isLandingScreen) router.replace("/(app)");
  }, [isLandingScreen]);

  if (isLandingScreen) return null;

  async function handleTopUp(amount: number) {
    if (!amount || amount <= 0) return;
    setError(null);
    setBusy(true);
    try {
      await topUp(amount);
      setCustomAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't top up right now");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoSettings} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>Wallet</Text>
      <Text style={styles.subtitle}>Top up to unlock apps and keep your robot running.</Text>

      <Card style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available balance</Text>
        <Text style={styles.balanceValue}>${(user?.tokenBalance ?? 0).toLocaleString()}</Text>
      </Card>

      <Text style={styles.sectionTitle}>Top up</Text>
      <View style={styles.presetRow}>
        {PRESET_AMOUNTS.map((amount) => (
          <Pressable key={amount} onPress={() => handleTopUp(amount)} disabled={busy} style={styles.presetChip}>
            <Text style={styles.presetChipText}>+${amount}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TextField
        label="Custom amount"
        keyboardType="number-pad"
        value={customAmount}
        onChangeText={setCustomAmount}
        placeholder="e.g. 75"
      />
      <Button
        label="Add funds"
        onPress={() => handleTopUp(Number(customAmount))}
        loading={busy}
        disabled={!customAmount}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  closeBtn: {
    alignSelf: "flex-end",
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  balanceCard: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  balanceLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  balanceValue: {
    fontFamily: fonts.display,
    fontSize: 44,
    color: colors.black,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  presetChip: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.sandSurface,
    borderWidth: 1,
    borderColor: colors.sandLight,
  },
  presetChipText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.sandDark,
  },
  errorText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
    marginBottom: spacing.sm,
  },
});
