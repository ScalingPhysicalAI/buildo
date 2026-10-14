import { LogOut } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RobotHeroCard } from "../../components/RobotHeroCard";
import { useAuth } from "../../lib/auth-context";
import { useRobot } from "../../lib/robot-context";
import { colors, fonts, radii, spacing } from "../../theme";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { robotName } = useRobot();
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Hey {firstName}</Text>
          <Text style={styles.subtitle}>Here's how {robotName} is doing</Text>
        </View>
        <Pressable onPress={logout} hitSlop={10} style={styles.logoutBtn}>
          <LogOut size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <RobotHeroCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  greeting: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
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
});
