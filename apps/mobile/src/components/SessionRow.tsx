import { router } from "expo-router";
import { Check, Trash, Upload, Video } from "lucide-react-native";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { formatDuration, formatRelativeTime } from "../lib/format";
import { useSessions, type Session } from "../lib/sessions-context";
import { colors, fonts, radii, spacing } from "../theme";

export function SessionRow({ session }: { session: Session }) {
  const { deleteSession, uploadSession } = useSessions();

  function confirmDelete() {
    Alert.alert(
      "Delete recording?",
      `"${session.skillName}" will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteSession(session.id) },
      ]
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push(`/session/${session.id}`)}
    >
      <View style={styles.thumb}>
        <Video size={18} color={colors.sandDark} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.skillName} numberOfLines={1}>
          {session.skillName}
        </Text>
        <Text style={styles.meta}>
          {formatRelativeTime(session.createdAt)} · {formatDuration(session.durationSeconds)}
        </Text>
      </View>

      {session.status === "uploaded" ? (
        <View style={[styles.actionBtn, styles.uploadedBtn]}>
          <Check size={16} color={colors.success} />
        </View>
      ) : session.status === "uploading" ? (
        <View style={styles.actionBtn}>
          <ActivityIndicator size="small" color={colors.sandDark} />
        </View>
      ) : (
        <Pressable style={styles.actionBtn} onPress={() => uploadSession(session.id)} hitSlop={8}>
          <Upload size={16} color={colors.sandDark} />
        </Pressable>
      )}

      <Pressable style={styles.actionBtn} onPress={confirmDelete} hitSlop={8}>
        <Trash size={16} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  rowPressed: {
    opacity: 0.85,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  skillName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundAlt,
  },
  uploadedBtn: {
    backgroundColor: colors.successSurface,
  },
});
