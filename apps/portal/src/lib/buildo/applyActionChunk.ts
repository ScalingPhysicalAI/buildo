// TypeScript port of packages/buildo-mujoco/scripts/apply_action_chunk.py --
// see that file and packages/buildo-mujoco/robots/buildo/ACTION_MAPPING.md
// for the normative mapping and why each piece works the way it does (the
// mount-frame transform, why IK must be re-solved every tick, the grip
// sign flip between hands). This is the same math, re-verified independently
// against the real buildo_v0.xml (see this repo's Phase 4 notes -- the two
// implementations converge to the same solved joint angles for the same
// input, confirming this port is faithful, not just "looks similar").
//
// Differential IK here uses a closed-form geometric Jacobian built from
// each joint's own world-frame axis and position (data.xmat/data.xpos),
// NOT @mujoco/mujoco's mj_jacSite -- that function's Jacobian *output*
// parameters don't actually come back through this WASM build's bindings
// (see mjMath.ts's header comment). Exact for a revolute chain where every
// joint's <joint pos="0 0 0"> in its own body frame, which is true for
// every OpenArm joint used here (confirmed in openarm_bimanual.xml).

import {
  mat3MulVec3,
  mat3ToQuat,
  quatConj,
  quatMul,
  quatToRotVec,
  solveLinear6,
  vecCross,
  vecNorm,
  vecSub,
  type Quat,
  type Vec3,
} from "./mjMath";
import type { ActionEntry } from "@buildo/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mujoco = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MjModel = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MjData = any;

const GRIP_JOINT_MAX = 0.7854; // radians; both fingers' actuator ctrlrange magnitude

const LEFT_ARM_JOINTS = Array.from({ length: 7 }, (_, i) => `arms_openarm_left_joint${i + 1}`);
const RIGHT_ARM_JOINTS = Array.from({ length: 7 }, (_, i) => `arms_openarm_right_joint${i + 1}`);

export interface BaseIntegratorState {
  x: number;
  y: number;
  yaw: number;
}

export function newBaseIntegratorState(): BaseIntegratorState {
  return { x: 0, y: 0, yaw: 0 };
}

export function mountPose(mujoco: Mujoco, model: MjModel, data: MjData): { pos: Vec3; mat: Float64Array | Float32Array; quat: Quat } {
  const mountId = model.body("buildo_lift").id;
  const pos: Vec3 = [data.xpos[mountId * 3], data.xpos[mountId * 3 + 1], data.xpos[mountId * 3 + 2]];
  const mat = data.xmat.slice(mountId * 9, mountId * 9 + 9);
  const quat = mat3ToQuat(mat, 0);
  return { pos, mat, quat };
}

interface SolveOpts {
  maxIters?: number;
  tol?: number;
  damping?: number;
}

/** Damped-least-squares differential IK, seeded from the arm's current
 * qpos (data.qpos isn't reset between calls) so it converges to the
 * nearest configuration rather than jumping. Leaves the solved pose in
 * data.qpos for the joints touched -- same as the Python version, see its
 * own docstring. */
export function solveArmIk(
  mujoco: Mujoco,
  model: MjModel,
  data: MjData,
  siteName: string,
  jointNames: string[],
  targetPos: Vec3,
  targetQuat: Quat,
  opts: SolveOpts = {}
): number[] {
  const maxIters = opts.maxIters ?? 200;
  const tol = opts.tol ?? 1e-4;
  const damping = opts.damping ?? 1e-2;

  const siteId = model.site(siteName).id;
  const joints = jointNames.map((name) => model.jnt(name));
  const qposAdrs = joints.map((j) => j.qposadr as number);
  const bodyIds = joints.map((j) => j.bodyid as number);
  const localAxes = joints.map((j) => Array.from(j.axis as ArrayLike<number>) as Vec3);
  const ranges = joints.map((j) => Array.from(j.range as ArrayLike<number>) as [number, number]);
  const n = joints.length;

  for (let iter = 0; iter < maxIters; iter++) {
    mujoco.mj_kinematics(model, data);
    mujoco.mj_comPos(model, data);

    const curPos: Vec3 = [data.site_xpos[siteId * 3], data.site_xpos[siteId * 3 + 1], data.site_xpos[siteId * 3 + 2]];
    const curQuat = mat3ToQuat(data.site_xmat, siteId * 9);

    const posErr = vecSub(targetPos, curPos);
    const errQuat = quatMul(targetQuat, quatConj(curQuat));
    const rotErr = quatToRotVec(errQuat);
    const err = [...posErr, ...rotErr];

    if (Math.sqrt(err.reduce((s, x) => s + x * x, 0)) < tol) break;

    const Jp: Vec3[] = [];
    const Jr: Vec3[] = [];
    for (let k = 0; k < n; k++) {
      const bId = bodyIds[k];
      const worldAxis = mat3MulVec3(data.xmat, bId * 9, localAxes[k]);
      const jointWorldPos: Vec3 = [data.xpos[bId * 3], data.xpos[bId * 3 + 1], data.xpos[bId * 3 + 2]];
      Jp.push(vecCross(worldAxis, vecSub(curPos, jointWorldPos)));
      Jr.push(worldAxis);
    }
    const J: number[][] = [];
    for (let r = 0; r < 3; r++) J.push(Jp.map((c) => c[r]));
    for (let r = 0; r < 3; r++) J.push(Jr.map((c) => c[r]));

    const JJt: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += J[a][k] * J[b][k];
        JJt[a][b] = s + (a === b ? damping : 0);
      }
    }
    const y = solveLinear6(JJt, err);
    const dq = new Array(n).fill(0);
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let a = 0; a < 6; a++) s += J[a][k] * y[a];
      dq[k] = s;
    }
    for (let k = 0; k < n; k++) {
      const adr = qposAdrs[k];
      let v = data.qpos[adr] + dq[k];
      const [lo, hi] = ranges[k];
      if (lo < hi) v = Math.min(hi, Math.max(lo, v));
      data.qpos[adr] = v;
    }
  }

  return qposAdrs.map((adr) => data.qpos[adr]);
}

/** Writes one BuildoActionChunk actions[i] entry into data.ctrl, per
 * packages/buildo-mujoco/robots/buildo/ACTION_MAPPING.md. Mutates
 * baseState in place (vx/vy/yawRate integration is stateful across calls
 * -- BuildoActionChunk gives velocities, the base's actuators are absolute
 * positions).
 *
 * Arm targets (action.leftArm/rightArm) are mount-frame -- transformed
 * through buildo_lift's CURRENT pose before solving IK. Call this at a high
 * rate (every physics tick, or close to it) while the base/lift are also
 * moving -- a stale mount pose drifts by however far they moved since the
 * last call (measured, see ACTION_MAPPING.md and the Phase 2 self-test). */
export function applyAction(
  mujoco: Mujoco,
  model: MjModel,
  data: MjData,
  baseState: BaseIntegratorState,
  action: ActionEntry,
  actionDt: number
): void {
  baseState.x += action.base.vx * actionDt;
  baseState.y += action.base.vy * actionDt;
  baseState.yaw += action.base.yawRate * actionDt;
  data.ctrl[model.actuator("base_x_act").id] = baseState.x;
  data.ctrl[model.actuator("base_y_act").id] = baseState.y;
  data.ctrl[model.actuator("base_yaw_act").id] = baseState.yaw;

  const liftAct = model.actuator("lift_z_act");
  const [liftLo, liftHi] = Array.from(liftAct.ctrlrange as ArrayLike<number>) as [number, number];
  data.ctrl[liftAct.id] = Math.min(liftHi, Math.max(liftLo, action.lift.height));

  mujoco.mj_kinematics(model, data);
  mujoco.mj_comPos(model, data);
  const { pos: mountPos, mat: mountMat, quat: mountQuat } = mountPose(mujoco, model, data);

  const sides: Array<{ side: "left" | "right"; joints: string[]; target: ActionEntry["leftArm"]; gripTarget: number }> = [
    { side: "left", joints: LEFT_ARM_JOINTS, target: action.leftArm, gripTarget: action.leftHand.gripTarget },
    { side: "right", joints: RIGHT_ARM_JOINTS, target: action.rightArm, gripTarget: action.rightHand.gripTarget },
  ];

  for (const { side, joints, target, gripTarget } of sides) {
    const worldTargetPos = mat3MulVec3(mountMat, 0, target.eePosition as Vec3);
    worldTargetPos[0] += mountPos[0];
    worldTargetPos[1] += mountPos[1];
    worldTargetPos[2] += mountPos[2];
    const worldTargetQuat = quatMul(mountQuat, target.eeOrientationQuat as Quat);

    const solved = solveArmIk(mujoco, model, data, `arms_${side}_ee_control_point`, joints, worldTargetPos, worldTargetQuat);
    joints.forEach((jointName, k) => {
      // "arms_openarm_left_joint3" -> "joint3" -> "arms_left_joint3_ctrl"
      const suffix = jointName.slice(jointName.lastIndexOf(`${side}_`) + side.length + 1);
      const actId = model.actuator(`arms_${side}_${suffix}_ctrl`).id;
      data.ctrl[actId] = solved[k];
    });

    const sign = side === "left" ? 1 : -1;
    data.ctrl[model.actuator(`arms_${side}_finger1_ctrl`).id] = sign * gripTarget * GRIP_JOINT_MAX;
  }
}

export { vecNorm };
