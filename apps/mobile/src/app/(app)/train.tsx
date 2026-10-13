import { router, useFocusEffect } from "expo-router";
import { Briefcase, ChevronRight, Hospital, House, Store, Warehouse } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../components/Card";
import { formatUSD } from "../../lib/format";
import { useSkills } from "../../lib/skills-context";
import { USE_CASES, estimatedIncome, type UseCase } from "../../lib/use-cases";
import type { SkillCatalogEntry } from "../../lib/skills-api";
import { colors, fonts, radii, spacing } from "../../theme";

const USE_CASE_ICON: Record<UseCase["key"], typeof House> = {
  HOME: House,
  SHOP: Store,
  OFFICE: Briefcase,
  WAREHOUSE: Warehouse,
  HOSPITAL: Hospital,
};

function useCaseProgress(useCase: UseCase, catalog: SkillCatalogEntry[]) {
  const total = useCase.skillSlugs.length;
  const done = useCase.skillSlugs.filter((slug) => {
    const entry = catalog.find((s) => s.slug === slug);
    return !!entry?.collection && entry.collection.status !== "FAILED";
  }).length;
  return { done, total };
}

function UseCaseCard({ useCase, catalog }: { useCase: UseCase; catalog: SkillCatalogEntry[] }) {
  const { done, total } = useCaseProgress(useCase, catalog);
  const Icon = USE_CASE_ICON[useCase.key];
  const complete = done === total;

  return (
    <Pressable onPress={() => router.push(`/use-case/${useCase.key}`)}>
      <Card style={styles.useCaseCard}>
        <View style={styles.useCaseIcon}>
          <Icon size={22} color={colors.sandDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.useCaseTitle}>{useCase.title}</Text>
          <Text style={styles.useCaseDescription}>{useCase.description}</Text>
          <View style={styles.useCaseMetaRow}>
            <Text style={styles.useCaseIncome}>{formatUSD(estimatedIncome(useCase))}/month</Text>
            <Text style={[styles.useCaseProgress, complete && styles.useCaseProgressDone]}>
              {done}/{total} skills
            </Text>
          </View>
        </View>
        <ChevronRight size={18} color={colors.textMuted} />
      </Card>
    </Pressable>
  );
}

export default function TrainScreen() {
  const insets = useSafeAreaInsets();
  const { catalog, isLoading, refreshCatalog } = useSkills();

  useFocusEffect(
    useCallback(() => {
      refreshCatalog().catch(() => {});
    }, [refreshCatalog])
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>Pick the robot app</Text>
      <Text style={styles.subtitle}>Pick the Buildo app you want to create, then train the skills it needs.</Text>

      {isLoading && catalog.length === 0 ? (
        <Text style={styles.emptyText}>Loading…</Text>
      ) : (
        USE_CASES.map((useCase) => (
          <UseCaseCard key={useCase.key} useCase={useCase} catalog={catalog} />
        ))
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
  useCaseCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  useCaseIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  useCaseTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  useCaseDescription: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  useCaseMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 6,
  },
  useCaseIncome: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.sandDark,
  },
  useCaseProgress: {
    fontFamily: fonts.technical,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  useCaseProgressDone: {
    color: colors.success,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
});
