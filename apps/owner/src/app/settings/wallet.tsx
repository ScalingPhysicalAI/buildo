import { router } from "expo-router";
import { BadgePercent, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/TextField";
import { isRentActive, type RentTermMonths } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { colors, fonts, radii, spacing } from "../../theme";

const PRESET_AMOUNTS = [100, 200, 400, 600];

// Per-month rate by term, direct vs. referred -- display copy of the same
// table enforced server-side in apps/portal's /api/robot-rental. Kept in
// sync by hand; no shared package between the two apps yet.
const RENT_PRICING: Record<RentTermMonths, { direct: number; referred: number }> = {
  3: { direct: 600, referred: 500 },
  6: { direct: 540, referred: 440 },
  12: { direct: 480, referred: 380 },
};
const TERMS: RentTermMonths[] = [3, 6, 12];
const RENT_PERIOD_DAYS = 30;

function closeOrGoSettings() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/settings");
  }
}

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { user, topUp, chooseRentPlan, payRent } = useAuth();
  const [customAmount, setCustomAmount] = useState("");
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [rentBusy, setRentBusy] = useState(false);
  const [rentError, setRentError] = useState<string | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<RentTermMonths>(
    (user?.rentTermMonths as RentTermMonths | undefined) ?? 3
  );

  // See store/[id].tsx -- same guard against a dev reload or Expo Go replay
  // landing directly on this modal with no history beneath it.
  const isLandingScreen = !router.canGoBack();

  useEffect(() => {
    if (isLandingScreen) router.replace("/(app)");
  }, [isLandingScreen]);

  if (isLandingScreen) return null;

  const isReferred = !!user?.referredById;
  const hasPlan = !!user?.rentTermMonths && !!user?.monthlyRentUsd;
  const selectedPrice = isReferred ? RENT_PRICING[selectedTerm].referred : RENT_PRICING[selectedTerm].direct;
  // Rent is a prepaid term, not a monthly charge -- the full term is billed
  // upfront (e.g. 3mo @ $600/mo = $1800 for 90 days), matching
  // apps/portal's /api/robot-rental[/pay].
  const selectedTotalCost = selectedPrice * selectedTerm;
  const isSwitchingTerm = hasPlan && selectedTerm !== user?.rentTermMonths;

  const rentPaidUntil = user?.rentPaidUntil ? new Date(user.rentPaidUntil) : null;
  const daysRemaining = rentPaidUntil ? Math.ceil((rentPaidUntil.getTime() - Date.now()) / 86_400_000) : 0;
  const rentActive = isRentActive(user);
  const totalDaysForTerm = (user?.rentTermMonths ?? selectedTerm) * RENT_PERIOD_DAYS;
  const barFraction = Math.max(0, Math.min(1, daysRemaining / totalDaysForTerm));

  function confirm(title: string, message: string, onConfirm: () => void) {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: onConfirm },
    ]);
  }

  function handleRentAction() {
    setRentError(null);
    const action = !hasPlan ? "start" : isSwitchingTerm ? "switch" : "pay";
    const title = action === "start" ? "Start rental?" : action === "switch" ? "Switch plan?" : "Renew rental?";
    const message =
      action === "pay"
        ? `$${selectedTotalCost} will be deducted from your wallet balance for another ${selectedTerm * RENT_PERIOD_DAYS} days.`
        : `$${selectedTotalCost} will be deducted from your wallet balance now -- $${selectedPrice}/mo for the ${selectedTerm}-month term (${selectedTerm * RENT_PERIOD_DAYS} days).`;

    confirm(title, message, async () => {
      setRentBusy(true);
      try {
        if (action === "pay") {
          await payRent();
        } else {
          await chooseRentPlan(selectedTerm);
        }
      } catch (err) {
        setRentError(err instanceof Error ? err.message : "Couldn't process that rent payment");
      } finally {
        setRentBusy(false);
      }
    });
  }

  function handleTopUp(amount: number) {
    if (!amount || amount <= 0) return;
    setTopUpError(null);
    confirm("Add funds?", `$${amount} will be added to your wallet balance.`, async () => {
      setTopUpBusy(true);
      try {
        await topUp(amount);
        setCustomAmount("");
      } catch (err) {
        setTopUpError(err instanceof Error ? err.message : "Couldn't top up right now");
      } finally {
        setTopUpBusy(false);
      }
    });
  }

  const rentButtonLabel = !hasPlan
    ? `Start rental -- $${selectedTotalCost} total`
    : isSwitchingTerm
      ? `Switch to ${selectedTerm}-month plan -- $${selectedTotalCost} total`
      : `Renew ${selectedTerm}-month rental -- $${selectedTotalCost}`;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoSettings} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>Wallet</Text>
      <Text style={styles.subtitle}>Robot rental and top-ups, both paid from the same balance.</Text>

      <Card style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available balance</Text>
        <Text style={styles.balanceValue}>${(user?.ownerWalletBalance ?? 0).toLocaleString()}</Text>
      </Card>

      {/* ---- Robot rental (compulsory -- store + installed skills are
          locked without it, see isRentActive()) ---- */}
      <Text style={styles.sectionTitle}>Robot rental</Text>

      {isReferred ? (
        <View style={styles.discountBadge}>
          <BadgePercent size={14} color={colors.sandDark} />
          <Text style={styles.discountBadgeText}>Referral discount applied -- $100/mo off every term</Text>
        </View>
      ) : null}

      {hasPlan ? (
        <Card style={styles.rentStatusCard}>
          <View style={styles.rentStatusRow}>
            <Text style={styles.rentStatusLabel}>
              ${user?.monthlyRentUsd}/mo · {user?.rentTermMonths}-month term
            </Text>
            <Text style={[styles.rentDaysText, !rentActive && styles.rentDaysTextDue]}>
              {rentActive ? `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left` : "Rent due"}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${barFraction * 100}%` },
                !rentActive && styles.progressFillDue,
              ]}
            />
          </View>
          {!rentActive ? (
            <Text style={styles.rentWarning}>
              Store access and installed skills are paused until rent is paid.
            </Text>
          ) : null}
        </Card>
      ) : (
        <Text style={styles.rentIntro}>
          Rent is required to unlock the app store and run installed skills on your robot.
        </Text>
      )}

      <View style={styles.termRow}>
        {TERMS.map((months) => {
          const rate = isReferred ? RENT_PRICING[months].referred : RENT_PRICING[months].direct;
          return (
            <Pressable
              key={months}
              onPress={() => setSelectedTerm(months)}
              style={[styles.termChip, selectedTerm === months && styles.termChipActive]}
            >
              <Text style={[styles.termChipText, selectedTerm === months && styles.termChipTextActive]}>
                {months}mo · ${rate}/mo
              </Text>
              <Text style={[styles.termChipSubtext, selectedTerm === months && styles.termChipTextActive]}>
                ${rate * months} total
              </Text>
            </Pressable>
          );
        })}
      </View>

      {rentError ? <Text style={styles.errorText}>{rentError}</Text> : null}

      <Button
        label={rentButtonLabel}
        onPress={handleRentAction}
        loading={rentBusy}
        style={{ marginBottom: spacing.xl }}
      />

      {/* ---- Top up ---- */}
      <Text style={styles.sectionTitle}>Top up</Text>
      <View style={styles.presetRow}>
        {PRESET_AMOUNTS.map((amount) => (
          <Pressable key={amount} onPress={() => handleTopUp(amount)} disabled={topUpBusy} style={styles.presetChip}>
            <Text style={styles.presetChipText}>+${amount}</Text>
          </Pressable>
        ))}
      </View>

      {topUpError ? <Text style={styles.errorText}>{topUpError}</Text> : null}

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
        loading={topUpBusy}
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
  discountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.sandSurface,
    borderWidth: 1,
    borderColor: colors.sandLight,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  discountBadgeText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.sandDark,
  },
  rentIntro: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  rentStatusCard: {
    marginBottom: spacing.md,
  },
  rentStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  rentStatusLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rentDaysText: {
    fontFamily: fonts.technical,
    fontSize: 12,
    color: colors.sandDark,
  },
  rentDaysTextDue: {
    color: colors.error,
  },
  progressTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.sandSurface,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: colors.sand,
  },
  progressFillDue: {
    backgroundColor: colors.error,
  },
  rentWarning: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.sm,
  },
  termRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  termChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  termChipActive: {
    backgroundColor: colors.skin,
    borderColor: colors.skinBorder,
  },
  termChipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.textMuted,
  },
  termChipSubtext: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  termChipTextActive: {
    color: colors.black,
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
