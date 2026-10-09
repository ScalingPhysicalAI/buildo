import { useEffect, useRef } from "react";
import { Glasses, Hand, Battery, X } from "lucide-react-native";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { StatusPill } from "../../components/StatusPill";
import { useDevices, type ConnectionStatus } from "../../lib/device-context";
import { colors, fonts, radii, spacing } from "../../theme";

function PulsingIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  return <Animated.View style={{ transform: [{ scale: pulse }] }}>{children}</Animated.View>;
}

function DeviceRow({
  icon,
  name,
  detail,
  status,
  battery,
  onConnect,
  onDisconnect,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  status: ConnectionStatus;
  battery?: number | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <Card style={styles.deviceCard}>
      <View style={styles.deviceTop}>
        <View style={[styles.iconWrap, status === "connected" && styles.iconWrapConnected]}>
          <PulsingIcon active={status === "connecting"}>{icon}</PulsingIcon>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.deviceName}>{name}</Text>
          <Text style={styles.deviceDetail}>{detail}</Text>
        </View>
        <StatusPill
          label={status}
          tone={status === "connected" ? "success" : status === "connecting" ? "warning" : "neutral"}
        />
      </View>

      {status === "connected" && battery != null ? (
        <View style={styles.batteryRow}>
          <Battery size={14} color={colors.textMuted} />
          <Text style={styles.batteryText}>{battery}% battery</Text>
        </View>
      ) : null}

      {status === "disconnected" && (
        <Button label={`Connect ${name}`} variant="secondary" onPress={onConnect} style={{ marginTop: spacing.sm }} />
      )}
      {status === "connecting" && (
        <Button label="Connecting…" variant="secondary" onPress={() => {}} loading style={{ marginTop: spacing.sm }} />
      )}
      {status === "connected" && (
        <Pressable onPress={onDisconnect} style={styles.disconnectLink}>
          <X size={13} color={colors.textMuted} />
          <Text style={styles.disconnectText}>Disconnect</Text>
        </Pressable>
      )}
    </Card>
  );
}

export default function PairScreen() {
  const devices = useDevices();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Pair your gear</Text>
      <Text style={styles.subtitle}>Glasses and gloves connect over Bluetooth.</Text>

      <DeviceRow
        icon={<Glasses size={22} color={devices.glasses === "connected" ? colors.success : colors.sandDark} />}
        name="Capture glasses"
        detail="Streams first-person video"
        status={devices.glasses}
        battery={devices.glasses_battery}
        onConnect={devices.connectGlasses}
        onDisconnect={() => devices.disconnect("glasses")}
      />

      <DeviceRow
        icon={<Hand size={22} color={devices.gloves === "connected" ? colors.success : colors.sandDark} />}
        name="Haptic gloves"
        detail="Streams hand pose + tactile data"
        status={devices.gloves}
        battery={devices.gloves_battery}
        onConnect={devices.connectGloves}
        onDisconnect={() => devices.disconnect("gloves")}
      />
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
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  deviceCard: {
    marginBottom: spacing.md,
  },
  deviceTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapConnected: {
    backgroundColor: colors.successSurface,
  },
  deviceName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  deviceDetail: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  batteryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  batteryText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  disconnectLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "center",
    marginTop: spacing.sm,
    padding: spacing.xs,
  },
  disconnectText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
  },
});
