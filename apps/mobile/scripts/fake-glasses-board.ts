// Simulates the glasses master board for testing the app's command + data
// channels without real hardware: connects to the phone as a TCP client on
// 5010 (command) and 5005 (data), exactly as PROTOCOL_GLASSES.md describes,
// and reconnects the same way the real board does if a connection drops.
//
// This deliberately skips BLE -- there's no way to fake a real BLE
// peripheral from a laptop without special hardware, and BLE is a small,
// separable piece anyway (it just hands over WiFi credentials once). What
// this DOES exercise for real: the command channel (hello/status/ack/pong,
// start/stop, time sync), and the data channel (data_hello, frame
// streaming, seq/boot dedup, the app's acks) -- the same code paths real
// hardware hits once it's on WiFi and dialing in.
//
// Usage:
//   1. In the app: Gadgets > Debug > "1. Start listeners"
//   2. Find your phone's IP (same WiFi network as the machine running this)
//   3. npx tsx scripts/fake-glasses-board.ts <phone-ip>
import net from "node:net";

const COMMAND_PORT = 5010;
const DATA_PORT = 5005;
const RECONNECT_DELAY_MS = 3000;
const STATUS_INTERVAL_MS = 2000;
const FRAME_INTERVAL_MS = 1000 / 18; // ~18fps, matching the doc's own example

const host = process.argv[2];
if (!host) {
  console.error("Usage: npx tsx scripts/fake-glasses-board.ts <phone-ip>");
  process.exit(1);
}

const boot = Math.floor(Math.random() * 1_000_000_000);
const startedAt = process.hrtime.bigint();
function tUs(): number {
  return Number((process.hrtime.bigint() - startedAt) / 1000n);
}

type RecordingState = "idle" | "recording";
let state: RecordingState = "idle";
let episodeName: string | null = null;
let episodeId = 0;
let frameN = 0;
let dataSeq = 0;
let dataSocketRef: net.Socket | null = null;

function connectWithRetry(port: number, label: string, onConnect: (socket: net.Socket) => void) {
  const socket = net.createConnection({ host, port });
  socket.on("connect", () => {
    console.log(`[${label}] connected`);
    onConnect(socket);
  });
  socket.on("error", (err) => console.log(`[${label}] error: ${err.message}`));
  socket.on("close", () => {
    console.log(`[${label}] closed, retrying in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connectWithRetry(port, label, onConnect), RECONNECT_DELAY_MS);
  });
  return socket;
}

function fakeWifi() {
  return {
    state: "connected",
    status: "got-ip",
    ssid: "FakeNetwork",
    ip: "10.0.0.99",
    rssi: -50,
    drops: 0,
    connects: 1,
    attempts: 0,
    down_s: null,
    last_outage_s: null,
  };
}

function fakeSlave() {
  return {
    ok: true,
    ip: "10.0.0.98",
    wifi: "connected",
    wifi_up: true,
    state,
    creds: "synced",
    fps: state === "recording" ? 18 : 0,
    playing: state === "recording",
    paired: frameN,
    unpaired: 0,
  };
}

function fakeBattery() {
  return {
    left: { pct: 82, v: 3.95, ma: -150, source: "battery", charging: "off", present: true, tte_min: 40, ttf_min: null },
    right: { pct: 79, v: 3.93, source: "usb", charging: "charging", present: true },
  };
}

// -- Command channel (5010) -------------------------------------------------

connectWithRetry(COMMAND_PORT, "command", (socket) => {
  socket.setEncoding("utf8");

  function send(obj: Record<string, unknown>) {
    socket.write(`${JSON.stringify(obj)}\n`);
  }

  send({
    type: "hello",
    device: "glasses",
    role: "master",
    side: "left",
    fw: "fake-1.0.0",
    boot,
    ip: "10.0.0.99",
    rtsp: "rtsp://10.0.0.99:554/",
    video_transport: "udp",
    data_port: DATA_PORT,
    width: 240,
    height: 240,
    calib: "none",
    wifi: fakeWifi(),
    reconnected: false,
    state,
    episode: null,
    last_episode: null,
    slave: fakeSlave(),
    battery: fakeBattery(),
    t_us: tUs(),
  });

  const statusTimer = setInterval(() => {
    send({
      type: "status",
      state,
      episode: episodeName ? { name: episodeName, N: frameN } : null,
      fps: state === "recording" ? 18 : 0,
      wifi: fakeWifi(),
      data: { sent: dataSeq, dropped: 0, connected: dataSocketRef !== null, queued_bytes: 0 },
      slave: fakeSlave(),
      battery: fakeBattery(),
    });
  }, STATUS_INTERVAL_MS);

  function handleCommand(cmd: Record<string, unknown>) {
    switch (cmd.cmd) {
      case "sync":
        send({ type: "ack", ref: cmd.seq, cmd: "sync", ok: true, burst: state === "idle", t_us: tUs() });
        break;
      case "ping":
        send({ type: "pong", id: cmd.id, t_us: tUs() });
        break;
      case "sync_end":
        console.log(`[command] sync_end: offset_us=${cmd.offset_us} rtt_us=${cmd.rtt_us}`);
        break;
      case "status":
        send({ type: "ack", ref: cmd.seq, cmd: "status", ok: true, status: { state }, t_us: tUs() });
        break;
      case "start": {
        if (state === "recording") {
          send({
            type: "ack",
            ref: cmd.seq,
            cmd: "start",
            ok: true,
            repeated: true,
            episode: { name: episodeName, id: episodeId, N: frameN },
            t_us: tUs(),
          });
          break;
        }
        episodeName = String(cmd.episode);
        episodeId++;
        frameN = 0;
        state = "recording";
        setTimeout(() => {
          send({
            type: "ack",
            ref: cmd.seq,
            cmd: "start",
            ok: true,
            episode: { name: episodeName, id: episodeId, N: 0, t0_us: tUs(), duration_s: 0, slave: true, slave_in: true },
            N0: 0,
            t0_us: tUs(),
            sync: { offset_us: 0, rtt_us: 1000, age_s: 0 },
            warnings: [],
          });
          dataSocketRef?.write(
            `${JSON.stringify({
              type: "episode",
              event: "start",
              ep: episodeName,
              id: episodeId,
              N0: 0,
              t_us: tUs(),
              video: { left: true, right: true },
            })}\n`
          );
        }, 1500); // simulate camera warmup -- spec allows up to ~5s
        break;
      }
      case "stop": {
        if (state !== "recording") {
          send({ type: "ack", ref: cmd.seq, cmd: "stop", ok: true, repeated: true, t_us: tUs() });
          break;
        }
        state = "idle";
        send({
          type: "ack",
          ref: cmd.seq,
          cmd: "stop",
          ok: true,
          summary: { frames: frameN, paired: frameN, unpaired: 0, slave_lost: 0, data_dropped: 0, t0_us: 0, t1_us: tUs(), duration_s: frameN / 18 },
          t_us: tUs(),
        });
        dataSocketRef?.write(
          `${JSON.stringify({ type: "episode", event: "stop", ep: episodeName, reason: "command", frames: frameN, paired: frameN })}\n`
        );
        episodeName = null;
        break;
      }
      case "video":
        send({ type: "ack", ref: cmd.seq, cmd: "video", ok: true, t_us: tUs() });
        break;
      case "reconnect":
        console.log("[command] reconnect requested (no-op in fake board)");
        break;
      default:
        console.log(`[command] unknown cmd:`, cmd);
    }
  }

  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      try {
        const cmd = JSON.parse(line);
        console.log("[command] received:", cmd);
        handleCommand(cmd);
      } catch {
        console.log(`[command] bad line from app: ${line}`);
      }
    }
  });

  socket.on("close", () => clearInterval(statusTimer));
});

// -- Data channel (5005) ------------------------------------------------

connectWithRetry(DATA_PORT, "data", (socket) => {
  dataSocketRef = socket;
  socket.setEncoding("utf8");
  socket.write(`${JSON.stringify({ type: "data_hello", src: "master", boot, next_seq: dataSeq, resend_from: dataSeq })}\n`);

  let ackBuffer = "";
  socket.on("data", (data) => {
    ackBuffer += data.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = ackBuffer.indexOf("\n")) !== -1) {
      const line = ackBuffer.slice(0, newlineIndex);
      ackBuffer = ackBuffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (typeof msg.ack === "number") console.log(`[data] app acked up to seq=${msg.ack}`);
      } catch {
        // ignore
      }
    }
  });

  const frameTimer = setInterval(() => {
    if (state !== "recording" || !episodeName) return;
    const t = tUs();
    const found = Math.random() > 0.15;
    socket.write(
      `${JSON.stringify({
        type: "frame",
        ep: episodeName,
        N: frameN,
        t_us: t,
        left: {
          t_us: t,
          dt_us: 800,
          x: found ? 120 + Math.sin(t / 500000) * 40 : -1,
          y: found ? 120 + Math.cos(t / 500000) * 40 : -1,
          found,
          score: found ? 0.9 : 0,
          rtp_ts: null,
          imu: { a: [0.01, -0.02, 0.98], g: [0.3, -0.1, 0.2] },
        },
        right: {
          t_us: t + 350,
          dt_us: 1100,
          x: found ? 101 + Math.sin(t / 500000) * 35 : -1,
          y: found ? 97 + Math.cos(t / 500000) * 35 : -1,
          found,
          score: found ? 0.87 : 0,
          rtp_ts: null,
          imu: { a: [0, 0.03, 0.97], g: [0.2, 0, -0.1] },
        },
        skew_us: 350,
        depth: null,
        v: 2,
        src: "master",
        seq: dataSeq,
      })}\n`
    );
    dataSeq++;
    frameN++;
  }, FRAME_INTERVAL_MS);

  socket.on("close", () => {
    clearInterval(frameTimer);
    if (dataSocketRef === socket) dataSocketRef = null;
  });
});

console.log(`Simulating glasses master -> ${host}:${COMMAND_PORT} (command), ${host}:${DATA_PORT} (data)`);
console.log("No BLE here -- this connects straight to the TCP ports, as if WiFi provisioning already happened.");
