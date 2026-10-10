import { router, useFocusEffect } from "expo-router";
import { ChevronRight, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../../components/Card";
import { StatusPill } from "../../../components/StatusPill";
import { Alert } from "../../../lib/alert";
import { useSkills } from "../../../lib/skills-context";
import type { AppDeployStatus, AppListing } from "../../../lib/skills-api";
import { colors, fonts, radii, spacing } from "../../../theme";

const STATUS_TONE: Record<AppDeployStatus, "neutral" | "success" | "warning" | "error"> = {
  DRAFT: "neutral",
  TESTING: "warning",
  PASSED: "success",
  FAILED: "error",
  LIVE: "success",
};

function AppCard({ app }: { app: AppListing }) {
  const { deleteApp } = useSkills();
  const [deleting, setDeleting] = useState(false);

  function confirmDelete() {
    Alert.alert("Delete this app?", `"${app.name}" will be permanently deleted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteApp(app.id);
          } catch (err) {
            Alert.alert("Couldn't delete app", err instanceof Error ? err.message : "Try again.");
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <Pressable onPress={() => router.push(`/build/${app.id}`)}>
      <Card style={styles.appCard}>
        <View style={styles.appCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.appName}>{app.name}</Text>
            <Text style={styles.appMeta}>
              {app.category} · {app.skills.length} skill{app.skills.length === 1 ? "" : "s"}
            </Text>
          </View>
          <Pressable onPress={confirmDelete} disabled={deleting} hitSlop={8} style={styles.deleteBtn}>
            {deleting ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Trash2 size={16} color={colors.textMuted} />
            )}
          </Pressable>
          <ChevronRight size={18} color={colors.textMuted} />
        </View>
        <StatusPill label={app.status} tone={STATUS_TONE[app.status]} />
      </Card>
    </Pressable>
  );
}

export default function BuildScreen() {
  const insets = useSafeAreaInsets();
  const { apps, refreshApps } = useSkills();

  useFocusEffect(
    useCallback(() => {
      refreshApps().catch(() => {});
    }, [refreshApps])
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Your apps</Text>
      <Text style={styles.subtitle}>Apps you've created from your trained skills.</Text>

      {apps.length === 0 ? (
        <Text style={styles.emptyText}>Apps you create from a use case in the Train tab will show up here.</Text>
      ) : (
        apps.map((app) => <AppCard key={app.id} app={app} />)
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
  appCard: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  appCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundAlt,
  },
  appName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  appMeta: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
});
