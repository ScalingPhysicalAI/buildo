// Live glasses video, shared by the Debug screen and the Skills recording
// screen -- one RTSP/RTP/JPEG rendering path, not two copies.
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { RtspJpegClient, type RawRtpPacket, type RtpJpegFrame } from "../lib/glasses/rtsp-client";
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
  onFrame,
  onRawPacket,
  style,
  hideLabel = false,
}: {
  label: string;
  url: string | null;
  localPort: number;
  localAddress: string | null;
  onLog: (line: string) => void;
  // Fires alongside the panel's own display update, same frame -- lets a
  // caller (the Skill recording screen) save every frame to disk without
  // opening a second RTSP connection of its own. Only ever fires for
  // unencrypted video now (see rtsp-client.ts) -- onRawPacket below is
  // what real recordings actually use.
  onFrame?: (frame: RtpJpegFrame) => void;
  // Every UDP packet, undecoded -- what gets saved now that video is
  // encrypted and this app has no key to decode it with.
  onRawPacket?: (packet: RawRtpPacket) => void;
  style?: StyleProp<ViewStyle>;
  hideLabel?: boolean;
}) {
  const clientRef = useRef<RtspJpegClient | null>(null);
  const [state, setState] = useState<"connecting" | "streaming" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  // Raw-capture mode (onRawPacket set) never gets an onFrame callback --
  // video is encrypted, this app can't decode it -- so frameCount above
  // would otherwise stay 0 forever. Tracked separately so the panel can
  // still show *something* moving instead of "Waiting for the first
  // frame…" forever.
  const [rawPacketCount, setRawPacketCount] = useState(0);
  const [lastEncHeader, setLastEncHeader] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("connecting");
    setError(null);
    setFrameCount(0);
    setFrameUri(null);
    setRawPacketCount(0);
    setLastEncHeader(null);

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
        onFrame?.(frame);
      },
      (line) => onLog(`${label}: ${line}`),
      onRawPacket
        ? (packet) => {
            if (cancelled) return;
            setState("streaming");
            setRawPacketCount((c) => c + 1);
            setLastEncHeader(packet.encHeader);
            onRawPacket(packet);
          }
        : undefined
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
  }, [url, label, localPort, localAddress, onLog, onFrame, onRawPacket]);

  if (!url) return null;

  return (
    <View style={[styles.panel, style]}>
      {hideLabel ? null : (
        <Text style={styles.panelLabel}>
          {label} · {state} · {onRawPacket ? `${rawPacketCount} packets` : `${frameCount} frames`}
        </Text>
      )}
      {frameUri ? (
        <FlickerFreeFrame uri={frameUri} style={styles.video} />
      ) : onRawPacket ? (
        // No preview is possible here -- the payload is encrypted and this
        // app has no key to decode it with -- so show that data is actually
        // flowing instead of a preview box that can never fill in.
        <View style={[styles.video, styles.videoEmpty, styles.rawBox]}>
          <Text style={styles.panelHint}>
            {state === "connecting"
              ? "Connecting…"
              : rawPacketCount === 0
                ? "Waiting for the first encrypted packet…"
                : "Encrypted -- no preview available"}
          </Text>
          {rawPacketCount > 0 ? (
            <>
              <Text style={styles.rawStat}>{rawPacketCount} raw packets received</Text>
              <Text style={styles.rawStat}>session: {lastEncHeader ?? "(none)"}</Text>
            </>
          ) : null}
        </View>
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
  rawBox: {
    gap: 4,
    paddingHorizontal: spacing.sm,
  },
  rawStat: {
    fontFamily: fonts.technical,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
