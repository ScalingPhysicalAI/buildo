// Builds a BuildoObservation from buildo_v0.xml's live MuJoCo state --
// TypeScript port of services/policy-server/test_integration_mujoco.py's
// observation_from_mujoco. No camera rendering here (cameraFrames: []) --
// same simplification as that Python version; wiring an actual rendered
// frame in is a separate piece of work, not needed to prove the
// observation/action loop itself.

import { mat3ToQuat, type Quat, type Vec3 } from "./mjMath";
import type { BuildoObservation } from "@buildo/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mujoco = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MjModel = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MjData = any;

function jointQpos(model: MjModel, data: MjData, name: string): number {
  return data.qpos[model.jnt(name).qposadr];
}

function jointQvel(model: MjModel, data: MjData, name: string): number {
  return data.qvel[model.jnt(name).dofadr];
}

function armState(model: MjModel, data: MjData, side: "left" | "right") {
  const joints = Array.from({ length: 7 }, (_, i) => `arms_openarm_${side}_joint${i + 1}`);
  const siteId = model.site(`arms_${side}_ee_control_point`).id;
  return {
    jointPositions: joints.map((j) => jointQpos(model, data, j)),
    eePosition: [data.site_xpos[siteId * 3], data.site_xpos[siteId * 3 + 1], data.site_xpos[siteId * 3 + 2]] as Vec3,
    eeOrientationQuat: mat3ToQuat(data.site_xmat, siteId * 9) as Quat,
  };
}

function handState(model: MjModel, data: MjData, side: "left" | "right") {
  const finger = jointQpos(model, data, `arms_openarm_${side}_finger_joint1`);
  return { fingerPositions: [finger], gripClosed: Math.abs(finger) > 0.5 };
}

export function observationFromMujoco(
  mujoco: Mujoco,
  model: MjModel,
  data: MjData,
  sequenceId: string,
  t: number,
  instruction: string
): BuildoObservation {
  return {
    schemaVersion: "buildo-observation/1.0",
    sequenceId,
    timestamp: t,
    instruction,
    cameraFrames: [],
    baseState: {
      x: jointQpos(model, data, "base_x"),
      y: jointQpos(model, data, "base_y"),
      yaw: jointQpos(model, data, "base_yaw"),
      vx: jointQvel(model, data, "base_x"),
      vy: jointQvel(model, data, "base_y"),
      yawRate: jointQvel(model, data, "base_yaw"),
    },
    liftState: {
      height: jointQpos(model, data, "lift_z"),
      velocity: jointQvel(model, data, "lift_z"),
    },
    leftArmState: armState(model, data, "left"),
    rightArmState: armState(model, data, "right"),
    leftHandState: handState(model, data, "left"),
    rightHandState: handState(model, data, "right"),
    leftTactile: null,
    rightTactile: null,
  };
}
