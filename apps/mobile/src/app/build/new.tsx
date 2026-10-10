import { Redirect, router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/TextField";
import { Alert } from "../../lib/alert";
import { useSkills } from "../../lib/skills-context";
import { getUseCase } from "../../lib/use-cases";
import { colors, fonts, radii, spacing } from "../../theme";

function closeOrGoBuild() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/build");
  }
}

export default function NewAppScreen() {
  const insets = useSafeAreaInsets();
  const { catalog, createApp } = useSkills();
  const { useCase: useCaseKey } = useLocalSearchParams<{ useCase: string }>();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const useCase = getUseCase(useCaseKey);
  if (!useCase) return <Redirect href="/(app)/train" />;

  const categoryKey = useCase.key;
  const slugs = useCase.skillSlugs;
  const includedSkills = catalog.filter((s) => slugs.includes(s.slug) && s.collection);
  const skillCollectionIds = includedSkills.map((s) => s.collection!.id);

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert("Name your app", "Give your app a name first.");
      return;
    }
    setBusy(true);
    try {
      const app = await createApp({
        name: name.trim(),
        description: description.trim() || undefined,
        category: categoryKey,
        skillCollectionIds,
      });
      router.replace(`/build/${app.id}`);
    } catch (err) {
      Alert.alert("Couldn't create app", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={closeOrGoBuild} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>New app</Text>
      <Text style={styles.subtitle}>List it for the Buildo app store, built from your own trained skills.</Text>

      <TextField label="App name" placeholder={`e.g. ${useCase.title} Helper`} value={name} onChangeText={setName} />
      <TextField
        label="Description (optional)"
        placeholder="What does this app do?"
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.categoryBadge}>
        <Text style={styles.categoryBadgeText}>{useCase.title} Use</Text>
      </View>

      <Text style={styles.fieldLabel}>Skills in this app</Text>
      {includedSkills.map((entry) => (
        <Card key={entry.id} style={styles.skillRow}>
          <Text style={styles.skillRowName}>{entry.name}</Text>
        </Card>
      ))}

      <Button label="Create app" onPress={handleCreate} loading={busy} style={{ marginTop: spacing.xl }} />
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
    fontSize: 28,
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
  fieldLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.sandSurface,
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  categoryBadgeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.sandDark,
  },
  skillRow: {
    marginBottom: spacing.sm,
  },
  skillRowName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
});
