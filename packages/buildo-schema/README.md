# `buildo-schema`

The one wire contract every Buildo consumer builds against: retargeting,
the browser MuJoCo simulator, headless training/eval, the cloud policy
server, App Store certification, and eventually a real robot. See
[`spec/SCHEMA.md`](./spec/SCHEMA.md) for the normative field-by-field
definition — this package is two independent implementations of exactly
that document, kept honest by [`conformance/`](./conformance).

- `ts/` — TypeScript bindings (zod schemas + types), Arrow IPC serialization
  for `BuildoObservation`, JSON for `BuildoActionChunk`.
- `python/` — Python bindings (pydantic models), same wire formats.
- `conformance/` — proves the two actually agree: TS writes an Observation,
  Python reads it back and checks every field; Python writes an
  ActionChunk, TS reads it back the same way. Run with:

  ```bash
  bash packages/buildo-schema/conformance/run.sh
  ```

  This becomes a CI gate in Phase 1 — any change to either binding's wire
  format that breaks the other fails here before it fails somewhere much
  more expensive to debug.

## Setup

```bash
# TS
cd ts && npm install && npx tsc

# Python
cd python && python3 -m venv .venv && .venv/bin/pip install -e .
```

## Why Arrow for observations but JSON for action chunks?

Not an arbitrary choice — it's what the reference implementations this
schema is modeled on already do for the same payload shapes. OpenArm's own
inference tutorial packs its observation bundle (camera frames + joint
state) as Arrow IPC for exactly this reason: mixed binary image data and
numeric state in one typed, self-describing message. Action chunks are
small and numeric-only, so plain JSON is simpler and human-inspectable with
no corresponding downside.
