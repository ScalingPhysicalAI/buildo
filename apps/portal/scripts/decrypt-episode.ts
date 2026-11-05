// Admin CLI: pull an uploaded episode's blob, decrypt it, and write the
// result to disk for inspection -- not a user-facing route, this app never
// decrypts anything server-side automatically (no key lives in a request
// path). Mirrors apps/mobile/enc_tool.py's own `decrypt` command exactly:
// data.jsonl is decrypted here in Node (HKDF/HMAC/AES-CTR, all built into
// node:crypto, verified against the same RFC 5869 vector test_enc.py
// checks the Python implementation against); video is SRTP (RFC 3711),
// which has no Node equivalent of the hardware team's own verified
// pylibsrtp-based tool, so that part shells out to enc_tool.py itself
// rather than reimplementing SRTP from scratch here. glove-data.bin (fixed
// 318-byte frames) is a separate, independent encryption scheme from
// glasses -- see temp_test_device/DATA_ENCRYPTION.md and glove_enc.py --
// decrypted here in Node too, same HKDF/AES-CTR/HMAC primitives, different
// key/label/frame layout, its own --glove-key.
//
// Usage:
//   tsx scripts/decrypt-episode.ts --collection <id> --key /path/to/enc_key.bin [--glove-key /path/to/glove_enc_key.bin] [--out dir] [--enc-tool /path/to/enc_tool.py] [--frames-tool /path/to/extract_glasses_frames.py] [--python python3] [--admin-secret <secret>] [--server <url>]
//   tsx scripts/decrypt-episode.ts --url <blob url>  --key /path/to/enc_key.bin [--glove-key ...] [--out dir] ...
//
// enc_tool.py's own `decrypt` only keeps a first/last frame per side as a
// quick sanity check (see its decrypt_video()) -- extract_glasses_frames.py
// (this script's own addition, reusing enc_tool.py's hkdf()/rtp_jpeg.py)
// saves every frame instead, which is what an actual training pipeline needs.
//
// --collection fetches the zip through /api/admin/episode-blob (needs
// ADMIN_SECRET -- see that route) instead of the Blob storage URL directly:
// the store is private, and its read token is marked "sensitive" on Vercel,
// which means it can never be read back by anyone once set, by design --
// not something a local script can ever be handed, so the portal server
// itself proxies the bytes instead, using the token at request time where
// it still works fine. --url (a blob URL you already have another way)
// skips all of that and fetches directly -- only works if given a public
// blob or your own already-authenticated URL.
import { createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENC_TOOL = join(HERE, "..", "..", "mobile", "enc_tool.py");
const DEFAULT_FRAMES_TOOL = join(HERE, "extract_glasses_frames.py");

// Nothing else in this script touches Prisma/the DB anymore (it talks to
// the portal over HTTP instead) -- loading PrismaClient used to pull in
// .env as a side effect, which is the only reason ADMIN_SECRET/env vars
// ever worked here before. Load it explicitly now that that side effect is
// gone.
for (const envFile of [".env", ".env.local"]) {
  const path = join(HERE, "..", envFile);
  if (existsSync(path)) process.loadEnvFile(path);
}

interface Args {
  collection?: string;
  url?: string;
  key: string;
  gloveKey?: string;
  out: string;
  encTool: string;
  framesTool: string;
  python: string;
  adminSecret?: string;
  server: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const key = get("--key");
  if (!key) {
    console.error("Usage: tsx scripts/decrypt-episode.ts --collection <id> | --url <blob-url> --key <enc_key.bin> [--out dir] [--enc-tool path] [--python python3]");
    process.exit(1);
  }
  return {
    collection: get("--collection"),
    url: get("--url"),
    key,
    gloveKey: get("--glove-key"),
    out: get("--out") ?? join(HERE, "..", ".decrypted-episodes", get("--collection") ?? "episode"),
    encTool: get("--enc-tool") ?? DEFAULT_ENC_TOOL,
    framesTool: get("--frames-tool") ?? DEFAULT_FRAMES_TOOL,
    python: get("--python") ?? "python3",
    adminSecret: get("--admin-secret") ?? process.env.ADMIN_SECRET,
    server: get("--server") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.starforgerobotics.com",
  };
}

// RFC 5869 HKDF -- node:crypto's built-in hkdfSync is RFC 5869 compliant,
// same standard test_enc.py checks the firmware's own implementation
// against, so this doesn't need its own hand-rolled version.
function hkdf(ikm: Buffer, salt: Buffer, info: string, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from(info), length));
}

interface DataStats {
  good: number;
  bad: number;
  leaks: number;
  hellos: number;
  sessions: number;
}

// Byte-for-byte port of enc_tool.py's decrypt_data() -- same field names,
// same MAC domain string, same IV construction. See that function for the
// annotated version; this one is deliberately unannotated to keep the two
// easy to diff against each other if the wire format ever changes.
function decryptDataChannel(rawLines: string[], key: Buffer): { decrypted: string[]; stats: DataStats } {
  const stats: DataStats = { good: 0, bad: 0, leaks: 0, hellos: 0, sessions: 0 };
  const keysBySession = new Map<string, Buffer>();
  const decrypted: string[] = [];

  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      stats.bad++;
      continue;
    }
    if (m.type === "data_hello") {
      stats.hellos++;
      continue;
    }
    if (m.v !== 3 || typeof m.ct !== "string") {
      stats.leaks++;
      continue;
    }
    const sidHex = String(m.sid);
    let keys = keysBySession.get(sidHex);
    if (!keys) {
      keys = hkdf(key, Buffer.from(sidHex, "hex"), "glasses data v1", 48);
      keysBySession.set(sidHex, keys);
    }
    const ct = Buffer.from(String(m.ct), "base64");
    const seq = Number(m.seq);
    const tUs = Number(m.t_us);
    const seqTBuf = Buffer.alloc(16);
    seqTBuf.writeBigUInt64BE(BigInt(seq), 0);
    seqTBuf.writeBigInt64BE(BigInt(tUs), 8);
    const macInput = Buffer.concat([
      Buffer.from("glasses-data-v1\0"),
      Buffer.from(sidHex, "hex"),
      Buffer.from(String(m.src)),
      Buffer.from([0]),
      seqTBuf,
      ct,
    ]);
    const mac = createHmac("sha256", keys.subarray(16, 32)).update(macInput).digest().subarray(0, 16);
    const tag = Buffer.from(String(m.tag), "base64");
    if (mac.length !== tag.length || !timingSafeEqual(mac, tag)) {
      stats.bad++;
      continue;
    }
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(seq), 6); // bytes(6) + seq (8 bytes BE) + bytes(2)
    const decipher = createDecipheriv("aes-128-ctr", keys.subarray(0, 16), iv);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(plain.toString("utf8"));
    } catch {
      stats.bad++;
      continue;
    }
    if (obj.seq !== seq || obj.t_us !== tUs) {
      stats.bad++;
      continue;
    }
    stats.good++;
    decrypted.push(JSON.stringify(obj));
  }
  stats.sessions = keysBySession.size;
  return { decrypted, stats };
}

// -- Glove data channel (glove-data.bin) -----------------------------------
// Independent scheme from glasses above -- see temp_test_device's
// DATA_ENCRYPTION.md and glove_enc.py (the reference this ports). One key
// per board (dev: tools/glove_enc_key.bin, shared); one session id (`sid`,
// from the glove's own hello, read from meta.json here -- never repeated
// per frame the way glasses repeats `sid` on every JSON line); fixed
// 318-byte frames, no JSON.

const GLOVE_HKDF_INFO = "glove data v1"; // must match dataCipher.cpp's kHkdfInfo
const GLOVE_HMAC_LABEL = Buffer.from("glove-data-v1\0"); // + its trailing NUL
const GLOVE_CLEAR_LEN = 16; // bootId(4) + seq(4) + assembledAtMs(8)
const GLOVE_PLAIN_LEN = 302; // sizeof(WireHandPacket)
const GLOVE_WIRE_LEN = GLOVE_PLAIN_LEN + 16; // 318 bytes, what's actually in glove-data.bin per frame
const GLOVE_IMU_SLOTS = 12;
const GLOVE_FSR_FINGERS = 5;
const GLOVE_IMU_SECTION_OFFSET = GLOVE_CLEAR_LEN; // 16
const GLOVE_IMU_SLOT_SIZE = 18; // present(1) + w,x,y,z f32(16) + accuracy(1)
const GLOVE_FSR_SECTION_OFFSET = GLOVE_IMU_SECTION_OFFSET + GLOVE_IMU_SLOTS * GLOVE_IMU_SLOT_SIZE; // 232
const GLOVE_FSR_FINGER_SIZE = 14; // present(1) + buttons(1) + channels int16 x6(12)

interface GloveStats {
  good: number;
  bad: number;
}

// Byte-for-byte port of glove_enc.py's open_data_frame() + parse_wire_packet()
// from glove_decrypt_tool.py -- same field names/offsets, same MAC domain,
// same IV construction (identical scheme to glasses' own, just a different
// label/info string -- see decryptDataChannel above).
function decryptGloveFrames(raw: Buffer, boardKey: Buffer, sidHex: string): { decrypted: string[]; stats: GloveStats } {
  const stats: GloveStats = { good: 0, bad: 0 };
  const decrypted: string[] = [];
  const sid = Buffer.from(sidHex, "hex");
  const okm = hkdf(boardKey, sid, GLOVE_HKDF_INFO, 48);
  const aesKey = okm.subarray(0, 16);
  const hmacKey = okm.subarray(16, 48);

  for (let off = 0; off + GLOVE_WIRE_LEN <= raw.length; off += GLOVE_WIRE_LEN) {
    const frame = raw.subarray(off, off + GLOVE_WIRE_LEN);
    const clearHeader = frame.subarray(0, GLOVE_CLEAR_LEN);
    const ciphertext = frame.subarray(GLOVE_CLEAR_LEN, GLOVE_PLAIN_LEN);
    const tag = frame.subarray(GLOVE_PLAIN_LEN);
    const seq = clearHeader.readUInt32LE(4);

    const mac = createHmac("sha256", hmacKey)
      .update(GLOVE_HMAC_LABEL)
      .update(sid)
      .update(clearHeader)
      .update(ciphertext)
      .digest()
      .subarray(0, 16);
    if (mac.length !== tag.length || !timingSafeEqual(mac, tag)) {
      stats.bad++;
      continue;
    }

    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(seq), 6); // same construction as glasses' nonce
    const decipher = createDecipheriv("aes-128-ctr", aesKey, iv);
    const plainTail = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plain = Buffer.concat([clearHeader, plainTail]);

    const bootId = plain.readUInt32LE(0);
    const assembledAtMs = plain.readBigUInt64LE(8);
    const imu: Record<string, unknown>[] = [];
    for (let i = 0; i < GLOVE_IMU_SLOTS; i++) {
      const o = GLOVE_IMU_SECTION_OFFSET + i * GLOVE_IMU_SLOT_SIZE;
      imu.push({
        present: plain.readUInt8(o) === 1,
        w: plain.readFloatLE(o + 1),
        x: plain.readFloatLE(o + 5),
        y: plain.readFloatLE(o + 9),
        z: plain.readFloatLE(o + 13),
        accuracy: plain.readUInt8(o + 17),
      });
    }
    const fsr: Record<string, unknown>[] = [];
    for (let i = 0; i < GLOVE_FSR_FINGERS; i++) {
      const o = GLOVE_FSR_SECTION_OFFSET + i * GLOVE_FSR_FINGER_SIZE;
      fsr.push({
        present: plain.readUInt8(o) === 1,
        buttons: plain.readUInt8(o + 1),
        channels: [0, 1, 2, 3, 4, 5].map((c) => plain.readInt16LE(o + 2 + c * 2)),
      });
    }

    stats.good++;
    decrypted.push(JSON.stringify({ bootId, seq, assembledAtMs: assembledAtMs.toString(), imu, fsr }));
  }
  return { decrypted, stats };
}

async function main() {
  const args = parseArgs();
  const key = readFileSync(args.key);

  let fetchUrl: string;
  let fetchHeaders: Record<string, string> = {};
  if (args.url) {
    fetchUrl = args.url;
  } else {
    if (!args.collection) {
      console.error("Pass either --collection <id> or --url <blob-url>.");
      process.exit(1);
    }
    if (!args.adminSecret) {
      console.error(
        "Missing ADMIN_SECRET -- set it in apps/portal/.env.local and on the Vercel project (Production), " +
          "or pass --admin-secret <value>. See /api/admin/episode-blob/route.ts."
      );
      process.exit(1);
    }
    fetchUrl = `${args.server}/api/admin/episode-blob?collection=${encodeURIComponent(args.collection)}`;
    fetchHeaders = { "x-admin-secret": args.adminSecret };
  }

  console.log(`Fetching ${fetchUrl} ...`);
  const res = await fetch(fetchUrl, { headers: fetchHeaders });
  if (!res.ok) {
    console.error(`Download failed: ${res.status} ${await res.text().catch(() => "")}`);
    process.exit(1);
  }
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipBytes);

  const rawDir = join(args.out, "raw");
  const decryptedDir = join(args.out, "decrypted");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(decryptedDir, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    const dest = join(rawDir, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  console.log(`Unzipped ${Object.keys(files).length} files to ${rawDir}`);

  // Data channel: decrypted here, in Node.
  const dataPath = join(rawDir, "data.jsonl");
  if (existsSync(dataPath)) {
    const lines = readFileSync(dataPath, "utf8").split("\n");
    const { decrypted, stats } = decryptDataChannel(lines, key);
    writeFileSync(join(decryptedDir, "data.jsonl"), decrypted.join("\n") + (decrypted.length ? "\n" : ""));
    console.log(
      `data: ${stats.good} messages verified and decrypted, ${stats.bad} rejected, ${stats.leaks} unencrypted, ` +
        `${stats.sessions} sessions, ${stats.hellos} hellos`
    );
    if (stats.bad > 0 || stats.leaks > 0) {
      console.log("  ^ any rejected/unencrypted count above means either the wrong key or a real protocol problem -- not expected on a clean capture.");
    }
  } else {
    console.log("No data.jsonl in this capture.");
  }

  // Glove data channel: decrypted here, in Node -- independent scheme and
  // key from glasses above (see decryptGloveFrames's own comment).
  const gloveDataPath = join(rawDir, "glove-data.bin");
  if (existsSync(gloveDataPath)) {
    if (!args.gloveKey) {
      console.log("\nSkipping glove decrypt -- glove-data.bin is present but no --glove-key was given.");
    } else {
      const metaPath = join(rawDir, "meta.json");
      const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : null;
      const sidHex = meta?.glove?.hello?.sid;
      if (typeof sidHex !== "string") {
        console.log("\nSkipping glove decrypt -- meta.json has no glove.hello.sid (hello never arrived, or this capture predates glove support).");
      } else {
        const gloveKey = readFileSync(args.gloveKey);
        const gloveRaw = readFileSync(gloveDataPath);
        const { decrypted, stats } = decryptGloveFrames(gloveRaw, gloveKey, sidHex);
        writeFileSync(join(decryptedDir, "glove-data.jsonl"), decrypted.join("\n") + (decrypted.length ? "\n" : ""));
        console.log(`glove: ${stats.good} frames verified and decrypted, ${stats.bad} rejected (sid=${sidHex})`);
        if (stats.bad > 0) {
          console.log("  ^ any rejected count above means either the wrong --glove-key or a real protocol problem -- not expected on a clean capture.");
        }
      }
    }
  } else {
    console.log("No glove-data.bin in this capture.");
  }

  // Video: SRTP, shelled out to the hardware team's own tested tool --
  // see this file's header comment for why that's deliberate, not a
  // shortcut. This also re-decrypts data.jsonl (redundant with the Node
  // pass above, harmless, same algorithm) since enc_tool.py's `decrypt`
  // command doesn't have a video-only mode.
  if (!existsSync(args.encTool)) {
    console.log(`\nSkipping video decrypt -- ${args.encTool} not found (pass --enc-tool, or it's gitignored and needs to be fetched from the hardware team separately).`);
  } else {
    console.log(`\nRunning ${args.encTool} for video decrypt (SRTP) ...`);
    try {
      const output = execFileSync(args.python, [args.encTool, "decrypt", rawDir, "--key", args.key, "--out", decryptedDir], {
        encoding: "utf8",
      });
      console.log(output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`enc_tool.py decrypt failed -- is Python set up with "cryptography" and "pylibsrtp" installed? (${message})`);
    }
  }

  // Every frame, not just enc_tool.py's own first/last sanity-check pair --
  // this is what a training pipeline actually needs. Separate script, same
  // verified crypto/depacketizer (see extract_glasses_frames.py's header).
  if (!existsSync(args.framesTool)) {
    console.log(`\nSkipping full frame extraction -- ${args.framesTool} not found.`);
  } else if (!existsSync(args.encTool)) {
    console.log("\nSkipping full frame extraction -- needs enc_tool.py (for hkdf()) and rtp_jpeg.py alongside it, see above.");
  } else {
    console.log(`\nExtracting every frame via ${args.framesTool} ...`);
    try {
      const output = execFileSync(
        args.python,
        [args.framesTool, rawDir, "--key", args.key, "--out", join(decryptedDir, "frames"), "--enc-tool", args.encTool],
        { encoding: "utf8" }
      );
      console.log(output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`extract_glasses_frames.py failed (${message})`);
    }
  }

  console.log(`\nDone. Raw: ${rawDir}\nDecrypted: ${decryptedDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
