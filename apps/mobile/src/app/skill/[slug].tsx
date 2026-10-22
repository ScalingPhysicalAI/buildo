// Recording happens via the capture glasses + haptic gloves (BLE pairing,
// video + IMU streamed to this phone over wifi) -- not the phone's own
// camera. The real glasses/gloves capture -> upload pipeline (see
// ../../lib/glasses/*) isn't wired into this flow yet, so this screen shows
// the full shape (record -> review -> upload -> train -> trained) with a
// timed stand-in for the capture itself, same pattern as the old
// sessions-context recorder it replaces.
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Battery, Check, Glasses, Hand, Square, Trash2, Upload, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Row, Section, STATE_LABEL } from "../../components/DebugPanels";
import { GlassesVideoPanel } from "../../components/GlassesVideoPanel";
import { Alert } from "../../lib/alert";
import { useDevices } from "../../lib/device-context";
import { formatDuration } from "../../lib/format";
import type { SessionState } from "../../lib/glasses/glasses-session";
import type { HelloMessage, PeerMessage, StatusMessage } from "../../lib/glasses/protocol";
import { getDisplayStatus } from "../../lib/skill-status";
import { useSkills } from "../../lib/skills-context";
import { colors, fonts, radii, spacing } from "../../theme";

const CAPTURE_TIPS = [
  "Make sure the gloves are visible in the camera.",
  "While performing an upward task, move the camera of the specs up.",
  "While performing a downward task, push it down.",
  "Speak the action you're performing out loud as you do it.",
  "The specs will show a bigger alert if your hands aren't visible in the camera.",
];

function closeOrGoHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/train");
  }
}

type Phase = "instructions" | "recording" | "review";

// Reflects the actual GlassesSession state machine (same one the Debug
// screen's STATE_LABEL shows) instead of a generic "connecting" guess, so
// what this loader says is always true, not just plausible.
const CONNECTING_LABEL: Record<SessionState, string> = {
  idle: "Connecting to glasses…",
  connecting_ble: "Connecting over Bluetooth…",
  ble_ready: "Bluetooth ready — starting Wi-Fi…",
  ble_disconnected: "Bluetooth disconnected",
  starting_wifi: "Starting Wi-Fi + glasses camera…",
  recording: "Streaming",
  stopping: "Stopping…",
};

// Paid skills must record at least this long before Stop is allowed -- the
// backend enforces the same minimum on upload, so this is UX, not the only
// gate. Custom (unpaid) skills have no minimum.
// TEMP: shortened from the real 2 minutes (120s) for testing.
const MIN_PAID_RECORDING_SECONDS = 10;

export default function SkillDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { catalog, recordUpload } = useSkills();
  const devices = useDevices();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>("instructions");
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  // Lazy useState initializer, not a ref read during render -- pre-existing
  // code flagged by the same rule hit elsewhere this session; fixed the
  // same way (see device-context.tsx), not a logic change.
  const [ring] = useState(() => new Animated.Value(1));
  const episodeRef = useRef<string | null>(null);

  // Live glasses state while this screen is actually recording -- same
  // event names the Debug screen listens to (glasses-debug.tsx), just
  // scoped to this screen instead of a persistent diagnostic view.
  const [sessionState, setSessionState] = useState<SessionState>(devices.glassesSession.state);
  const [hello, setHello] = useState<HelloMessage | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [peerRtsp, setPeerRtsp] = useState<string | null>(null);
  // Same "what's actually happening" log the Debug screen shows -- shown
  // here too now so a failure on this screen doesn't need a trip to Debug
  // just to see what stalled (got BLE? got an IP? waiting on hello?).
  const [logs, setLogs] = useState<string[]>([]);

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 40));
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const session = devices.glassesSession;
    const unsubState = session.on("state", ({ state }) => setSessionState(state));
    const unsubLog = session.on("log", ({ line }) => pushLog(line));
    const unsubHello = session.link.on("hello", setHello);
    const unsubStatus = session.link.on("status", setStatus);
    const unsubPeer = session.link.on("peer", (p: PeerMessage) => setPeerRtsp(p.rtsp));
    return () => {
      unsubState();
      unsubLog();
      unsubHello();
      unsubStatus();
      unsubPeer();
    };
  }, [phase, devices.glassesSession, pushLog]);

  // Only counts real recording time toward the paid-skill minimum, not the
  // Wi-Fi handoff wait before the episode actually starts -- the old mock
  // had no such wait (phase and "actually recording" were the same moment),
  // now they aren't.
  const isLive = sessionState === "recording";

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  useEffect(() => {
    if (phase !== "recording") {
      ring.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1.25, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, ring]);

  const entry = catalog.find((s) => s.slug === slug);
  if (!entry) return <Redirect href="/(app)/train" />;

  const displayStatus = getDisplayStatus(entry.collection);
  const minRecordingSeconds = entry.reward > 0 ? MIN_PAID_RECORDING_SECONDS : 0;
  const canStop = elapsed >= minRecordingSeconds;

  async function handleStartRecording() {
    const gearConnected = devices.glasses === "connected" && devices.gloves === "connected";
    if (!gearConnected) {
      Alert.alert("Glasses and gloves are not connected", "Pair your capture glasses and haptic gloves before recording.", [
        { text: "Cancel", style: "cancel" },
        { text: "Connect", onPress: () => router.push("/(app)/pair") },
      ]);
      return;
    }
    const episodeName = `ep_${entry!.slug}_${Date.now()}`;
    episodeRef.current = episodeName;
    setElapsed(0);
    setHello(null);
    setStatus(null);
    setPeerRtsp(null);
    setLogs([]);
    setPhase("recording");
    try {
      // Same call the Debug screen's "Start recording" button makes --
      // hotspot up, Wi-Fi credentials over BLE, wait for hello, video
      // config, time sync, then the actual `start` command.
      await devices.glassesSession.startRecording(episodeName);
    } catch (err) {
      setPhase("instructions");
      Alert.alert("Couldn't start recording", err instanceof Error ? err.message : "Check your glasses and try again.");
    }
  }

  function handleStopRecording() {
    if (!canStop) return;
    const episodeName = episodeRef.current;
    if (episodeName) {
      // Same stop(episode) -> forget_wifi -> hotspot down -> back to BLE
      // sequence the Debug screen's "Stop recording" button triggers.
      // Fire-and-forget: the teardown takes a couple of seconds, but
      // there's no reason to block the user from moving on to review.
      devices.glassesSession.stopRecording(episodeName).catch(() => undefined);
    }
    setPhase("review");
  }

  function handleDiscard() {
    setPhase("instructions");
  }

  async function handleUpload() {
    setBusy(true);
    try {
      await recordUpload(entry!.slug, undefined, elapsed);
      setPhase("instructions");
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "recording") {
    const leftRtsp = hello?.rtsp ?? null;
    const batteryLeft = status?.battery.left?.pct;
    const batteryRight = status?.battery.right?.pct;

    return (
      <ScrollView style={styles.cameraContainer} contentContainerStyle={{ flexGrow: 1 }}>
        {/* minHeight: windowHeight -- this block is the "first screen view"
            the user wants: badges, video, battery, stop button, nothing
            else. Giving it the full window height (instead of sizing to its
            own content, which left it shorter than the screen once the
            video boxes shrank) is what makes logs/live-state below only
            reachable by actually scrolling, instead of being visible
            immediately under the fold. */}
        <View style={[styles.cameraOverlay, { paddingTop: insets.top + spacing.md, minHeight: windowHeight }]}>
          <View style={styles.liveRow}>
            <View style={styles.liveBadge}>
              <Glasses size={14} color={isLive ? colors.recording : colors.textMuted} />
              <Text style={[styles.liveBadgeText, !isLive && styles.liveBadgeTextPaused]}>
                {isLive ? "Streaming" : "Connecting…"}
              </Text>
            </View>
            <View style={styles.liveBadge}>
              <Hand size={14} color={isLive ? colors.recording : colors.textMuted} />
              <Text style={[styles.liveBadgeText, !isLive && styles.liveBadgeTextPaused]}>
                {isLive ? "Streaming" : "Connecting…"}
              </Text>
            </View>
          </View>

          {/* Same two GlassesVideoPanel calls as Debug (Left (master) on
              15000, Right (slave) on 15010, no style override) -- side by
              side, centered (cameraOverlay's own justifyContent/alignItems
              center does this once the block has real height to center
              within). No title text, no Card/Section wrapper. */}
          {leftRtsp || peerRtsp ? (
            <View style={styles.videoBox}>
              {/* GlassesVideoPanel returns null outright when its own
                  `url` is null (e.g. peerRtsp hasn't arrived yet) -- with
                  no wrapper, that collapses the row to one full-width box
                  instead of two. Wrapping each in an equal-width slot keeps
                  both boxes the same size and visible side by side
                  regardless of which one already has a frame. */}
              <View style={styles.videoSlot}>
                <GlassesVideoPanel label="Left (master)" url={leftRtsp} localPort={15000} localAddress={devices.glassesSession.gatewayIp} onLog={pushLog} hideLabel />
              </View>
              <View style={styles.videoSlot}>
                <GlassesVideoPanel label="Right (slave)" url={peerRtsp} localPort={15010} localAddress={devices.glassesSession.gatewayIp} onLog={pushLog} hideLabel />
              </View>
            </View>
          ) : (
            <View style={styles.connectingRow}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.previewLabel}>{CONNECTING_LABEL[sessionState]}</Text>
            </View>
          )}

          {status ? (
            <View style={styles.batteryRow}>
              <Battery size={13} color="rgba(255,255,255,0.65)" />
              <Text style={styles.batteryText}>
                Left {batteryLeft ?? "?"}% · Right {batteryRight ?? "?"}%
              </Text>
            </View>
          ) : null}

          <Text style={styles.cameraTimer}>{formatDuration(elapsed)}</Text>
          <View style={styles.recordControlsRow}>
            <Pressable onPress={handleStopRecording} disabled={!canStop} style={styles.recordButtonWrap}>
              <Animated.View style={[styles.recordRing, { transform: [{ scale: ring }] }]} />
              <View style={[styles.stopButton, !canStop && styles.stopButtonDisabled]}>
                <Square size={26} color={colors.white} fill={colors.white} />
              </View>
            </Pressable>
          </View>
          <Text style={styles.cameraHint}>
            {!canStop
              ? `Keep recording — ${minRecordingSeconds - elapsed}s more for the reward to count`
              : "Tap stop when you're done"}
          </Text>
        </View>

        {/* Only reachable by scrolling past the full-height block above --
            logs, then the same Live state Section Debug shows. Black
            background throughout, matching the camera view above instead of
            switching to the light Card theme Debug uses for this. */}
        <View style={styles.debugMirror}>
          {logs.length > 0 ? (
            <View style={styles.logPanel}>
              <ScrollView contentContainerStyle={{ gap: 2 }}>
                {logs.map((line, i) => (
                  <Text key={i} style={styles.logLine}>
                    {line}
                  </Text>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Same Section/Row components the Debug screen uses (literally
              the same ones, imported from components/DebugPanels.tsx) --
              not a redesign, just the identical diagnostic view available
              here too without a trip to Debug. */}
          <Section title="Live state">
            <Row label="State" value={STATE_LABEL[sessionState]} />
            {hello ? (
              <>
                <Row label="Firmware" value={hello.fw} />
                <Row label="Board state" value={hello.state} />
                <Row label="Slave" value={`${hello.slave.wifi} / ${hello.slave.state}`} />
              </>
            ) : (
              <Row label="Hello" value="not received yet" />
            )}
            {status ? (
              <>
                <Row label="FPS" value={String(status.fps)} />
                <Row label="Data sent / dropped" value={`${status.data.sent} / ${status.data.dropped}`} />
                <Row label="Wi-Fi RSSI" value={status.rssi != null ? `${status.rssi} dBm` : "?"} />
                <Row
                  label="Right camera (via master)"
                  value={`${status.slave.wifi} · ${status.slave.state} · fps=${status.slave.fps ?? 0}`}
                />
              </>
            ) : (
              <Row label="Status" value="not received yet" />
            )}
          </Section>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Pressable onPress={closeOrGoHome} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.name}>{entry.name}</Text>
      <View style={styles.rewardRow}>
        <Text style={styles.category}>{entry.category}</Text>
      </View>
      <Text style={styles.summary}>{entry.summary}</Text>

      {phase === "review" ? (
        <View style={styles.reviewCard}>
          <View style={styles.reviewSourceRow}>
            <Glasses size={14} color={colors.textMuted} />
            <Hand size={14} color={colors.textMuted} />
            <Text style={styles.reviewSourceText}>Captured from glasses + gloves</Text>
          </View>
          <Text style={styles.reviewTitle}>Recording ready</Text>
          <Text style={styles.reviewMeta}>{formatDuration(elapsed)} recorded</Text>
          <View style={styles.reviewActions}>
            <Button
              label="Delete"
              variant="secondary"
              icon={<Trash2 size={18} color={colors.textPrimary} />}
              onPress={handleDiscard}
              style={{ flex: 1 }}
            />
            <Button
              label="Upload"
              icon={<Upload size={18} color={colors.white} />}
              onPress={handleUpload}
              loading={busy}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.instructionsLabel}>How to record it</Text>
          <Text style={styles.instructions}>{entry.instructions}</Text>
          <View style={styles.gearNote}>
            <Glasses size={13} color={colors.textMuted} />
            <Hand size={13} color={colors.textMuted} />
            <Text style={styles.gearNoteText}>
              Recorded via your capture glasses + haptic gloves, not the phone camera.
            </Text>
          </View>

          <Text style={styles.tipsLabel}>Capture tips</Text>
          {CAPTURE_TIPS.map((tip) => (
            <Text key={tip} style={styles.tipText}>
              • {tip}
            </Text>
          ))}

          {displayStatus === "available" ? (
            <Button label="Start recording" onPress={handleStartRecording} style={{ marginTop: spacing.lg }} />
          ) : displayStatus === "uploaded" || displayStatus === "trained" ? (
            <View style={styles.statusCardSuccess}>
              <Check size={18} color={colors.success} />
              <Text style={styles.statusText}>Uploaded</Text>
            </View>
          ) : displayStatus === "training" ? (
            <View style={styles.statusCardSuccess}>
              <Check size={18} color={colors.success} />
              <Text style={styles.statusText}>Uploaded</Text>
            </View>
          ) : (
            <View style={styles.statusCard}>
              <Text style={styles.statusText}>That recording didn&apos;t go through. You can record again.</Text>
              <Button label="Record again" onPress={handleStartRecording} style={{ marginTop: spacing.md }} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  debugMirror: {
    backgroundColor: colors.black,
    padding: spacing.lg,
  },
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
  name: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
  },
  rewardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 4,
  },
  category: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  summary: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  instructionsLabel: {
    fontFamily: fonts.technical,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  instructions: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 23,
  },
  gearNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  gearNoteText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  tipsLabel: {
    fontFamily: fonts.technical,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.sandDark,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  tipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  statusCard: {
    backgroundColor: colors.sandSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  statusCardSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.successSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.success,
  },
  statusTextTraining: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.sandDark,
  },
  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  reviewSourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },
  reviewSourceText: {
    fontFamily: fonts.technical,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  reviewTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  reviewMeta: {
    fontFamily: fonts.technical,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  reviewActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: colors.black,
  },
  cameraOverlay: {
    // Normal flow now, not position:absolute filling the screen -- it needs
    // to take up exactly its own content height so the debug-mirror
    // sections below it are reachable by scrolling the ScrollView this is
    // now inside. liveRow below still positions absolute relative to this
    // box, same as before, just no longer pinned to the full device height.
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  liveRow: {
    position: "absolute",
    top: spacing.xxl,
    flexDirection: "row",
    gap: spacing.sm,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  liveBadgeText: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.recording,
    letterSpacing: 0.3,
  },
  liveBadgeTextPaused: {
    color: colors.textMuted,
  },
  // Side by side, same as Debug's own videoBox -- just tighter padding/gap
  // than Debug's Card-wrapped version (see the comment above videoSection)
  // so each square actually gets noticeably more width instead of losing
  // most of it to Card's padding.
  videoBox: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.xxl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.black,
  },
  // Visible as a square placeholder box even while its GlassesVideoPanel
  // child has no url yet and renders nothing -- otherwise an empty slot has
  // zero height and only the other, populated one is actually visible.
  // Explicit width %, not flex:1 -- flex:1 combined with aspectRatio on both
  // this box AND GlassesVideoPanel's own inner video box (also
  // width:'100%'/aspectRatio:1) was sizing the first one too large before
  // Yoga got to shrinking it, pushing the second one off the right edge of
  // the screen instead of actually splitting the row in half. 48%, not 50%
  // -- videoBox's own gap still needs a few px between the two, 50%+50%
  // with any gap at all overflows again.
  videoSlot: {
    width: "50%",
    aspectRatio: 1,
    borderRadius: radii.sm,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  connectingRow: {
    width: "82%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  logPanel: {
    width: "82%",
    maxHeight: 90,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: spacing.sm,
  },
  logLine: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: "rgba(255,255,255,0.55)",
    marginBottom: 2,
  },
  batteryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  batteryText: {
    fontFamily: fonts.technical,
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
  },
  previewLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.3,
    color: "rgba(255,255,255,0.45)",
  },
  cameraTimer: {
    fontFamily: fonts.technical,
    fontSize: 28,
    color: colors.white,
  },
  recordControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  recordButtonWrap: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  recordRing: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.recording,
    opacity: 0.4,
  },
  stopButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.recording,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.3)",
  },
  stopButtonDisabled: {
    opacity: 0.4,
  },
  cameraHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
  },
});
