// Live glasses video, shared by the Debug screen and the Skills recording
// screen -- one RTSP/RTP/JPEG rendering path, not two copies.
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { RtspJpegClient } from "../lib/glasses/rtsp-client";
import { colors, fonts, radii, spacing } from "../theme";

// Keeps the last decoded frame visible until the next one finishes decoding
// (onLoad), instead of flickering black between frames on Android.
function FlickerFreeFrame({ uri, style }: { uri: string | null; style: StyleProp<ViewStyle> }) {
  const [shown, setShown] = useState<string | null>(null);
  const pendingUri = uri && uri !== shown ? uri : null;

  return (
    <View style={style}>
      {shown ? <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
      {pendingUri ? (
        <Image
          key={pendingUri}
          source={{ uri: pendingUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLoad={() => setShown(pendingUri)}
        />
      ) : null}
    </View>
  );
}

export function GlassesVideoPanel({
  label,
  url,
  localPort,
  localAddress,
  onLog,
  style,
  hideLabel = false,
}: {
  label: string;
  url: string | null;
  localPort: number;
  localAddress: string | null;
  onLog: (line: string) => void;
  style?: StyleProp<ViewStyle>;
  hideLabel?: boolean;
}) {
  const clientRef = useRef<RtspJpegClient | null>(null);
  const [state, setState] = useState<"connecting" | "streaming" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);

  useEffect(() => {
    if (!url) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("connecting");
    setError(null);
    setFrameCount(0);
    setFrameUri(null);

    // Makes a torn-down client's own callbacks inert, since stop() doesn't
    // cancel an already in-flight request that could resolve afterwards.
    let cancelled = false;

    const client = new RtspJpegClient(
      url,
      localPort,
      localAddress ?? undefined,
      (frame) => {
        if (cancelled) return;
        setState("streaming");
        setFrameCount((c) => c + 1);
        setFrameUri(`data:image/jpeg;base64,${frame.jpeg.toString("base64")}`);
      },
      (line) => onLog(`${label}: ${line}`)
    );
    clientRef.current = client;
    client.start().catch((err) => {
      if (cancelled) return;
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      client.stop().catch(() => undefined);
      clientRef.current = null;
    };
  }, [url, label, localPort, localAddress, onLog]);

  if (!url) return null;

  return (
    <View style={[styles.panel, style]}>
      {hideLabel ? null : (
        <Text style={styles.panelLabel}>
          {label} · {state} · {frameCount} frames
        </Text>
      )}
      {frameUri ? (
        <FlickerFreeFrame uri={frameUri} style={styles.video} />
      ) : (
        <View style={[styles.video, styles.videoEmpty]}>
          <Text style={styles.panelHint}>{state === "connecting" ? "Connecting…" : "Waiting for the first frame…"}</Text>
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
  },
  panelLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  panelHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  video: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#000",
    borderRadius: radii.md,
    overflow: "hidden",
  },
  videoEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
