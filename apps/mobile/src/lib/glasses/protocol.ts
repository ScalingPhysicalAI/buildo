// Wire format for the glasses system (master Nicla + cable-linked slave),
// per PROTOCOL_GLASSES.md and EPISODES.md (firmware team spec). Pure types
// + (de)serializers only -- no I/O here, so this can be exercised without a
// socket or any hardware.

// -- Shared shapes --------------------------------------------------------

export interface WifiStatus {
  state?: "connected" | "connecting" | string;
  status?: string;
  ssid: string | null;
  ip?: string | null;
  rssi: number | null;
  drops: number;
  connects: number;
  attempts: number;
  down_s: number | null;
  last_outage_s: number | null;
  connected?: boolean;
}

export interface SlaveStatus {
  ok: boolean;
  ip?: string;
  wifi: "no-credentials" | "connecting" | "connected" | "wrong-password" | "network-not-found" | "connect-failed" | "off" | string;
  wifi_up?: boolean;
  state: "idle" | "arming" | "ready" | "recording" | string;
  creds: "synced" | "pending" | "none" | string;
  fps?: number;
  playing?: boolean;
  paired?: number;
  unpaired?: number;
}

export interface BatterySide {
  pct: number | null;
  v: number | null;
  ma?: number | null;
  source: "usb" | "battery" | null;
  charging: "charging" | "precharge" | "topping_off" | "full" | "off" | "timer_fault" | "too_hot_or_cold" | "battery_overvoltage" | string | null;
  present: boolean;
  tte_min?: number | null;
  ttf_min?: number | null;
}

export interface BatteryInfo {
  left: BatterySide | null;
  right: BatterySide | null;
}

// -- Command channel (TCP 5010) -------------------------------------------

export interface HelloMessage {
  type: "hello";
  device: "glasses";
  role: "master";
  side: "left";
  fw: string;
  boot: number;
  ip: string;
  rtsp: string;
  video_transport: string;
  data_port: number;
  width: number;
  height: number;
  calib: "ok" | "none" | string;
  wifi: WifiStatus;
  reconnected: boolean;
  state: "idle" | "recording";
  episode: unknown;
  last_episode: unknown;
  slave: SlaveStatus;
  battery: BatteryInfo;
  t_us: number;
}

export interface StatusMessage {
  type: "status";
  t_us?: number;
  state: "idle" | "recording";
  episode: unknown;
  fps: number;
  // Live on the real device's status push (confirmed against an actual raw
  // dump), not just inside wifi.rssi -- the doc's own illustrative example
  // didn't show these, real firmware does.
  rssi?: number | null;
  heap?: number;
  wifi: WifiStatus;
  video?: { client: boolean; playing: boolean; on: boolean; every?: number; quality?: number };
  data: { sent: number; dropped: number; connected: boolean; queued_bytes: number };
  slave: SlaveStatus;
  battery: BatteryInfo;
  sync?: { offset_us: number; rtt_us: number; age_s: number };
}

export interface AckMessage {
  type: "ack";
  ref?: number;
  cmd?: string;
  ok: boolean;
  t_us?: number;
  episode?: unknown;
  summary?: unknown;
  status?: unknown;
  error?: string;
  detail?: string;
  repeated?: boolean;
  warnings?: string[];
  burst?: boolean;
  [key: string]: unknown;
}

export interface PeerMessage {
  type: "peer";
  role: "slave";
  side: "right";
  rtsp: string | null;
  video_transport?: string;
  ok: boolean;
}

export interface EpisodeEventMessage {
  type: "episode";
  event: "start" | "slave_lost" | "slave_back" | "battery_low" | "stop";
  ep: string;
  reason?: string;
  [key: string]: unknown;
}

export interface PongMessage {
  type: "pong";
  id: number;
  t_us: number;
}

export type CommandChannelMessage =
  | HelloMessage
  | StatusMessage
  | AckMessage
  | PeerMessage
  | EpisodeEventMessage
  | PongMessage;

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
    case "peer":
    case "episode":
    case "pong":
      return msg as unknown as CommandChannelMessage;
    default:
      return null;
  }
}

// Commands the app may send on the command channel (TCP 5010). `seq` is
// optional here -- GlassesLink.sendCommand() injects one if omitted -- but
// ping (uses `id`), reconnect and sync_end never carry one, per
// PROTOCOL_GLASSES.md's command table.
export type GlassesCommand =
  | { cmd: "start"; episode: string; seq?: number; require_slave?: boolean }
  | { cmd: "stop"; episode: string; seq?: number }
  | { cmd: "video"; on: boolean; every?: number; quality?: number; seq?: number }
  | { cmd: "status"; seq?: number }
  | { cmd: "sync"; seq?: number }
  | { cmd: "ping"; id: number }
  | { cmd: "sync_end"; offset_us: number; rtt_us: number }
  | { cmd: "reconnect" }
  // Refused with {ok:false, error:"recording"} while an episode is active --
  // must come after `stop`. Ack first, then ~0.5s later the board closes
  // this TCP connection and Glasses-L starts advertising over BLE again.
  | { cmd: "forget_wifi"; seq?: number };

export function buildCommandLine(command: GlassesCommand): string {
  return `${JSON.stringify(command)}\n`;
}

// -- Data channel (TCP 5005) -----------------------------------------------

export interface DataHelloMessage {
  type: "data_hello";
  src: "master";
  boot: number;
  next_seq: number;
  resend_from: number;
}

export interface CameraDetection {
  t_us: number;
  x: number;
  y: number;
  found: boolean;
  score: number;
  rtp_ts: number | null;
  dt_us: number;
  imu?: { a: [number, number, number]; g: [number, number, number] };
}

export interface FrameMessage {
  type: "frame";
  ep: string;
  N: number;
  t_us: number;
  left: CameraDetection;
  right: CameraDetection | null;
  skew_us: number;
  depth: { xyz_mm: [number, number, number]; gap_mm: number } | null;
  v: number;
  src: "master";
  seq: number;
}

export interface DataEpisodeMarker {
  type: "episode";
  event: "start" | "stop";
  ep: string;
  [key: string]: unknown;
}

export type DataChannelMessage = DataHelloMessage | FrameMessage | DataEpisodeMarker;

export function parseDataLine(line: string): DataChannelMessage | null {
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
  if (msg.type === "data_hello" || msg.type === "frame" || msg.type === "episode") {
    return msg as unknown as DataChannelMessage;
  }
  return null;
}

// The app's own ack line back to the board on the data channel -- not a
// `type`-tagged message, just `{"ack":<seq>}\n` per spec.
export function buildDataAckLine(highestSeq: number): string {
  return `${JSON.stringify({ ack: highestSeq })}\n`;
}
