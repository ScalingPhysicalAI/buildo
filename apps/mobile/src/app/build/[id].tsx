import { router, useLocalSearchParams } from "expo-router";
import { Check, Clock3, Download, DollarSign, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { StatusPill } from "../../components/StatusPill";
import { Alert } from "../../lib/alert";
import { useSkills } from "../../lib/skills-context";
import type { AppDeployStatus } from "../../lib/skills-api";
import { colors, fonts, radii, spacing } from "../../theme";

const STATUS_TONE: Record<AppDeployStatus, "neutral" | "success" | "warning" | "error"> = {
  DRAFT: "neutral",
  TESTING: "warning",
  PASSED: "success",
  FAILED: "error",
  LIVE: "success",
};

function closeOrGoBuild() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/build");
  }
}

export default function AppDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { apps, deployApp } = useSkills();
  const [busy, setBusy] = useState(false);

  const app = apps.find((a) => a.id === id);
  if (!app) return null;

  function handleTrainAndDeploy() {
    Alert.alert(
      "Test and deploy this app?",
      "You'll be charged a one-time $5 fee to test and deploy it to the Buildo app store.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Pay $5 and deploy",
          onPress: async () => {
            setBusy(true);
            try {
              await deployApp(app!.id);
            } catch (err) {
              Alert.alert(
                "Couldn't start training and deployment",
                err instanceof Error ? err.message : "Please try again."
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  const canDeploy = app.status === "DRAFT" || app.status === "FAILED";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoBuild} style={styles.closeBtn} hitSlop={12}>
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

      {canDeploy ? (
        <Button
          label={app.status === "FAILED" ? "Retry training and deployment" : "Train and Deploy"}
          onPress={handleTrainAndDeploy}
          loading={busy}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}

      {app.status === "TESTING" ? (
        <View style={styles.testingCard}>
          <View style={styles.testingRow}>
            <Clock3 size={18} color={colors.sandDark} />
            <Text style={styles.testingTitle}>Testing in progress</Text>
          </View>
          <Text style={styles.testingNote}>
            Testing typically takes up to seven days. You&apos;re welcome to check back at any time to view your
            results and rewards.
          </Text>
        </View>
      ) : null}

      {app.status === "LIVE" ? (
        <>
          <View style={styles.liveBanner}>
            <Check size={18} color={colors.success} />
            <Text style={styles.liveBannerText}>
              Your app has been successfully deployed to the Buildo App Store. You will earn rewards each time a
              user installs and uses your app.
            </Text>
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
  testingCard: {
    backgroundColor: colors.sandSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  testingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  testingTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.sandDark,
  },
  testingNote: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  liveBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.successSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  liveBannerText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.success,
    lineHeight: 20,
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
