import { router } from "expo-router";
import { BatteryMedium, Signal } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import { RobotPulse } from "./RobotPulse";
import { useRobot } from "../lib/robot-context";
import { colors, fonts, radii, spacing } from "../theme";

export function RobotHeroCard() {
  const { connected, connectionMethod, robotName, batteryLevel, signalStrength, disconnectRobot } = useRobot();
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectRobot();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>YOUR ROBOT</Text>

      <RobotPulse active={connected} size={168} />

      <Text style={styles.name}>{robotName}</Text>

      <View style={styles.statusRow}>
        <View style={[styles.statusDot, connected ? styles.statusDotOn : styles.statusDotOff]} />
        <Text style={styles.statusText}>
          {connected ? `Connected · ${connectionMethod === "wifi" ? "Wi-Fi" : "SIM"}` : "Not connected"}
        </Text>
      </View>

      {connected ? (
        <View style={styles.statsRow}>
          <View style={styles.statChip}>
            <BatteryMedium size={14} color="rgba(245,241,232,0.7)" />
            <Text style={styles.statText}>{batteryLevel}%</Text>
          </View>
          <View style={styles.statChip}>
            <Signal size={14} color="rgba(245,241,232,0.7)" />
            <Text style={styles.statText}>{signalStrength}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>Connect your Buildo to start giving it commands</Text>
      )}

      <Button
        label={connected ? "Manage connection" : "Connect robot"}
        variant={connected ? "secondary" : "cream"}
        onPress={() => router.push("/settings/connect-robot")}
        style={styles.cta}
      />

      {connected ? (
        <Pressable onPress={handleDisconnect} disabled={disconnecting} hitSlop={8} style={styles.disconnectBtn}>
          <Text style={styles.disconnectText}>{disconnecting ? "Disconnecting..." : "Disconnect robot"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.deviceSurface,
    borderRadius: radii.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  eyebrow: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 2,
    color: "rgba(245,241,232,0.45)",
    marginBottom: spacing.md,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.background,
    marginTop: spacing.md,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotOn: {
    backgroundColor: colors.success,
  },
  statusDotOff: {
    backgroundColor: "rgba(245,241,232,0.3)",
  },
  statusText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: "rgba(245,241,232,0.7)",
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(245,241,232,0.08)",
  },
  statText: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: "rgba(245,241,232,0.75)",
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(245,241,232,0.5)",
    marginTop: spacing.md,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing.lg,
    width: "100%",
  },
  disconnectBtn: {
    marginTop: spacing.md,
    paddingVertical: 4,
  },
  disconnectText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
  },
});
