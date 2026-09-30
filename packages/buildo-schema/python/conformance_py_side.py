"""One half of the cross-language conformance check (see
../conformance/fixture.json and README.md for what this proves)."""

from __future__ import annotations

import json
import sys

sys.path.insert(0, ".")

from buildo_schema import (
    BuildoActionChunk,
    BuildoObservation,
    deserialize_observation,
    serialize_action_chunk,
)


def fixture_to_action_chunk(fixture: dict) -> BuildoActionChunk:
    ac = fixture["actionChunk"]
    return BuildoActionChunk.model_validate(ac)


def main() -> None:
    mode = sys.argv[1]
    fixture_path = sys.argv[2]
    data_path = sys.argv[3]
    with open(fixture_path) as f:
        fixture = json.load(f)

    if mode == "write-action-chunk":
        chunk = fixture_to_action_chunk(fixture)
        out = serialize_action_chunk(chunk)
        with open(data_path, "w") as f:
            f.write(out)
        print(f"[py] wrote action chunk JSON -> {data_path} ({len(out)} bytes)")
    elif mode == "read-observation":
        with open(data_path, "rb") as f:
            data = f.read()
        obs = deserialize_observation(data)
        expected = BuildoObservation.model_validate(
            {
                **fixture["observation"],
                "cameraFrames": [
                    {**cf, "data": bytes(cf["dataBytes"])}
                    for cf in fixture["observation"]["cameraFrames"]
                ],
            }
        )
        if obs != expected:
            print("[py] MISMATCH reading TS-written observation")
            print("expected:", expected)
            print("got:     ", obs)
            sys.exit(1)
        print("[py] observation written by TS matches fixture exactly")
    else:
        raise ValueError(f"unknown mode: {mode}")


if __name__ == "__main__":
    main()
