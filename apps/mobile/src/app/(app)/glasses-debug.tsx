// Developer screen for the real glasses connection -- BLE stays on always;
// recording brings Wi-Fi up for the episode and drops it on stop.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Row, Section, STATE_LABEL } from "../../components/DebugPanels";
import { GlassesVideoPanel } from "../../components/GlassesVideoPanel";
import { GloveHandView } from "../../components/GloveHandView";
import { isLikelyGlasses, type Device } from "../../lib/ble/nordic-uart-link";
import { useDevices } from "../../lib/device-context";
import { deleteLocalFile, EpisodeRecorder } from "../../lib/glasses/episode-storage";
import { uploadEpisodeZip } from "../../lib/glasses/episode-upload";
import type { SessionState } from "../../lib/glasses/glasses-session";
import type { EpisodeEventMessage, HelloMessage, PeerMessage, StatusMessage } from "../../lib/glasses/protocol";
import type { RawRtpPacket } from "../../lib/glasses/rtsp-client";
import type { GloveSessionState } from "../../lib/gloves/glove-session";
import { GLOVE_STATE_LABEL } from "../../lib/gloves/glove-session";
import type {
  HelloMessage as GloveHelloMessage,
  StatusMessage as GloveStatusMessage,
  WireHandPacket,
} from "../../lib/gloves/protocol";
import { generateDummyHandPacket } from "../../lib/gloves/dummy-hand-data";
import { useSkills } from "../../lib/skills-context";
import { colors, fonts, radii, spacing } from "../../theme";

const SCAN_DURATION_MS = 15000;

export default function GlassesDebugScreen() {
  const insets = useSafeAreaInsets();
  // Shares the one app-wide GlassesSession from DeviceProvider -- don't
  // construct a second one here, it'll double-bind the TCP servers.
  const devices = useDevices();
  const session = devices.glassesSession;
  const gloves = devices.glovesSession;
  const { recordUpload } = useSkills();
  const recorderRef = useRef<EpisodeRecorder | null>(null);
  const lastDurationSecRef = useRef<number | undefined>(undefined);

  // Lazy initializers: the session may already be past "idle".
  const [sessionState, setSessionState] = useState<SessionState>(() => session.state);
  const [episodeName, setEpisodeName] = useState("ep_0001");
  const [hello, setHello] = useState<HelloMessage | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [peerRtsp, setPeerRtsp] = useState<string | null>(null);
  const [gatewayIp, setGatewayIp] = useState<string | null>(() => session.gatewayIp);
  const [frameCount, setFrameCount] = useState(0);
  const [commandBusy, setCommandBusy] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  // User intent, separate from session state -- Stop must be pressable
  // immediately on Start, not only once the state reaches "recording".
  const [userWantsRecording, setUserWantsRecording] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannedDevices, setScannedDevices] = useState<Map<string, Device>>(new Map());
  const [bleConnecting, setBleConnecting] = useState<string | null>(null);
  const [bleError, setBleError] = useState<string | null>(null);
  const [hotspotInfo, setHotspotInfo] = useState<string | null>(null);

  const [environmentInput, setEnvironmentInput] = useState("");
  const [skillSlugInput, setSkillSlugInput] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [hasRecording, setHasRecording] = useState(false);

  const [gloveState, setGloveState] = useState<GloveSessionState>(() => gloves.state);
  const [gloveHello, setGloveHello] = useState<GloveHelloMessage | null>(null);
  const [gloveStatus, setGloveStatus] = useState<GloveStatusMessage | null>(null);
  const [glovePacketCount, setGlovePacketCount] = useState(0);
  const [glovePacket, setGlovePacket] = useState<WireHandPacket | null>(null);
  const lastGlovePacketUiUpdateRef = useRef(0);
  const [gloveDemoMode, setGloveDemoMode] = useState(false);
  const [dummyGlovePacket, setDummyGlovePacket] = useState<WireHandPacket | null>(null);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 80));
  }, []);

  // Stable identity -- GlassesVideoPanel's own RTSP-connect effect re-runs
  // whenever onRawPacket's identity changes, same reason the Skill
  // recording screen's own callbacks are useCallback'd. Raw, undecoded
  // packets -- see rtsp-client.ts and episode-storage.ts.
  const onLeftPacket = useCallback((p: RawRtpPacket) => {
    recorderRef.current?.saveVideoPacket("left", p.packet, p.encHeader);
  }, []);
  const onRightPacket = useCallback((p: RawRtpPacket) => {
    recorderRef.current?.saveVideoPacket("right", p.packet, p.encHeader);
  }, []);

  useEffect(() => {
    // Only this screen's own listeners -- start()/destroy() belong to
    // DeviceProvider, since this is the one shared, app-wide session.
    const unsubState = session.on("state", ({ state }) => {
      setSessionState((prev) => {
        // Clear stale data when leaving "recording" for any reason.
        if (prev === "recording" && state !== "recording") {
          setHello(null);
          setStatus(null);
          setPeerRtsp(null);
          setFrameCount(0);
        }
        return state;
      });
      setGatewayIp(session.gatewayIp);
    });
    const unsubLog = session.on("log", ({ line }) => pushLog(line));
    const unsubHello = session.link.on("hello", (h) => {
      setHello(h);
      recorderRef.current?.setHello(h);
    });
    const unsubStatus = session.link.on("status", (s) => {
      setStatus(s);
      recorderRef.current?.setStatus(s);
    });
    const unsubPeer = session.link.on("peer", (p: PeerMessage) => setPeerRtsp(p.rtsp));
    const unsubEpisode = session.link.on("episodeEvent", (e: EpisodeEventMessage) => pushLog(`episode: ${e.event}`));
    const unsubDataHello = session.link.on("dataHello", (d) => recorderRef.current?.addDataHello(d));
    // Counts every data-channel line (hello/marker/frame-or-encrypted) --
    // was "frames received" when the content was readable; now that it's
    // encrypted, a per-line count is all this app can still show.
    const unsubRawLine = session.link.on("rawDataLine", ({ line }) => {
      setFrameCount((c) => c + 1);
      recorderRef.current?.appendRawDataLine(line);
    });

    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      unsubState();
      unsubLog();
      unsubHello();
      unsubStatus();
      unsubPeer();
      unsubEpisode();
      unsubDataHello();
      unsubRawLine();
    };
  }, [session, pushLog]);

  // Entirely separate from the glasses effect above, on purpose -- this
  // screen's glove wiring must never risk touching glasses' own listeners.
  useEffect(() => {
    const unsubState = gloves.on("state", ({ state }) => {
      setGloveState((prev) => {
        if (prev === "streaming" && state !== "streaming") {
          setGloveHello(null);
          setGloveStatus(null);
          setGlovePacketCount(0);
          setGlovePacket(null);
        }
        return state;
      });
    });
    const unsubLog = gloves.on("log", ({ line }) => pushLog(line));
    const unsubHello = gloves.link.on("hello", setGloveHello);
    const unsubStatus = gloves.link.on("status", setGloveStatus);
    const unsubPacket = gloves.link.on("packet", (packet) => {
      setGlovePacketCount((c) => c + 1);
      // Packets can arrive at 50-100Hz -- re-rendering the whole debug
      // screen on every single one would hitch the UI thread for no visual
      // benefit. ~15fps is plenty smooth for a hand rig on screen.
      const now = Date.now();
      if (now - lastGlovePacketUiUpdateRef.current >= 66) {
        lastGlovePacketUiUpdateRef.current = now;
        setGlovePacket(packet);
      }
    });

    return () => {
      unsubState();
      unsubLog();
      unsubHello();
      unsubStatus();
      unsubPacket();
    };
  }, [gloves, pushLog]);

  // Preview-only: generates synthetic packets in the exact shape a real
  // glove sends, so the hand rig below can be demoed/tested with no
  // physical glove connected at all. Never touches glovePacket/glove state
  // above -- GloveHandView just gets fed whichever source is on.
  useEffect(() => {
    if (!gloveDemoMode) return;
    const startedAt = Date.now();
    let seq = 0;
    const timer = setInterval(() => {
      setDummyGlovePacket(generateDummyHandPacket(Date.now() - startedAt, seq++));
    }, 66);
    return () => {
      clearInterval(timer);
      setDummyGlovePacket(null);
    };
  }, [gloveDemoMode]);

  async function onStartRecording() {
    setRecordingError(null);
    setUploadError(null);
    setCommandBusy("start");
    setUserWantsRecording(true);
    recorderRef.current = new EpisodeRecorder({
      episodeName,
      environment: environmentInput || "debug",
      skillSlug: skillSlugInput || "debug",
      skillName: skillSlugInput || "debug",
    });
    setHasRecording(false);

    // Glasses and gloves start independently now -- for testing the glove
    // data path alone, gloves no longer needs glasses connected too (and
    // vice versa). Each gets its own try/catch so one failing, or simply
    // not being BLE-ready, never blocks the other.
    const glassesReady = sessionState === "ble_ready";
    const glovesReady = gloveState === "ble_ready";

    if (!glassesReady && !glovesReady) {
      setRecordingError("Neither glasses nor gloves are connected (BLE ready) -- connect at least one first.");
      setUserWantsRecording(false);
      setCommandBusy(null);
      return;
    }

    if (glassesReady) {
      try {
        await session.startRecording(episodeName);
      } catch (err) {
        setRecordingError(err instanceof Error ? err.message : String(err));
      }
    } else {
      pushLog("glasses: not connected -- skipping (gloves-only start)");
    }
    setCommandBusy(null);

    if (glovesReady) {
      gloves.startRecording(episodeName).catch((err) => {
        pushLog(`gloves: failed to start Wi-Fi (${err instanceof Error ? err.message : String(err)})`);
      });
    }
  }

  async function onStopRecording() {
    setCommandBusy("stop");
    try {
      await session.stopRecording(episodeName);
    } catch (err) {
      // Caught, not left to propagate -- an exception here used to skip
      // the gloves stop below entirely, since this used to be a bare
      // try/finally with no catch.
      pushLog(`glasses: stop failed (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      lastDurationSecRef.current = recorderRef.current?.finish().durationSec;
      setHasRecording(true);
      setCommandBusy(null);
      setUserWantsRecording(false);
      setHello(null);
      setStatus(null);
      setPeerRtsp(null);
      setFrameCount(0);
    }

    // Independent of glasses' own stop above -- best-effort, never throws
    // into it. Not gated on glasses having been started at all.
    if (gloveState === "streaming" || gloveState === "starting_wifi") {
      gloves.stopRecording(episodeName).catch((err) => {
        pushLog(`gloves: failed to stop cleanly (${err instanceof Error ? err.message : String(err)})`);
      });
    }
  }

  async function onUpload() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (!skillSlugInput.trim() || !environmentInput.trim()) {
      setUploadError("Fill in both Environment and Skill slug before uploading -- they must match a real skill in the catalog.");
      return;
    }
    setUploadError(null);
    setUploadBusy(true);
    try {
      const { file: zipFile, sizeBytes } = recorder.buildZip();
      const collection = await recordUpload(
        skillSlugInput.trim(),
        `${episodeName}.zip`,
        lastDurationSecRef.current,
        sizeBytes,
        true // debug -- skips the server's real-recording minimum-length rule
      );
      await uploadEpisodeZip(zipFile, collection.id, environmentInput.trim(), skillSlugInput.trim());
      deleteLocalFile(zipFile);
      recorder.delete();
      recorderRef.current = null;
      setHasRecording(false);
      pushLog(`upload: done (${collection.id})`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed -- the recording is still saved on your phone.");
    } finally {
      setUploadBusy(false);
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

  // connectBleManually() never throws (same as glasses' own version) --
  // failures surface as a "log" line, already routed into pushLog above.
  async function onGloveConnectBle() {
    await gloves.connectBleManually();
  }

  async function onGloveDisconnectBle() {
    await gloves.disconnectBleManually();
  }

  const isRecording = sessionState === "recording";
  // Either device being BLE-ready is enough to enable Start now -- gloves
  // can be tested on its own, without glasses connected at all. Used to be
  // gated on glasses alone, which left the button disabled with gloves-only
  // connected even though onStartRecording() itself already handles that.
  const canStart = sessionState === "ble_ready" || gloveState === "ble_ready";
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

      <Section title="Gloves connection">
        <Row label="State" value={GLOVE_STATE_LABEL[gloveState]} />
        <Text style={styles.sectionHint}>
          Same manual-only BLE as glasses above -- connect once before recording. &ldquo;Start recording&rdquo; below
          brings both glasses and the gloves onto the same Wi-Fi hotspot together, if the gloves are connected here.
        </Text>
        <View style={styles.commandRow}>
          <Button
            label={gloveState === "connecting_ble" ? "Connecting…" : "Connect BLE"}
            loading={gloveState === "connecting_ble"}
            disabled={gloveState === "ble_ready" || gloveState === "streaming" || gloveState === "starting_wifi"}
            onPress={onGloveConnectBle}
            style={styles.commandBtn}
          />
          <Button
            label="Disconnect BLE"
            variant="secondary"
            disabled={gloveState === "streaming" || gloveState === "starting_wifi"}
            onPress={onGloveDisconnectBle}
            style={styles.commandBtn}
          />
        </View>
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

        <Text style={[styles.sectionHint, { marginTop: spacing.md }]}>
          Must match a real skill in the catalog (its slug) and an existing environment -- same upload path the
          Skill recording screen uses.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Environment (e.g. hospital)"
          placeholderTextColor={colors.textMuted}
          value={environmentInput}
          onChangeText={setEnvironmentInput}
          autoCapitalize="none"
          editable={!userWantsRecording}
        />
        <TextInput
          style={styles.input}
          placeholder="Skill slug (e.g. pick-and-place)"
          placeholderTextColor={colors.textMuted}
          value={skillSlugInput}
          onChangeText={setSkillSlugInput}
          autoCapitalize="none"
          editable={!userWantsRecording}
        />
        <Button
          label={uploadBusy ? "Uploading…" : "Upload recording"}
          loading={uploadBusy}
          disabled={!hasRecording || userWantsRecording}
          onPress={onUpload}
          style={{ marginTop: spacing.sm }}
        />
        {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}
      </Section>

      {leftRtsp || peerRtsp ? (
        <Section title="Live video">
          {/* Kept up by hello/peer, not isRecording, on purpose -- a brief
              state flicker (e.g. a status-heartbeat gap during the Wi-Fi
              handoff) shouldn't yank the video view out from under you
              while the underlying stream might still be fine. */}
          <View style={styles.videoBox}>
            <GlassesVideoPanel
              label="Left (master)"
              url={leftRtsp}
              localPort={15000}
              localAddress={gatewayIp}
              onLog={pushLog}
              onRawPacket={onLeftPacket}
            />
            <GlassesVideoPanel
              label="Right (slave)"
              url={peerRtsp}
              localPort={15010}
              localAddress={gatewayIp}
              onLog={pushLog}
              onRawPacket={onRightPacket}
            />
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
        <Row label="Data lines received (data channel)" value={String(frameCount)} />
      </Section>

      <Section title="Gloves live state">
        {gloveHello ? (
          <>
            <Row label="Firmware" value={gloveHello.fw} />
            <Row label="Wi-Fi" value={`${gloveHello.wifi.connected} / ssid=${gloveHello.wifi.ssid ?? "?"}`} />
            <Row label="Reconnected" value={String(gloveHello.reconnected)} />
          </>
        ) : (
          <Text style={styles.sectionHint}>No hello yet.</Text>
        )}
        {gloveStatus ? (
          <>
            <Row label="Wi-Fi RSSI" value={gloveStatus.wifi.rssi != null ? `${gloveStatus.wifi.rssi} dBm` : "?"} />
            <Row
              label="Data sent / dropped / replayed"
              value={`${gloveStatus.data.sent} / ${gloveStatus.data.dropped} / ${gloveStatus.data.replay_dropped}`}
            />
          </>
        ) : null}
        <Row label="Packets received (data channel)" value={String(glovePacketCount)} />
      </Section>

      <Section title="Gloves hand view">
        <View style={styles.commandRow}>
          <Button
            label={gloveDemoMode ? "Stop dummy-data preview" : "Preview with dummy data (no glove needed)"}
            variant="secondary"
            onPress={() => setGloveDemoMode((v) => !v)}
            style={styles.commandBtn}
          />
        </View>
        {gloveDemoMode ? (
          <>
            <Text style={styles.errorText}>Showing synthetic dummy data -- not from a real glove. Preview only.</Text>
            <Text style={styles.sectionHint}>
              Only one physical glove exists today -- both hands below are driven from the same dummy stream (the
              left is just a mirror image) so the hand design can be previewed for both sides ahead of a second
              glove. Once real gloves connect, each will show here the same way, one real hand per glove.
            </Text>
            <View style={styles.handsRow}>
              <View style={styles.handsCol}>
                <GloveHandView key="demo-left" packet={dummyGlovePacket} autoCalibrate handedness="left" compact label="Left (dummy)" />
              </View>
              <View style={styles.handsCol}>
                <GloveHandView key="demo-right" packet={dummyGlovePacket} autoCalibrate handedness="right" compact label="Right (dummy)" />
              </View>
            </View>
          </>
        ) : (
          <GloveHandView key="live" packet={glovePacket} handedness="right" />
        )}
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
  handsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  handsCol: {
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
