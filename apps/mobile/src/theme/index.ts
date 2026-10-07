// Same brand family as apps/portal (see apps/portal/src/app/globals.css) --
// sand/gold accent, Bebas Neue display + Barlow body + Space Mono technical
// -- but light, per this app's own spec ("skill trainer/end users, light
// theme") rather than the portal's dark theme. Same identity, different room.

export const colors = {
  background: "#F5F1E8",
  backgroundAlt: "#EDE6D6",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFDF8",
  black: "#1A1712",
  textPrimary: "#1A1712",
  textMuted: "#7A6F5E",
  textOnSand: "#1A1712",
  sand: "#B89C72",
  sandDark: "#8A6F4A",
  sandLight: "#D4B98A",
  sandSurface: "#F1E7D5",
  border: "rgba(138, 111, 74, 0.16)",
  borderStrong: "rgba(138, 111, 74, 0.32)",
  success: "#16A34A",
  successSurface: "#E7F6EC",
  error: "#DC2626",
  errorSurface: "#FBEAEA",
  recording: "#DC2626",
  white: "#FFFFFF",
} as const;

export const fonts = {
  display: "BebasNeue_400Regular",
  body: "Barlow_400Regular",
  bodyMedium: "Barlow_500Medium",
  bodySemiBold: "Barlow_600SemiBold",
  bodyBold: "Barlow_700Bold",
  technical: "SpaceMono_400Regular",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: "#8A6F4A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
} as const;
