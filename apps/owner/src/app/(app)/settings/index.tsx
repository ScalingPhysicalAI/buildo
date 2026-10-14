import { router } from "expo-router";
import { ChevronRight, LifeBuoy, LogOut, Wallet, Wifi } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../../components/Card";
import { useAuth } from "../../../lib/auth-context";
import { useRobot } from "../../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../../theme";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { connected } = useRobot();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>{user?.name ?? "Robot owner"} · {user?.email}</Text>

      <Pressable onPress={() => router.push("/settings/connect-robot")}>
        <Card style={styles.row}>
          <View style={styles.rowIcon}>
            <Wifi size={18} color={colors.sandDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Robot connection</Text>
            <Text style={styles.rowSubtext}>{connected ? "Connected" : "Not connected"}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push("/settings/wallet")}>
        <Card style={styles.row}>
          <View style={styles.rowIcon}>
            <Wallet size={18} color={colors.sandDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Wallet balance</Text>
            <Text style={styles.rowSubtext}>${(user?.ownerWalletBalance ?? 0).toLocaleString()} available · top up</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push("/settings/support")}>
        <Card style={styles.row}>
          <View style={styles.rowIcon}>
            <LifeBuoy size={18} color={colors.sandDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Help & support</Text>
            <Text style={styles.rowSubtext}>FAQs and contacting our team</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </Card>
      </Pressable>

      <Pressable onPress={logout}>
        <Card style={styles.row}>
          <View style={styles.rowIcon}>
            <LogOut size={18} color={colors.error} />
          </View>
          <Text style={[styles.rowLabel, { color: colors.error }]}>Log out</Text>
        </Card>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowSubtext: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
});
