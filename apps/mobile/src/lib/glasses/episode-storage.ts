// Saves an episode's glasses data to the phone's own storage as it's
// recorded, instead of discarding it after display. Video is now encrypted
// (see rtsp-client.ts) and this app has no key, so it saves exactly what
// came off the wire -- raw RTP packets, raw data-channel lines -- in the
// same layout enc_tool.py's own `record` command produces, so its
// `decrypt`/`decrypt_video` (server-side only, never in this app) work
// against a real phone capture unmodified:
//   video-left.rtp / video-right.rtp   4-byte-BE-length-prefixed RTP packets
//   data.jsonl                         every data-channel line, as received
//   meta.json                          hello/data_hellos/summary/sessions/status
// episode.json is this app's own addition (environment/skill/timestamps) --
// enc_tool.py doesn't know about those, so it's kept separate from meta.json.
import { Directory, File, FileMode, Paths, type FileHandle } from "expo-file-system";
import { zipSync, type Zippable } from "fflate";

export interface EpisodeMeta {
  episodeName: string;
  environment: string;
  skillSlug: string;
  skillName: string;
}

export interface EpisodeSummary {
  startedAt: string;
  stoppedAt: string;
  durationSec: number;
  packetCount: { left: number; right: number };
  dataLineCount: number;
}

interface VideoSessionBoundary {
  // Matches enc_tool.py's RawVideo.sessions: [firstPacketIndex, encHeader].
  // A session starts a new one whenever the PLAY response's X-Glasses-Enc
  // header changes (new SRTP keys) -- null means encryption was off.
  index: number;
  enc: string | null;
}

const EPISODES_ROOT = "episodes";

function bigEndianUint32(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

export class EpisodeRecorder {
  readonly directory: Directory;
  private packetCount = { left: 0, right: 0 };
  private sessions: { left: VideoSessionBoundary[]; right: VideoSessionBoundary[] } = { left: [], right: [] };
  private videoHandles: { left: FileHandle | null; right: FileHandle | null } = { left: null, right: null };
  private dataHandle: FileHandle | null = null;
  private dataLineCount = 0;
  private readonly startedAtMs = Date.now();

  private hello: unknown = null;
  private dataHellos: unknown[] = [];
  private summary: unknown = null;
  private lastStatus: unknown = null;

  constructor(private readonly meta: EpisodeMeta) {
    this.directory = new Directory(Paths.document, EPISODES_ROOT, meta.episodeName);
    this.directory.create({ intermediates: true, idempotent: true });

    const dataFile = new File(this.directory, "data.jsonl");
    dataFile.create({ overwrite: true });
    this.dataHandle = dataFile.open(FileMode.Append);

    // Both created up front, even if one side never gets a single packet
    // (e.g. no slave camera this episode) -- meta.json always lists both
    // left and right, and the server's decrypt_video() opens every file it
    // names there unconditionally. A missing file would be a crash on the
    // server side instead of just "0 packets, 0 frames" for that side.
    this.videoHandles.left = this.openVideoFile("left");
    this.videoHandles.right = this.openVideoFile("right");
  }

  private openVideoFile(side: "left" | "right"): FileHandle {
    const file = new File(this.directory, `video-${side}.rtp`);
    file.create({ overwrite: true });
    return file.open(FileMode.Append);
  }

  private videoHandle(side: "left" | "right"): FileHandle {
    let handle = this.videoHandles[side];
    if (!handle) {
      // Shouldn't happen -- the constructor opens both up front -- but
      // falling back here (and remembering it) is cheap insurance against
      // a write arriving after finish() already closed everything.
      handle = this.openVideoFile(side);
      this.videoHandles[side] = handle;
    }
    return handle;
  }

  setHello(hello: unknown) {
    this.hello = hello;
  }

  addDataHello(message: unknown) {
    this.dataHellos.push(message);
  }

  setStatus(status: unknown) {
    this.lastStatus = status;
  }

  setSummary(summary: unknown) {
    this.summary = summary;
  }

  // Raw RTP packet, still SRTP-encrypted, never decoded -- see
  // rtsp-client.ts's RawRtpPacket. Length-prefixed so the server's own
  // reader (struct.unpack(">I", ...) in enc_tool.py) can split them back
  // apart; UDP itself has no message framing once packets are concatenated.
  saveVideoPacket(side: "left" | "right", packet: Uint8Array, encHeader: string | null) {
    const sessions = this.sessions[side];
    const index = this.packetCount[side];
    if (sessions.length === 0 || sessions[sessions.length - 1].enc !== encHeader) {
      sessions.push({ index, enc: encHeader });
    }
    const handle = this.videoHandle(side);
    handle.writeBytes(bigEndianUint32(packet.length));
    handle.writeBytes(packet);
    this.packetCount[side] = index + 1;
  }

  // Raw data-channel line, exactly as received -- data_hello is still
  // plaintext; everything else is now an opaque encrypted envelope (no
  // "type"/"N"/"left" fields visible on the wire at all anymore).
  appendRawDataLine(line: string) {
    this.dataHandle?.writeBytes(utf8Bytes(`${line}\n`));
    this.dataLineCount++;
  }

  packetCountFor(side: "left" | "right") {
    return this.packetCount[side];
  }

  finish(): EpisodeSummary {
    this.videoHandles.left?.close();
    this.videoHandles.right?.close();
    this.dataHandle?.close();
    this.videoHandles = { left: null, right: null };
    this.dataHandle = null;

    const stoppedAtMs = Date.now();
    const summary: EpisodeSummary = {
      startedAt: new Date(this.startedAtMs).toISOString(),
      stoppedAt: new Date(stoppedAtMs).toISOString(),
      durationSec: Math.round((stoppedAtMs - this.startedAtMs) / 1000),
      packetCount: { ...this.packetCount },
      dataLineCount: this.dataLineCount,
    };

    // meta.json -- same shape enc_tool.py's record() writes, so its
    // decrypt/decrypt_video (server-side) read a phone capture unmodified.
    const meta = {
      hello: this.hello,
      data_hellos: this.dataHellos,
      summary: this.summary,
      video: {
        left: { packets: this.packetCount.left, sessions: this.sessions.left.map((s) => [s.index, s.enc]) },
        right: { packets: this.packetCount.right, sessions: this.sessions.right.map((s) => [s.index, s.enc]) },
      },
      status: this.lastStatus,
    };
    new File(this.directory, "meta.json").write(JSON.stringify(meta, null, 1));

    // episode.json -- this app's own bookkeeping (environment/skill/name),
    // which enc_tool.py has no concept of and doesn't need to read.
    new File(this.directory, "episode.json").write(
      JSON.stringify({ name: this.meta.episodeName, ...this.meta, ...summary }, null, 2)
    );
    return summary;
  }

  // Zips the whole episode directory in memory -- fine at the sizes a real
  // episode runs; no native zip module needed, which is what keeps this
  // shippable without a rebuild.
  buildZip(): { file: File; sizeBytes: number } {
    const data: Zippable = {};
    const walk = (dir: Directory) => {
      for (const entry of dir.list()) {
        const relativePath = Paths.relative(this.directory, entry);
        if (entry instanceof Directory) {
          walk(entry);
        } else {
          data[relativePath] = entry.bytesSync();
        }
      }
    };
    walk(this.directory);

    const zipped = zipSync(data, { level: 6 });
    const zipFile = new File(Paths.cache, `${this.meta.episodeName}.zip`);
    zipFile.write(zipped);
    return { file: zipFile, sizeBytes: zipped.length };
  }

  delete() {
    this.videoHandles.left?.close();
    this.videoHandles.right?.close();
    this.dataHandle?.close();
    if (this.directory.exists) this.directory.delete();
  }
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function deleteLocalFile(file: File) {
  if (file.exists) file.delete();
}
