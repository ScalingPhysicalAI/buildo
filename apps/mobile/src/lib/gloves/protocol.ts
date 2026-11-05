// Wire format for the haptic glove, per PROTOCOL_GLOVES_UPDATED.md. Pure
// types + (de)serializers only -- no I/O here, mirrors glasses/protocol.ts's
// split.
//
// Deliberately NOT implemented: the optional time-sync procedure (§3.4) and
// the always-on UDP teleop feed (now documented separately in
// docs/TELEOPERATION.md, whose destination is a compile-time firmware
// constant the app can't set). Neither is needed for connect -> stream ->
// disconnect; add them if a real use for either comes up.

// -- Shared shapes ----------------------------------------------------------

export interface GloveWifiStatus {
  connected: boolean;
  ssid: string | null;
  rssi: number | null;
  drops: number;
  connects: number;
  attempts: number;
  down_s: number | null;
  last_outage_s: number | null;
}

// -- BLE setup channel (Nordic UART) -----------------------------------------

export interface GloveInfoAck {
  type: "ack";
  cmd: "info";
  ok: true;
  // app_ip: null means no override was ever set, i.e. the glove is
  // auto-targeting the Wi-Fi gateway -- not that it has no receiver.
  info: { device: "glove"; fw: string; wifi: GloveWifiStatus; app_ip: string | null };
}

// -- Unsolicited BLE pushes (§2.4) -------------------------------------------

// "down"/"status" carry the connection-history fields below; "up" carries
// none of them. "ssid" is only ever present on "status". All of that is
// optional here rather than three separate per-event shapes, since nothing
// reads most of these fields today.
export interface GloveWifiEvent {
  type: "wifi";
  event: "down" | "status" | "up";
  role: "glove";
  ssid?: string | null;
  rssi?: number;
  drops?: number;
  connects?: number;
  attempts?: number;
  down_s?: number | null;
  last_outage_s?: number | null;
  reason?: string | null;
  t_us?: number;
  [key: string]: unknown;
}

export function isGloveWifiEvent(message: Record<string, unknown>): message is GloveWifiEvent {
  return message.type === "wifi" && message.role === "glove";
}

// -- Wi-Fi command channel (TCP 5010) ----------------------------------------

export interface HelloMessage {
  type: "hello";
  device: "glove";
  fw: string;
  reset_reason: string;
  boot: number;
  reconnected: boolean;
  imu_slots: number;
  fsr_fingers: number;
  data_port: number;
  // This boot's data-channel session id (32 hex chars), per
  // DATA_ENCRYPTION.md -- not secret, and not this app's to use (it never
  // decrypts anything); just store/forward it like everything else here so
  // a server can derive this session's AES/HMAC keys from it later.
  sid: string;
  // Not shown in PROTOCOL_GLOVES_UPDATED.md's own hello example (the
  // teleop feed is now documented separately in docs/TELEOPERATION.md) --
  // optional so a firmware that still sends it doesn't fail to parse, but
  // nothing here depends on it (teleop is explicitly out of scope).
  teleop_port?: number;
  wifi: GloveWifiStatus;
  t_us: number;
}

export interface StatusMessage {
  type: "status";
  wifi: GloveWifiStatus;
  data: { sent: number; dropped: number; replay_dropped: number };
}

export interface AckMessage {
  type: "ack";
  ref?: number;
  cmd?: string;
  ok: boolean;
  t_us?: number;
  info?: Record<string, unknown>;
  wifi?: GloveWifiStatus;
  error?: string;
  [key: string]: unknown;
}

export type CommandChannelMessage = HelloMessage | StatusMessage | AckMessage;

export function parseCommandLine(line: string): CommandChannelMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const msg = parsed as Record<string, unknown>;
  switch (msg.type) {
    case "hello":
    case "status":
    case "ack":
      return msg as unknown as CommandChannelMessage;
    default:
      return null;
  }
}

// Commands the app may send, over BLE (setup) or TCP 5010 (once Wi-Fi is
// up) -- `seq` only ever applies on the TCP side, per §2.3/§3.2.
//
// `start`/`stop` are TCP-only (§3.5) -- by the time an episode could
// meaningfully start, Wi-Fi is already up and BLE advertising has stopped,
// so there's no BLE connection left to send them over anyway. Their ack can
// carry `error: "busy"` (a different episode is already running) or
// `error: "bad_episode"` (stop named one that isn't the active one) -- both
// just surface through AckMessage.error, no dedicated type needed.
export type GloveCommand =
  | { cmd: "info" }
  | { cmd: "wifi"; ssid: string; key: string; seq?: number }
  // ip omitted (or null) clears any saved override and falls back to
  // auto-targeting the Wi-Fi gateway -- the normal case on our own hotspot,
  // where the gateway IS the phone. Only send a real ip when the receiver
  // isn't the gateway (e.g. a bench-test receiver on a shared network).
  | { cmd: "app_ip"; ip?: string | null; seq?: number }
  | { cmd: "reconnect"; seq?: number }
  | { cmd: "forget_wifi"; seq?: number }
  | { cmd: "status"; seq?: number }
  | { cmd: "start"; episode: string; seq?: number }
  | { cmd: "stop"; episode: string; seq?: number }
  | { cmd: "data_ack"; data_seq: number };

export function buildCommandLine(command: GloveCommand): string {
  return `${JSON.stringify(command)}\n`;
}

// -- Wi-Fi data channel (TCP 5008) -- fixed-size binary, no JSON -----------
//
// Per DATA_ENCRYPTION.md, every frame on the wire is now WIRE_HAND_PACKET_SIZE
// (302, the plaintext WireHandPacket's own size) + 16 bytes of appended HMAC
// tag = GLOVE_WIRE_FRAME_SIZE (318). Only bytes 0-15 (bootId/seq/
// assembledAtMs) stay plaintext; this app has no key, so it reads exactly
// those 16 bytes for dedup/replay tracking and otherwise never decodes a
// real frame -- parseWireHandPacket below now only parses already-decrypted
// 302-byte plaintext (produced server-side, or by the dummy-data generator
// for the hand-view demo), never a raw 318-byte frame off the wire.

export const WIRE_HAND_PACKET_SIZE = 302;
export const GLOVE_WIRE_FRAME_SIZE = WIRE_HAND_PACKET_SIZE + 16;
const IMU_SLOT_COUNT = 12;
const IMU_SLOT_SIZE = 18;
const FSR_FINGER_COUNT = 5;
const FSR_FINGER_SIZE = 14;
const IMU_SECTION_OFFSET = 16;
const FSR_SECTION_OFFSET = IMU_SECTION_OFFSET + IMU_SLOT_COUNT * IMU_SLOT_SIZE; // 232

export interface WireImuSample {
  present: boolean;
  w: number;
  x: number;
  y: number;
  z: number;
  accuracy: number;
}

export interface WireFsrFinger {
  present: boolean;
  buttons: number;
  channels: [number, number, number, number, number, number];
}

export interface WireHandPacket {
  bootId: number;
  seq: number;
  assembledAtMs: number;
  imu: WireImuSample[];
  fsr: WireFsrFinger[];
}

// uint64 little-endian as a regular JS number -- buffer@5.7.1 (this app's
// polyfill) has no readBigUInt64LE, and ms-since-boot won't overflow
// Number.MAX_SAFE_INTEGER for a very long time (hundreds of years), so a
// plain low+high*2^32 combine is both all this polyfill offers and
// perfectly accurate for this field. Exported -- glove-link.ts reads just
// this field (bytes 0-15 stay plaintext even in an encrypted frame) without
// going through full parseWireHandPacket, which now only applies to
// already-decrypted plaintext.
export function readUInt64LE(buf: Buffer, offset: number): number {
  const low = buf.readUInt32LE(offset);
  const high = buf.readUInt32LE(offset + 4);
  return low + high * 4294967296;
}

// Throws if `buf` isn't exactly WIRE_HAND_PACKET_SIZE bytes -- callers must
// slice exactly one packet's worth before calling this, never a partial or
// multi-packet buffer.
export function parseWireHandPacket(buf: Buffer): WireHandPacket {
  if (buf.length !== WIRE_HAND_PACKET_SIZE) {
    throw new Error(`parseWireHandPacket: expected ${WIRE_HAND_PACKET_SIZE} bytes, got ${buf.length}`);
  }

  const bootId = buf.readUInt32LE(0);
  const seq = buf.readUInt32LE(4);
  const assembledAtMs = readUInt64LE(buf, 8);

  const imu: WireImuSample[] = [];
  for (let i = 0; i < IMU_SLOT_COUNT; i++) {
    const o = IMU_SECTION_OFFSET + i * IMU_SLOT_SIZE;
    imu.push({
      present: buf.readUInt8(o) === 1,
      w: buf.readFloatLE(o + 1),
      x: buf.readFloatLE(o + 5),
      y: buf.readFloatLE(o + 9),
      z: buf.readFloatLE(o + 13),
      accuracy: buf.readUInt8(o + 17),
    });
  }

  const fsr: WireFsrFinger[] = [];
  for (let i = 0; i < FSR_FINGER_COUNT; i++) {
    const o = FSR_SECTION_OFFSET + i * FSR_FINGER_SIZE;
    fsr.push({
      present: buf.readUInt8(o) === 1,
      buttons: buf.readUInt8(o + 1),
      channels: [
        buf.readInt16LE(o + 2),
        buf.readInt16LE(o + 4),
        buf.readInt16LE(o + 6),
        buf.readInt16LE(o + 8),
        buf.readInt16LE(o + 10),
        buf.readInt16LE(o + 12),
      ],
    });
  }

  return { bootId, seq, assembledAtMs, imu, fsr };
}
