import { useEffect, useRef, useState } from "react";
import { Check, Glasses, Hand, Wifi, Battery, X } from "lucide-react-native";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { StatusPill } from "../../components/StatusPill";
import { useDevices, type ConnectionStatus } from "../../lib/device-context";
import { colors, fonts, radii, spacing } from "../../theme";

// No real Buildo unit broadcasts wifi networks yet (same "no hardware"
// situation noted throughout this repo) -- this is what the picker looks
// like once one does.
const MOCK_NETWORKS = [
  { ssid: "Buildo-Unit-04A2", signal: 3 },
  { ssid: "Buildo-Unit-91F0", signal: 2 },
  { ssid: "StarforgeLab-5G", signal: 3 },
];

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
  const [showNetworks, setShowNetworks] = useState(false);
  const [joiningSsid, setJoiningSsid] = useState<string | null>(null);

  function joinNetwork(ssid: string) {
    setJoiningSsid(ssid);
    devices.connectBuildo(ssid);
    setShowNetworks(false);
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Pair your gear</Text>
      <Text style={styles.subtitle}>Glasses and gloves connect over Bluetooth. Buildo joins your wifi network.</Text>

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

      <Card style={styles.deviceCard}>
        <View style={styles.deviceTop}>
          <View style={[styles.iconWrap, devices.buildo === "connected" && styles.iconWrapConnected]}>
            <PulsingIcon active={devices.buildo === "connecting"}>
              <Wifi size={22} color={devices.buildo === "connected" ? colors.success : colors.sandDark} />
            </PulsingIcon>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceName}>Buildo unit</Text>
            <Text style={styles.deviceDetail}>{devices.buildoNetwork ?? "Not on your network yet"}</Text>
          </View>
          <StatusPill
            label={devices.buildo}
            tone={devices.buildo === "connected" ? "success" : devices.buildo === "connecting" ? "warning" : "neutral"}
          />
        </View>

        {devices.buildo === "disconnected" && (
          <Button
            label="Find nearby Buildo"
            variant="secondary"
            onPress={() => setShowNetworks((v) => !v)}
            style={{ marginTop: spacing.sm }}
          />
        )}
        {devices.buildo === "connecting" && (
          <Text style={styles.joiningText}>Joining {joiningSsid}…</Text>
        )}
        {devices.buildo === "connected" && (
          <Pressable onPress={() => devices.disconnect("buildo")} style={styles.disconnectLink}>
            <X size={13} color={colors.textMuted} />
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        )}

        {showNetworks && (
          <View style={styles.networkList}>
            {MOCK_NETWORKS.map((n) => (
              <Pressable key={n.ssid} style={styles.networkRow} onPress={() => joinNetwork(n.ssid)}>
                <Wifi size={16} color={colors.textMuted} />
                <Text style={styles.networkSsid}>{n.ssid}</Text>
                <Check size={16} color={colors.sandDark} style={{ opacity: 0 }} />
              </Pressable>
            ))}
          </View>
        )}
      </Card>
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
  joiningText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.sandDark,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  networkList: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  networkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  networkSsid: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
});
