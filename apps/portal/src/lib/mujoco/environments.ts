// Simulator environments. Each one is an MJCF fragment under
// public/mujoco/scene/environments/<id>/scene.xml (generated into
// packages/buildo-mujoco/mjcf/environments/), loaded alongside the robot
// via <include> -- see loadHumanoidModel(). Adding one: write
// packages/buildo-mujoco/environments/<id>/layout.json, run
// scripts/build_environment.py <id>, `pnpm sync:mujoco`, then add an entry
// below. Everything here that isn't
// physics (camera framing, lighting, spawn point, which scripted workflows
// the room supports) lives in this registry rather than the MJCF.
//
// Coordinates: camera/light values are three.js (Y-up; three.x = mj.x,
// three.y = mj.z, three.z = -mj.y). `spawn` is MuJoCo world frame (Z-up).

export type Vec3 = [number, number, number];

export interface CameraPreset {
  pos: Vec3;
  lookAt: Vec3;
}

/** Scripted workflows that depend on a specific room layout (prop positions, park points). */
export type WorkflowId = "serveCoffee";

export interface SimEnvironment {
  id: string;
  name: string;
  description: string;
  /** Path of the environment's MJCF fragment, relative to /mujoco/scene/. */
  sceneFile: string;
  /** In-memory scene files for uploaded environments (see lib/mujoco/uploadEnvironment.ts). */
  files?: ReadonlyMap<string, Uint8Array | string>;
  /** Scene clear color; also used by the page behind the canvas before it paints. */
  background: string;
  /** Robot start position (facing +x), applied with applySpawn() in loadHumanoidScene.ts. */
  spawn: { x: number; y: number };
  camera: {
    orbitPosition: Vec3;
    orbitTarget: Vec3;
    /** Exactly four fixed "security camera" presets, one per room corner. */
    corners: [CameraPreset, CameraPreset, CameraPreset, CameraPreset];
  };
  lighting: {
    /** Point the key/fill lights aim at -- normally the room's center at counter height. */
    focus: Vec3;
    /** Half-width/half-depth of the key light's orthographic shadow frustum; must cover the room. */
    shadowHalfExtent: [number, number];
  };
  workflows: WorkflowId[];
}

// Kitchen framing values were measured against the imported kitchen's real
// boundary (see the comments that used to sit above CORNER_VIEWS /
// ORBIT_POSITION in MujocoViewer.tsx, preserved in git history): corners use
// MuJoCo y -2.75..6.0 (the kitchen proper, not the hallway past it), inset
// 1.8m and raised to 3.2m to clear the pantry cabinets.
const KITCHEN: SimEnvironment = {
  id: "kitchen",
  name: "Home — Kitchen",
  description: "Furnished residential kitchen with island, counters, and a coffee cup to serve.",
  sceneFile: "environments/kitchen/scene.xml",
  background: "#f3efe4",
  spawn: { x: 0, y: 0 },
  camera: {
    orbitPosition: [4.5, 3.5, 0.0],
    orbitTarget: [0, 0.9, -2.48],
    corners: [
      { pos: [1.93, 3.2, 0.95], lookAt: [0, 0.9, -1.6] },
      { pos: [-1.93, 3.2, 0.95], lookAt: [0, 0.9, -1.6] },
      { pos: [-1.93, 3.2, -4.2], lookAt: [0, 0.9, -1.6] },
      { pos: [1.93, 3.2, -4.2], lookAt: [0, 0.9, -1.6] },
    ],
  },
  lighting: { focus: [0, 0.6, -2.48], shadowHalfExtent: [5, 6] },
  workflows: ["serveCoffee"],
};

// Office and warehouse are generated from layout files by
// packages/buildo-mujoco/scripts/build_environment.py. Rooms are
// x -4.5..4.5 / y -3.5..3.5 (2.8m walls) and x -8..8 / y -6..6 (6m walls).
const OFFICE: SimEnvironment = {
  id: "office",
  name: "Office",
  description: "Open-plan office with desk rows, a lounge corner, and shelving.",
  sceneFile: "environments/office/scene.xml",
  background: "#dcdad5",
  spawn: { x: 0, y: 0 },
  camera: {
    orbitPosition: [3.6, 2.6, 2.9],
    orbitTarget: [0, 0.6, 0],
    corners: [
      { pos: [3.7, 2.5, 2.8], lookAt: [0, 0.7, 0] },
      { pos: [-3.7, 2.5, 2.8], lookAt: [0, 0.7, 0] },
      { pos: [-3.7, 2.5, -2.8], lookAt: [0, 0.7, 0] },
      { pos: [3.7, 2.5, -2.8], lookAt: [0, 0.7, 0] },
    ],
  },
  lighting: { focus: [0, 0.6, 0], shadowHalfExtent: [5.5, 4.5] },
  workflows: [],
};

const WAREHOUSE: SimEnvironment = {
  id: "warehouse",
  name: "Warehouse",
  description: "Distribution warehouse with pallet racking, a staging area of wrapped pallets, and loading dock doors.",
  sceneFile: "environments/warehouse/scene.xml",
  background: "#c9ccd0",
  spawn: { x: 0, y: 0 },
  camera: {
    orbitPosition: [7, 4.8, 5.3],
    orbitTarget: [0, 0.8, 0],
    corners: [
      { pos: [7, 4.5, 5.2], lookAt: [0, 0.8, 0] },
      { pos: [-7, 4.5, 5.2], lookAt: [0, 0.8, 0] },
      { pos: [-7, 4.5, -5.2], lookAt: [0, 0.8, 0] },
      { pos: [7, 4.5, -5.2], lookAt: [0, 0.8, 0] },
    ],
  },
  lighting: { focus: [0, 0.6, 0], shadowHalfExtent: [9, 7] },
  workflows: [],
};

export const ENVIRONMENTS: SimEnvironment[] = [KITCHEN, OFFICE, WAREHOUSE];

export const DEFAULT_ENVIRONMENT_ID = KITCHEN.id;

export function getEnvironment(id: string | null | undefined, extra: readonly SimEnvironment[] = []): SimEnvironment {
  return ENVIRONMENTS.find((env) => env.id === id) ?? extra.find((env) => env.id === id) ?? KITCHEN;
}
