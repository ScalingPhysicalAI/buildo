// Recording happens via the capture glasses + haptic gloves (BLE pairing,
// video + IMU streamed to this phone over wifi) -- not the phone's own
// camera. The real glasses/gloves capture -> upload pipeline (see
// ../../lib/glasses/*) isn't wired into this flow yet, so this screen shows
// the full shape (record -> review -> upload -> train -> trained) with a
// timed stand-in for the capture itself, same pattern as the old
// sessions-context recorder it replaces.
import { Redirect, router, useLocalSearchParams } from "expo-router";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Glasses,
  Hand,
  Pause,
  Play,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Alert } from "../../lib/alert";
import { useDevices } from "../../lib/device-context";
import { formatDuration } from "../../lib/format";
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

// Paid skills must record at least this long before Stop is allowed -- the
// backend enforces the same minimum on upload, so this is UX, not the only
// gate. Custom (unpaid) skills have no minimum.
const MIN_PAID_RECORDING_SECONDS = 120;

export default function SkillDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { catalog, recordUpload } = useSkills();
  const devices = useDevices();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>("instructions");
  const [elapsed, setElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraPosition, setCameraPosition] = useState<"up" | "down" | null>(null);
  const ring = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (phase !== "recording" || isPaused) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [phase, isPaused]);

  useEffect(() => {
    if (phase !== "recording" || isPaused) {
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
  }, [phase, isPaused]);

  const entry = catalog.find((s) => s.slug === slug);
  if (!entry) return <Redirect href="/(app)/train" />;

  const displayStatus = getDisplayStatus(entry.collection);
  const minRecordingSeconds = entry.reward > 0 ? MIN_PAID_RECORDING_SECONDS : 0;
  const canStop = elapsed >= minRecordingSeconds;

  function handleStartRecording() {
    const gearConnected = devices.glasses === "connected" && devices.gloves === "connected";
    if (!gearConnected) {
      Alert.alert("Glasses and gloves are not connected", "Pair your capture glasses and haptic gloves before recording.", [
        { text: "Cancel", style: "cancel" },
        { text: "Connect", onPress: () => router.push("/(app)/pair") },
      ]);
      return;
    }
    setElapsed(0);
    setIsPaused(false);
    setCameraPosition(null);
    setPhase("recording");
  }

  function handleCameraPosition(position: "up" | "down") {
    setCameraPosition((current) => (current === position ? null : position));
  }

  function handlePauseResume() {
    setIsPaused((p) => !p);
  }

  function handleStopRecording() {
    if (!canStop) return;
    setIsPaused(false);
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
    return (
      <View style={styles.cameraContainer}>
        <View style={[styles.cameraOverlay, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.liveRow}>
            <View style={styles.liveBadge}>
              <Glasses size={14} color={isPaused ? colors.textMuted : colors.recording} />
              <Text style={[styles.liveBadgeText, isPaused && styles.liveBadgeTextPaused]}>
                {isPaused ? "Paused" : "Streaming"}
              </Text>
            </View>
            <View style={styles.liveBadge}>
              <Hand size={14} color={isPaused ? colors.textMuted : colors.recording} />
              <Text style={[styles.liveBadgeText, isPaused && styles.liveBadgeTextPaused]}>
                {isPaused ? "Paused" : "Streaming"}
              </Text>
            </View>
          </View>

          <View style={styles.cameraPositionRow}>
            <Pressable
              onPress={() => handleCameraPosition("up")}
              style={[styles.cameraPositionBtn, cameraPosition === "up" && styles.cameraPositionBtnActive]}
            >
              <ArrowUp size={16} color={cameraPosition === "up" ? colors.black : colors.white} />
              <Text style={[styles.cameraPositionText, cameraPosition === "up" && styles.cameraPositionTextActive]}>
                Camera up
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleCameraPosition("down")}
              style={[styles.cameraPositionBtn, cameraPosition === "down" && styles.cameraPositionBtnActive]}
            >
              <ArrowDown size={16} color={cameraPosition === "down" ? colors.black : colors.white} />
              <Text
                style={[styles.cameraPositionText, cameraPosition === "down" && styles.cameraPositionTextActive]}
              >
                Camera down
              </Text>
            </Pressable>
          </View>

          <View style={styles.previewBox}>
            <Animated.View style={[styles.previewPulseDot, { transform: [{ scale: ring }] }]} />
            <Glasses size={36} color="rgba(255,255,255,0.35)" strokeWidth={1.2} />
            <Text style={styles.previewLabel}>{isPaused ? "Preview paused" : "Live preview from glasses"}</Text>
          </View>

          <Text style={styles.cameraTimer}>{formatDuration(elapsed)}</Text>
          <View style={styles.recordControlsRow}>
            <Pressable onPress={handlePauseResume} style={styles.pauseButton}>
              {isPaused ? (
                <Play size={22} color={colors.white} fill={colors.white} />
              ) : (
                <Pause size={22} color={colors.white} fill={colors.white} />
              )}
            </Pressable>
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
              : isPaused
                ? "Tap play to resume"
                : "Tap pause or stop"}
          </Text>
        </View>
      </View>
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
        {entry.reward > 0 ? <Text style={styles.reward}>${entry.reward} per install, once in an app</Text> : null}
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
              <Text style={styles.statusText}>
                {entry.reward > 0 ? `Uploaded — earns $${entry.reward} per install once in an app` : "Uploaded"}
              </Text>
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
  reward: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.sandDark,
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
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  liveRow: {
    position: "absolute",
    top: spacing.md,
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
  cameraPositionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  cameraPositionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm + 2,
  },
  cameraPositionBtnActive: {
    backgroundColor: colors.skin,
  },
  cameraPositionText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.white,
  },
  cameraPositionTextActive: {
    color: colors.black,
  },
  previewBox: {
    width: "82%",
    aspectRatio: 4 / 3,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  previewPulseDot: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.recording,
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
  pauseButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
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
