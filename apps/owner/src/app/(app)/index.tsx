import { LogOut, Wifi, WifiOff } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { useAuth } from "../../lib/auth-context";
import { useRobot } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { connected, connectionMethod, robotName } = useRobot();
  const firstName = user?.name?.split(" ")[0] ?? "there";

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

      <Card style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.statusIcon, connected ? styles.statusIconOn : styles.statusIconOff]}>
            {connected ? (
              <Wifi size={20} color={colors.success} />
            ) : (
              <WifiOff size={20} color={colors.textMuted} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{connected ? robotName : "Robot not connected"}</Text>
            <Text style={styles.statusSubtitle}>
              {connected
                ? `Connected via ${connectionMethod === "wifi" ? "Wi-Fi" : "SIM"}`
                : "Connect your robot to get started"}
            </Text>
          </View>
        </View>
        {!connected ? (
          <Button
            label="Connect robot"
            onPress={() => router.push("/settings/connect-robot")}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
      </Card>
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
  statusCard: {
    gap: 0,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  statusIconOn: {
    backgroundColor: colors.successSurface,
  },
  statusIconOff: {
    backgroundColor: colors.backgroundAlt,
  },
  statusTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  statusSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
});
