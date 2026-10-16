import { router, useLocalSearchParams } from "expo-router";
import { Bot, Check, Download, Lock, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { fetchAppStore, isRentActive, isSkillSubscriptionActive, subscribeToSkill, type StoreApp } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useRobot } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

const CATEGORY_LABEL: Record<StoreApp["category"], string> = {
  HOME: "Home",
  SHOP: "Shops",
  OFFICE: "Offices",
  WAREHOUSE: "Warehouses",
  HOSPITAL: "Hospitals",
};

// No bulk discount for longer terms (unlike robot rent) -- just
// monthlyPriceUsd * months, charged upfront, same as a single month.
const SKILL_TERMS = [1, 3, 6, 12] as const;
type SkillTermMonths = (typeof SKILL_TERMS)[number];

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
  const { user, refresh } = useAuth();
  const { installedApps, installApp } = useRobot();
  const rentActive = isRentActive(user);
  // undefined = still loading, null = loaded but no app with this id exists
  // -- these must be distinct states, otherwise a bad/stale id spins forever
  // instead of showing a "not found" message.
  const [app, setApp] = useState<StoreApp | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [subscribeMonths, setSubscribeMonths] = useState<SkillTermMonths>(1);

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
  const isSubscribed = isSkillSubscriptionActive(app);

  async function handleInstall() {
    if (!app || !rentActive || !isSubscribed) return;
    setInstalling(true);
    try {
      await new Promise((r) => setTimeout(r, 900));
      await installApp(app.id, app.name);
    } finally {
      setInstalling(false);
    }
  }

  function handleSubscribe() {
    if (!app || !rentActive) return;
    const months = subscribeMonths;
    const totalCost = app.monthlyPriceUsd * months;
    setSubscribeError(null);
    Alert.alert(
      isInstalled ? "Renew subscription?" : "Subscribe?",
      `$${totalCost} will be deducted from your wallet balance for ${months} month${months === 1 ? "" : "s"}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setSubscribing(true);
            try {
              const result = await subscribeToSkill(app.id, months);
              setApp((prev) => (prev ? { ...prev, mySubscribedUntil: result.subscribedUntil } : prev));
              await refresh();
            } catch (err) {
              setSubscribeError(err instanceof Error ? err.message : "Couldn't subscribe right now");
            } finally {
              setSubscribing(false);
            }
          },
        },
      ]
    );
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
            <Text style={styles.installCount}>{app.subscriberCount} subscribed</Text>
          </View>

          <Text style={styles.priceTag}>${app.monthlyPriceUsd}/mo subscription</Text>

          {app.description ? <Text style={styles.description}>{app.description}</Text> : null}

          {!rentActive ? (
            <>
              <Card style={styles.lockedCard}>
                <Lock size={18} color={colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.lockedCardTitle}>Pay your rent first</Text>
                  <Text style={styles.lockedCardBody}>
                    {isInstalled
                      ? "This skill is disabled until this month's robot rent is paid."
                      : "Pay your rent first, then you can subscribe and apply this skill."}
                  </Text>
                </View>
              </Card>
              <Button
                label="Go to wallet"
                onPress={() => router.push("/settings/wallet")}
                style={{ marginTop: spacing.md }}
              />
            </>
          ) : !isSubscribed ? (
            <>
              {isInstalled ? (
                <Card style={styles.lockedCard}>
                  <Lock size={18} color={colors.error} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lockedCardTitle}>Subscription expired</Text>
                    <Text style={styles.lockedCardBody}>
                      Renew to keep running this skill on your robot.
                    </Text>
                  </View>
                </Card>
              ) : null}
              <View style={styles.termRow}>
                {SKILL_TERMS.map((months) => (
                  <Pressable
                    key={months}
                    onPress={() => setSubscribeMonths(months)}
                    style={[styles.termChip, subscribeMonths === months && styles.termChipActive]}
                  >
                    <Text style={[styles.termChipText, subscribeMonths === months && styles.termChipTextActive]}>
                      {months}mo
                    </Text>
                  </Pressable>
                ))}
              </View>

              {subscribeError ? <Text style={styles.subscribeErrorText}>{subscribeError}</Text> : null}
              <Button
                label={`${isInstalled ? "Renew" : "Subscribe"} -- $${app.monthlyPriceUsd * subscribeMonths} total`}
                onPress={handleSubscribe}
                loading={subscribing}
                style={{ marginTop: spacing.md }}
              />
            </>
          ) : isInstalled ? (
            <Card style={styles.installedCard}>
              <Check size={18} color={colors.success} />
              <Text style={styles.installedText}>Installed to your robot</Text>
            </Card>
          ) : (
            <Button
              label="Apply to my robot"
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
  priceTag: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.sandDark,
    marginTop: spacing.md,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 21,
    marginTop: spacing.sm,
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
  lockedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  lockedCardTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  lockedCardBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    flexShrink: 1,
  },
  subscribeErrorText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.md,
  },
  termRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  termChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  termChipActive: {
    backgroundColor: colors.skin,
    borderColor: colors.skinBorder,
  },
  termChipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  termChipTextActive: {
    color: colors.black,
  },
});
