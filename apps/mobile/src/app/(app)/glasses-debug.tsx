// Developer screen for the real glasses connection, built around the actual
// product flow (not a pile of manual steps): BLE is the default, always-on
// connection; starting a recording brings Wi-Fi up (phone hotspot, fixed
// credentials) just for the episode; stopping a recording drops the hotspot
// and the board falls back to BLE on its own. See glasses-session.ts for the
// state machine this screen drives. Built against PROTOCOL_GLASSES.md /
// EPISODES.md. Reached from the Gadgets tab's "Debug" card (pair.tsx).
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Row, Section, STATE_LABEL } from "../../components/DebugPanels";
import { GlassesVideoPanel } from "../../components/GlassesVideoPanel";
import { isLikelyGlasses, type Device } from "../../lib/ble/nordic-uart-link";
import { useDevices } from "../../lib/device-context";
import type { SessionState } from "../../lib/glasses/glasses-session";
import type {
  EpisodeEventMessage,
  HelloMessage,
  PeerMessage,
  StatusMessage,
} from "../../lib/glasses/protocol";
import { colors, fonts, radii, spacing } from "../../theme";

const SCAN_DURATION_MS = 15000;

// Live video is GlassesVideoPanel (src/components/GlassesVideoPanel.tsx) --
// extracted out of this screen so the real app's Skills recording screen can
// use the exact same, already-verified rendering path instead of a second
// copy. No behavior change here, just moved.

export default function GlassesDebugScreen() {
  const insets = useSafeAreaInsets();
  // Shares the one app-wide GlassesSession from DeviceProvider instead of
  // constructing a private one here. This screen used to call `new
  // GlassesSession()` and start its own TCP command/data servers on top of
  // the ones DeviceProvider already has listening on 5010/5005 -- both binds
  // silently succeed (createServer uses reuseAddress), so there was no error
  // anywhere, but whichever listener the OS actually handed an incoming
  // connection to was arbitrary. That's exactly why recordings kept timing
  // out waiting for "hello" even when the board's own logs confirmed it
  // connected and sent one: the connection could land on this screen's
  // then-orphaned server instead of the one DeviceProvider's session (which
  // Gadgets/Skills actually watch) was listening on. One shared instance
  // means one TCP server per port, period.
  const devices = useDevices();
  const session = devices.glassesSession;

  // Lazy initializers, not a value set inside the listener effect below --
  // the session may already be past "idle" (e.g. BLE connected from the
  // Gadgets tab before Debug was ever opened), and setting state synchronously
  // inside an effect body trips react-hooks/set-state-in-effect.
  const [sessionState, setSessionState] = useState<SessionState>(() => session.state);
  const [episodeName, setEpisodeName] = useState("ep_0001");
  const [hello, setHello] = useState<HelloMessage | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [peerRtsp, setPeerRtsp] = useState<string | null>(null);
  const [gatewayIp, setGatewayIp] = useState<string | null>(() => session.gatewayIp);
  const [frameCount, setFrameCount] = useState(0);
  const [commandBusy, setCommandBusy] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  // Tracks the user's own intent (pressed Start, hasn't pressed/finished
  // Stop yet) independently of the session's internal state machine -- the
  // Stop button must be pressable immediately on Start, not only once
  // hotspot/BLE/acks all line up and the state reaches "recording".
  const [userWantsRecording, setUserWantsRecording] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannedDevices, setScannedDevices] = useState<Map<string, Device>>(new Map());
  const [bleConnecting, setBleConnecting] = useState<string | null>(null);
  const [bleError, setBleError] = useState<string | null>(null);
  const [hotspotInfo, setHotspotInfo] = useState<string | null>(null);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 80));
  }, []);

  useEffect(() => {
    // Only attaches this screen's own listeners -- `session.start()` and
    // `session.destroy()` are DeviceProvider's job now, since this is the
    // one shared, app-wide instance (see the comment above `session` for
    // why this screen stopped owning its own). Unmounting Debug must not
    // tear down the connection Gadgets/Skills are also watching.
    const unsubState = session.on("state", ({ state }) => {
      setSessionState((prev) => {
        // Clears stale hello/status/video/frame-count data whenever
        // leaving "recording" for any reason -- including the link
        // dying unexpectedly, not just a deliberate Stop press -- so
        // the screen can't keep showing frozen numbers from a
        // connection that's actually already gone.
        if (prev === "recording" && state !== "recording") {
          setHello(null);
          setStatus(null);
          setPeerRtsp(null);
          setFrameCount(0);
        }
        return state;
      });
      // session.gatewayIp is a plain getter, not its own event -- reading
      // it here (synced with every state transition) instead of from the
      // ref directly during render, which the rules of hooks disallow.
      setGatewayIp(session.gatewayIp);
    });
    const unsubLog = session.on("log", ({ line }) => pushLog(line));
    const unsubHello = session.link.on("hello", setHello);
    const unsubStatus = session.link.on("status", setStatus);
    const unsubFrame = session.link.on("frame", () => setFrameCount((c) => c + 1));
    const unsubPeer = session.link.on("peer", (p: PeerMessage) => setPeerRtsp(p.rtsp));
    const unsubEpisode = session.link.on("episodeEvent", (e: EpisodeEventMessage) => pushLog(`episode: ${e.event}`));

    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      unsubState();
      unsubLog();
      unsubHello();
      unsubStatus();
      unsubFrame();
      unsubPeer();
      unsubEpisode();
    };
  }, [session, pushLog]);

  async function onStartRecording() {
    setRecordingError(null);
    setCommandBusy("start");
    // Set the instant the button is pressed, not once the session machine
    // confirms "recording" -- Stop should be pressable right away, not only
    // after hotspot/BLE/ack timing all lines up first.
    setUserWantsRecording(true);
    try {
      await session.startRecording(episodeName);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : String(err));
      setUserWantsRecording(false);
    } finally {
      setCommandBusy(null);
    }
  }

  async function onStopRecording() {
    setCommandBusy("stop");
    try {
      await session.stopRecording(episodeName);
    } finally {
      setCommandBusy(null);
      setUserWantsRecording(false);
      setHello(null);
      setStatus(null);
      setPeerRtsp(null);
      setFrameCount(0);
    }
  }

  async function runCommand(name: string, fn: () => Promise<unknown>) {
    setCommandBusy(name);
    try {
      await fn();
    } finally {
      setCommandBusy(null);
    }
  }

  function stopScanTimer() {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
  }

  async function onStartScan() {
    setBleError(null);
    setScannedDevices(new Map());
    setScanning(true);
    try {
      await session.link.startBleScan((device) => {
        setScannedDevices((prev) => {
          const existing = prev.get(device.id);
          if (existing && (existing.rssi ?? -999) >= (device.rssi ?? -999)) return prev;
          return new Map(prev).set(device.id, device);
        });
      });
    } catch (err) {
      setBleError(err instanceof Error ? err.message : String(err));
      setScanning(false);
      return;
    }
    stopScanTimer();
    scanTimerRef.current = setTimeout(onStopScan, SCAN_DURATION_MS);
  }

  function onStopScan() {
    stopScanTimer();
    session.link.stopBleScan();
    setScanning(false);
  }

  async function onConnectToDevice(device: Device) {
    setBleError(null);
    onStopScan();
    setBleConnecting(device.id);
    try {
      await session.connectBleToDeviceManually(device);
    } catch (err) {
      setBleError(err instanceof Error ? err.message : String(err));
    } finally {
      setBleConnecting(null);
    }
  }

  async function onManualStartHotspot() {
    setHotspotInfo(null);
    try {
      const reservation = await session.link.startHotspot();
      setHotspotInfo(`ssid=${reservation.ssid} gateway=${reservation.gatewayIp}`);
    } catch (err) {
      setHotspotInfo(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onManualStopHotspot() {
    await session.link.stopHotspot();
    setHotspotInfo(null);
  }

  async function onManualDisconnectBle() {
    await session.disconnectBleManually();
  }

  async function onManualConnectBle() {
    await session.connectBleManually();
  }

  const isRecording = sessionState === "recording";
  const canStart = sessionState === "ble_ready";
  const leftRtsp = hello?.rtsp ?? null;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Debug</Text>
      <Text style={styles.subtitle}>
        Real flow: Bluetooth is always on; starting a recording brings Wi-Fi up just for the episode, stopping it
        drops back to Bluetooth-only. No mock data.
      </Text>

      <Section title="Connection">
        <Row label="State" value={STATE_LABEL[sessionState]} />
        <Text style={styles.sectionHint}>
          Bluetooth is manual only -- it does not connect automatically, and doesn&apos;t auto-reconnect if it drops.
          This board&apos;s BLE disconnects on its own the instant Wi-Fi comes up (confirmed from the device&apos;s own
          logs), and a background auto-reconnect loop that kept trying anyway was found to be the actual cause of
          recordings losing Wi-Fi after about a minute -- the reconnect scans were competing with the hotspot for
          radio time. Press Connect below once, before recording; no need to touch it again until you want to stop.
        </Text>
        <View style={styles.commandRow}>
          <Button
            label={sessionState === "connecting_ble" ? "Connecting…" : "Connect BLE"}
            loading={sessionState === "connecting_ble"}
            disabled={sessionState === "ble_ready" || sessionState === "recording" || sessionState === "starting_wifi"}
            onPress={onManualConnectBle}
            style={styles.commandBtn}
          />
          <Button
            label="Disconnect BLE"
            variant="secondary"
            disabled={sessionState === "recording" || sessionState === "starting_wifi"}
            onPress={onManualDisconnectBle}
            style={styles.commandBtn}
          />
        </View>
        {bleError ? <Text style={styles.errorText}>{bleError}</Text> : null}
      </Section>

      <Section title="Recording">
        <TextInput
          style={styles.input}
          placeholder="Episode name (e.g. ep_0001)"
          placeholderTextColor={colors.textMuted}
          value={episodeName}
          onChangeText={setEpisodeName}
          autoCapitalize="none"
          editable={!userWantsRecording}
        />
        <View style={styles.commandRow}>
          <Button
            label={commandBusy === "start" ? "Starting…" : "Start recording"}
            loading={commandBusy === "start"}
            disabled={!canStart || userWantsRecording}
            onPress={onStartRecording}
            style={styles.commandBtn}
          />
          <Button
            label={commandBusy === "stop" ? "Stopping…" : "Stop recording"}
            variant="secondary"
            loading={commandBusy === "stop"}
            disabled={!userWantsRecording}
            onPress={onStopRecording}
            style={styles.commandBtn}
          />
        </View>
        {!canStart && !userWantsRecording ? (
          <Text style={styles.sectionHint}>
            Waiting for Bluetooth to connect first -- this happens automatically, no action needed.
          </Text>
        ) : null}
        {recordingError ? <Text style={styles.errorText}>{recordingError}</Text> : null}
      </Section>

      {leftRtsp || peerRtsp ? (
        <Section title="Live video">
          {/* Kept up by hello/peer, not isRecording, on purpose -- a brief
              state flicker (e.g. a status-heartbeat gap during the Wi-Fi
              handoff) shouldn't yank the video view out from under you
              while the underlying stream might still be fine. */}
          <View style={styles.videoBox}>
            <GlassesVideoPanel label="Left (master)" url={leftRtsp} localPort={15000} localAddress={gatewayIp} onLog={pushLog} />
            <GlassesVideoPanel label="Right (slave)" url={peerRtsp} localPort={15010} localAddress={gatewayIp} onLog={pushLog} />
          </View>
        </Section>
      ) : null}

      <Section title="Live state">
        {hello ? (
          <>
            <Row label="Firmware" value={hello.fw} />
            <Row label="Board state" value={hello.state} />
            <Row label="Slave" value={`${hello.slave.wifi} / ${hello.slave.state}`} />
          </>
        ) : (
          <Text style={styles.sectionHint}>No hello yet.</Text>
        )}
        {status ? (
          <>
            <Row label="FPS" value={String(status.fps)} />
            <Row label="Data sent / dropped" value={`${status.data.sent} / ${status.data.dropped}`} />
            <Row label="Wi-Fi RSSI" value={status.rssi != null ? `${status.rssi} dBm` : "?"} />
            <Row
              label="Battery (left)"
              value={status.battery.left ? `${status.battery.left.pct ?? "?"}% (${status.battery.left.source ?? "?"})` : "?"}
            />
            <Row
              label="Battery (right)"
              value={status.battery.right ? `${status.battery.right.pct ?? "?"}% (${status.battery.right.source ?? "?"})` : "?"}
            />
            <Row
              label="Video (master)"
              value={status.video ? `on=${status.video.on} client=${status.video.client} playing=${status.video.playing}` : "?"}
            />
            <Row
              label="Right camera (via master)"
              value={`${status.slave.wifi} · ${status.slave.state} · fps=${status.slave.fps ?? 0}`}
            />
          </>
        ) : null}
        <Row label="Frames received (data channel)" value={String(frameCount)} />
      </Section>

      <Section title="Commands">
        <Text style={styles.sectionHint}>Needs Wi-Fi up (recording) -- these go over the TCP command channel.</Text>
        <View style={styles.commandRow}>
          <Button
            label="Time sync"
            variant="secondary"
            loading={commandBusy === "sync"}
            disabled={!isRecording}
            onPress={() => runCommand("sync", () => session.runTimeSyncNow())}
            style={styles.commandBtn}
          />
          <Button
            label="Status"
            variant="secondary"
            loading={commandBusy === "status"}
            disabled={!isRecording}
            onPress={() => runCommand("status", () => session.sendCommand({ cmd: "status" }))}
            style={styles.commandBtn}
          />
          <Button
            label="Reconnect"
            variant="secondary"
            loading={commandBusy === "reconnect"}
            disabled={!isRecording}
            onPress={() => runCommand("reconnect", () => session.sendCommand({ cmd: "reconnect" }))}
            style={styles.commandBtn}
          />
        </View>
      </Section>

      <Section title="Advanced / manual (diagnostics only)">
        <Text style={styles.sectionHint}>
          The flow above handles connection, hotspot, and credentials automatically. These are for testing each
          piece independently when something&apos;s not behaving -- not needed for normal use.
        </Text>
        <Button
          label={advancedOpen ? "Hide manual controls" : "Show manual controls"}
          variant="secondary"
          onPress={() => setAdvancedOpen((v) => !v)}
          style={{ marginTop: spacing.sm }}
        />
        {advancedOpen ? (
          <>
            <Text style={[styles.sectionHint, { marginTop: spacing.md }]}>Hotspot</Text>
            <View style={styles.commandRow}>
              <Button label="Start hotspot" variant="secondary" onPress={onManualStartHotspot} style={styles.commandBtn} />
              <Button label="Stop hotspot" variant="secondary" onPress={onManualStopHotspot} style={styles.commandBtn} />
            </View>
            {hotspotInfo ? <Text style={styles.sectionHint}>{hotspotInfo}</Text> : null}

            <Text style={[styles.sectionHint, { marginTop: spacing.md }]}>
              Bluetooth: Connect/Disconnect now live in the Connection section above. This scan is just for when that
              can&apos;t find &ldquo;Glasses-L&rdquo; by name and you need to pick the device from a full nearby list.
            </Text>
            <View style={styles.commandRow}>
              {!scanning ? (
                <Button label="Scan nearby (15s)" variant="secondary" onPress={onStartScan} style={styles.commandBtn} />
              ) : (
                <Button label="Stop scan" variant="secondary" onPress={onStopScan} style={styles.commandBtn} />
              )}
            </View>
            {(() => {
              const namedDevices = [...scannedDevices.values()]
                .filter((device) => !!(device.name ?? device.localName))
                .sort((a, b) => {
                  const aLikely = isLikelyGlasses(a) ? 1 : 0;
                  const bLikely = isLikelyGlasses(b) ? 1 : 0;
                  if (aLikely !== bLikely) return bLikely - aLikely;
                  return (b.rssi ?? -999) - (a.rssi ?? -999);
                });
              return (
                <>
                  {namedDevices.map((device) => (
                    <Pressable
                      key={device.id}
                      onPress={() => onConnectToDevice(device)}
                      disabled={bleConnecting !== null}
                      style={styles.deviceRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>
                          {device.name ?? device.localName}
                          {isLikelyGlasses(device) ? " ✓" : ""}
                        </Text>
                        <Text style={styles.deviceMeta}>
                          {device.id} · {device.rssi ?? "?"} dBm
                        </Text>
                      </View>
                      <Text style={styles.deviceConnectLabel}>{bleConnecting === device.id ? "Connecting…" : "Connect"}</Text>
                    </Pressable>
                  ))}
                  {scanning && namedDevices.length === 0 ? (
                    <Text style={styles.sectionHint}>Scanning… named devices will appear here as they&apos;re found.</Text>
                  ) : null}
                </>
              );
            })()}
          </>
        ) : null}
      </Section>

      <Section title="Log">
        {log.length === 0 ? <Text style={styles.sectionHint}>Nothing yet.</Text> : null}
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </Section>
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
  sectionHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  input: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontFamily: fonts.technical,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  commandRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  commandBtn: {
    flex: 1,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deviceName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  deviceMeta: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  deviceConnectLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.sandDark,
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
  videoBox: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.black,
  },
});
