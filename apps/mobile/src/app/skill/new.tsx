import { router } from "expo-router";
import { X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { Alert } from "../../lib/alert";
import { useSkills } from "../../lib/skills-context";
import { colors, fonts, radii, spacing } from "../../theme";

function closeOrGoHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)/train");
  }
}

export default function NewCustomSkillScreen() {
  const insets = useSafeAreaInsets();
  const { createCustomSkill } = useSkills();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert("Name it first", "Give this skill a name.");
      return;
    }
    setBusy(true);
    try {
      const skill = await createCustomSkill(name.trim());
      router.replace(`/skill/${skill.slug}`);
    } catch (err) {
      Alert.alert("Couldn't create skill", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Pressable onPress={closeOrGoHome} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>Add a custom skill</Text>
      <Text style={styles.subtitle}>
        Teach Buildo something not in the list below. Custom skills aren&apos;t paid, but they go through the same
        record → upload → train pipeline, and can be used in an app once trained.
      </Text>

      <TextField
        label="Skill name"
        placeholder="e.g. Stack the dishwasher"
        value={name}
        onChangeText={setName}
        autoFocus
      />

      <Button label="Start recording" onPress={handleCreate} loading={busy} style={{ marginTop: spacing.md }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
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
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
});
