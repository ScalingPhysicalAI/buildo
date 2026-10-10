import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LogOut } from "lucide-react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "../../components/Card";
import { GadgetsBanner } from "../../components/GadgetsBanner";
import { Logo } from "../../components/Logo";
import { ReferralBanner } from "../../components/ReferralBanner";
import { TrainBanner } from "../../components/TrainBanner";
import { useAuth } from "../../lib/auth-context";
import { colors, fonts, radii, spacing } from "../../theme";

const GREETINGS = [
  "Welcome back! Let's make today count.",
  "Great to see you — let's earn some $$.",
  "Welcome back! One skill at a time.",
  "Hey, you're on a roll — keep building.",
  "Welcome back! Small steps, big rewards.",
];

function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const [greeting, setGreeting] = useState(pickGreeting);

  useFocusEffect(
    useCallback(() => {
      setGreeting(pickGreeting());
    }, [])
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.header}>
        <Logo tag="mobile" size={16} />
        <Pressable onPress={logout} hitSlop={12} style={styles.logoutBtn}>
          <LogOut size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <Text style={styles.greeting}>Hi, {firstName}</Text>
      <Text style={styles.greetingSub}>{greeting}</Text>

      <Card style={styles.creditCard}>
        <View>
          <Text style={styles.creditLabel}>Credit balance</Text>
          <Text style={styles.creditValue}>{user?.tokenBalance ?? 0}$</Text>
        </View>
        <View style={styles.creditBadge}>
          <Text style={styles.creditBadgeText}>{user?.role ?? "DEVELOPER"}</Text>
        </View>
      </Card>

      <ReferralBanner />
      <TrainBanner />
      <GadgetsBanner />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  logoutBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  greeting: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.black,
  },
  greetingSub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  creditCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  creditLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  creditValue: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
    marginTop: 2,
  },
  creditBadge: {
    backgroundColor: colors.sandSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  creditBadgeText: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: colors.sandDark,
    letterSpacing: 0.4,
  },
});
