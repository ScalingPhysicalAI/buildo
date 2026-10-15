import { router } from "expo-router";
import { Bot, ChevronRight, Download, Lock } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../../components/Card";
import { Button } from "../../../components/Button";
import { fetchAppStore, isRentActive, type StoreApp } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { colors, fonts, radii, spacing } from "../../../theme";

const CATEGORY_LABEL: Record<StoreApp["category"], string> = {
  HOME: "Home",
  SHOP: "Shops",
  OFFICE: "Offices",
  WAREHOUSE: "Warehouses",
  HOSPITAL: "Hospitals",
};

export default function StoreScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [apps, setApps] = useState<StoreApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchAppStore()
      .then(setApps)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the app store"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Rent is compulsory -- the store (browsing, subscribing, and anything
  // already installed) is locked the moment it lapses. See isRentActive()
  // in lib/api.ts and the rent section of settings/wallet.tsx.
  if (!isRentActive(user)) {
    return (
      <View
        style={[styles.scroll, styles.lockedContainer, { paddingTop: insets.top + spacing.md }]}
      >
        <View style={styles.lockedIcon}>
          <Lock size={28} color={colors.sandDark} />
        </View>
        <Text style={styles.title}>Store locked</Text>
        <Text style={styles.lockedText}>
          {user?.monthlyRentUsd
            ? "Your robot rent isn't paid for this month. Pay it to unlock the store and resume any installed skills."
            : "Start your robot rental to unlock the store and install skills on your Buildo."}
        </Text>
        <Button label="Go to wallet" onPress={() => router.push("/settings/wallet")} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Text style={styles.title}>App store</Text>
      <Text style={styles.subtitle}>Apps built by Buildo creators -- install them straight to your robot.</Text>

      {error ? (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Button label="Retry" onPress={load} variant="secondary" style={{ marginTop: spacing.md }} />
        </View>
      ) : apps === null ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={colors.sandDark} />
        </View>
      ) : apps.length === 0 ? (
        <Text style={styles.emptyText}>No apps are live on the store yet -- check back soon.</Text>
      ) : (
        apps.map((app) => (
          <Pressable key={app.id} onPress={() => router.push(`/store/${app.id}`)}>
            <Card style={styles.appCard}>
              <View style={styles.appIcon}>
                <Bot size={22} color={colors.sandDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.appName}>{app.name}</Text>
                <Text style={styles.appMeta}>
                  {CATEGORY_LABEL[app.category]} · By {app.creatorName}
                </Text>
                <View style={styles.installRow}>
                  <Download size={12} color={colors.textMuted} />
                  <Text style={styles.installCount}>{app.installCount} installs</Text>
                </View>
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.priceText}>${app.monthlyPriceUsd}/mo</Text>
                <ChevronRight size={18} color={colors.textMuted} />
              </View>
            </Card>
          </Pressable>
        ))
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
  centerBox: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },
  lockedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  },
  lockedIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  lockedText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  appCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  appIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  appMeta: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  installRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  installCount: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: colors.textMuted,
  },
  priceCol: {
    alignItems: "flex-end",
    gap: 4,
  },
  priceText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.sandDark,
  },
});
