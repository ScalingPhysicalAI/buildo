import DottedMapWithoutCountries from "dotted-map/without-countries";
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Circle, Svg } from "react-native-svg";

const BASE_DOT_COLOR = "rgba(255,255,255,0.22)";
const BASE_DOT_RADIUS = 0.26;

import worldGrid from "../lib/world-map-grid.json";
import { fonts, radii, spacing } from "../theme";

// Cities with heavier Buildo deployment -- rendered bigger/brighter and,
// for a handful, with a pulsing "live" ring overlaid on top of the static
// SVG dots (see PULSE_CITIES below) to read as an actively-growing network
// rather than a flat illustration.
const US_UK_CITIES = [
  { lat: 40.7128, lng: -74.006 }, // New York
  { lat: 37.7749, lng: -122.4194 }, // San Francisco
  { lat: 34.0522, lng: -118.2437 }, // Los Angeles
  { lat: 41.8781, lng: -87.6298 }, // Chicago
  { lat: 30.2672, lng: -97.7431 }, // Austin
  { lat: 25.7617, lng: -80.1918 }, // Miami
  { lat: 51.5072, lng: -0.1276 }, // London
  { lat: 53.4808, lng: -2.2426 }, // Manchester
];

const INDIA_CITIES = [
  { lat: 19.076, lng: 72.8777 }, // Mumbai
  { lat: 28.7041, lng: 77.1025 }, // Delhi
  { lat: 12.9716, lng: 77.5946 }, // Bangalore
  { lat: 17.385, lng: 78.4867 }, // Hyderabad
];

const OTHER_CITIES = [
  { lat: 52.52, lng: 13.405 }, // Berlin
  { lat: 48.8566, lng: 2.3522 }, // Paris
  { lat: 35.6762, lng: 139.6503 }, // Tokyo
  { lat: 1.3521, lng: 103.8198 }, // Singapore
  { lat: -33.8688, lng: 151.2093 }, // Sydney
  { lat: 25.2048, lng: 55.2708 }, // Dubai
  { lat: 43.6532, lng: -79.3832 }, // Toronto
  { lat: -23.5505, lng: -46.6333 }, // São Paulo
];

const PULSE_CITIES = [
  { lat: 40.7128, lng: -74.006 }, // New York
  { lat: 37.7749, lng: -122.4194 }, // San Francisco
  { lat: 51.5072, lng: -0.1276 }, // London
  { lat: 19.076, lng: 72.8777 }, // Mumbai
];

function PulseDot({ left, top }: { left: number; top: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 5] });
  const opacity = pulse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.65, 0.2, 0] });

  return (
    <View style={[styles.pulseWrap, { left: `${left}%`, top: `${top}%` }]}>
      <Animated.View style={[styles.pulseRing, { opacity, transform: [{ scale }] }]} />
      <View style={styles.pulseCore} />
    </View>
  );
}

export function GlobalReachMap() {
  // Points are rendered as native <Circle> elements straight from dotted-map's
  // own point array -- no SVG string is built/parsed here (SvgXml's string
  // parse was the actual cost on first mount; going object -> React element
  // skips that entirely and is what made the tab feel laggy).
  const { points, width, height, aspectRatio, pulsePoints } = useMemo(() => {
    const map = new DottedMapWithoutCountries({ map: worldGrid as any });

    US_UK_CITIES.forEach((c) => map.addPin({ lat: c.lat, lng: c.lng, svgOptions: { color: "#FFFFFF", radius: 0.55 } }));
    INDIA_CITIES.forEach((c) => map.addPin({ lat: c.lat, lng: c.lng, svgOptions: { color: "#FFFFFF", radius: 0.55 } }));
    OTHER_CITIES.forEach((c) =>
      map.addPin({ lat: c.lat, lng: c.lng, svgOptions: { color: "rgba(255,255,255,0.6)", radius: 0.36 } })
    );

    const pulsePins = PULSE_CITIES.map((c) =>
      map.addPin({ lat: c.lat, lng: c.lng, svgOptions: { color: "#FFFFFF", radius: 0.55 } })
    );

    return {
      points: map.getPoints(),
      width: map.image.width,
      height: map.image.height,
      aspectRatio: map.image.width / map.image.height,
      pulsePoints: pulsePins.map((p) => ({ left: (p.x / map.image.width) * 100, top: (p.y / map.image.height) * 100 })),
    };
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Buildo's global reach</Text>
          <Text style={styles.subtitle}>Live network of deployed Buildo robots worldwide</Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveBadgeText}>LIVE</Text>
        </View>
      </View>

      <View style={[styles.mapWrap, { aspectRatio }]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
          {points.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.svgOptions?.radius ?? BASE_DOT_RADIUS}
              fill={p.svgOptions?.color ?? BASE_DOT_COLOR}
            />
          ))}
        </Svg>
        {pulsePoints.map((p, i) => (
          <PulseDot key={i} left={p.left} top={p.top} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0B1016",
    borderRadius: radii.lg,
    padding: spacing.lg,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: "#FFFFFF",
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    marginTop: 2,
    maxWidth: 220,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm,
    marginTop: 2,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#4ADE80",
  },
  liveBadgeText: {
    fontFamily: fonts.technical,
    fontSize: 10,
    letterSpacing: 0.6,
    color: "#4ADE80",
  },
  mapWrap: {
    width: "100%",
  },
  pulseWrap: {
    position: "absolute",
    width: 0,
    height: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FFFFFF",
  },
  pulseCore: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
});
