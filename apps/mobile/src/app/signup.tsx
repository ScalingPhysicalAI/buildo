import { Eye, EyeOff, Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, router } from "expo-router";

import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth-context";
import { colors, fonts, radii, spacing } from "../theme";

export default function SignupScreen() {
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedUp, setSignedUp] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;
  const scrollRef = useRef<ScrollView>(null);
  const scrollToEnd = () => scrollRef.current?.scrollToEnd({ animated: true });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, []);

  async function handleSignup() {
    setError(null);
    if (!name.trim() || !email || !password) {
      setError("Fill in your name, email, and password");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await signup(name.trim(), email, password, "DEVELOPER");
      setSignedUp(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create your account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "android" ? 24 : 0}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={[styles.hero, { opacity: fade }]}>
          <View style={styles.heroIcon}>
            <Sparkles size={32} color={colors.sandDark} strokeWidth={1.5} />
          </View>
          <Text style={styles.title}>BUILDO REWARDS</Text>
          <Text style={styles.subtitle}>Become a Buildo Creator to earn rewards</Text>
          <View style={styles.bonusPill}>
            <Text style={styles.bonusPillText}>Get $20 instant on Sign up</Text>
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
          {signedUp ? (
            <View style={styles.card}>
              <Logo tag="mobile" size={18} />
              <Text style={styles.cardHint}>You're in — what do you want to do first?</Text>

              <Button
                label="Start training a skill"
                onPress={() => router.replace("/(app)/train")}
                style={{ marginTop: spacing.sm }}
              />
              <Button
                label="Explore the app store"
                variant="secondary"
                onPress={() => router.replace("/(app)/build")}
                style={{ marginTop: spacing.sm }}
              />
            </View>
          ) : (
            <View style={styles.card}>
              <Logo tag="mobile" size={18} />
              <Text style={styles.cardHint}>Create your Buildo Studio account</Text>

              <TextField
                label="Name"
                autoComplete="name"
                value={name}
                onChangeText={setName}
                onFocus={scrollToEnd}
                placeholder="Ada Lovelace"
              />
              <TextField
                label="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                onFocus={scrollToEnd}
                placeholder="you@starforgerobotics.com"
              />
              <TextField
                label="Password"
                secureTextEntry={!passwordVisible}
                autoComplete="password-new"
                value={password}
                onChangeText={setPassword}
                onFocus={scrollToEnd}
                placeholder="At least 8 characters"
                rightElement={
                  <Pressable onPress={() => setPasswordVisible((v) => !v)} hitSlop={8}>
                    {passwordVisible ? (
                      <EyeOff size={18} color={colors.textMuted} />
                    ) : (
                      <Eye size={18} color={colors.textMuted} />
                    )}
                  </Pressable>
                }
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Button label="Create account" onPress={handleSignup} loading={loading} style={{ marginTop: spacing.sm }} />
            </View>
          )}

          {!signedUp && (
            <View style={styles.footerRow}>
              <Text style={styles.footerText}>Already have an account?</Text>
              <Link href="/login" replace style={styles.footerLink}>
                Sign in
              </Link>
            </View>
          )}
        </Animated.View>
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
    textAlign: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    lineHeight: 21,
  },
  bonusPill: {
    backgroundColor: colors.sandSurface,
    borderWidth: 1,
    borderColor: colors.sandLight,
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  bonusPillText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.sandDark,
    letterSpacing: 0.2,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  cardHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
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
