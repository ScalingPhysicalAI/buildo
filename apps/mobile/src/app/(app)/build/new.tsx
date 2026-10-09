import { router } from "expo-router";
import { Check, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../../components/Button";
import { TextField } from "../../../components/TextField";
import { Alert } from "../../../lib/alert";
import { getDisplayStatus } from "../../../lib/skill-status";
import { useSkills } from "../../../lib/skills-context";
import type { AppCategory } from "../../../lib/skills-api";
import { colors, fonts, radii, spacing } from "../../../theme";

const CATEGORIES: { value: AppCategory; label: string }[] = [
  { value: "HOME", label: "Home use" },
  { value: "GENERAL", label: "General use" },
  { value: "PUBLIC", label: "Public use" },
  { value: "KITCHEN", label: "Kitchen" },
  { value: "CLEANING", label: "Cleaning" },
  { value: "INVENTORY", label: "Inventory" },
];

function closeOrGoHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/build");
  }
}

export default function NewAppScreen() {
  const insets = useSafeAreaInsets();
  const { catalog, createApp } = useSkills();

  const trainedSkills = catalog.filter((s) => getDisplayStatus(s.collection) === "trained");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<AppCategory>("HOME");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggleSkill(collectionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  }

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert("Name your app", "Give your app a name first.");
      return;
    }
    if (selected.size === 0) {
      Alert.alert("Pick at least one skill", "Choose which trained skills this app uses.");
      return;
    }
    setBusy(true);
    try {
      const app = await createApp({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        skillCollectionIds: Array.from(selected),
      });
      router.replace(`/(app)/build/${app.id}`);
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
      <Pressable onPress={closeOrGoHome} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>New app</Text>
      <Text style={styles.subtitle}>List it for the Buildo app store, built from your own trained skills.</Text>

      <TextField label="App name" placeholder="e.g. Kitchen Helper" value={name} onChangeText={setName} />
      <TextField
        label="Description (optional)"
        placeholder="What does this app do?"
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.categoryGrid}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.value}
            onPress={() => setCategory(c.value)}
            style={[styles.categoryChip, category === c.value && styles.categoryChipActive]}
          >
            <Text style={[styles.categoryChipText, category === c.value && styles.categoryChipTextActive]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Skills in this app</Text>
      {trainedSkills.length === 0 ? (
        <Text style={styles.emptyText}>No trained skills yet.</Text>
      ) : (
        trainedSkills.map((entry) => {
          const collectionId = entry.collection!.id;
          const isSelected = selected.has(collectionId);
          return (
            <Pressable key={entry.id} onPress={() => toggleSkill(collectionId)} style={styles.skillRow}>
              <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                {isSelected ? <Check size={14} color={colors.white} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.skillRowName}>{entry.name}</Text>
                <Text style={styles.skillRowCategory}>{entry.category}</Text>
              </View>
            </Pressable>
          );
        })
      )}

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
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  categoryChip: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  categoryChipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  categoryChipTextActive: {
    color: colors.white,
  },
  skillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  skillRowName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  skillRowCategory: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginTop: 1,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
});
