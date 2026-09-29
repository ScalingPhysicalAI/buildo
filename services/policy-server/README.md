# Buildo policy server (Phase 3)

Speaks the doc's page-7 contract literally: POST a `BuildoObservation`
(Arrow IPC bytes) to `/act`, get a `BuildoActionChunk` (JSON) back. Plain
HTTP -- no WebRTC (that's Phase 9).

The "policy" inside (`policy_server/pick_and_place.py`) is deliberately
**not ML** -- a scripted state machine, ported from apps/portal's existing
browser pick-and-place workflow (same phase sequence and timings, re-
targeted in task space for OpenArm/buildo_v0 -- see that module's own
docstring for exactly what was and wasn't reused). The point of this phase
is proving the request/response contract and the chunking model work,
using logic we already know behaves sensibly, with zero ML risk.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -e ../../packages/buildo-schema/python -e .
.venv/bin/uvicorn policy_server.app:app --reload
```

## Test it

```bash
.venv/bin/pip install mujoco httpx  # mujoco only needed for the integration test below
.venv/bin/python test_integration_mujoco.py
```

That test is the real proof: it reads live state out of `buildo_v0.xml`
running in MuJoCo, builds a `BuildoObservation` from it, calls
`PickAndPlacePolicy.act()` directly (same code path `/act` uses), applies
the resulting `BuildoActionChunk` back onto the model via
`packages/buildo-mujoco/scripts/apply_action_chunk.py` (Phase 2), steps
physics, and repeats for a full cycle -- asserting the base actually drives,
the gripper actually closes and reopens, in the right order. This is the
same loop Phase 4 wires into the browser, just without the network hop and
without going through the actual HTTP layer.

## What's a placeholder here, on purpose

- **No real perception.** `pick_and_place.py`'s pick/place waypoints and
  grasp offsets are small illustrative numbers, not derived from any real
  object or scene -- `buildo_v0.xml` doesn't have a kitchen/cup scene wired
  up yet (that still only exists for the old humanoid in apps/portal).
  Phase 6 (retargeting real captured data) and eventually real perception
  are what make these come from an actual observed object instead.
- **One shared rollout, no sessions.** `app.py` keeps a single
  `PickAndPlacePolicy` instance for the whole server. Fine for today's
  single-client dev loop; a real deployment serving multiple
  robots/simulators needs one policy instance per session.
- **Loops forever.** There's no "start task" trigger in `BuildoActionChunk`
  yet, so this always runs, cycling pick -> place -> pick -> ... A real
  policy would idle until told to start.
