import { router } from "expo-router";
import { Check, SatelliteDish, Wifi, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/TextField";
import { useRobot, type ConnectionMethod } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

function closeOrGoSettings() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/settings");
  }
}

export default function ConnectRobotScreen() {
  const insets = useSafeAreaInsets();
  const { connectRobot } = useRobot();
  const [method, setMethod] = useState<ConnectionMethod>("wifi");
  const [network, setNetwork] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [done, setDone] = useState(false);

  // See store/[id].tsx -- same guard against a dev reload or Expo Go replay
  // landing directly on this modal with no history beneath it.
  const isLandingScreen = !router.canGoBack();

  useEffect(() => {
    if (isLandingScreen) router.replace("/(app)");
  }, [isLandingScreen]);

  if (isLandingScreen) return null;

  async function handleConnect() {
    setConnecting(true);
    try {
      await connectRobot(method);
      setDone(true);
    } finally {
      setConnecting(false);
    }
  }

  if (done) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Check size={32} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>Robot connected</Text>
          <Text style={styles.successBody}>
            Your Buildo is now connected via {method === "wifi" ? "Wi-Fi" : "its SIM"}.
          </Text>
          <Button label="Done" onPress={closeOrGoSettings} style={{ marginTop: spacing.xl, width: "100%" }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Pressable onPress={closeOrGoSettings} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>Connect your robot</Text>
      <Text style={styles.subtitle}>Choose how your Buildo should get online.</Text>

      <View style={styles.methodRow}>
        <Pressable
          onPress={() => setMethod("wifi")}
          style={[styles.methodChip, method === "wifi" && styles.methodChipActive]}
        >
          <Wifi size={16} color={method === "wifi" ? colors.black : colors.textMuted} />
          <Text style={[styles.methodChipText, method === "wifi" && styles.methodChipTextActive]}>Wi-Fi</Text>
        </Pressable>
        <Pressable
          onPress={() => setMethod("sim")}
          style={[styles.methodChip, method === "sim" && styles.methodChipActive]}
        >
          <SatelliteDish size={16} color={method === "sim" ? colors.black : colors.textMuted} />
          <Text style={[styles.methodChipText, method === "sim" && styles.methodChipTextActive]}>SIM</Text>
        </Pressable>
      </View>

      {method === "wifi" ? (
        <Card>
          <TextField
            label="Network name"
            value={network}
            onChangeText={setNetwork}
            placeholder="Your home Wi-Fi"
          />
          <TextField
            label="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="Wi-Fi password"
          />
        </Card>
      ) : (
        <Card>
          <Text style={styles.simLabel}>Built-in SIM detected</Text>
          <Text style={styles.simBody}>
            Your Buildo ships with its own SIM for connectivity anywhere -- no Wi-Fi needed. Just activate it below.
          </Text>
        </Card>
      )}

      <Button
        label={connecting ? "Connecting..." : "Connect"}
        onPress={handleConnect}
        loading={connecting}
        style={{ marginTop: spacing.lg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
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
    fontSize: 28,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  methodRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  methodChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodChipActive: {
    backgroundColor: colors.skin,
    borderColor: colors.skinBorder,
  },
  methodChipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  methodChipTextActive: {
    color: colors.black,
  },
  simLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  simBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.successSurface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  successTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.black,
  },
  successBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
  },
});
