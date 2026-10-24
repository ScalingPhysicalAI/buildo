import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Bluetooth, Bug, ChevronDown, ChevronRight, Glasses, Hand, Battery, X } from "lucide-react-native";
import { Animated, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { StatusPill } from "../../components/StatusPill";
import { Alert } from "../../lib/alert";
import { isLikelyGlasses, type Device } from "../../lib/ble/nordic-uart-link";
import { BleState, enableBluetooth, getBleState, isLocationEnabled, openBluetoothSettings, openLocationSettings } from "../../lib/ble/radio-status";
import { useDevices, type ConnectionStatus } from "../../lib/device-context";
import { colors, fonts, radii, spacing } from "../../theme";

const SCAN_DURATION_MS = 15000;

function PulsingIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  // Lazy useState initializer, not a ref read during render (react-hooks/refs).
  const [pulse] = useState(() => new Animated.Value(1));

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
  error,
  onConnect,
  onDisconnect,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
  status: ConnectionStatus;
  battery?: number | null;
  error?: string | null;
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
        <>
          <Button label={`Connect ${name}`} variant="secondary" onPress={onConnect} style={{ marginTop: spacing.sm }} />
          {error ? <Text style={styles.connectErrorText}>{error}</Text> : null}
        </>
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

  const [scanOpen, setScanOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannedDevices, setScannedDevices] = useState<Map<string, Device>>(new Map());
  const [bleConnecting, setBleConnecting] = useState<string | null>(null);
  const [bleScanError, setBleScanError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function checkRadios() {
        const bleState = await getBleState();
        if (cancelled) return;
        if (bleState !== BleState.PoweredOn) {
          Alert.alert("Turn on Bluetooth", "Buildo needs Bluetooth to connect to your glasses and gloves.", [
            { text: "Not now", style: "cancel" },
            {
              text: Platform.OS === "android" ? "Turn on" : "Open Settings",
              onPress: () => {
                if (Platform.OS === "android") {
                  enableBluetooth().catch(openBluetoothSettings);
                } else {
                  Linking.openSettings().catch(() => undefined);
                }
              },
            },
          ]);
          return; // one prompt at a time -- location gets its turn next focus
        }

        const locationOn = await isLocationEnabled();
        if (cancelled || locationOn) return;
        Alert.alert(
          "Turn on Location",
          "Android requires Location services to be on for Bluetooth scanning, even though Buildo doesn't use your location.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: openLocationSettings },
          ]
        );
      }

      checkRadios();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  function stopScanTimer() {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
  }

  function onStopScan() {
    stopScanTimer();
    devices.glassesSession.link.stopBleScan();
    setScanning(false);
  }

  async function onStartScan() {
    setBleScanError(null);
    setScannedDevices(new Map());
    setScanning(true);
    try {
      await devices.glassesSession.link.startBleScan((device) => {
        setScannedDevices((prev) => {
          const existing = prev.get(device.id);
          if (existing && (existing.rssi ?? -999) >= (device.rssi ?? -999)) return prev;
          return new Map(prev).set(device.id, device);
        });
      });
    } catch (err) {
      setBleScanError(err instanceof Error ? err.message : String(err));
      setScanning(false);
      return;
    }
    stopScanTimer();
    scanTimerRef.current = setTimeout(onStopScan, SCAN_DURATION_MS);
  }

  async function onConnectScannedDevice(device: Device) {
    setBleScanError(null);
    onStopScan();
    setBleConnecting(device.id);
    try {
      await devices.glassesSession.connectBleToDeviceManually(device);
    } catch (err) {
      setBleScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setBleConnecting(null);
    }
  }

  useEffect(() => {
    return () => {
      stopScanTimer();
      devices.glassesSession.link.stopBleScan();
    };
  }, [devices.glassesSession]);

  const namedScannedDevices = [...scannedDevices.values()]
    .filter((device) => !!(device.name ?? device.localName))
    .sort((a, b) => {
      const aLikely = isLikelyGlasses(a) ? 1 : 0;
      const bLikely = isLikelyGlasses(b) ? 1 : 0;
      if (aLikely !== bLikely) return bLikely - aLikely;
      return (b.rssi ?? -999) - (a.rssi ?? -999);
    });

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
        error={devices.glasses_error}
        onConnect={devices.connectGlasses}
        onDisconnect={() => devices.disconnect("glasses")}
      />

      <DeviceRow
        icon={<Hand size={22} color={devices.gloves === "connected" ? colors.success : colors.sandDark} />}
        name="Creators Gloves"
        detail="Streams hand pose + tactile data"
        status={devices.gloves}
        battery={devices.gloves_battery}
        onConnect={devices.connectGloves}
        onDisconnect={() => devices.disconnect("gloves")}
      />

      <Card style={styles.scanBanner}>
        <Pressable onPress={() => setScanOpen((v) => !v)} style={styles.scanBannerHeader}>
          <View style={styles.debugIconWrap}>
            <Bluetooth size={20} color={colors.sandDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.debugTitle}>Scan for nearby BLE devices</Text>
            <Text style={styles.debugDetail}>
              If &ldquo;Connect&rdquo; above can&apos;t find your glasses, scan and pick the device by hand.
            </Text>
          </View>
          {scanOpen ? <ChevronDown size={18} color={colors.textMuted} /> : <ChevronRight size={18} color={colors.textMuted} />}
        </Pressable>

        {scanOpen ? (
          <View style={styles.scanPanel}>
            {!scanning ? (
              <Button label="Scan nearby (15s)" variant="secondary" onPress={onStartScan} />
            ) : (
              <Button label="Stop scan" variant="secondary" onPress={onStopScan} />
            )}
            {bleScanError ? <Text style={styles.connectErrorText}>{bleScanError}</Text> : null}
            {namedScannedDevices.map((device) => (
              <Pressable
                key={device.id}
                onPress={() => onConnectScannedDevice(device)}
                disabled={bleConnecting !== null}
                style={styles.scanDeviceRow}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceName}>
                    {device.name ?? device.localName}
                    {isLikelyGlasses(device) ? " ✓" : ""}
                  </Text>
                  <Text style={styles.deviceDetail}>
                    {device.id} · {device.rssi ?? "?"} dBm
                  </Text>
                </View>
                <Text style={styles.scanConnectLabel}>{bleConnecting === device.id ? "Connecting…" : "Connect"}</Text>
              </Pressable>
            ))}
            {scanning && namedScannedDevices.length === 0 ? (
              <Text style={styles.debugDetail}>Scanning… named devices will appear here as they&apos;re found.</Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Pressable onPress={() => router.push("/glasses-debug")}>
        <Card style={styles.debugCard}>
          <View style={styles.debugIconWrap}>
            <Bug size={20} color={colors.sandDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.debugTitle}>Debug</Text>
            <Text style={styles.debugDetail}>
              Real BLE + Wi-Fi connection to the glasses hardware -- live logs, no mock data.
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
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
  connectErrorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  debugCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  scanBanner: {
    marginTop: spacing.sm,
  },
  scanBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  debugIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  debugTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  debugDetail: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    lineHeight: 15,
  },
  scanPanel: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  scanDeviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  scanConnectLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.sandDark,
  },
});
