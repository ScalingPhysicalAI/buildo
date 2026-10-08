// Wire format for the glasses master board, per "Glasses Integration: Packet
// Spec" (@zaid, Oct 5 2026). Pure types + (de)serializers only -- no I/O here,
// so this can be exercised without a socket or any hardware.

export interface Vec3 {
  a: [number, number, number];
  g: [number, number, number];
}

export interface CameraDetection {
  x: number;
  y: number;
  found: boolean;
  fid: number;
}

export interface GlovePosition {
  X: number;
  Y: number;
  Z: number;
  valid: boolean;
}

export interface SyncInfo {
  dt_left_us: number;
  dt_right_us: number;
  offset_us: number;
}

interface Envelope {
  v: number;
  src: "glasses";
  seq: number;
  t_ms: number;
}

export interface TelemetryMessage extends Envelope {
  type: "telemetry";
  pulse: number;
  sync: SyncInfo;
  left: CameraDetection;
  right: CameraDetection;
  glove: GlovePosition;
  imu: { left: Vec3; right: Vec3 };
  dropped: number;
}

export interface HelloMessage extends Envelope {
  type: "hello";
  device: string;
  fw: string;
  calib: unknown;
  ip: string;
}

export interface StatusMessage extends Envelope {
  type: "status";
  streaming: boolean;
  frames: boolean;
  wifi_rssi: number;
  fps: number;
}

export interface AckMessage extends Envelope {
  type: "ack";
  ref: number;
  ok: boolean;
}

export type BoardMessage = TelemetryMessage | HelloMessage | StatusMessage | AckMessage;

// The spec says "ignore unknown fields" -- so this only checks the shape we
// actually read from, and never rejects a line for having extra keys.
export function parseBoardLine(line: string): BoardMessage | null {
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
  if (typeof msg.type !== "string" || typeof msg.seq !== "number") return null;

  switch (msg.type) {
    case "telemetry":
    case "hello":
    case "status":
    case "ack":
      return msg as unknown as BoardMessage;
    default:
      return null;
  }
}

// Commands the app may send to the board, over the same 5005 connection used
// for telemetry. Anything else the board doesn't recognize comes back
// `ok:false` -- that validation lives on the board, not here.
export type GlassesCommand =
  | { cmd: "stream"; on: boolean }
  | { cmd: "frames"; on: boolean; every?: number; quality?: number }
  | { cmd: "reconnect" }
  | { cmd: "wifi_off" };

export function buildCommandLine(command: GlassesCommand, seq: number): string {
  return `${JSON.stringify({ ...command, seq })}\n`;
}

// Frame header: 20 bytes, little-endian, immediately followed by `length`
// JPEG bytes. Repeats for every frame on ports 5006 (left) / 5007 (right).
export const FRAME_HEADER_SIZE = 20;
const MAGIC_F = 0x46; // "F"
const MAGIC_R = 0x52; // "R"

export interface FrameHeader {
  cam: 0 | 1;
  frameId: number;
  pulse: number;
  dtUs: number;
  length: number;
}

export function parseFrameHeader(buf: Uint8Array): FrameHeader | null {
  if (buf.length < FRAME_HEADER_SIZE) return null;
  if (buf[0] !== MAGIC_F || buf[1] !== MAGIC_R) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    cam: buf[2] === 1 ? 1 : 0,
    // byte 3 is reserved
    frameId: view.getUint32(4, true),
    pulse: view.getUint32(8, true),
    dtUs: view.getUint32(12, true),
    length: view.getUint32(16, true),
  };
}
