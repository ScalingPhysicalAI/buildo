"""JSON (de)serialization for BuildoActionChunk -- see ../ts/src/action-chunk-json.ts
for why this is plain JSON while observations use Arrow IPC."""

from __future__ import annotations

from .types import BuildoActionChunk


def serialize_action_chunk(chunk: BuildoActionChunk) -> str:
    return chunk.model_dump_json(by_alias=True)


def deserialize_action_chunk(data: str) -> BuildoActionChunk:
    return BuildoActionChunk.model_validate_json(data)
