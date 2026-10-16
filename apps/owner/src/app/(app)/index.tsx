import { router } from "expo-router";
import { AlertTriangle, LogOut } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../components/Card";
import { RobotHeroCard } from "../../components/RobotHeroCard";
import { daysUntil, EXPIRY_WARNING_DAYS, isRentActive } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useRobot } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { robotName } = useRobot();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  const hasPlan = !!user?.monthlyRentUsd;
  const rentActive = isRentActive(user);
  const rentDaysLeft = daysUntil(user?.rentPaidUntil);
  const showRentWarning = hasPlan && (!rentActive || (rentDaysLeft !== null && rentDaysLeft <= EXPIRY_WARNING_DAYS));

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Hey {firstName}</Text>
          <Text style={styles.subtitle}>Here's how {robotName} is doing</Text>
        </View>
        <Pressable onPress={logout} hitSlop={10} style={styles.logoutBtn}>
          <LogOut size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      {showRentWarning ? (
        <Pressable onPress={() => router.push("/settings/wallet")}>
          <Card style={styles.warningCard}>
            <AlertTriangle size={18} color={colors.error} />
            <Text style={styles.warningText}>
              {!rentActive
                ? "Robot rent is overdue -- pay now to restore your store and skills."
                : `Robot rent renews in ${rentDaysLeft} day${rentDaysLeft === 1 ? "" : "s"} -- tap to renew early.`}
            </Text>
          </Card>
        </Pressable>
      ) : null}

      <RobotHeroCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  greeting: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  logoutBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.error,
    borderWidth: 1,
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
});
