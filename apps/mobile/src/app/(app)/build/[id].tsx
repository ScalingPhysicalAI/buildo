import { router, useLocalSearchParams } from "expo-router";
import { Check, Download, DollarSign, X } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../../components/Button";
import { Card } from "../../../components/Card";
import { StatusPill } from "../../../components/StatusPill";
import { useSkills } from "../../../lib/skills-context";
import type { AppDeployStatus } from "../../../lib/skills-api";
import { colors, fonts, radii, spacing } from "../../../theme";

const DEPLOY_FEE = 50;

const STATUS_TONE: Record<AppDeployStatus, "neutral" | "success" | "warning" | "error"> = {
  DRAFT: "neutral",
  TESTING: "warning",
  PASSED: "success",
  FAILED: "error",
  LIVE: "success",
};

function closeOrGoHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/build");
  }
}

export default function AppDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { apps, deployApp, publishApp } = useSkills();
  const [busy, setBusy] = useState(false);

  const app = apps.find((a) => a.id === id);
  if (!app) return null;

  async function handleCertify() {
    setBusy(true);
    try {
      await deployApp(app!.id);
    } catch (err) {
      Alert.alert("Certification failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handlePublish() {
    Alert.alert(
      "Publish this app?",
      `You'll be charged a one-time $${DEPLOY_FEE} deploy fee and it'll go live on the Buildo app store.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Pay $${DEPLOY_FEE} and publish`,
          onPress: async () => {
            setBusy(true);
            try {
              await publishApp(app!.id);
            } catch (err) {
              Alert.alert("Publish failed", err instanceof Error ? err.message : "Try again.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  const canCertify = app.status === "DRAFT" || app.status === "FAILED";
  const canPublish = app.status === "PASSED";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoHome} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.name}>{app.name}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.category}>{app.category}</Text>
        <StatusPill label={app.status} tone={STATUS_TONE[app.status]} />
      </View>
      {app.description ? <Text style={styles.description}>{app.description}</Text> : null}

      <Text style={styles.sectionTitle}>Skills in this app</Text>
      {app.skills.map((s) => (
        <View key={s.id} style={styles.skillRow}>
          <Text style={styles.skillName}>{s.skillCollection.skill.name}</Text>
        </View>
      ))}

      {canCertify ? (
        <Button
          label={app.status === "FAILED" ? "Re-run certification" : "Run certification"}
          onPress={handleCertify}
          loading={busy}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}

      {canPublish ? (
        <Button
          label={`Pay $${DEPLOY_FEE} and publish`}
          onPress={handlePublish}
          loading={busy}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}

      {app.testReport ? (
        <Card style={styles.reportCard}>
          <Text style={styles.sectionTitle}>Certification report</Text>
          {app.testReport.checks.map((check) => (
            <View key={check.id} style={styles.checkRow}>
              {check.passed ? (
                <Check size={16} color={colors.success} />
              ) : (
                <X size={16} color={colors.error} />
              )}
              <Text style={styles.checkLabel}>{check.label}</Text>
            </View>
          ))}
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Estimated task success rate</Text>
            <Text style={styles.metricValue}>{app.testReport.metrics.taskSuccessRate}%</Text>
          </View>
        </Card>
      ) : null}

      {app.status === "LIVE" ? (
        <>
          <View style={styles.liveBanner}>
            <Check size={18} color={colors.success} />
            <Text style={styles.liveBannerText}>Live on the Buildo app store</Text>
          </View>
          <View style={styles.statsRow}>
            <Card style={styles.statCard}>
              <Download size={16} color={colors.sandDark} />
              <Text style={styles.statValue}>{app.installCount}</Text>
              <Text style={styles.statLabel}>Downloads</Text>
            </Card>
            <Card style={styles.statCard}>
              <DollarSign size={16} color={colors.sandDark} />
              <Text style={styles.statValue}>${app.earnings}</Text>
              <Text style={styles.statLabel}>Earnings</Text>
            </Card>
          </View>
        </>
      ) : null}
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  category: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  skillRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  skillName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  reportCard: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  checkLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textPrimary,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metricLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  metricValue: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.successSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  liveBannerText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.success,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.black,
  },
  statLabel: {
    fontFamily: fonts.technical,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
});
