import { router } from "expo-router";
import { Mic, Store, Wallet, Wifi } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../components/Button";
import { markOnboardingSeen } from "../lib/onboarding";
import { colors, fonts, radii, spacing } from "../theme";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    icon: Wifi,
    title: "Connect your robot",
    body: "Pair your Buildo over Wi-Fi or its built-in SIM in just a few taps -- no cables, no setup hassle.",
  },
  {
    icon: Wallet,
    title: "Top up your wallet",
    body: "Keep your robot's wallet funded to unlock new apps and skills whenever you need them.",
  },
  {
    icon: Mic,
    title: "Just say the word",
    body: "Give your robot voice commands and watch it get to work around the house.",
  },
  {
    icon: Store,
    title: "Discover the app store",
    body: "Browse apps built by Buildo creators and install them straight onto your robot.",
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const isLast = index === SLIDES.length - 1;

  async function finish() {
    await markOnboardingSeen();
    router.replace("/login");
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }
    scrollRef.current?.scrollTo({ x: width * (index + 1), animated: true });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Pressable onPress={finish} style={[styles.skip, { top: insets.top + spacing.sm }]} hitSlop={12}>
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
      >
        {SLIDES.map((slide, i) => {
          const Icon = slide.icon;
          return (
            <View key={i} style={[styles.slide, { width }]}>
              <View style={styles.iconWrap}>
                <Icon size={40} color={colors.sandDark} strokeWidth={1.5} />
              </View>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <Button label={isLast ? "Get started" : "Next"} onPress={next} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skip: {
    position: "absolute",
    right: spacing.lg,
    zIndex: 1,
    padding: spacing.sm,
  },
  skipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.textMuted,
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: radii.lg,
    backgroundColor: colors.sandSurface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.black,
    textAlign: "center",
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.borderStrong,
  },
  dotActive: {
    backgroundColor: colors.sandDark,
    width: 20,
  },
});
