import { Bot } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link, router } from "expo-router";

import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth-context";
import { colors, fonts, radii, spacing } from "../theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password");
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      router.replace("/(app)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Bot size={32} color={colors.sandDark} strokeWidth={1.5} />
          </View>
          <Text style={styles.title}>BUILDO</Text>
          <Text style={styles.subtitle}>Sign in to manage your robot</Text>
        </View>

        <View style={styles.card}>
          <TextField
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
          />
          <TextField
            label="Password"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Button label="Sign in" onPress={handleLogin} loading={loading} style={{ marginTop: spacing.sm }} />
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>New here?</Text>
          <Link href="/signup" replace style={styles.footerLink}>
            Create an account
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  hero: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.black,
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  errorText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.lg,
  },
  footerText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
  },
  footerLink: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.sandDark,
  },
});
