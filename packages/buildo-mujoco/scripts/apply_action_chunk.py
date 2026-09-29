#!/usr/bin/env python3
"""Reference implementation of the BuildoActionChunk -> buildo_v0.xml mapping
documented in robots/buildo/ACTION_MAPPING.md. Headless proof that the
mapping is realizable (the IK actually converges) -- not the browser client
controller Phase 4 builds; see that doc's own closing note.

Usage (from this directory or anywhere, paths are self-relative):
    python3 apply_action_chunk.py

Requires: mujoco, numpy (not pinned anywhere yet -- same informal
dependency style as urdf_to_mjcf.py in this same directory).
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass, field

import mujoco
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "robots" / "buildo" / "buildo_v0.xml"

GRIP_JOINT_MAX = 0.7854  # radians; both fingers' actuator ctrlrange magnitude


@dataclass
class ArmTarget:
    ee_position: np.ndarray  # [x, y, z], mount-frame (buildo_lift body), meters
    ee_orientation_quat: np.ndarray  # [w, x, y, z], mount-frame


@dataclass
class ActionChunkEntry:
    """One entry of BuildoActionChunk.actions -- see SCHEMA.md."""

    base_vx: float
    base_vy: float
    base_yaw_rate: float
    lift_height: float
    left_arm: ArmTarget
    right_arm: ArmTarget
    left_hand_grip_target: float  # [0, 1]
    right_hand_grip_target: float  # [0, 1]


@dataclass
class BaseIntegratorState:
    """Client-side integration state for the base's velocity commands --
    BuildoActionChunk gives vx/vy/yaw_rate, but the base's actuators are
    absolute-position <position> actuators. Not part of the schema or the
    model; this is exactly what ACTION_MAPPING.md's controller note means."""

    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0


def solve_arm_ik(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    site_name: str,
    joint_names: list[str],
    target_pos: np.ndarray,
    target_quat: np.ndarray,
    max_iters: int = 200,
    tol: float = 1e-4,
    damping: float = 1e-2,
) -> np.ndarray:
    """Damped-least-squares differential IK, seeded from the arm's current
    qpos so it converges to the nearest configuration. Returns the solved
    joint angles (same order as joint_names); does not mutate `data` beyond
    what's needed to compute Jacobians (qpos is restored... actually we WANT
    the solve to walk from the current pose, so we leave the final solved
    pose in data.qpos for the joints we touched -- see call site)."""
    site_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, site_name)
    qpos_adrs = [
        model.jnt_qposadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, j)]
        for j in joint_names
    ]
    dof_adrs = [
        model.jnt_dofadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, j)]
        for j in joint_names
    ]

    jacp = np.zeros((3, model.nv))
    jacr = np.zeros((3, model.nv))

    for _ in range(max_iters):
        mujoco.mj_kinematics(model, data)
        mujoco.mj_comPos(model, data)
        cur_pos = data.site_xpos[site_id].copy()
        cur_mat = data.site_xmat[site_id].reshape(3, 3)
        cur_quat = np.zeros(4)
        mujoco.mju_mat2Quat(cur_quat, cur_mat.flatten())

        pos_err = target_pos - cur_pos

        quat_err = np.zeros(3)
        neg_cur_quat = np.zeros(4)
        mujoco.mju_negQuat(neg_cur_quat, cur_quat)
        err_quat = np.zeros(4)
        mujoco.mju_mulQuat(err_quat, target_quat, neg_cur_quat)
        mujoco.mju_quat2Vel(quat_err, err_quat, 1.0)

        err = np.concatenate([pos_err, quat_err])
        if np.linalg.norm(err) < tol:
            break

        mujoco.mj_jacSite(model, data, jacp, jacr, site_id)
        J = np.concatenate([jacp[:, dof_adrs], jacr[:, dof_adrs]], axis=0)

        JJt = J @ J.T + damping * np.eye(6)
        dq = J.T @ np.linalg.solve(JJt, err)

        for k, adr in enumerate(qpos_adrs):
            data.qpos[adr] += dq[k]
            lo, hi = model.jnt_range[
                mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, joint_names[k])
            ]
            data.qpos[adr] = np.clip(data.qpos[adr], lo, hi)

    return np.array([data.qpos[adr] for adr in qpos_adrs])


LEFT_ARM_JOINTS = [f"arms_openarm_left_joint{i}" for i in range(1, 8)]
RIGHT_ARM_JOINTS = [f"arms_openarm_right_joint{i}" for i in range(1, 8)]


def _mount_pose(model: mujoco.MjModel, data: mujoco.MjData) -> tuple[np.ndarray, np.ndarray]:
    """Current world pose of buildo_lift -- the body the arms are actually
    attached to (base x/y/yaw AND current lift height, so an arm target
    expressed relative to it doesn't need to change as the lift moves).
    Requires mj_kinematics to have been run first."""
    mount_id = model.body("buildo_lift").id
    mount_pos = data.xpos[mount_id].copy()
    mount_mat = data.xmat[mount_id].reshape(3, 3).copy()
    mount_quat = np.zeros(4)
    mujoco.mju_mat2Quat(mount_quat, mount_mat.flatten())
    return mount_pos, mount_mat, mount_quat


def apply_action(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    base_state: BaseIntegratorState,
    action: ActionChunkEntry,
    action_dt: float,
) -> None:
    """Writes one BuildoActionChunk actions[i] entry into data.ctrl,
    per robots/buildo/ACTION_MAPPING.md. Mutates base_state in place
    (the vx/vy/yaw_rate integration is stateful across calls).

    Arm targets are mount-frame (see ArmTarget) but MuJoCo's kinematics/
    Jacobians are all world-frame, so this transforms through buildo_lift's
    CURRENT pose before solving IK. That current-pose word matters: this
    must be called often enough (every physics tick, or close to it) while
    the base/lift are also moving, not once per whole action chunk -- a
    stale mount pose is exactly what made the first version of this function
    drift by however far the base moved during the chunk. See _self_test."""

    base_state.x += action.base_vx * action_dt
    base_state.y += action.base_vy * action_dt
    base_state.yaw += action.base_yaw_rate * action_dt
    data.ctrl[model.actuator("base_x_act").id] = base_state.x
    data.ctrl[model.actuator("base_y_act").id] = base_state.y
    data.ctrl[model.actuator("base_yaw_act").id] = base_state.yaw

    lo, hi = model.actuator("lift_z_act").ctrlrange
    data.ctrl[model.actuator("lift_z_act").id] = np.clip(action.lift_height, lo, hi)

    mujoco.mj_kinematics(model, data)
    mujoco.mj_comPos(model, data)
    mount_pos, mount_mat, mount_quat = _mount_pose(model, data)

    for side, joints, target, hand_target in (
        ("left", LEFT_ARM_JOINTS, action.left_arm, action.left_hand_grip_target),
        ("right", RIGHT_ARM_JOINTS, action.right_arm, action.right_hand_grip_target),
    ):
        world_target_pos = mount_pos + mount_mat @ target.ee_position
        world_target_quat = np.zeros(4)
        mujoco.mju_mulQuat(world_target_quat, mount_quat, target.ee_orientation_quat)

        solved = solve_arm_ik(
            model,
            data,
            site_name=f"arms_{side}_ee_control_point",
            joint_names=joints,
            target_pos=world_target_pos,
            target_quat=world_target_quat,
        )
        for j_name, q in zip(joints, solved):
            # "arms_openarm_left_joint3" -> "joint3" -> "arms_left_joint3_ctrl"
            suffix = j_name.rsplit(f"{side}_", 1)[-1]
            act_name = f"arms_{side}_{suffix}_ctrl"
            data.ctrl[model.actuator(act_name).id] = q

        sign = 1.0 if side == "left" else -1.0
        data.ctrl[model.actuator(f"arms_{side}_finger1_ctrl").id] = (
            sign * hand_target * GRIP_JOINT_MAX
        )


def _self_test() -> None:
    """Exercises the full mapping, including base+lift moving *during* the
    same chunk as the arm targets -- the case that actually requires the
    mount-frame transform in apply_action to be right. A single-shot IK
    solve (call apply_action once, then step 500x) would drift by however
    far the base/lift move in that window, since the targets are mount-
    relative and the mount doesn't hold still; this instead re-solves IK
    at every physics tick, which is what a real controller does anyway."""
    model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)

    left_site = model.site("arms_left_ee_control_point").id
    right_site = model.site("arms_right_ee_control_point").id

    def current_quat(site_id: int) -> np.ndarray:
        q = np.zeros(4)
        mujoco.mju_mat2Quat(q, data.site_xmat[site_id].copy())
        return q

    def to_mount_frame(world_pos: np.ndarray, world_quat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        mount_pos, mount_mat, mount_quat = _mount_pose(model, data)
        local_pos = mount_mat.T @ (world_pos - mount_pos)
        neg_mount_quat = np.zeros(4)
        mujoco.mju_negQuat(neg_mount_quat, mount_quat)
        local_quat = np.zeros(4)
        mujoco.mju_mulQuat(local_quat, neg_mount_quat, world_quat)
        return local_pos, local_quat

    # "Hold roughly here, in the torso's own frame" -- a small, nearby offset
    # from the arm's current pose, expressed in mount-frame terms per
    # ACTION_MAPPING.md, not world coordinates. Representative of one
    # BuildoActionChunk entry (300ms-1s of motion), not an arbitrary jump.
    left_local_pos, left_local_quat = to_mount_frame(
        data.site_xpos[left_site] + np.array([0.08, -0.05, 0.05]), current_quat(left_site)
    )
    right_local_pos, right_local_quat = to_mount_frame(
        data.site_xpos[right_site] + np.array([0.08, 0.05, 0.05]), current_quat(right_site)
    )

    action = ActionChunkEntry(
        base_vx=0.1,
        base_vy=0.0,
        base_yaw_rate=0.0,
        lift_height=0.15,
        left_arm=ArmTarget(ee_position=left_local_pos, ee_orientation_quat=left_local_quat),
        right_arm=ArmTarget(ee_position=right_local_pos, ee_orientation_quat=right_local_quat),
        left_hand_grip_target=1.0,
        right_hand_grip_target=0.5,
    )
    base_state = BaseIntegratorState()

    n_steps = 500
    physics_dt = 0.001  # matches buildo_v0.xml's <option timestep>
    resolve_every = 10  # ~100Hz IK re-solve against the live mount pose
    for i in range(n_steps):
        if i % resolve_every == 0:
            apply_action(model, data, base_state, action, action_dt=physics_dt * resolve_every)
        mujoco.mj_step(model, data)

    # Expected final EE world position: the SAME mount-relative target,
    # transformed through the mount's FINAL (post-motion) pose -- because
    # the target was always mount-relative, it should have tracked the
    # moving base/lift the whole time, not stayed fixed in world space.
    mujoco.mj_kinematics(model, data)
    mujoco.mj_comPos(model, data)
    mount_pos, mount_mat, mount_quat = _mount_pose(model, data)
    left_expected = mount_pos + mount_mat @ left_local_pos
    right_expected = mount_pos + mount_mat @ right_local_pos

    left_err = np.linalg.norm(data.site_xpos[left_site] - left_expected)
    right_err = np.linalg.norm(data.site_xpos[right_site] - right_expected)
    print(f"left ee error:  {left_err * 1000:.2f} mm")
    print(f"right ee error: {right_err * 1000:.2f} mm")
    print(f"base ctrl (x,y,yaw): {base_state.x:.3f} {base_state.y:.3f} {base_state.yaw:.3f}")
    print(f"lift ctrl: {data.ctrl[model.actuator('lift_z_act').id]:.3f}")
    print(f"left grip ctrl:  {data.ctrl[model.actuator('arms_left_finger1_ctrl').id]:.3f}")
    print(f"right grip ctrl: {data.ctrl[model.actuator('arms_right_finger1_ctrl').id]:.3f}")

    assert left_err < 0.01, "left arm IK did not converge within 1cm"
    assert right_err < 0.01, "right arm IK did not converge within 1cm"
    print("OK: action chunk applied with concurrent base/lift motion, both arms tracked their mount-relative target within 1cm")


if __name__ == "__main__":
    _self_test()
