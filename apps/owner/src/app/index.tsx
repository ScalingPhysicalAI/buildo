import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "../lib/auth-context";
import { hasSeenOnboarding } from "../lib/onboarding";
import { colors } from "../theme";

export default function Index() {
  const { user, isLoading } = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    hasSeenOnboarding().then(setOnboarded);
  }, []);

  if (isLoading || onboarded === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.sandDark} size="large" />
      </View>
    );
  }

  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href={user ? "/(app)" : "/login"} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
