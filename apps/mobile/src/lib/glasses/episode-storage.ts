// Saves an episode's glasses data to the phone's own storage as it's
// recorded, instead of discarding it after display -- the frames saved here
// are what gets previewed on the review screen and zipped for upload.
import { Directory, File, Paths } from "expo-file-system";
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
  frameCount: { left: number; right: number };
  dataFrameCount: number;
}

const EPISODES_ROOT = "episodes";

export class EpisodeRecorder {
  readonly directory: Directory;
  private leftCount = 0;
  private rightCount = 0;
  private dataFrameCount = 0;
  private readonly startedAtMs = Date.now();

  constructor(private readonly meta: EpisodeMeta) {
    this.directory = new Directory(Paths.document, EPISODES_ROOT, meta.episodeName);
    this.directory.create({ intermediates: true, idempotent: true });
    new Directory(this.directory, "left").create({ intermediates: true, idempotent: true });
    new Directory(this.directory, "right").create({ intermediates: true, idempotent: true });
  }

  saveVideoFrame(side: "left" | "right", jpeg: Uint8Array) {
    const index = side === "left" ? this.leftCount++ : this.rightCount++;
    new File(this.directory, side, `${index}.jpg`).write(jpeg);
  }

  appendDataFrame(message: unknown) {
    this.dataFrameCount++;
    new File(this.directory, "frames.ndjson").write(`${JSON.stringify(message)}\n`, { append: true });
  }

  frameCount(side: "left" | "right") {
    return side === "left" ? this.leftCount : this.rightCount;
  }

  // Local preview, in order -- file:// URIs an <Image> can render directly.
  previewFrameUris(side: "left" | "right"): string[] {
    const count = this.frameCount(side);
    const uris: string[] = [];
    for (let i = 0; i < count; i++) {
      uris.push(new File(this.directory, side, `${i}.jpg`).uri);
    }
    return uris;
  }

  finish(): EpisodeSummary {
    const stoppedAtMs = Date.now();
    const summary: EpisodeSummary = {
      startedAt: new Date(this.startedAtMs).toISOString(),
      stoppedAt: new Date(stoppedAtMs).toISOString(),
      durationSec: Math.round((stoppedAtMs - this.startedAtMs) / 1000),
      frameCount: { left: this.leftCount, right: this.rightCount },
      dataFrameCount: this.dataFrameCount,
    };
    new File(this.directory, "episode.json").write(
      JSON.stringify({ name: this.meta.episodeName, ...this.meta, ...summary }, null, 2)
    );
    return summary;
  }

  // Zips the whole episode directory in memory -- fine at the sizes a real
  // episode runs (frames are small/low-fps by design); no native zip module
  // needed, which is what keeps this shippable without a rebuild.
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
    if (this.directory.exists) this.directory.delete();
  }
}

export function deleteLocalFile(file: File) {
  if (file.exists) file.delete();
}
