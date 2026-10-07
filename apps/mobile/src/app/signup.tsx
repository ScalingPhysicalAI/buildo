import { Sparkles } from "lucide-react-native";
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
import type { Role } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { colors, fonts, radii, spacing } from "../theme";

const ROLES: { value: Role; label: string }[] = [
  { value: "DEVELOPER", label: "Developer" },
  { value: "RESEARCHER", label: "Researcher" },
];

export default function SignupScreen() {
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("DEVELOPER");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;

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
      await signup(name.trim(), email, password, role);
      router.replace("/(app)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create your account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Animated.View style={[styles.hero, { opacity: fade }]}>
          <View style={styles.heroIcon}>
            <Sparkles size={32} color={colors.sandDark} strokeWidth={1.5} />
          </View>
          <Text style={styles.title}>BUILDO TRAINER</Text>
          <Text style={styles.subtitle}>
            Capture demonstrations for Buildo -- glasses, gloves, and your voice, in sync.
          </Text>
        </Animated.View>

        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
          <View style={styles.card}>
            <Logo tag="mobile" size={18} />
            <Text style={styles.cardHint}>Create your Starforge developer portal account</Text>

            <TextField
              label="Name"
              autoComplete="name"
              value={name}
              onChangeText={setName}
              placeholder="Ada Lovelace"
            />
            <TextField
              label="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@starforgerobotics.com"
            />
            <TextField
              label="Password"
              secureTextEntry
              autoComplete="password-new"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
            />

            <Text style={styles.fieldLabel}>I am a</Text>
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <Pressable
                  key={r.value}
                  onPress={() => setRole(r.value)}
                  style={[styles.roleOption, role === r.value && styles.roleOptionActive]}
                >
                  <Text style={[styles.roleOptionText, role === r.value && styles.roleOptionTextActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Button label="Create account" onPress={handleSignup} loading={loading} style={{ marginTop: spacing.sm }} />
          </View>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <Link href="/login" replace style={styles.footerLink}>
              Sign in
            </Link>
          </View>
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
  fieldLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  roleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  roleOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
  },
  roleOptionActive: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  roleOptionText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  roleOptionTextActive: {
    color: colors.white,
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
