import { router, useLocalSearchParams } from "expo-router";
import { Bot, Check, Download, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { fetchAppStore, type StoreApp } from "../../lib/api";
import { useRobot } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

const CATEGORY_LABEL: Record<StoreApp["category"], string> = {
  HOME: "Home",
  SHOP: "Shops",
  OFFICE: "Offices",
  WAREHOUSE: "Warehouses",
  HOSPITAL: "Hospitals",
};

function closeOrGoStore() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/store");
  }
}

export default function AppDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { installedApps, installApp } = useRobot();
  // undefined = still loading, null = loaded but no app with this id exists
  // -- these must be distinct states, otherwise a bad/stale id spins forever
  // instead of showing a "not found" message.
  const [app, setApp] = useState<StoreApp | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  // A dev reload (or Expo Go replaying its last-opened URL) can land directly
  // on this modal with no navigation history beneath it. It was never meant
  // to be a landing screen, so bounce straight back to Home instead of
  // showing a "not found" popup on cold open.
  const isLandingScreen = !router.canGoBack();

  useEffect(() => {
    if (isLandingScreen) {
      router.replace("/(app)");
      return;
    }
    fetchAppStore()
      .then((apps) => setApp(apps.find((a) => a.id === id) ?? null))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this app"));
  }, [id, isLandingScreen]);

  if (isLandingScreen) return null;

  const isInstalled = installedApps.some((a) => a.id === id);

  async function handleInstall() {
    if (!app) return;
    setInstalling(true);
    try {
      await new Promise((r) => setTimeout(r, 900));
      await installApp(app.id, app.name);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Pressable onPress={closeOrGoStore} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : app === undefined ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={colors.sandDark} />
        </View>
      ) : app === null ? (
        <Text style={styles.errorText}>This app isn't available anymore.</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.appIcon}>
            <Bot size={32} color={colors.sandDark} />
          </View>
          <Text style={styles.name}>{app.name}</Text>
          <Text style={styles.meta}>
            {CATEGORY_LABEL[app.category]} · By {app.creatorName}
          </Text>
          <View style={styles.installRow}>
            <Download size={13} color={colors.textMuted} />
            <Text style={styles.installCount}>{app.installCount} installs</Text>
          </View>

          {app.description ? <Text style={styles.description}>{app.description}</Text> : null}

          {isInstalled ? (
            <Card style={styles.installedCard}>
              <Check size={18} color={colors.success} />
              <Text style={styles.installedText}>Installed to your robot</Text>
            </Card>
          ) : (
            <Button
              label="Install to my robot"
              onPress={handleInstall}
              loading={installing}
              style={{ marginTop: spacing.xl }}
            />
          )}
        </ScrollView>
      )}
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
  centerBox: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  appIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  installRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
  },
  installCount: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  installedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  installedText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
});
