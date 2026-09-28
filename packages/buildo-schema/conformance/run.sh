#!/usr/bin/env bash
# Cross-language conformance check for the Buildo wire schema (see
# ../spec/SCHEMA.md). Proves the TS and Python bindings actually agree on
# the wire format, not just that each one round-trips against itself:
#   1. TS serializes a fixture BuildoObservation to Arrow IPC; Python reads
#      it back and checks every field matches.
#   2. Python serializes a fixture BuildoActionChunk to JSON; TS reads it
#      back and checks every field matches.
# This is what Phase 1's CI runs on every PR that touches this package.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE="$SCRIPT_DIR/fixture.json"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "== Building TS bindings =="
(cd "$SCHEMA_DIR/ts" && npx tsc)

echo "== Direction 1: TS writes Observation -> Python reads =="
node "$SCHEMA_DIR/ts/conformance-ts-side.mjs" write-observation "$FIXTURE" "$TMP_DIR/observation.arrow"
"$SCHEMA_DIR/python/.venv/bin/python" "$SCHEMA_DIR/python/conformance_py_side.py" read-observation "$FIXTURE" "$TMP_DIR/observation.arrow"

echo "== Direction 2: Python writes ActionChunk -> TS reads =="
(cd "$SCHEMA_DIR/python" && "$SCHEMA_DIR/python/.venv/bin/python" conformance_py_side.py write-action-chunk "$FIXTURE" "$TMP_DIR/action_chunk.json")
node "$SCHEMA_DIR/ts/conformance-ts-side.mjs" read-action-chunk "$FIXTURE" "$TMP_DIR/action_chunk.json"

echo ""
echo "CONFORMANCE OK: TS and Python bindings agree on the wire format in both directions."
