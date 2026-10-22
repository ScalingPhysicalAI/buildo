// Live glasses video, extracted out of glasses-debug.tsx so the real app
// (Skills recording screen) and the Debug screen can both use the exact
// same, already-verified RTSP/RTP/JPEG rendering path instead of two copies
// drifting apart. No behavior changes from the Debug screen's own version --
// only `localPort` moved from "derived from the label string" to an explicit
// prop, since a label like "Left (master)" was never a robust way to pick a
// port for an arbitrary caller.
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { RtspJpegClient } from "../lib/glasses/rtsp-client";
import { colors, fonts, radii, spacing } from "../theme";

// Swapping a single <Image>'s uri every frame flickers black between frames
// on Android -- each new data: uri is a brand-new image as far as <Image> is
// concerned, so it briefly shows nothing while the new one decodes. This
// keeps the last fully-decoded frame visible and opaque underneath, and only
// swaps to the next one once IT has finished decoding (onLoad), so there's
// never a gap with nothing drawn. A still frame holding one extra beat is
// invisible; a black flash every frame is not.
function FlickerFreeFrame({ uri, style }: { uri: string | null; style: StyleProp<ViewStyle> }) {
  const [shown, setShown] = useState<string | null>(null);
  // Derived directly from props/state each render -- no effect needed: this
  // is "the next thing to load," not state of its own, so there's nothing
  // to synchronize.
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
  // Purely cosmetic, no effect on connection/decode logic -- the Debug
  // screen wants the "label · state · N frames" line for diagnostics, a
  // polished recording screen doesn't.
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

    // Guards against a real race: this effect also reruns when
    // `localAddress` itself arrives/changes (it's in the deps below), which
    // can genuinely happen slightly *after* `url` first does -- the gateway
    // IP is only known once the hotspot has started, hello/peer can land
    // around the same moment. That means an earlier client (started with
    // localAddress still null, the broken default-route case) can still be
    // mid-request when this effect's cleanup stops it and a corrected one
    // takes over. client.stop() tears down the socket but doesn't cancel an
    // in-flight request's own timeout timer, so the OLD client's rejected
    // promise can still fire afterwards and overwrite state the NEW,
    // successfully-streaming client already set. `cancelled` makes a
    // client instance's own callbacks inert once its effect run is done.
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
