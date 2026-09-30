import { BuildoActionChunkSchema, type BuildoActionChunk } from "./types.js";

// Deliberately trivial next to observation-arrow.ts's hand-built Arrow
// schema -- an action chunk is small, numeric-only JSON (see
// ../../spec/SCHEMA.md), so zod's own (de)serialization is the whole
// implementation; no separate wire-format layer needed.

export function serializeActionChunk(chunk: BuildoActionChunk): string {
  return JSON.stringify(BuildoActionChunkSchema.parse(chunk));
}

export function deserializeActionChunk(json: string): BuildoActionChunk {
  return BuildoActionChunkSchema.parse(JSON.parse(json));
}
