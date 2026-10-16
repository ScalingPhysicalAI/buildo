import { useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, View, type ImageSourcePropType } from "react-native";

const ROBOT_FRONT = require("../../assets/robot-colored.png") as ImageSourcePropType;
// Source render (cropped from robot_colored_render.jpeg, background removed,
// framed to upper body only -- including the full reach of the forward
// hand) is 513x680 -- keep real device proportions at any size.
const ROBOT_ASPECT = 513 / 680;

// Shared "device" visual -- the real Buildo render with a soft ambient glow
// and outward scan rings, used anywhere we show the robot as a live,
// connectable device: the Home tab hero, and the pairing flow while searching.
export function RobotPulse({
  active,
  size = 140,
  source = ROBOT_FRONT,
}: {
  active: boolean;
  size?: number;
  source?: ImageSourcePropType;
}) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      ring1.setValue(0);
      ring2.setValue(0);
      return;
    }
    const makeLoop = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    const loop1 = makeLoop(ring1, 0);
    const loop2 = makeLoop(ring2, 900);
    loop1.start();
    loop2.start();
    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [active]);

  const ringStyle = (value: Animated.Value) => ({
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.4] }) }],
  });

  const glowSize = size * 1.55;
  const ringSize = size * 1.1;

  return (
    <View style={[styles.wrap, { width: glowSize, height: glowSize }]}>
      <View
        style={[
          styles.glow,
          { width: glowSize, height: glowSize, borderRadius: glowSize / 2 },
          active ? styles.glowActive : styles.glowIdle,
        ]}
      />
      {active ? (
        <>
          <Animated.View
            style={[styles.ring, { width: ringSize, height: ringSize, borderRadius: ringSize / 2 }, ringStyle(ring1)]}
          />
          <Animated.View
            style={[styles.ring, { width: ringSize, height: ringSize, borderRadius: ringSize / 2 }, ringStyle(ring2)]}
          />
        </>
      ) : null}
      <Image
        source={source}
        resizeMode="contain"
        // Full opacity in both states -- the renders are already near-black,
        // dimming them further on a dark card just makes them vanish.
        style={{ width: size * ROBOT_ASPECT, height: size }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
  },
  glowActive: {
    backgroundColor: "rgba(184, 156, 114, 0.22)",
  },
  glowIdle: {
    // Cool, neutral backlight (not gold) so an idle robot reads as "off"
    // rather than just a dimmer version of "on", while still rim-lighting
    // the silhouette against the dark card.
    backgroundColor: "rgba(190, 205, 220, 0.1)",
  },
  ring: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: "rgba(184, 156, 114, 0.8)",
  },
});
