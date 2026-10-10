import { router } from "expo-router";
import { Check, Wallet, X } from "lucide-react-native";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/TextField";
import { Alert } from "../../lib/alert";
import { useAuth } from "../../lib/auth-context";
import { placeGadgetOrder } from "../../lib/gadgets-api";
import { colors, fonts, radii, spacing } from "../../theme";

const KIT_PRICE = 499;
const MIN_WALLET_BALANCE = -500;

const HERO_IMAGE = "https://cdn.shopify.com/s/files/1/0954/5685/4200/files/IMG-20260917-WA0065.jpg?v=1789675398";

const INCLUDED = [
  { label: "Egocentric glasses", image: "https://starforgerobotics.com/assets/buildo-kit-glasses.png" },
  { label: "Teleoperation gloves", image: "https://starforgerobotics.com/assets/buildo-kit-gloves.png" },
  {
    label: "Buildo Development Kit",
    image: "https://cdn.shopify.com/s/files/1/0954/5685/4200/files/IMG-20260917-WA0064.jpg?v=1789675966",
  },
];

const SPECS = [
  { label: "Frame rate", value: "60 FPS" },
  { label: "Hand tracking", value: "21 joints/hand" },
  { label: "Force feedback", value: "Fingertip" },
  { label: "Connectivity", value: "USB-C + wireless" },
];

function closeOrGoHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(app)");
  }
}

export default function GadgetOrderScreen() {
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState(false);

  const projectedBalance = (user?.tokenBalance ?? 0) - KIT_PRICE;
  const overLimit = projectedBalance < MIN_WALLET_BALANCE;

  async function handlePay() {
    if (!name.trim() || !email.trim() || !address.trim()) {
      Alert.alert("Missing details", "Fill in your name, email, and shipping address.");
      return;
    }
    if (overLimit) {
      Alert.alert(
        "Wallet limit reached",
        `This order would take your balance past the $${MIN_WALLET_BALANCE} limit.`
      );
      return;
    }
    setBusy(true);
    try {
      await placeGadgetOrder({
        recipientName: name.trim(),
        recipientEmail: email.trim(),
        phone: phone.trim() || undefined,
        shippingAddress: address.trim(),
      });
      await refresh();
      setPlaced(true);
    } catch (err) {
      Alert.alert("Couldn't place order", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={closeOrGoHome} style={styles.closeBtn} hitSlop={12}>
          <X size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Check size={28} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>Order placed</Text>
          <Text style={styles.successText}>
            Your Buildo Development Kit is on its way. A confirmation email has been sent to {email}.
          </Text>
          <Button label="Done" onPress={closeOrGoHome} style={{ marginTop: spacing.lg }} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={closeOrGoHome} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Image source={{ uri: HERO_IMAGE }} style={styles.heroImage} resizeMode="cover" />

      <View style={styles.titleRow}>
        <Text style={styles.title}>Buildo Development Kit</Text>
        <Text style={styles.price}>${KIT_PRICE}</Text>
      </View>
      <Text style={styles.description}>
        Egocentric glasses paired with teleoperation gloves — capture first-person video and hand motion to train
        Buildo's skills.
      </Text>

      <Text style={styles.sectionTitle}>What's included</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.includedScroll}
      >
        {INCLUDED.map((item) => (
          <Card key={item.label} style={styles.includedCard}>
            <Image source={{ uri: item.image }} style={styles.includedImage} resizeMode="cover" />
            <Text style={styles.includedLabel}>{item.label}</Text>
          </Card>
        ))}
      </ScrollView>

      <Text style={styles.sectionTitle}>Key specs</Text>
      <View style={styles.specGrid}>
        {SPECS.map((spec) => (
          <View key={spec.label} style={styles.specCell}>
            <Text style={styles.specLabel}>{spec.label}</Text>
            <Text style={styles.specValue}>{spec.value}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Shipping details</Text>
      <TextField label="Full name" value={name} onChangeText={setName} placeholder="Ada Lovelace" />
      <TextField
        label="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@starforgerobotics.com"
      />
      <TextField
        label="Phone (optional)"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        placeholder="+1 555 555 5555"
      />
      <TextField
        label="Shipping address"
        multiline
        value={address}
        onChangeText={setAddress}
        placeholder="Street, city, state, ZIP, country"
      />

      <View style={styles.walletCard}>
        <View style={styles.walletRow}>
          <Wallet size={18} color={colors.sandDark} />
          <Text style={styles.walletLabel}>Wallet balance</Text>
          <Text style={styles.walletValue}>${user?.tokenBalance ?? 0}</Text>
        </View>
        <Text style={styles.walletNote}>
          This order charges ${KIT_PRICE} directly from your wallet. Your balance can go negative.
        </Text>
      </View>

      <Button
        label={`Pay $${KIT_PRICE} with wallet`}
        onPress={handlePay}
        loading={busy}
        disabled={overLimit}
        style={{ marginTop: spacing.md }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
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
  heroImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.lg,
    backgroundColor: colors.backgroundAlt,
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.black,
    flex: 1,
  },
  price: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.sandDark,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  sectionTitle: {
    fontFamily: fonts.technical,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  includedScroll: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  includedCard: {
    width: 150,
    alignItems: "center",
    gap: spacing.sm,
  },
  includedImage: {
    width: 110,
    height: 110,
    borderRadius: radii.md,
    backgroundColor: colors.sandSurface,
  },
  includedLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: "center",
  },
  specGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  specCell: {
    width: "48%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  specLabel: {
    fontFamily: fonts.technical,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  specValue: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 2,
  },
  walletCard: {
    backgroundColor: colors.sandSurface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  walletLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  walletValue: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.sandDark,
  },
  walletNote: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.successSurface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  successTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.black,
  },
  successText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
    lineHeight: 20,
  },
});
