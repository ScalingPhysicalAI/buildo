import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Check, ShieldCheck, Wallet, X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/TextField";
import { CREATOR_MONTHLY_REWARD_USD } from "../../components/ReferralBanner";
import { Alert } from "../../lib/alert";
import { uploadKycId } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { placeGadgetOrder } from "../../lib/gadgets-api";
import { formatUSD } from "../../lib/format";
import { colors, fonts, radii, spacing } from "../../theme";

const KIT_PRICE = 200;
const MIN_WALLET_BALANCE = -500;

// Amazon-style top gallery -- swipe through the kit's product photos.
const GALLERY_IMAGES = [
  "https://cdn.shopify.com/s/files/1/0954/5685/4200/files/IMG-20260917-WA0065.jpg?v=1789675398",
  "https://cdn.shopify.com/s/files/1/0954/5685/4200/files/IMG-20260917-WA0064.jpg?v=1789675966",
];

const INCLUDED = [
  { label: "Egocentric glasses", image: "https://starforgerobotics.com/assets/buildo-kit-glasses.png" },
  { label: "Teleoperation gloves", image: "https://starforgerobotics.com/assets/buildo-kit-gloves.png" },
];

const SPECS = [
  { label: "Frame rate", value: "60 FPS" },
  { label: "Hand tracking", value: "21 joints/hand" },
  { label: "Force feedback", value: "Fingertip" },
  { label: "Connectivity", value: "USB-C + wireless" },
];

const TERMS = [
  "This order is billed directly from your Buildo wallet balance. Your balance may go negative, within the stated limit, and will be repaid from your future app and skill earnings.",
  "Orders are typically shipped within 5-7 business days of confirmation. Delivery estimates are not guaranteed and may vary by location.",
  "Inspect your kit upon delivery. Report any shipping damage or missing items within 48 hours of receipt.",
  "The Buildo Development Kit is non-returnable once unboxed, except in the case of a manufacturing defect reported within 14 days of delivery.",
  "If your wallet balance remains past the limit, Starforge Robotics may pause further gadget orders, skill purchases, and app deployments until it's settled.",
  `Referral reward: you earn ${formatUSD(CREATOR_MONTHLY_REWARD_USD)} after someone you referred makes a purchase, and only for as long as you keep uploading training data.`,
  "Your submitted government ID is used solely to verify your identity for this order and is not shared with third parties.",
  "The shipping address and contact details you provide are used only to fulfill this order.",
  "Starforge Robotics may update these terms from time to time; continued use of the app after a change constitutes acceptance of the updated terms.",
  "These terms are governed by the laws of the jurisdiction in which Starforge Robotics is registered.",
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
  const { width: windowWidth } = useWindowDimensions();
  const { user, refresh } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [pincodeLandmark, setPincodeLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [kycImage, setKycImage] = useState<{ uri: string; mimeType: string } | null>(null);
  const [kycUploading, setKycUploading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const galleryWidth = windowWidth - spacing.lg * 2;
  const verified = !!user?.kycIdImageUrl;

  function handleGalleryScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / galleryWidth);
    setActiveImage(index);
  }

  const projectedBalance = (user?.tokenBalance ?? 0) - KIT_PRICE;
  const overLimit = projectedBalance < MIN_WALLET_BALANCE;

  async function pickKycImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo access to upload your government ID.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const picked = { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" };
    setKycImage(picked);
    await handleKycUpload(picked);
  }

  // Takes the just-picked image as a param rather than reading kycImage from
  // state, since pickKycImage calls this immediately after setKycImage --
  // state wouldn't have flushed yet if this read it from the closure.
  async function handleKycUpload(image: { uri: string; mimeType: string }) {
    setKycUploading(true);
    try {
      await uploadKycId(image.uri, image.mimeType);
      await refresh();
    } catch (err) {
      Alert.alert("Couldn't verify", err instanceof Error ? err.message : "Try again.");
      setKycImage(null);
    } finally {
      setKycUploading(false);
    }
  }

  async function handlePlaceOrder() {
    setBusy(true);
    try {
      await placeGadgetOrder({
        recipientName: name.trim(),
        recipientEmail: email.trim(),
        phone: phone.trim(),
        shippingAddress: `${addressLine.trim()}, ${pincodeLandmark.trim()}`,
      });
      await refresh();
      setPlaced(true);
    } catch (err) {
      Alert.alert("Couldn't place order", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleBuyPress() {
    if (!name.trim() || !email.trim() || !phone.trim() || !addressLine.trim() || !pincodeLandmark.trim()) {
      Alert.alert("Missing details", "Fill in your name, email, phone number, and shipping address.");
      return;
    }
    if (!verified) {
      Alert.alert("Verify your identity", "Upload a government ID above before placing your order.");
      return;
    }
    if (overLimit) {
      Alert.alert(
        "Wallet limit reached",
        `This order would take your balance past the ${formatUSD(MIN_WALLET_BALANCE)} limit.`
      );
      return;
    }
    setAgreedToTerms(false);
    setShowTerms(true);
  }

  async function handleAgreeAndPay() {
    setShowTerms(false);
    await handlePlaceOrder();
  }

  if (showTerms) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => setShowTerms(false)} style={styles.closeBtn} hitSlop={12}>
          <X size={20} color={colors.textPrimary} />
        </Pressable>

        <Text style={styles.termsTitle}>Terms & Conditions</Text>
        <Text style={styles.description}>Please read and accept before we place your order.</Text>

        <ScrollView style={styles.termsBox} contentContainerStyle={styles.termsBoxContent}>
          {TERMS.map((term, i) => (
            <Text key={i} style={styles.termItem}>
              <Text style={styles.termNumber}>{i + 1}. </Text>
              {term}
            </Text>
          ))}
        </ScrollView>

        <Pressable onPress={() => setAgreedToTerms((v) => !v)} style={styles.agreeRow}>
          <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
            {agreedToTerms ? <Check size={14} color={colors.white} /> : null}
          </View>
          <Text style={styles.agreeText}>I have read and agree to the Terms & Conditions</Text>
        </Pressable>

        <Button
          label="Proceed"
          variant="cream"
          onPress={handleAgreeAndPay}
          loading={busy}
          disabled={!agreedToTerms}
          style={{ marginTop: spacing.md }}
        />
      </View>
    );
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

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleGalleryScroll}
        scrollEventThrottle={16}
        style={{ width: galleryWidth }}
      >
        {GALLERY_IMAGES.map((uri) => (
          <Image key={uri} source={{ uri }} style={[styles.heroImage, { width: galleryWidth }]} resizeMode="cover" />
        ))}
      </ScrollView>
      <View style={styles.dotsRow}>
        {GALLERY_IMAGES.map((uri, i) => (
          <View key={uri} style={[styles.dot, i === activeImage && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>Buildo Development Kit</Text>
        <Text style={styles.price}>{formatUSD(KIT_PRICE)}</Text>
      </View>
      <Text style={styles.description}>
        Egocentric glasses paired with teleoperation gloves — capture first-person video and hand motion to train
        Buildo's skills.
      </Text>

      <Text style={styles.sectionTitle}>What's included</Text>
      <Card style={styles.includedCard}>
        {INCLUDED.map((item) => (
          <View key={item.label} style={styles.includedRow}>
            <Image source={{ uri: item.image }} style={styles.includedIcon} resizeMode="contain" />
            <Text style={styles.includedLabel}>{item.label}</Text>
          </View>
        ))}
      </Card>

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
        label="Phone"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        placeholder="+1 555 555 5555"
      />
      <TextField
        label="Address"
        multiline
        value={addressLine}
        onChangeText={setAddressLine}
        placeholder="House/flat no., street, city, state"
      />
      <TextField
        label="Pincode & landmark"
        value={pincodeLandmark}
        onChangeText={setPincodeLandmark}
        placeholder="e.g. 560001, near City Mall"
      />

      <Text style={styles.sectionTitle}>Identity verification</Text>
      {verified ? (
        <View style={styles.kycVerifiedRow}>
          <ShieldCheck size={18} color={colors.success} />
          <Text style={styles.kycVerifiedText}>Identity verified</Text>
        </View>
      ) : (
        <Card style={styles.kycCard}>
          <Text style={styles.kycBody}>
            Required before ordering on credit -- upload a photo of any government-issued ID (passport, driver's
            license, national ID).
          </Text>
          {kycImage ? (
            <View style={styles.kycPreviewRow}>
              <Image source={{ uri: kycImage.uri }} style={styles.kycPreview} />
              {kycUploading ? (
                <View style={styles.kycUploadingRow}>
                  <ActivityIndicator size="small" color={colors.sandDark} />
                  <Text style={styles.kycChangeText}>Verifying...</Text>
                </View>
              ) : (
                <Pressable onPress={pickKycImage} style={styles.kycChangeBtn}>
                  <Text style={styles.kycChangeText}>Choose a different photo</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <Pressable onPress={pickKycImage} style={styles.kycPickBtn}>
              <Text style={styles.kycPickText}>Choose photo</Text>
            </Pressable>
          )}
        </Card>
      )}

      <View style={styles.walletCard}>
        <View style={styles.walletRow}>
          <Wallet size={18} color={colors.sandDark} />
          <Text style={styles.walletLabel}>Creator's wallet balance</Text>
          <Text style={styles.walletValue}>{formatUSD(user?.tokenBalance ?? 0)}</Text>
        </View>
        <Text style={styles.walletNote}>
          This order charges {formatUSD(KIT_PRICE)} directly from your wallet. Your balance can go negative.
        </Text>
      </View>

      <Button
        label="Buy now & pay later"
        variant="cream"
        onPress={handleBuyPress}
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
    aspectRatio: 4 / 3,
    borderRadius: radii.lg,
    backgroundColor: colors.backgroundAlt,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.sandDark,
    width: 16,
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
  includedCard: {
    gap: spacing.sm,
  },
  includedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  includedIcon: {
    width: 28,
    height: 28,
  },
  includedLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
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
  kycCard: {
    gap: spacing.sm,
  },
  kycBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  kycPickBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.sandDark,
    borderRadius: radii.pill,
    paddingVertical: 12,
    alignItems: "center",
  },
  kycPickText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.sandDark,
  },
  kycPreviewRow: {
    gap: spacing.sm,
  },
  kycPreview: {
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: radii.md,
    backgroundColor: colors.backgroundAlt,
  },
  kycChangeBtn: {
    alignSelf: "flex-start",
  },
  kycUploadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
  },
  kycChangeText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.sandDark,
  },
  kycVerifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.successSurface,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  kycVerifiedText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  termsTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.black,
  },
  termsBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  termsBoxContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  termItem: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  termNumber: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.sandDark,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkboxChecked: {
    backgroundColor: colors.sandDark,
    borderColor: colors.sandDark,
  },
  agreeText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
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
