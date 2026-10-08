// Simulates the glasses master board for testing the app's TCP layer
// without real hardware: connects to the phone as a TCP client on 5005
// (telemetry/control) and 5006 (left frames), exactly as "Glasses
// Integration: Packet Spec" describes, and reconnects the same way the real
// board does if the connection drops.
//
// Usage: npx tsx scripts/fake-glasses-board.ts <phone-ip>
//
// Frame payloads here are opaque dummy bytes, NOT real JPEG data -- the
// app's frame parser only reads the 20-byte header and treats the rest as an
// opaque length-prefixed blob, so this is enough to exercise that parsing
// without needing an actual decodable image.
import net from "node:net";

const CONTROL_PORT = 5005;
const FRAME_PORT = 5006;
const RECONNECT_DELAY_MS = 3000;
const TELEMETRY_INTERVAL_MS = 80; // ~12.5Hz, within the spec's 10-18Hz range
const STATUS_INTERVAL_MS = 2000;
const FRAME_EVERY_N_SAMPLES = 3;

const host = process.argv[2];
if (!host) {
  console.error("Usage: npx tsx scripts/fake-glasses-board.ts <phone-ip>");
  process.exit(1);
}

function connectWithRetry(port: number, onConnect: (socket: net.Socket) => void) {
  const socket = net.createConnection({ host, port });

  socket.on("connect", () => {
    console.log(`[${port}] connected`);
    onConnect(socket);
  });

  socket.on("error", (err) => {
    console.log(`[${port}] error: ${err.message}`);
  });

  socket.on("close", () => {
    console.log(`[${port}] closed, retrying in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connectWithRetry(port, onConnect), RECONNECT_DELAY_MS);
  });

  return socket;
}

// -- Control / telemetry connection (5005) ---------------------------------

connectWithRetry(CONTROL_PORT, (socket) => {
  let seq = 0;
  const startedAt = Date.now();
  const tMs = () => Date.now() - startedAt;

  function send(obj: Record<string, unknown>) {
    socket.write(`${JSON.stringify(obj)}\n`);
  }

  send({ v: 1, type: "hello", src: "glasses", seq: seq++, t_ms: tMs(), device: "nicla_master", fw: "fake-0.0.1", calib: null, ip: "0.0.0.0" });

  const telemetryTimer = setInterval(() => {
    const found = Math.random() > 0.2;
    send({
      v: 1,
      type: "telemetry",
      src: "glasses",
      seq: seq++,
      t_ms: tMs(),
      pulse: 0,
      sync: { dt_left_us: 0, dt_right_us: 0, offset_us: 0 },
      left: found
        ? { x: 120 + Math.sin(tMs() / 500) * 40, y: 120 + Math.cos(tMs() / 500) * 40, found: true, fid: seq }
        : { x: -1, y: -1, found: false, fid: -1 },
      right: { x: -1, y: -1, found: false, fid: -1 },
      glove: { X: 0, Y: 0, Z: 0, valid: false },
      imu: { left: { a: [0.01, -0.02, 0.99], g: [0.4, -0.1, 0.2] }, right: { a: [0, 0, 0], g: [0, 0, 0] } },
      dropped: 0,
    });
  }, TELEMETRY_INTERVAL_MS);

  const statusTimer = setInterval(() => {
    send({ v: 1, type: "status", src: "glasses", seq: seq++, t_ms: tMs(), streaming: true, frames: true, wifi_rssi: 0, fps: 0 });
  }, STATUS_INTERVAL_MS);

  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      try {
        const cmd = JSON.parse(line);
        console.log(`[${CONTROL_PORT}] received cmd:`, cmd);
        send({ v: 1, type: "ack", src: "glasses", seq: seq++, t_ms: tMs(), ref: cmd.seq, ok: true });
      } catch {
        console.log(`[${CONTROL_PORT}] bad line from app: ${line}`);
      }
    }
  });

  socket.on("close", () => {
    clearInterval(telemetryTimer);
    clearInterval(statusTimer);
  });
});

// -- Frame connection (5006) -------------------------------------------

connectWithRetry(FRAME_PORT, (socket) => {
  let sampleCount = 0;
  let frameId = 0;

  const timer = setInterval(() => {
    sampleCount++;
    if (sampleCount % FRAME_EVERY_N_SAMPLES !== 0) return;

    frameId++;
    const jpeg = Buffer.alloc(500, frameId % 256); // dummy opaque payload, not real JPEG bytes
    const header = Buffer.alloc(20);
    header.write("FR", 0, "ascii");
    header.writeUInt8(0, 2); // cam = left
    header.writeUInt8(0, 3); // reserved
    header.writeUInt32LE(frameId, 4);
    header.writeUInt32LE(0, 8); // pulse
    header.writeUInt32LE(0, 12); // dt_us
    header.writeUInt32LE(jpeg.length, 16);

    socket.write(Buffer.concat([header, jpeg]));
  }, TELEMETRY_INTERVAL_MS);

  socket.on("close", () => clearInterval(timer));
});

console.log(`Simulating glasses master board -> ${host}:${CONTROL_PORT} (control), ${host}:${FRAME_PORT} (frames)`);
