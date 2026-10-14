import { router } from "expo-router";
import { Check, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextField } from "../../components/TextField";
import { colors, fonts, radii, spacing } from "../../theme";

const FAQS = [
  {
    q: "My robot won't connect to Wi-Fi, what do I do?",
    a: "Make sure your robot is within range of your router and your password is correct. You can also switch to the built-in SIM from Settings.",
  },
  {
    q: "How does the wallet top-up work?",
    a: "Funds you add to your wallet are used to buy and install apps from the Buildo app store onto your robot.",
  },
  {
    q: "Can I use voice commands without connecting my robot first?",
    a: "No -- your robot needs to be connected before it can hear and act on voice commands.",
  },
];

function closeOrGoSettings() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/settings");
  }
}

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // See store/[id].tsx -- same guard against a dev reload or Expo Go replay
  // landing directly on this modal with no history beneath it.
  const isLandingScreen = !router.canGoBack();

  useEffect(() => {
    if (isLandingScreen) router.replace("/(app)");
  }, [isLandingScreen]);

  if (isLandingScreen) return null;

  async function handleSend() {
    if (!message.trim()) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    setBusy(false);
    setSent(true);
    setMessage("");
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoSettings} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.title}>Help & support</Text>
      <Text style={styles.subtitle}>Common questions, or reach our team directly.</Text>

      <Text style={styles.sectionTitle}>FAQs</Text>
      {FAQS.map((faq, i) => (
        <Pressable key={i} onPress={() => setOpenIndex(openIndex === i ? null : i)}>
          <Card style={styles.faqCard}>
            <Text style={styles.faqQ}>{faq.q}</Text>
            {openIndex === i ? <Text style={styles.faqA}>{faq.a}</Text> : null}
          </Card>
        </Pressable>
      ))}

      <Text style={styles.sectionTitle}>Contact our team</Text>
      {sent ? (
        <Card style={styles.sentCard}>
          <Check size={20} color={colors.success} />
          <Text style={styles.sentText}>Thanks -- our team will get back to you shortly.</Text>
        </Card>
      ) : (
        <Card>
          <TextField
            label="Message"
            value={message}
            onChangeText={setMessage}
            placeholder="Describe your issue..."
            multiline
            numberOfLines={4}
            style={{ height: 100, textAlignVertical: "top" }}
          />
          <Button label="Send" onPress={handleSend} loading={busy} disabled={!message.trim()} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.black,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  faqCard: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  faqQ: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  faqA: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
  },
  sentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sentText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
});
