import { Mail } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link, router } from "expo-router";

import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { TextField } from "../components/TextField";
import { Alert } from "../lib/alert";
import { forgotPassword } from "../lib/api";
import { colors, fonts, radii, spacing } from "../theme";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) {
      Alert.alert("Enter your email", "We need your email to send a reset link.");
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      Alert.alert("Couldn't send reset link", err instanceof Error ? err.message : "Try again.");
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
            <Mail size={32} color={colors.sandDark} strokeWidth={1.5} />
          </View>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter your account email and we'll send a reset link to your inbox.
          </Text>
        </View>

        <View style={styles.card}>
          <Logo tag="mobile" size={18} />

          {sent ? (
            <>
              <Text style={styles.sentText}>
                If an account exists for that email, a reset link is on its way. Open it from your inbox to set a
                new password, then come back here to sign in.
              </Text>
              <Button label="Back to sign in" onPress={() => router.replace("/login")} style={{ marginTop: spacing.md }} />
            </>
          ) : (
            <>
              <TextField
                label="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@starforgerobotics.com"
              />
              <Button
                label="Send reset link"
                onPress={handleSubmit}
                loading={loading}
                style={{ marginTop: spacing.sm }}
              />
            </>
          )}
        </View>

        <View style={styles.footerRow}>
          <Link href="/login" replace style={styles.footerLink}>
            Back to sign in
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
    fontSize: 28,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    lineHeight: 21,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  sentText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  footerRow: {
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  footerLink: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.sandDark,
  },
});
