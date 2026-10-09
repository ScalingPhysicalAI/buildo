import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Check, Download, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Alert } from "../../lib/alert";
import { useSkills } from "../../lib/skills-context";
import { colors, fonts, radii, spacing } from "../../theme";

function closeOrGoStore() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/build");
  }
}

export default function StoreAppDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { appStore, installApp } = useSkills();
  const [busy, setBusy] = useState(false);

  const app = appStore.find((a) => a.id === id);
  if (!app) return <Redirect href="/(app)/build" />;

  async function handleInstall() {
    setBusy(true);
    try {
      await installApp(app!.id);
    } catch (err) {
      Alert.alert("Couldn't install", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoStore} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.name}>{app.name}</Text>
      <Text style={styles.meta}>
        {app.category} · by {app.user.name}
      </Text>

      <View style={styles.downloadsRow}>
        <Download size={14} color={colors.textMuted} />
        <Text style={styles.downloadsText}>
          {app.installCount} install{app.installCount === 1 ? "" : "s"}
        </Text>
      </View>

      {app.description ? <Text style={styles.description}>{app.description}</Text> : null}

      <Text style={styles.sectionTitle}>What this app can do</Text>
      {app.skills.map((s) => (
        <View key={s.id} style={styles.skillRow}>
          <Text style={styles.skillName}>{s.skillCollection.skill.name}</Text>
          <Text style={styles.skillSummary}>{s.skillCollection.skill.summary}</Text>
        </View>
      ))}

      {app.installedByMe ? (
        <View style={styles.installedBanner}>
          <Check size={18} color={colors.success} />
          <Text style={styles.installedText}>Installed</Text>
        </View>
      ) : (
        <Button label="Install" onPress={handleInstall} loading={busy} style={{ marginTop: spacing.xl }} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
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
  meta: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  downloadsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.sm,
  },
  downloadsText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  skillRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 2,
  },
  skillName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  skillSummary: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  installedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.successSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.xl,
  },
  installedText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.success,
  },
});
