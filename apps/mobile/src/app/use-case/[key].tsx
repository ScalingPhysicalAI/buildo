import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Check, ChevronRight, Lock, X } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { formatDaysLeft } from "../../lib/format";
import { useSkills } from "../../lib/skills-context";
import { estimatedIncomeLabel, getUseCase } from "../../lib/use-cases";
import { colors, fonts, radii, spacing } from "../../theme";

function closeOrGoTrain() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/train");
  }
}

export default function UseCaseScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { catalog, apps, refreshCatalog, refreshApps } = useSkills();
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      refreshCatalog().catch(() => {});
      refreshApps().catch(() => {});
    }, [refreshCatalog, refreshApps])
  );

  const useCase = getUseCase(key);
  if (!useCase) return <Redirect href="/(app)/train" />;

  const total = useCase.skillSlugs.length;
  const done = useCase.skillSlugs.filter((slug) => {
    const entry = catalog.find((s) => s.slug === slug);
    return !!entry?.collection && entry.collection.status !== "FAILED";
  }).length;
  const allDone = done === total;
  const categoryKey = useCase.key;
  const existingApp = apps.find((a) => a.category === categoryKey);

  function handleCreateApp() {
    if (!allDone) return;
    router.push(`/build/new?useCase=${categoryKey}`);
  }

  function existingAppStatusLabel(): string {
    if (!existingApp) return "";
    if (existingApp.status === "LIVE") return "Live on the Buildo app store";
    if (existingApp.status === "TESTING") return `In deployment cycle — ${formatDaysLeft(existingApp.testingEndsAt)}`;
    if (existingApp.status === "FAILED") return "Testing didn't pass — open it to retry";
    return "Draft — open it to test and deploy";
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoTrain} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>{useCase.title}</Text>
      <Text style={styles.summary}>
        Train {total} skill{total === 1 ? "" : "s"} to earn an estimated {estimatedIncomeLabel(useCase)} running a{" "}
        {useCase.title} Buildo. {done} of {total} complete.
      </Text>

      {useCase.skillSlugs.map((slug) => {
        const entry = catalog.find((s) => s.slug === slug);
        const isDone = !!entry?.collection && entry.collection.status !== "FAILED";

        return (
          <Pressable key={slug} onPress={() => router.push(`/skill/${slug}`)}>
            <Card style={styles.itemCard}>
              <View style={[styles.itemIcon, isDone && styles.itemIconDone]}>
                {isDone ? <Check size={18} color={colors.success} /> : <Lock size={14} color={colors.sandDark} />}
              </View>
              <Text style={styles.itemName}>{entry?.name ?? slug}</Text>
              <ChevronRight size={18} color={colors.textMuted} />
            </Card>
          </Pressable>
        );
      })}

      {existingApp ? (
        <View style={styles.existingAppCard}>
          <Text style={styles.existingAppName}>{existingApp.name}</Text>
          <Text style={styles.existingAppStatus}>{existingAppStatusLabel()}</Text>
          <Button
            label="View in Your Apps"
            onPress={() => router.push(`/build/${existingApp.id}`)}
            style={{ marginTop: spacing.md }}
          />
        </View>
      ) : (
        <Button
          label={allDone ? "Create app" : `Complete all skills to create your app (${done}/${total})`}
          onPress={handleCreateApp}
          disabled={!allDone}
          style={{ marginTop: spacing.lg }}
        />
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
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.black,
  },
  summary: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  itemIconDone: {
    backgroundColor: colors.successSurface,
  },
  itemName: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  existingAppCard: {
    backgroundColor: colors.sandSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  existingAppName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.black,
  },
  existingAppStatus: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.sandDark,
    marginTop: 2,
  },
});
