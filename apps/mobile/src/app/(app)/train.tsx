import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../components/Card";
import { StatusPill } from "../../components/StatusPill";
import { formatTimeLeft, getDisplayStatus, type DisplayStatus } from "../../lib/skill-status";
import { useSkills } from "../../lib/skills-context";
import type { SkillCatalogEntry } from "../../lib/skills-api";
import { colors, fonts, radii, spacing } from "../../theme";

const STATUS_LABEL: Record<DisplayStatus, string> = {
  available: "Record for $",
  uploaded: "Ready to train",
  training: "Training",
  trained: "Trained",
  failed: "Failed",
};

const STATUS_TONE: Record<DisplayStatus, "neutral" | "success" | "warning" | "error"> = {
  available: "neutral",
  uploaded: "warning",
  training: "warning",
  trained: "success",
  failed: "error",
};

function SkillCard({ entry }: { entry: SkillCatalogEntry }) {
  const status = getDisplayStatus(entry.collection);
  const label =
    status === "training"
      ? formatTimeLeft(entry.collection?.trainEndsAt ?? null)
      : status === "available"
        ? `Record for $${entry.reward}`
        : STATUS_LABEL[status];

  return (
    <Pressable onPress={() => router.push(`/skill/${entry.slug}`)}>
      <Card style={styles.skillCard}>
        <View style={styles.skillCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.skillName}>{entry.name}</Text>
            <Text style={styles.skillCategory}>{entry.category}</Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </View>
        <Text style={styles.skillSummary}>{entry.summary}</Text>
        <StatusPill label={label} tone={STATUS_TONE[status]} />
      </Card>
    </Pressable>
  );
}

export default function RecordScreen() {
  const insets = useSafeAreaInsets();
  const { catalog, isLoading } = useSkills();

  const trainedCount = catalog.filter((s) => getDisplayStatus(s.collection) === "trained").length;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Record a skill</Text>
      <Text style={styles.subtitle}>
        Pick a skill below, follow the instructions, and record yourself performing it to earn $ credit.
      </Text>

      {trainedCount > 0 ? (
        <Pressable onPress={() => router.push("/(app)/build")}>
          <View style={styles.trainedBanner}>
            <Text style={styles.trainedBannerText}>
              {trainedCount} skill{trainedCount === 1 ? "" : "s"} trained — build an app with them
            </Text>
            <ChevronRight size={16} color={colors.sandDark} />
          </View>
        </Pressable>
      ) : null}

      {isLoading && catalog.length === 0 ? (
        <Text style={styles.emptyText}>Loading skills…</Text>
      ) : catalog.length === 0 ? (
        <Text style={styles.emptyText}>No skills available right now — check back soon.</Text>
      ) : (
        catalog.map((entry) => <SkillCard key={entry.id} entry={entry} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
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
    marginBottom: spacing.sm,
    lineHeight: 20,
  },
  trainedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.sandSurface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.sandLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  trainedBannerText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.sandDark,
    flex: 1,
  },
  skillCard: {
    gap: spacing.sm,
  },
  skillCardTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  skillName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  skillCategory: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
    marginTop: 2,
  },
  skillSummary: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
});
