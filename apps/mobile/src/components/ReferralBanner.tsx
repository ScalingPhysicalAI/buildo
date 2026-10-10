import { useState } from "react";
import { Check, Copy, Gift, Share2 } from "lucide-react-native";
import { Clipboard, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { colors, fonts, radii, spacing } from "../theme";

const PURCHASE_URL = "https://starforgerobotics.com/buildo/";

const USE_CASES = ["Busy professionals", "Shop owners", "Office owners", "Warehouses", "Hospitals"];

function shareMessage(code: string) {
  return `Hey I've become a Buildo Creator, you can use this referral code ${code} to get $500 discount on your Buildo purchase ${PURCHASE_URL}`;
}

// TODO: dummy/local only for now -- not backed by a real per-user code from
// the server yet. Swap for a real fetched code once that's wired up.
function generateDummyCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `BLD${suffix}`;
}

export function ReferralBanner() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function ensureCode(): string {
    if (code) return code;
    const generated = generateDummyCode();
    setCode(generated);
    return generated;
  }

  function handleCopy() {
    const activeCode = ensureCode();
    Clipboard.setString(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleShare() {
    const activeCode = ensureCode();
    await Share.share({ message: shareMessage(activeCode) });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Gift size={20} color={colors.sandDark} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Refer Buildo and get $500 reward</Text>
          <Text style={styles.subtitle}>Generate referral code</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.useCaseLabel}>Buildo robots can be used by</Text>
        <View style={styles.useCaseList}>
          {USE_CASES.map((item) => (
            <View key={item} style={styles.useCaseRow}>
              <View style={styles.dot} />
              <Text style={styles.useCaseText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {code ? (
          <Pressable
            onPress={handleCopy}
            style={({ pressed }) => [styles.codeChip, pressed && styles.pressed]}
          >
            <View style={styles.codeTextWrap}>
              <Text style={styles.codeLabel}>{copied ? "Copied" : "Your referral code · tap to copy"}</Text>
              <Text style={styles.codeValue}>{code}</Text>
            </View>
            {copied ? (
              <Check size={20} color={colors.success} />
            ) : (
              <Copy size={20} color={colors.sandDark} />
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={ensureCode}
            style={({ pressed }) => [styles.generateBtn, pressed && styles.pressed]}
          >
            <Text style={styles.generateBtnText}>Generate referral code</Text>
          </Pressable>
        )}

        <Pressable
          onPress={handleShare}
          style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}
        >
          <Share2 size={16} color={colors.black} />
          <Text style={styles.shareBtnText}>Share referral link</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.sandSurface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.sandLight,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.sandDark,
    marginTop: 2,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  useCaseLabel: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.sandDark,
    marginBottom: spacing.xs,
  },
  useCaseList: {
    gap: 6,
  },
  useCaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.sandDark,
  },
  useCaseText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.black,
  },
  divider: {
    height: 1,
    backgroundColor: colors.sandLight,
    marginVertical: spacing.xs,
  },
  codeChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.sandLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  codeTextWrap: {
    flex: 1,
  },
  codeLabel: {
    fontFamily: fonts.technical,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  codeValue: {
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: 2,
    color: colors.black,
    marginTop: 2,
  },
  generateBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.sandDark,
    borderRadius: radii.pill,
    paddingVertical: 12,
    alignItems: "center",
  },
  generateBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.sandDark,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.skin,
    borderWidth: 1,
    borderColor: colors.skinBorder,
    borderRadius: radii.pill,
    paddingVertical: 12,
  },
  shareBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.black,
  },
});
