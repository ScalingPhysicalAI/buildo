# Buildo wire schema — `BuildoObservation` / `BuildoActionChunk`

This is the one contract every consumer builds against: retargeting, the
browser MuJoCo simulator, a headless training/eval harness, the cloud policy
server, App Store certification, and (eventually) a real Buildo robot. The
TS bindings (`../ts`) and Python bindings (`../python`) are two independent
implementations of exactly what's written here — if they ever disagree, this
file is right and one of them has a bug. The conformance test
(`../conformance`) exists specifically to catch that.

Field names, types and units below are normative. Optional fields are
marked `?`.

## `BuildoObservation` — client -> policy server, Arrow IPC

Sent at the VLA's own inference rate (10-30 Hz), not every physics step.
Serialized as a single-batch **Arrow IPC stream** (matches OpenArm's own
inference-tutorial observation bundle and Dora's node-to-node format —
chosen because it's a real, cheap way to carry mixed binary image data and
numeric state in one typed, self-describing payload, not an arbitrary
choice).

| Field | Type | Units / notes |
|---|---|---|
| `schema_version` | string | e.g. `"buildo-observation/1.0"` |
| `sequence_id` | string | monotonic per-session, echoed back on the resulting action chunk |
| `timestamp` | float64 | unix epoch seconds |
| `instruction` | string | natural-language task instruction |
| `camera_frames` | list<struct> | `{name: string, width: int32, height: int32, encoding: string ("rgb8"\|"jpeg"), data: binary}` |
| `base_state` | struct | `{x: float64, y: float64, yaw: float64, vx: float64, vy: float64, yaw_rate: float64}` — meters, radians |
| `lift_state` | struct | `{height: float64, velocity: float64}` — meters |
| `left_arm_state` / `right_arm_state` | struct | `{joint_positions: list<float64>, ee_position: [float64;3], ee_orientation_quat: [float64;4] (w,x,y,z)}` |
| `left_hand_state` / `right_hand_state` | struct | `{finger_positions: list<float64>, grip_closed: bool}` |
| `left_tactile` / `right_tactile` | list<float64>? | omitted if the robot has no tactile sensing |

## `BuildoActionChunk` — policy server -> client, JSON

A *chunk* of future actions, not a single step — the policy server is
queried at 10-30 Hz but returns 300-1000ms of future motion so the client
can keep running physics/control between requests (see
`docs/CHUNKING.md` once Phase 4 lands). One JSON object per response line.

| Field | Type | Units / notes |
|---|---|---|
| `schema_version` | string | e.g. `"buildo-action-chunk/1.0"` |
| `sequence_id` | string | echoes the triggering observation's `sequence_id` |
| `model_version` | string | identifies which policy checkpoint produced this |
| `action_start_time` | float64 | unix epoch seconds this chunk starts applying from |
| `action_dt` | float64 | seconds between consecutive entries in `actions` |
| `actions` | list<struct> | see below, ordered, applied at `action_start_time + i * action_dt` |

Each entry in `actions`:

```
{
  base: { vx: float64, vy: float64, yaw_rate: float64 },
  lift: { height: float64 },
  left_arm:  { ee_position: [float64;3], ee_orientation_quat: [float64;4] },
  right_arm: { ee_position: [float64;3], ee_orientation_quat: [float64;4] },
  left_hand:  { grip_target: float64 },   // 0 = fully open, 1 = fully closed
  right_hand: { grip_target: float64 },
}
```

This is exactly the doc's own VLA-facing action space table (mobile base:
vx/vy/yaw rate; height mechanism: lift height; each arm: end-effector pose;
each hand: hand/finger target) — task-space, not joint-space. A local
controller on the client (browser sim today, robot firmware eventually)
converts these into actual joint commands; the policy never sees joints
directly. This split is deliberate (see the PDF's §1) — it's what lets the
same action chunk apply to a simulated Buildo and a real one with different
underlying kinematics.

## Versioning

Both fields' `schema_version` follow `"<name>/<major>.<minor>"`. A
consumer MUST reject an unknown major version outright (breaking change)
and MAY ignore unknown fields on a matching major version (additive/minor
change). There is no migration tooling yet — Phase 10 covers that once
there's a second version to migrate between.
