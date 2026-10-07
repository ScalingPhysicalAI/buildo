import { router } from "expo-router";
import { Square, TriangleAlert, Glasses, Hand } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SessionRow } from "../../components/SessionRow";
import { TextField } from "../../components/TextField";
import { useDevices } from "../../lib/device-context";
import { formatDuration } from "../../lib/format";
import { useSessions } from "../../lib/sessions-context";
import { colors, fonts, radii, spacing } from "../../theme";

export default function RecordScreen() {
  const devices = useDevices();
  const insets = useSafeAreaInsets();
  const { sessions, addSession } = useSessions();
  const allConnected = devices.glasses === "connected" && devices.gloves === "connected" && devices.buildo === "connected";

  const [skillName, setSkillName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  const ring = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) {
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
  }, [isRecording]);

  function handleToggleRecord() {
    if (!isRecording) {
      setIsRecording(true);
      setElapsed(0);
      setJustSaved(false);
    } else {
      setIsRecording(false);
      addSession(skillName.trim(), elapsed);
      setSkillName("");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2400);
    }
  }

  if (!allConnected) {
    return (
      <View style={[styles.gate, { paddingTop: insets.top }]}>
        <TriangleAlert size={40} color={colors.sandDark} />
        <Text style={styles.gateTitle}>Pair your gear first</Text>
        <Text style={styles.gateSubtitle}>Glasses, gloves, and Buildo all need to be connected before you can record.</Text>
        <Pressable style={styles.gateButton} onPress={() => router.push("/(app)/pair")}>
          <Text style={styles.gateButtonText}>Go to Devices</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Record an episode</Text>
      <Text style={styles.subtitle}>Name the skill, then record yourself performing it once, start to finish.</Text>

      <TextField
        label="Skill name"
        placeholder="e.g. Pour coffee into mug"
        value={skillName}
        onChangeText={setSkillName}
        editable={!isRecording}
      />

      <View style={styles.liveRow}>
        <View style={styles.liveBadge}>
          <Glasses size={14} color={isRecording ? colors.recording : colors.textMuted} />
          <Text style={[styles.liveBadgeText, isRecording && styles.liveBadgeTextActive]}>
            {isRecording ? "Streaming" : "Idle"}
          </Text>
        </View>
        <View style={styles.liveBadge}>
          <Hand size={14} color={isRecording ? colors.recording : colors.textMuted} />
          <Text style={[styles.liveBadgeText, isRecording && styles.liveBadgeTextActive]}>
            {isRecording ? "Streaming" : "Idle"}
          </Text>
        </View>
      </View>

      <View style={styles.recordArea}>
        <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
        <Pressable
          onPress={handleToggleRecord}
          disabled={!skillName.trim() && !isRecording}
          style={styles.recordButtonWrap}
        >
          <Animated.View
            style={[styles.recordRing, { transform: [{ scale: ring }], opacity: isRecording ? 0.5 : 0 }]}
          />
          <View style={[styles.recordButton, !skillName.trim() && !isRecording && styles.recordButtonDisabled]}>
            {isRecording ? (
              <Square size={28} color={colors.white} fill={colors.white} />
            ) : (
              <View style={styles.recordDot} />
            )}
          </View>
        </Pressable>
        <Text style={styles.recordHint}>
          {isRecording ? "Tap to stop and save" : !skillName.trim() ? "Enter a skill name to begin" : "Tap to start recording"}
        </Text>
        {justSaved ? <Text style={styles.savedText}>Episode saved ✓</Text> : null}
      </View>

      <View style={styles.sessionsHeader}>
        <Text style={styles.sessionsTitle}>Your recordings</Text>
        {sessions.length > 0 ? <Text style={styles.sessionsCount}>{sessions.length}</Text> : null}
      </View>

      {sessions.length === 0 ? (
        <Text style={styles.emptyText}>Recordings you save will show up here, ready to review and upload.</Text>
      ) : (
        sessions.map((s) => <SessionRow key={s.id} session={s} />)
      )}
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
  liveRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  liveBadgeText: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  liveBadgeTextActive: {
    color: colors.recording,
  },
  recordArea: {
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  timer: {
    fontFamily: fonts.technical,
    fontSize: 28,
    color: colors.textPrimary,
    marginBottom: spacing.md,
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
  },
  recordButton: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.recording,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.surface,
  },
  recordButtonDisabled: {
    backgroundColor: colors.textMuted,
    opacity: 0.5,
  },
  recordDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
  },
  recordHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  savedText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.success,
    marginTop: spacing.sm,
  },
  sessionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sessionsTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  sessionsCount: {
    fontFamily: fonts.technical,
    fontSize: 12,
    color: colors.sandDark,
    backgroundColor: colors.sandSurface,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  gate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  gateTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.black,
    marginTop: spacing.md,
  },
  gateSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  gateButton: {
    backgroundColor: colors.black,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  gateButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.white,
  },
});
