// One half of the cross-language conformance check (see
// ../conformance/fixture.json and README.md for what this proves). Run
// from the compiled dist/, not source, so this exercises exactly what a
// real consumer would import.
import { readFileSync, writeFileSync } from "node:fs";
import {
  serializeObservation,
  deserializeActionChunk,
} from "./dist/index.js";

const fixturePath = process.argv[3];
const dataPath = process.argv[4];
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function fixtureToObservation(f) {
  return {
    ...f.observation,
    cameraFrames: f.observation.cameraFrames.map((cf) => ({
      name: cf.name,
      width: cf.width,
      height: cf.height,
      encoding: cf.encoding,
      data: new Uint8Array(cf.dataBytes),
    })),
  };
}

const mode = process.argv[2];
if (mode === "write-observation") {
  const obs = fixtureToObservation(fixture);
  const bytes = serializeObservation(obs);
  writeFileSync(dataPath, bytes);
  console.log(`[ts] wrote observation Arrow IPC -> ${dataPath} (${bytes.length} bytes)`);
} else if (mode === "read-action-chunk") {
  const json = readFileSync(dataPath, "utf8");
  const chunk = deserializeActionChunk(json);
  const expected = fixture.actionChunk;
  const same = JSON.stringify(chunk) === JSON.stringify(expected);
  if (!same) {
    console.error("[ts] MISMATCH reading Python-written action chunk");
    console.error("expected:", JSON.stringify(expected));
    console.error("got:     ", JSON.stringify(chunk));
    process.exit(1);
  }
  console.log("[ts] action chunk written by Python matches fixture exactly");
} else {
  throw new Error(`unknown mode: ${mode}`);
}
