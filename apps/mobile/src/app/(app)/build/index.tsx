import { router } from "expo-router";
import { Check, ChevronRight, Download, Plus } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../../components/Button";
import { Card } from "../../../components/Card";
import { StatusPill } from "../../../components/StatusPill";
import { getDisplayStatus } from "../../../lib/skill-status";
import { useSkills } from "../../../lib/skills-context";
import type { AppDeployStatus, AppListing, AppStoreListing } from "../../../lib/skills-api";
import { colors, fonts, radii, spacing } from "../../../theme";

const STATUS_TONE: Record<AppDeployStatus, "neutral" | "success" | "warning" | "error"> = {
  DRAFT: "neutral",
  TESTING: "warning",
  PASSED: "success",
  FAILED: "error",
  LIVE: "success",
};

function AppCard({ app }: { app: AppListing }) {
  return (
    <Pressable onPress={() => router.push(`/(app)/build/${app.id}`)}>
      <Card style={styles.appCard}>
        <View style={styles.appCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.appName}>{app.name}</Text>
            <Text style={styles.appMeta}>
              {app.category} · {app.skills.length} skill{app.skills.length === 1 ? "" : "s"}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </View>
        <StatusPill label={app.status} tone={STATUS_TONE[app.status]} />
      </Card>
    </Pressable>
  );
}

function StoreCard({ app }: { app: AppStoreListing }) {
  const { installApp } = useSkills();
  const [busy, setBusy] = useState(false);

  async function handleInstall() {
    setBusy(true);
    try {
      await installApp(app.id);
    } catch (err) {
      Alert.alert("Couldn't install", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.appCard}>
      <View style={styles.appCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.appName}>{app.name}</Text>
          <Text style={styles.appMeta}>
            {app.category} · by {app.user.name} · {app.skills.length} skill{app.skills.length === 1 ? "" : "s"}
          </Text>
        </View>
      </View>
      {app.description ? <Text style={styles.appDescription}>{app.description}</Text> : null}
      <View style={styles.storeCardFooter}>
        <View style={styles.downloadsRow}>
          <Download size={13} color={colors.textMuted} />
          <Text style={styles.downloadsText}>{app.installCount} installs</Text>
        </View>
        {app.installedByMe ? (
          <View style={styles.installedRow}>
            <Check size={14} color={colors.success} />
            <Text style={styles.installedText}>Installed</Text>
          </View>
        ) : (
          <Button label="Install" onPress={handleInstall} loading={busy} style={styles.installBtn} />
        )}
      </View>
    </Card>
  );
}

export default function BuildScreen() {
  const insets = useSafeAreaInsets();
  const { catalog, apps, appStore } = useSkills();
  const [tab, setTab] = useState<"mine" | "store">("mine");

  const trainedCount = catalog.filter((s) => getDisplayStatus(s.collection) === "trained").length;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Build an app</Text>
      <Text style={styles.subtitle}>
        Bundle your trained skills into an app, run it through automated certification, and publish it.
      </Text>

      <View style={styles.tabRow}>
        <Pressable onPress={() => setTab("mine")} style={[styles.tabChip, tab === "mine" && styles.tabChipActive]}>
          <Text style={[styles.tabChipText, tab === "mine" && styles.tabChipTextActive]}>My apps</Text>
        </Pressable>
        <Pressable onPress={() => setTab("store")} style={[styles.tabChip, tab === "store" && styles.tabChipActive]}>
          <Text style={[styles.tabChipText, tab === "store" && styles.tabChipTextActive]}>App store</Text>
        </Pressable>
      </View>

      {tab === "mine" ? (
        <>
          <Card style={styles.summaryCard}>
            <View>
              <Text style={styles.summaryLabel}>Trained skills</Text>
              <Text style={styles.summaryValue}>{trainedCount}</Text>
            </View>
            <Button
              label="New app"
              icon={<Plus size={18} color={colors.white} />}
              onPress={() => router.push("/(app)/build/new")}
              disabled={trainedCount === 0}
              style={styles.newAppBtn}
            />
          </Card>
          {trainedCount === 0 ? (
            <Text style={styles.hintText}>Train at least one skill in the Record tab to start building an app.</Text>
          ) : null}

          <Text style={styles.sectionTitle}>Your apps</Text>
          {apps.length === 0 ? (
            <Text style={styles.emptyText}>Apps you create will show up here.</Text>
          ) : (
            apps.map((app) => <AppCard key={app.id} app={app} />)
          )}
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Live on the Buildo app store</Text>
          {appStore.length === 0 ? (
            <Text style={styles.emptyText}>No apps published yet — be the first to deploy one.</Text>
          ) : (
            appStore.map((app) => <StoreCard key={app.id} app={app} />)
          )}
        </>
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
  tabRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tabChip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  tabChipActive: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  tabChipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  tabChipTextActive: {
    color: colors.white,
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  summaryLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  summaryValue: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
    marginTop: 2,
  },
  newAppBtn: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  hintText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  appCard: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  appCardTop: {
    flexDirection: "row",
    alignItems: "center",
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
  appDescription: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  storeCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  downloadsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  downloadsText: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
  },
  installedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  installedText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.success,
  },
  installBtn: {
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
});
