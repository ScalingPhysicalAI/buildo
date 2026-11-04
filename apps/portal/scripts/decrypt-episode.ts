// Admin CLI: pull an uploaded episode's blob, decrypt it, and write the
// result to disk for inspection -- not a user-facing route, this app never
// decrypts anything server-side automatically (no key lives in a request
// path). Mirrors apps/mobile/enc_tool.py's own `decrypt` command exactly:
// data.jsonl is decrypted here in Node (HKDF/HMAC/AES-CTR, all built into
// node:crypto, verified against the same RFC 5869 vector test_enc.py
// checks the Python implementation against); video is SRTP (RFC 3711),
// which has no Node equivalent of the hardware team's own verified
// pylibsrtp-based tool, so that part shells out to enc_tool.py itself
// rather than reimplementing SRTP from scratch here.
//
// Usage:
//   tsx scripts/decrypt-episode.ts --collection <id> --key /path/to/enc_key.bin [--out dir] [--enc-tool /path/to/enc_tool.py] [--python python3]
//   tsx scripts/decrypt-episode.ts --url <blob url>  --key /path/to/enc_key.bin [--out dir] ...
import { createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { unzipSync } from "fflate";

const prisma = new PrismaClient();
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENC_TOOL = join(HERE, "..", "..", "mobile", "enc_tool.py");

interface Args {
  collection?: string;
  url?: string;
  key: string;
  out: string;
  encTool: string;
  python: string;
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
    out: get("--out") ?? join(HERE, "..", ".decrypted-episodes", get("--collection") ?? "episode"),
    encTool: get("--enc-tool") ?? DEFAULT_ENC_TOOL,
    python: get("--python") ?? "python3",
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

async function main() {
  const args = parseArgs();
  const key = readFileSync(args.key);

  let videoUrl = args.url;
  if (!videoUrl) {
    if (!args.collection) {
      console.error("Pass either --collection <id> or --url <blob-url>.");
      process.exit(1);
    }
    const collection = await prisma.skillCollectionSession.findUnique({ where: { id: args.collection } });
    if (!collection?.videoUrl) {
      console.error(`Collection ${args.collection} has no videoUrl yet -- upload may not have finished.`);
      process.exit(1);
    }
    videoUrl = collection.videoUrl;
  }

  console.log(`Fetching ${videoUrl} ...`);
  const res = await fetch(videoUrl);
  if (!res.ok) {
    console.error(`Download failed: ${res.status}`);
    process.exit(1);
  }
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipBytes);

  const rawDir = join(args.out, "raw");
  const decryptedDir = join(args.out, "decrypted");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(decryptedDir, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    writeFileSync(join(rawDir, path), bytes);
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

  console.log(`\nDone. Raw: ${rawDir}\nDecrypted: ${decryptedDir}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
