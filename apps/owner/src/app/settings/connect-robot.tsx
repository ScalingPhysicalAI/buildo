import { router } from "expo-router";
import { Check, SatelliteDish, Wifi, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { RobotPulse } from "../../components/RobotPulse";
import { TextField } from "../../components/TextField";
import { useRobot, type ConnectionMethod } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

const ROBOT_PAIRED = require("../../../assets/robot-angle-2.png") as ImageSourcePropType;

const PAIRING_STEPS = ["Searching for your Buildo...", "Establishing secure link...", "Finalizing connection..."];

function closeOrGoSettings() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/settings");
  }
}

type Phase = "form" | "connecting" | "done";

export default function ConnectRobotScreen() {
  const insets = useSafeAreaInsets();
  const { connectRobot } = useRobot();
  const [method, setMethod] = useState<ConnectionMethod>("wifi");
  const [network, setNetwork] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [stepIndex, setStepIndex] = useState(0);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // See store/[id].tsx -- same guard against a dev reload or Expo Go replay
  // landing directly on this modal with no history beneath it.
  const isLandingScreen = !router.canGoBack();

  useEffect(() => {
    if (isLandingScreen) router.replace("/(app)");
  }, [isLandingScreen]);

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, []);

  if (isLandingScreen) return null;

  async function handleConnect() {
    setPhase("connecting");
    setStepIndex(0);
    stepTimer.current = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, PAIRING_STEPS.length - 1));
    }, 480);
    try {
      await connectRobot(method);
      setPhase("done");
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
    }
  }

  if (phase === "connecting") {
    return (
      <View style={[styles.deviceScreen, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.eyebrow}>PAIRING</Text>
        <RobotPulse active size={140} />
        <Text style={styles.deviceTitle}>Connecting your Buildo</Text>
        <Text style={styles.deviceSubtitle}>{PAIRING_STEPS[stepIndex]}</Text>
      </View>
    );
  }

  if (phase === "done") {
    return (
      <View style={[styles.deviceScreen, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.successStage}>
          <RobotPulse active size={140} source={ROBOT_PAIRED} />
          <View style={styles.successBadge}>
            <Check size={18} color={colors.black} strokeWidth={2.5} />
          </View>
        </View>
        <Text style={styles.deviceTitle}>Robot connected</Text>
        <Text style={styles.deviceSubtitle}>
          Your Buildo is now connected via {method === "wifi" ? "Wi-Fi" : "its SIM"}.
        </Text>
        <Button
          label="Done"
          variant="cream"
          onPress={closeOrGoSettings}
          style={{ marginTop: spacing.xl, width: "100%" }}
        />
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

      <Button label="Connect" onPress={handleConnect} style={{ marginTop: spacing.lg }} />
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
  deviceScreen: {
    flex: 1,
    backgroundColor: colors.deviceSurface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  eyebrow: {
    position: "absolute",
    top: spacing.xl,
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 3,
    color: "rgba(245,241,232,0.4)",
  },
  successStage: {
    alignItems: "center",
    justifyContent: "center",
  },
  successBadge: {
    position: "absolute",
    bottom: 8,
    right: "28%",
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.sand,
    borderWidth: 2,
    borderColor: colors.deviceSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.background,
    marginTop: spacing.lg,
  },
  deviceSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: "rgba(245,241,232,0.6)",
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
