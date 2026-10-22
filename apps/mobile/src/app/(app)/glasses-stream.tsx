// Live video from the glasses -- a real RTSP + RTP/JPEG client (see
// src/lib/glasses/rtsp-client.ts and rtp-jpeg.ts), not a standard video
// player: this protocol streams MJPEG (RFC 2435), which off-the-shelf RTSP
// players don't decode. Each reassembled JPEG frame is rendered directly as
// an <Image>, base64-encoded -- no native video component involved at all.
//
// Not yet validated end-to-end against real hardware. The RTP/JPEG
// reconstruction was checked structurally (marker/length self-consistency)
// but real RTSP servers vary, so the exact request sequence in
// rtsp-client.ts may need adjusting once tried for real.
import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RtspJpegClient } from "../../lib/glasses/rtsp-client";
import { colors, fonts, radii, spacing } from "../../theme";

type PanelState = "idle" | "connecting" | "streaming" | "error";

function StreamPanel({ label, url, localPort }: { label: string; url: string | null; localPort: number }) {
  const clientRef = useRef<RtspJpegClient | null>(null);
  const [state, setState] = useState<PanelState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!url) return;
    // Starting a network client on mount is exactly the "synchronize with
    // an external system" case this hook is for -- there's no way to show
    // a "connecting" indicator for an async operation without setting it
    // here before that operation starts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("connecting");
    setError(null);
    setFrameCount(0);

    const client = new RtspJpegClient(
      url,
      localPort,
      undefined, // this screen has no hotspot gateway IP to bind to; see rtsp-client.ts's constructor comment
      (frame) => {
        setState("streaming");
        setFrameCount((c) => c + 1);
        setFrameUri(`data:image/jpeg;base64,${frame.jpeg.toString("base64")}`);
      },
      (line) => setLog((prev) => [line, ...prev].slice(0, 20))
    );
    clientRef.current = client;
    client.start().catch((err) => {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      client.stop().catch(() => undefined);
      clientRef.current = null;
    };
  }, [url, localPort]);

  if (!url) {
    return (
      <View style={styles.panel}>
        <Text style={styles.panelLabel}>{label} · no RTSP URL yet</Text>
        <View style={[styles.video, styles.videoEmpty]}>
          <Text style={styles.panelHint}>Connect over Wi-Fi first (Debug screen) to get this side&apos;s URL.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>
        {label} · {state} · {frameCount} frames
      </Text>
      {frameUri ? (
        <Image source={{ uri: frameUri }} style={styles.video} resizeMode="contain" />
      ) : (
        <View style={[styles.video, styles.videoEmpty]}>
          <Text style={styles.panelHint}>{state === "connecting" ? "Connecting…" : "Waiting for the first frame…"}</Text>
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Text selectable style={styles.urlText}>
        {url}
      </Text>
      {log.map((line, i) => (
        <Text key={i} style={styles.logLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

// Always an explicit, unconditional navigation to the Debug screen --
// router.back()/canGoBack() landed on the home tab instead in practice:
// both this screen and glasses-debug are hidden routes nested in the tabs
// layout (see _layout.tsx), and the tabs navigator's own back-stack
// handling for a hidden route doesn't behave like a plain stack push/pop.
// Debug is always the right place to return to from here regardless, so
// there's no good reason to rely on history at all.
function closeOrGoDebug() {
  router.replace("/glasses-debug");
}

export default function GlassesStreamScreen() {
  const insets = useSafeAreaInsets();
  const { leftRtsp, rightRtsp } = useLocalSearchParams<{ leftRtsp?: string; rightRtsp?: string }>();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <Pressable onPress={closeOrGoDebug} style={styles.closeBtn} hitSlop={12}>
        <X size={20} color={colors.background} />
      </Pressable>
      <Text style={styles.title}>Stream</Text>
      <Text style={styles.subtitle}>
        Real RTP/JPEG client, not a standard video player (this protocol is MJPEG). Not yet confirmed against real
        hardware -- if frames never arrive, the log below each panel shows exactly where the RTSP handshake got to.
      </Text>

      {/* Fixed, distinct local UDP ports per side -- see rtsp-client.ts's
          constructor comment for why these can't be 0/"any free port". */}
      <StreamPanel label="Left (master)" url={leftRtsp ?? null} localPort={15000} />
      <StreamPanel label="Right (slave)" url={rightRtsp ?? null} localPort={15010} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
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
    backgroundColor: "rgba(255,255,255,0.12)",
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.background,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(245,241,232,0.6)",
    marginTop: 2,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  panel: {
    marginBottom: spacing.lg,
  },
  panelLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.background,
    marginBottom: spacing.sm,
  },
  panelHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: "rgba(245,241,232,0.5)",
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  video: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#000",
    borderRadius: radii.md,
  },
  videoEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  errorText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xs,
  },
  urlText: {
    fontFamily: fonts.technical,
    fontSize: 10,
    color: "rgba(245,241,232,0.4)",
    marginTop: spacing.xs,
  },
  logLine: {
    fontFamily: fonts.technical,
    fontSize: 9,
    color: "rgba(245,241,232,0.35)",
    marginTop: 2,
  },
});
