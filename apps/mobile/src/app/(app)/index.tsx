import { router } from "expo-router";
import { Glasses, Hand, LogOut, Wifi, ChevronRight } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Logo } from "../../components/Logo";
import { SessionRow } from "../../components/SessionRow";
import { StatusPill } from "../../components/StatusPill";
import { useAuth } from "../../lib/auth-context";
import { useDevices, type ConnectionStatus } from "../../lib/device-context";
import { useSessions } from "../../lib/sessions-context";
import { colors, fonts, radii, spacing } from "../../theme";

function statusTone(status: ConnectionStatus) {
  if (status === "connected") return "success" as const;
  if (status === "connecting") return "warning" as const;
  return "neutral" as const;
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const devices = useDevices();
  const { sessions } = useSessions();
  const insets = useSafeAreaInsets();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  const allConnected = devices.glasses === "connected" && devices.gloves === "connected" && devices.buildo === "connected";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.header}>
        <Logo tag="mobile" size={16} />
        <Pressable onPress={logout} hitSlop={12} style={styles.logoutBtn}>
          <LogOut size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <Text style={styles.greeting}>Hi, {firstName}</Text>
      <Text style={styles.greetingSub}>
        {allConnected ? "Everything's paired — ready to record." : "Pair your gear to start recording a skill."}
      </Text>

      <Card style={styles.creditCard}>
        <View>
          <Text style={styles.creditLabel}>Credit balance</Text>
          <Text style={styles.creditValue}>{user?.tokenBalance ?? 0}$</Text>
        </View>
        <View style={styles.creditBadge}>
          <Text style={styles.creditBadgeText}>{user?.role ?? "DEVELOPER"}</Text>
        </View>
      </Card>

      <Pressable onPress={() => router.push("/(app)/pair")}>
        <Card style={styles.deviceCard}>
          <View style={styles.deviceCardHeader}>
            <Text style={styles.sectionTitle}>Your gear</Text>
            <ChevronRight size={18} color={colors.textMuted} />
          </View>

          <View style={styles.deviceRow}>
            <Glasses size={18} color={colors.textPrimary} />
            <Text style={styles.deviceName}>Capture glasses</Text>
            <StatusPill label={devices.glasses} tone={statusTone(devices.glasses)} />
          </View>
          <View style={styles.deviceRow}>
            <Hand size={18} color={colors.textPrimary} />
            <Text style={styles.deviceName}>Haptic gloves</Text>
            <StatusPill label={devices.gloves} tone={statusTone(devices.gloves)} />
          </View>
          <View style={styles.deviceRow}>
            <Wifi size={18} color={colors.textPrimary} />
            <Text style={styles.deviceName}>Buildo unit</Text>
            <StatusPill label={devices.buildo} tone={statusTone(devices.buildo)} />
          </View>
        </Card>
      </Pressable>

      <Button
        label={allConnected ? "Start new episode" : "Finish pairing first"}
        onPress={() => router.push("/(app)/record")}
        disabled={!allConnected}
        style={{ marginTop: spacing.lg }}
      />

      <View style={[styles.deviceCardHeader, { marginTop: spacing.xl, marginBottom: spacing.sm }]}>
        <Text style={styles.sectionTitle}>Recent recordings</Text>
        {sessions.length > 3 ? (
          <Pressable onPress={() => router.push("/(app)/record")}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        ) : null}
      </View>

      {sessions.length === 0 ? (
        <Text style={styles.emptyText}>Nothing recorded yet — start an episode to see it here.</Text>
      ) : (
        sessions.slice(0, 3).map((s) => <SessionRow key={s.id} session={s} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
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
  greeting: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.black,
  },
  greetingSub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  creditCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  creditLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  creditValue: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
    marginTop: 2,
  },
  creditBadge: {
    backgroundColor: colors.sandSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  creditBadgeText: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: colors.sandDark,
    letterSpacing: 0.4,
  },
  deviceCard: {
    gap: spacing.md,
  },
  deviceCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  deviceName: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  seeAll: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.sandDark,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
});
