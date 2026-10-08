// Temporary developer screen for bench-testing the glasses integration
// layer piece by piece, before the real BLE contract (ble-contract.ts) is
// filled in and this gets replaced by the real Pair-screen flow. Not linked
// from anywhere in the normal app UI except a small link on the Pair screen.
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BleManager, type Device } from "react-native-ble-plx";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { requestBlePermissions } from "../../lib/glasses/ble-provisioning";
import { startHotspot, stopHotspot, type LocalHotspotReservation } from "../../lib/glasses/hotspot";
import { CONTROL_PORT, GlassesLink, LEFT_FRAME_PORT } from "../../lib/glasses/tcp-server";
import { colors, fonts, radii, spacing } from "../../theme";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text selectable style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

// -- Hotspot ------------------------------------------------------------

function HotspotSection() {
  const [status, setStatus] = useState<"idle" | "starting" | "started" | "error">("idle");
  const [reservation, setReservation] = useState<LocalHotspotReservation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onStart() {
    setStatus("starting");
    setError(null);
    try {
      const result = await startHotspot();
      setReservation(result);
      setStatus("started");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function onStop() {
    await stopHotspot();
    setReservation(null);
    setStatus("idle");
  }

  return (
    <Section title="1. Phone hotspot (native module)">
      <Text style={styles.sectionHint}>
        Proves the Kotlin LocalHotspot module itself works -- no BLE or glasses needed.
      </Text>
      {status === "started" && reservation ? (
        <>
          <Row label="SSID" value={reservation.ssid} />
          <Row label="Password" value={reservation.password} />
          <Row label="Gateway IP" value={reservation.gatewayIp} />
          <Button label="Stop hotspot" variant="secondary" onPress={onStop} style={{ marginTop: spacing.sm }} />
        </>
      ) : (
        <Button
          label={status === "starting" ? "Starting…" : "Start hotspot"}
          onPress={onStart}
          loading={status === "starting"}
          style={{ marginTop: spacing.sm }}
        />
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </Section>
  );
}

// -- Raw BLE scan ---------------------------------------------------------

function BleScanSection() {
  const managerRef = useRef<BleManager | null>(null);
  const [status, setStatus] = useState<"idle" | "scanning" | "error">("idle");
  const [devices, setDevices] = useState<Map<string, Device>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    managerRef.current = new BleManager();
    return () => {
      managerRef.current?.stopDeviceScan();
      managerRef.current?.destroy();
    };
  }, []);

  async function onScan() {
    setError(null);
    setDevices(new Map());
    const granted = await requestBlePermissions();
    if (!granted) {
      setError("Bluetooth/location permission denied.");
      setStatus("error");
      return;
    }

    setStatus("scanning");
    managerRef.current?.startDeviceScan(null, null, (scanError, device) => {
      if (scanError) {
        setError(scanError.message);
        setStatus("error");
        managerRef.current?.stopDeviceScan();
        return;
      }
      if (device) {
        setDevices((prev) => new Map(prev).set(device.id, device));
      }
    });

    setTimeout(() => {
      managerRef.current?.stopDeviceScan();
      setStatus((s) => (s === "scanning" ? "idle" : s));
    }, 10000);
  }

  return (
    <Section title="2. Raw BLE scan (unfiltered)">
      <Text style={styles.sectionHint}>
        Proves BLE permissions + scanning work at all on this phone -- not filtered to the glasses yet, since
        ble-contract.ts is still a placeholder. Any nearby BLE device should show up.
      </Text>
      <Button
        label={status === "scanning" ? "Scanning…" : "Scan nearby BLE (10s)"}
        onPress={onScan}
        loading={status === "scanning"}
        style={{ marginTop: spacing.sm }}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {[...devices.values()].map((d) => (
        <Row key={d.id} label={d.name ?? d.localName ?? "(unnamed)"} value={d.id} />
      ))}
    </Section>
  );
}

// -- TCP glasses link -------------------------------------------------

function TcpSection() {
  const linkRef = useRef<GlassesLink | null>(null);
  const [listening, setListening] = useState(false);
  const [controlConnected, setControlConnected] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  function pushLog(line: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 20));
  }

  useEffect(() => {
    return () => {
      linkRef.current?.stop();
    };
  }, []);

  function onStart() {
    const link = new GlassesLink();
    linkRef.current = link;

    link.on("controlConnected", () => {
      setControlConnected(true);
      pushLog("control connected");
    });
    link.on("controlDisconnected", () => {
      setControlConnected(false);
      pushLog("control disconnected");
    });
    link.on("message", ({ message }) => {
      pushLog(`${message.type} seq=${message.seq}`);
    });
    link.on("seqGap", ({ type, previous, current }) => {
      pushLog(`⚠ seq gap on ${type}: ${previous} → ${current}`);
    });
    link.on("frame", ({ header, jpeg }) => {
      setFrameCount((c) => c + 1);
      pushLog(`frame fid=${header.frameId} ${jpeg.length}B`);
    });

    link.start();
    setListening(true);
    pushLog(`listening on ${CONTROL_PORT} + ${LEFT_FRAME_PORT}`);
  }

  function onStop() {
    linkRef.current?.stop();
    linkRef.current = null;
    setListening(false);
    setControlConnected(false);
    setFrameCount(0);
  }

  return (
    <Section title="3. Glasses TCP link">
      <Text style={styles.sectionHint}>
        Doesn&apos;t need BLE or the hotspot -- just needs your phone reachable from your laptop on the same WiFi. Check
        your phone&apos;s IP in WiFi settings, then point the fake-board script at it.
      </Text>
      <Text style={styles.codeHint}>npx tsx scripts/fake-glasses-board.ts &lt;phone-ip&gt;</Text>
      {!listening ? (
        <Button label="Start listeners" onPress={onStart} style={{ marginTop: spacing.sm }} />
      ) : (
        <Button label="Stop listeners" variant="secondary" onPress={onStop} style={{ marginTop: spacing.sm }} />
      )}
      {listening ? (
        <>
          <Row label="Control" value={controlConnected ? "connected" : "waiting…"} />
          <Row label="Frames received" value={String(frameCount)} />
        </>
      ) : null}
      {log.map((line, i) => (
        <Text key={i} style={styles.logLine}>
          {line}
        </Text>
      ))}
    </Section>
  );
}

export default function GlassesDebugScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Glasses debug</Text>
      <Text style={styles.subtitle}>Developer-only. Test each layer independently before the real pairing flow exists.</Text>

      <HotspotSection />
      <BleScanSection />
      <TcpSection />
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
    fontSize: 28,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  sectionHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  codeHint: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.sandDark,
    backgroundColor: colors.sandSurface,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rowLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  rowValue: {
    flex: 1,
    textAlign: "right",
    fontFamily: fonts.technical,
    fontSize: 12,
    color: colors.textPrimary,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.sm,
  },
  logLine: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
  },
});
