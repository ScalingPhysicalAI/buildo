import { Mic } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../components/Card";
import { useRobot } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

// No real speech pipeline yet -- tapping the mic simulates listening, then
// "hears" one of these canned phrases. Swap this for a real on-device/cloud
// speech-to-text result once the voice pipeline exists; sendVoiceCommand
// itself already does the right thing either way (logs it locally for now).
const CANNED_PHRASES = [
  "Tidy up the living room",
  "Go charge yourself",
  "Bring me a glass of water",
  "Pause what you're doing",
  "Start the morning cleaning routine",
];

type Phase = "idle" | "listening" | "heard";

export default function VoiceScreen() {
  const insets = useSafeAreaInsets();
  const { voiceLog, sendVoiceCommand } = useRobot();
  const [phase, setPhase] = useState<Phase>("idle");
  const [heardText, setHeardText] = useState("");
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (phase !== "listening") {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.35, duration: 650, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);

  async function handlePress() {
    if (phase !== "idle") return;
    setPhase("listening");
    await new Promise((r) => setTimeout(r, 1600));
    const phrase = CANNED_PHRASES[Math.floor(Math.random() * CANNED_PHRASES.length)];
    setHeardText(phrase);
    setPhase("heard");
    await sendVoiceCommand(phrase);
    await new Promise((r) => setTimeout(r, 1400));
    setPhase("idle");
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Voice command</Text>
      <Text style={styles.subtitle}>Tap and speak -- your robot will carry it out.</Text>

      <View style={styles.micWrap}>
        <Pressable onPress={handlePress} disabled={phase !== "idle"}>
          <Animated.View style={[styles.micRing, { transform: [{ scale: pulse }] }]} />
          <View style={[styles.micButton, phase !== "idle" && styles.micButtonActive]}>
            <Mic size={32} color={phase !== "idle" ? colors.white : colors.sandDark} />
          </View>
        </Pressable>
        <Text style={styles.micHint}>
          {phase === "listening" ? "Listening..." : phase === "heard" ? `Heard: "${heardText}"` : "Tap to speak"}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Recent commands</Text>
      {voiceLog.length === 0 ? (
        <Text style={styles.emptyText}>Nothing yet -- try giving your robot a command above.</Text>
      ) : (
        voiceLog.map((entry) => (
          <Card key={entry.id} style={styles.logRow}>
            <Text style={styles.logText}>{entry.text}</Text>
            <Text style={styles.logTime}>{new Date(entry.at).toLocaleTimeString()}</Text>
          </Card>
        ))
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
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  micWrap: {
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  micRing: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.sandLight,
    alignSelf: "center",
    opacity: 0.5,
  },
  micButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.sandSurface,
    borderWidth: 1,
    borderColor: colors.sandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  micButtonActive: {
    backgroundColor: colors.sandDark,
    borderColor: colors.sandDark,
  },
  micHint: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: "center",
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  logText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  logTime: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
  },
});
