#!/usr/bin/env python3
"""End-to-end proof for Phase 3: read real state out of buildo_v0.xml running
in MuJoCo, build a BuildoObservation from it, ask PickAndPlacePolicy for a
BuildoActionChunk, apply that chunk back onto the model (via Phase 2's
apply_action_chunk.py), step physics, and repeat -- the actual closed loop
the architecture doc describes, minus the network hop (Phase 9) and minus
calling it through the FastAPI HTTP layer (that's what app.py adds; this
tests the policy logic + schema + robot model together, which is the part
worth proving carefully).

Usage:
    python3 test_integration_mujoco.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import mujoco
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "packages" / "buildo-mujoco" / "scripts"))
from apply_action_chunk import BaseIntegratorState, apply_action  # noqa: E402

from buildo_schema import ArmState, BaseState, BuildoObservation, CameraFrame, HandState, LiftState
from policy_server import PickAndPlacePolicy

MODEL_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "packages"
    / "buildo-mujoco"
    / "robots"
    / "buildo"
    / "buildo_v0.xml"
)


def _quat_of_site(model: mujoco.MjModel, data: mujoco.MjData, site_name: str) -> tuple[float, float, float, float]:
    q = np.zeros(4)
    mujoco.mju_mat2Quat(q, data.site_xmat[model.site(site_name).id].reshape(3, 3).flatten())
    return tuple(q)


def observation_from_mujoco(model: mujoco.MjModel, data: mujoco.MjData, sequence_id: str, t: float) -> BuildoObservation:
    """Stand-in for what Phase 4's browser controller (reading the WASM sim)
    or a real robot's sensor stack would build. No camera rendering here --
    camera_frames=[] -- since this test only exercises the state channel."""

    def jnt_qpos(name: str) -> float:
        return float(data.qpos[model.jnt_qposadr[model.joint(name).id]])

    def arm_state(side: str) -> ArmState:
        joints = [f"arms_openarm_{side}_joint{i}" for i in range(1, 8)]
        site = f"arms_{side}_ee_control_point"
        return ArmState(
            joint_positions=[jnt_qpos(j) for j in joints],
            ee_position=tuple(data.site_xpos[model.site(site).id]),
            ee_orientation_quat=_quat_of_site(model, data, site),
        )

    def hand_state(side: str) -> HandState:
        finger = jnt_qpos(f"arms_openarm_{side}_finger_joint1")
        return HandState(finger_positions=[finger], grip_closed=abs(finger) > 0.5)

    return BuildoObservation(
        schema_version="buildo-observation/1.0",
        sequence_id=sequence_id,
        timestamp=t,
        instruction="pick up the object and place it elsewhere",
        camera_frames=[],
        base_state=BaseState(
            x=jnt_qpos("base_x"),
            y=jnt_qpos("base_y"),
            yaw=jnt_qpos("base_yaw"),
            vx=float(data.qvel[model.joint("base_x").dofadr[0]]),
            vy=float(data.qvel[model.joint("base_y").dofadr[0]]),
            yaw_rate=float(data.qvel[model.joint("base_yaw").dofadr[0]]),
        ),
        lift_state=LiftState(height=jnt_qpos("lift_z"), velocity=float(data.qvel[model.joint("lift_z").dofadr[0]])),
        left_arm_state=arm_state("left"),
        right_arm_state=arm_state("right"),
        left_hand_state=hand_state("left"),
        right_hand_state=hand_state("right"),
        left_tactile=None,
        right_tactile=None,
    )


def main() -> None:
    model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)

    policy = PickAndPlacePolicy()
    base_integrator = BaseIntegratorState()

    physics_dt = 0.001  # buildo_v0.xml's <option timestep>
    action_dt = 0.05  # matches PickAndPlacePolicy.act()'s default
    substeps_per_entry = round(action_dt / physics_dt)

    sim_seconds = 60.0  # generous margin over one full pick-and-place cycle
    n_ticks = int(sim_seconds / physics_dt)

    grip_history: list[float] = []
    base_x_history: list[float] = []
    tick = 0
    entry_idx = 0
    chunk = None
    seq = 0

    while tick < n_ticks:
        if chunk is None or entry_idx >= len(chunk.actions):
            obs = observation_from_mujoco(model, data, sequence_id=f"seq-{seq}", t=tick * physics_dt)
            chunk = policy.act(obs)
            entry_idx = 0
            seq += 1

        action = chunk.actions[entry_idx]
        apply_action(model, data, base_integrator, action, action_dt=action_dt)
        for _ in range(substeps_per_entry):
            mujoco.mj_step(model, data)
            tick += 1
        entry_idx += 1

        grip_history.append(float(data.ctrl[model.actuator("arms_right_finger1_ctrl").id]))
        base_x_history.append(float(data.qpos[model.jnt_qposadr[model.joint("base_x").id]]))

    # Right gripper's ctrl sign is flipped (see apply_action_chunk.py: sign=-1
    # for "right"), so closed == most negative, open == ~0 -- max_closedness
    # tracks "how closed," independent of that sign convention.
    closedness = [abs(g) for g in grip_history]
    peak_idx = max(range(len(closedness)), key=lambda i: closedness[i])
    max_closedness = closedness[peak_idx]
    min_closedness_after_peak = min(closedness[peak_idx:])
    max_base_x = max(base_x_history)

    print(f"phases visited through to: {policy.phase} (elapsed {policy.phase_elapsed:.2f}s)")
    print(f"right grip closedness: peak={max_closedness:.3f}, min after peak={min_closedness_after_peak:.3f}")
    print(f"base x: max={max_base_x:.3f}")

    assert max_closedness > 0.5, "gripper never closed -- close phase didn't run or didn't drive the right actuator"
    assert min_closedness_after_peak < 0.1, "gripper never reopened after closing -- release phase didn't run"
    assert max_base_x > 0.5, "base never drove forward -- driveToPick/driveToPlace never actually moved it"
    print("OK: full pick-and-place cycle ran through the real policy server logic against buildo_v0 in MuJoCo")


if __name__ == "__main__":
    main()
