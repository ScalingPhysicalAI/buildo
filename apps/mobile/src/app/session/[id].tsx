import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Check, Play, Upload, X } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { useAuth } from "../../lib/auth-context";
import { formatDuration, formatRelativeTime } from "../../lib/format";
import { useSessions } from "../../lib/sessions-context";
import { colors, fonts, radii, spacing } from "../../theme";

// Expo Go reopens a project at whatever path you were last on, not
// necessarily the app's real root -- if that was this screen (e.g. mid-
// testing) and the in-memory session it pointed at is gone after a reload
// (sessions are in-memory only, see sessions-context.tsx), there's nothing
// here to show. Redirect straight to the normal landing spot instead of a
// dead-end "not found" screen with its own close button -- same place
// index.tsx sends a cold start to, so this never strands anyone.
function closeOrGoHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)");
  }
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getSession, uploadSession } = useSessions();
  const { user, isLoading } = useAuth();
  const insets = useSafeAreaInsets();
  const session = getSession(id);

  if (!session) {
    if (isLoading) return null;
    return <Redirect href={user ? "/(app)" : "/signup"} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Pressable onPress={closeOrGoHome} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      {/* No real video capture wired up yet (see DeviceProvider/SessionsProvider
          headers) -- this is what playback looks like once glasses footage is
          actually recorded and stored. */}
      <View style={styles.videoPlaceholder}>
        <View style={styles.playButton}>
          <Play size={28} color={colors.white} fill={colors.white} />
        </View>
        <Text style={styles.videoHint}>Preview not available in this build</Text>
      </View>

      <Text style={styles.skillName}>{session.skillName}</Text>
      <Text style={styles.meta}>
        {formatRelativeTime(session.createdAt)} · {formatDuration(session.durationSeconds)}
      </Text>

      {session.status === "uploaded" ? (
        <View style={styles.uploadedRow}>
          <Check size={18} color={colors.success} />
          <Text style={styles.uploadedText}>Uploaded to your account</Text>
        </View>
      ) : session.status === "uploading" ? (
        <Button label="Uploading…" variant="secondary" onPress={() => {}} loading style={{ marginTop: spacing.lg }} />
      ) : (
        <Button
          label="Upload"
          icon={<Upload size={18} color={colors.white} />}
          onPress={() => uploadSession(session.id)}
          style={{ marginTop: spacing.lg }}
        />
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
  videoPlaceholder: {
    aspectRatio: 16 / 10,
    borderRadius: radii.lg,
    backgroundColor: colors.black,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
  },
  skillName: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  uploadedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.successSurface,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  uploadedText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.success,
  },
});
