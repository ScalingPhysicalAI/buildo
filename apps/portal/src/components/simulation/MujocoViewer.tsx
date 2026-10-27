"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import clsx from "clsx";

import { buildSceneFromModel, getBodyAxisXY, getPosition, getQuaternion, applySpawn, loadHumanoidModel } from "@/lib/mujoco/loadHumanoidScene";
import { DEFAULT_ENVIRONMENT_ID, ENVIRONMENTS, getEnvironment, type SimEnvironment } from "@/lib/mujoco/environments";
import { loadPropCatalog, propIdForBody, withAddedProps, type AddedProp, type PropCatalogEntry } from "@/lib/mujoco/propCatalog";
import { EnvironmentUploadPanel } from "./EnvironmentUploadPanel";
import { ObjectEditor, type ObjectEditorApi, type SceneObjectInfo, type Vec3 as EditorVec3 } from "./ObjectEditor";

// The MuJoCo WASM engine (mujoco.js + mujoco.wasm) is served as a static
// asset from public/mujoco/ rather than bundled -- it's a precompiled
// Emscripten module meant to be fetched at its own URL, and mujoco.js
// resolves its .wasm relative to that URL by default. See
// scripts/sync-mujoco-assets.sh for how these files get there.
const ENGINE_URL = "/mujoco/engine/mujoco.js";

async function loadEngine() {
  const { default: loadMujoco } = await import(/* webpackIgnore: true */ ENGINE_URL);
  return loadMujoco();
}

// One engine for every viewer rebuild (environment switch, object editor). Each
// instance's heap can grow toward the 2 GB wasm cap and is only returned when
// garbage collected, so a fresh instance per rebuild piles those heaps up.
let viewerEngine: ReturnType<typeof loadEngine> | null = null;
function loadViewerEngine() {
  viewerEngine ??= loadEngine().catch((err) => {
    viewerEngine = null;
    throw err;
  });
  return viewerEngine;
}

const UPLOAD_OPTION = "__upload__";

// MuJoCo-frame vectors and (w, x, y, z) quaternions, for moving a drawer's contents with it.
type Vec3Tuple = [number, number, number];
type QuatTuple = [number, number, number, number];
const vec3At = (buf: Float64Array | Float32Array, i: number): Vec3Tuple => [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
const quatAt = (buf: Float64Array | Float32Array, i: number): QuatTuple => [buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]];
const quatRotate = (q: QuatTuple, [x, y, z]: Vec3Tuple): Vec3Tuple => {
  const [, rx, ry, rz] = quatMul(quatMul(q, [0, x, y, z]), quatConj(q));
  return [rx, ry, rz];
};

// Drive/teleop tuning -- kept well inside the placeholder actuators' own
// ctrlrange (see model/scripts/urdf_to_mjcf.py) so a held key never asks for
// more than the actuator can deliver. DRIVE_WHEEL_RADIUS is a real
// measurement (from the wheel mesh's own geometry, see the same script);
// the speeds themselves are demo pacing, not hardware specs.
const DRIVE_SPEED = 0.8; // m/s
const TURN_SPEED = 1.0; // rad/s
const DRIVE_WHEEL_RADIUS = 0.1015; // m
// The telescoping lift column between the wheel base and the torso ("Slider
// 2" in the CAD export -- a real prismatic joint, not cosmetic: raising it
// visibly lifts the chest/head/arms as one rigid unit relative to the wheel
// base). U raises, L lowers, holding at whatever height the key was
// released at (a position target, not a velocity) -- ctrlrange itself
// (read from the model, not hardcoded) already caps it to what the column
// can physically extend.
const LIFT_RATE = 0.15; // m/s while U or L is held
// Waist forward bend ("Revolute 4" -- the torso pitch joint, WAIST_JOINTS in
// model/scripts/urdf_to_mjcf.py). Its own ctrlrange goes further than this
// (to -1.92 rad, confirmed via headless kinematics: negative is the forward
// direction, positive doesn't exist on this joint at all -- 0 is fully
// straight), but capped here at -90deg -- a human-plausible forward bend
// limit, not the joint's own mechanical one. F bends forward, R straightens
// back up, same hold-to-move/release-to-hold pattern as U/L.
const BEND_RATE = 0.5; // rad/s while F or R is held
const BEND_MAX = Math.PI / 2; // rad, forward -- clamps *below* the joint's own -1.92 limit

// Right arm (the same one Pick & Place uses). Sign conventions and which
// axis does what confirmed via headless forward kinematics, not guessed --
// swept each joint alone (others held at 0) and read where the hand ended
// up in base_link's own local frame (x=lateral, y=vertical, z=forward/back,
// same convention as getBodyAxisXY/BASE_FORWARD_AXIS elsewhere in this
// file):
//  - "Revolute 5" (shoulder, forward/back): local z barely moves near 0 but
//    swings hugely negative (forward, this body's own forward-axis
//    convention) as qpos goes *negative*, and only *positive* as far as
//    +45deg (the joint's own mechanical limit) before running out of range
//    -- i.e. this one joint's own range is already asymmetric in exactly
//    the shape asked for (a big forward reach, a small backward one), 0 is
//    the neutral/straight-down reference.
//  - "Revolute 7" (shoulder, lateral): local z is untouched throughout;
//    local x sweeps hugely instead. 0 is the same neutral reference.
const SHOULDER_FWD_RATE = 0.6; // rad/s while T or G is held
const SHOULDER_FWD_MAX = Math.PI / 2; // rad, forward raise (T) -- well inside the joint's own -180deg limit
const SHOULDER_BACK_MAX = Math.PI / 6; // rad, backward (G) -- 30deg, inside the joint's own +45deg limit
const SHOULDER_LAT_RATE = 0.6; // rad/s while Y or H is held
const SHOULDER_LAT_MAX = Math.PI / 2; // rad, lateral raise (Y) -- clamps below the joint's own 180deg range
// Upper-arm roll ("Revolute 9") and elbow ("Revolute 11") -- no raise-angle
// spec given for these the way the shoulder had, so each just uses its own
// full mechanical range (read from the model, not hardcoded) as the cap.
const ARM_ROLL_RATE = 0.6; // rad/s while I or K is held
const ELBOW_RATE = 0.8; // rad/s while O or P is held

// Wrist (right arm) -- two axes, both swept offline the same way the
// shoulder axes were (see that comment): "Revolute 26" sweeps the hand
// through a wide forward/back arc, "Revolute 43" sweeps it through a
// lateral/vertical arc at a constant forward distance. Neither has a
// human-plausible-angle spec from the user the way the shoulder did, so (like
// arm roll/elbow) each just uses its own full mechanical range.
const WRIST_A_RATE = 0.8; // rad/s while J or N is held ("Revolute 26")
const WRIST_B_RATE = 0.8; // rad/s while V or B is held ("Revolute 43")

// Left arm mirrors the right one joint-for-joint (see LEFT_ARM_JOINTS'
// own comment below). Originally driven by holding Shift with the same key
// as the matching right-arm control, but that Shift-chord scheme turned out
// unreliable in practice (reported as "left arm mirroring doesn't work at
// all" -- most likely browsers/OSes not reliably reporting a modifier held
// simultaneously with another key the way a plain keydown is reported) --
// switched to its own dedicated keys (number row + punctuation) instead, so
// each left-arm control is a single ordinary key with no modifier involved.
// Every left-arm joint's positive direction was confirmed, not assumed, to
// be the mirror image of its right-arm counterpart's (swept "Revolute
// 6/8/27/64" the same way as "Revolute 5/7/26/43" -- each one's
// hand-position sweep is the same shape, just with z (forward) or x
// (lateral) trending the *opposite* way for the same sign of qpos) -- so the
// left-arm controls below apply the *negated* rate to reach the mirrored
// target range.
const LEFT_MIRROR_SIGN = -1;

// Manual grip (both hands): holding it closed near the object grabs it with
// a kinematic follow (applyGripPose below), not an equality weld -- this
// engine build's JS bindings crash on any access to a boolean-typed
// mjData/mjModel array, which is exactly what the weld-enable mechanism
// (data.eq_active) is, so a weld-based design isn't usable here at all (see
// applyGripPose's own comment). Finger-contact alone doesn't reliably hold
// anything with this hand either (the thumb chain doesn't oppose the other
// four fingers regardless of joint values, see PICK_FINGER_JOINTS' own
// comment), so without the kinematic follow a "grabbed" object would just
// slide free the moment the arm moved.
const GRIP_RATE = 1.2; // 0..1 (open..closed) per second while held
const GRIP_ENGAGE_AT = 0.8; // grip fraction above which closing near the object grabs it
const GRIP_RELEASE_AT = 0.2; // grip fraction below which it lets go
// A gripped door/drawer is pulled toward the hand by a spring-damper with
// this natural frequency (rad/s, scaled by the part's own inertia), capped at
// roughly what a person pulls with (N*m for doors, N for drawers).
const PULL_OMEGA = 25;
const PULL_MAX_TORQUE = 30;
const PULL_MAX_FORCE = 80;
// How close the palm's center must be to the object's *surface* (nearest
// point on any of its geoms' bounding boxes) to grab it -- measured to the
// surface, not the object's center, so a large box can be grabbed by its
// side. Was a 0.2m center distance -- reported live as grabbing objects from
// noticeably far away.
const GRIP_REACH = 0.06; // m
// The hold itself is a kinematic follow (applyGripPose) that freezes
// whatever the anchor-to-object offset happened to be *at the moment of
// grab* -- so grabbing from anywhere within GRIP_REACH would freeze that gap
// for the whole hold. The captured offset is shifted toward the palm until
// the surface gap is at most this, for a snug-looking hold.
const GRIP_SNUG_GAP = 0.01; // m
// Heaviest object a hand can pick up; heavier free bodies (chairs, drums,
// pallets, the pallet jack) can only be pushed.
const GRAB_MAX_MASS = 5; // kg
// A held object's robot collision is off (see setRobotCollision) and stays
// off after release until its surface is at least this far from both palms,
// so letting go doesn't start it inside the fingers.
const ROBOT_COLLISION_CLEARANCE = 0.15; // m
const ROBOT_COLLISION_BIT = 2;
// Which of base_link's own local axes points where the robot actually
// faces -- see getBodyAxisXY's comment. Confirmed empirically (not
// guessed): local X is the line straight through both hands (i.e. side to
// side), local Y is straight up, which only leaves local Z as the
// front-back axis.
const BASE_FORWARD_AXIS = 2 as const;

// Corner camera presets and the Center Stage framing are per-environment --
// see `camera` in lib/mujoco/environments.ts.
type ViewMode = "orbit" | "corner1" | "corner2" | "corner3" | "corner4" | "fpp";
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "orbit", label: "Center Stage" },
  { value: "corner1", label: "Corner 1" },
  { value: "corner2", label: "Corner 2" },
  { value: "corner3", label: "Corner 3" },
  { value: "corner4", label: "Corner 4" },
  { value: "fpp", label: "First Person" },
];

// The on-screen key guide's own content -- grouped so the panel can render
// section headings, not just one long list. Kept as data rather than
// scattered across each control's own JSX so adding a key here can't
// silently drift out of sync with what the panel actually shows.
const KEY_GUIDE: { section: string; rows: { key: string; action: string }[] }[] = [
  {
    section: "Drive",
    rows: [
      { key: "W / S", action: "Forward / back" },
      { key: "A / D", action: "Turn left / right" },
    ],
  },
  {
    section: "Torso",
    rows: [
      { key: "U / L", action: "Raise / lower height" },
      { key: "F / R", action: "Bend forward / straighten" },
    ],
  },
  {
    section: "Right arm",
    rows: [
      { key: "T / G", action: "Shoulder: raise forward / lower back" },
      { key: "Y / H", action: "Shoulder: raise sideways / lower" },
      { key: "I / K", action: "Upper arm: rotate" },
      { key: "O / P", action: "Elbow: bend / straighten" },
      { key: "J / N", action: "Wrist: bend" },
      { key: "V / B", action: "Wrist: roll" },
      { key: "C / X", action: "Hand: grip / release" },
    ],
  },
  {
    section: "Left arm",
    rows: [
      { key: "1 / 2", action: "Shoulder: raise forward / lower back" },
      { key: "3 / 4", action: "Shoulder: raise sideways / lower" },
      { key: "5 / 6", action: "Upper arm: rotate" },
      { key: "7 / 8", action: "Elbow: bend / straighten" },
      { key: "9 / 0", action: "Wrist: bend" },
      { key: "= / -", action: "Wrist: roll" },
      { key: "[ / ]", action: "Hand: grip / release" },
    ],
  },
];

// FPP head look-around range -- a human neck doesn't spin like a turret,
// so this is clamped rather than a free 360 look.
const FPP_MAX_YAW = (110 * Math.PI) / 180;
const FPP_MIN_PITCH = (-70 * Math.PI) / 180; // look down
const FPP_MAX_PITCH = (60 * Math.PI) / 180; // look up
const FPP_LOOK_SENSITIVITY = 0.006; // radians per pixel of drag
const FPP_FORWARD_CLEARANCE = 0.22; // m -- clears the head geom's own ~0.158m bounding radius, see the render loop's own comment
// Wave gesture removed at the user's request (the joint-anchor fix -- see
// recenter_arm_joint_anchors() in model/scripts/urdf_to_mjcf.py -- fixed the
// "detached"-looking swing, but the resulting motion still didn't read as a
// wave) -- pending a proper scripted-scene replacement.

function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function lerpArr(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

// wxyz quaternion helpers for the kinematic-follow grip's relpose (see
// GRIP_RATE's own comment), computed live since a grab -- manual or the
// Workflow's own scripted one -- can happen from any pose, not one fixed
// one.
function quatConj(q: [number, number, number, number]): [number, number, number, number] {
  return [q[0], -q[1], -q[2], -q[3]];
}
function quatMul(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  const [w1, x1, y1, z1] = a;
  const [w2, x2, y2, z2] = b;
  return [
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
  ];
}

// Live relpose for a manual-grip weld: body1 (the object)'s current
// position/orientation expressed in body2 (the grip anchor)'s own frame --
// the exact quantity a MJCF <weld relpose="..."> attribute holds, just
// computed at grab time instead of offline (see GRIP_RATE's own comment).
// mujoco/data types are untyped (any) throughout this file, hence the
// explicit params here rather than threading real types through --
// TypeScript infers `unknown[]` for a plain Array.from(any) in some
// overload-resolution cases, which is what this sidesteps.
// Standard rotation-matrix -> quaternion (wxyz, matching MuJoCo's own
// convention) conversion -- needed because MjData exposes geom_xmat (a 3x3
// per geom) but no geom_xquat. See RIGHT_GRIP_ANCHOR_GEOM's own comment for
// why the grip anchor has to be a geom, not a body, in the first place.
function mat3ToQuat(m: Float32Array | Float64Array, base: number): [number, number, number, number] {
  const m00 = m[base], m01 = m[base + 1], m02 = m[base + 2];
  const m10 = m[base + 3], m11 = m[base + 4], m12 = m[base + 5];
  const m20 = m[base + 6], m21 = m[base + 7], m22 = m[base + 8];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    return [0.25 / s, (m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    return [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    return [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    return [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
  }
}

// anchorGeom is a GEOM id, not a body id -- see RIGHT_GRIP_ANCHOR_GEOM's own
// comment for why (every fingertip/palm body in this CAD export has its own
// origin sitting 0.7-0.9m from where its mesh actually renders; geom_xpos/
// geom_xmat, unlike body xpos/xmat, already account for a geom's own local
// pos/mat offset within its body, giving the mesh's real rendered pose).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeGripRelpose(data: any, anchorGeom: number, objBody: number) {
  const ax = data.geom_xpos[anchorGeom * 3];
  const ay = data.geom_xpos[anchorGeom * 3 + 1];
  const az = data.geom_xpos[anchorGeom * 3 + 2];
  const dx = data.xpos[objBody * 3] - ax;
  const dy = data.xpos[objBody * 3 + 1] - ay;
  const dz = data.xpos[objBody * 3 + 2] - az;
  const m = anchorGeom * 9;
  // R^T * d: R is row-major, so column i is [R[i], R[3+i], R[6+i]], and
  // (R^T*d)'s row i is that column dotted with d.
  const relPos: [number, number, number] = [
    data.geom_xmat[m] * dx + data.geom_xmat[m + 3] * dy + data.geom_xmat[m + 6] * dz,
    data.geom_xmat[m + 1] * dx + data.geom_xmat[m + 4] * dy + data.geom_xmat[m + 7] * dz,
    data.geom_xmat[m + 2] * dx + data.geom_xmat[m + 5] * dy + data.geom_xmat[m + 8] * dz,
  ];
  const anchorQuat = mat3ToQuat(data.geom_xmat, m);
  const oq = objBody * 4;
  const objQuat: [number, number, number, number] = [data.xquat[oq], data.xquat[oq + 1], data.xquat[oq + 2], data.xquat[oq + 3]];
  const relQuat = quatMul(quatConj(anchorQuat), objQuat);
  return { relPos, relQuat };
}

// Nearest point on geoms [first, first+count) to world point p, using each
// geom's oriented bounding box (model.geom_aabb, in the geom's own frame).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nearestSurfacePoint(model: any, data: any, first: number, count: number, p: [number, number, number]) {
  let best = { dist: Infinity, point: [0, 0, 0] as [number, number, number] };
  for (let g = first; g < first + count; g++) {
    const m = g * 9;
    const dx = p[0] - data.geom_xpos[g * 3];
    const dy = p[1] - data.geom_xpos[g * 3 + 1];
    const dz = p[2] - data.geom_xpos[g * 3 + 2];
    const local = [0, 1, 2].map((i) => {
      const v = data.geom_xmat[m + i] * dx + data.geom_xmat[m + 3 + i] * dy + data.geom_xmat[m + 6 + i] * dz;
      const c = model.geom_aabb[g * 6 + i];
      const h = model.geom_aabb[g * 6 + 3 + i];
      return Math.min(c + h, Math.max(c - h, v));
    });
    const point: [number, number, number] = [0, 1, 2].map(
      (r) =>
        data.geom_xpos[g * 3 + r] +
        data.geom_xmat[m + r * 3] * local[0] +
        data.geom_xmat[m + r * 3 + 1] * local[1] +
        data.geom_xmat[m + r * 3 + 2] * local[2]
    ) as [number, number, number];
    const dist = Math.hypot(point[0] - p[0], point[1] - p[1], point[2] - p[2]);
    if (dist < best.dist) best = { dist, point };
  }
  return best;
}

// Shifts a freshly-captured grip relPos (object origin in the anchor's
// frame) toward the anchor until the object's surface is GRIP_SNUG_GAP from
// it -- see that constant's own comment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snugRelPos(data: any, anchorGeom: number, relPos: [number, number, number], surface: [number, number, number]) {
  const a = [data.geom_xpos[anchorGeom * 3], data.geom_xpos[anchorGeom * 3 + 1], data.geom_xpos[anchorGeom * 3 + 2]];
  const v = [surface[0] - a[0], surface[1] - a[1], surface[2] - a[2]];
  const gap = Math.hypot(v[0], v[1], v[2]);
  if (gap <= GRIP_SNUG_GAP) return relPos;
  const k = (gap - GRIP_SNUG_GAP) / gap;
  const m = anchorGeom * 9;
  const shift = [0, 1, 2].map(
    (i) => (data.geom_xmat[m + i] * v[0] + data.geom_xmat[m + 3 + i] * v[1] + data.geom_xmat[m + 6 + i] * v[2]) * k
  );
  return [relPos[0] - shift[0], relPos[1] - shift[1], relPos[2] - shift[2]] as [number, number, number];
}

// Scripted "Workflow": drives to the counter's own coffee cup
// (urdf_to_mjcf.py's CUP_OBJECT_POS), grabs it with the same right arm/hand
// the wave gesture uses, then carries it over to the coffee machine and
// stops there, still holding it -- see the Workflow dropdown's own comment
// near the JSX for the option this drives.
//
// The six arm joint targets below were solved two different ways before
// landing here, both offline against this same model:
//  1. Pure kinematic IK (finger_tip_1 at the target position) -- looked
//     right in a static mj_forward snapshot, but several joints (arm roll
//     "Revolute 9", both wrist axes) turned out to have real per-joint
//     torque limits (as low as +-15 N*m) that the *kinematic* solve had no
//     way to know about, so the actual pose under gravity settled somewhere
//     else entirely once simulated for real -- confirmed by holding each
//     candidate target under actual dynamics for several seconds and
//     comparing.
//  2. Re-solved with the wrist axes ("Revolute 26"/"43") pinned to 0 --
//     their own safe (empirically swept) holding range sits right around
//     0 anyway -- and arm roll bounded to its own [-0.2, 0.2] safe zone,
//     then verified by simulating the *actual* dynamics (not just
//     kinematics) for 2500+ steps and checking the settled anchor position
//     matches the intended grasp point. GRASP below is that verified pose;
//     PREGRASP is just GRASP scaled by 0.6 (an intermediate "reaching, not
//     yet at the object" pose -- doesn't need its own precise IK solve
//     since it's a waypoint, not a grasp point).
const PICK_ARM_JOINTS = ["Revolute 5", "Revolute 7", "Revolute 9", "Revolute 11", "Revolute 26", "Revolute 43"];
const PICK_REST_QPOS = [0, 0, 0, 0, 0, 0];
// Solved with a different objective than earlier attempts at this same
// problem: instead of minimizing raw palm-to-cup distance (which kept
// landing poses where the *forearm* ends up closer to the cup than the palm
// does -- reported live as "picks up with its forearm/wrist," and verified
// real: this rig's fingers, in most reaching poses, don't point at what the
// palm is merely close to), this searches for where the palm's own local
// +Z axis -- the direction its fingers actually extend along, measured
// directly off finger_tip_1/2/thumb_knuckle_1's geom positions in the
// palm's local frame -- points roughly *at* the cup, offset out from the
// palm by about the fingers' closed reach (0.10m). That "virtual grasp
// point," not the raw palm position, is what's minimized here. The result:
// forearm_joint_1's own geoms settle ~3x farther from the cup than this
// grasp point does (0.31m vs 0.10m, confirmed by simulating actual
// dynamics for 6000+ steps, not a kinematic snapshot) -- the fingers, not
// the forearm, are what's nearest the cup now, and the two contact points
// that actually develop during the reach are both fingertips touching the
// counter (checked directly). This also uses noticeably less waist bend
// than the previous solve (~54 degrees vs ~75) and more shoulder-forward
// rotation instead -- the user's own suggestion ("T to move arm forward")
// -- while still settling the base within ~5cm of PICK_PARK_PICK under the
// bend's reaction load (PICK_BEND_HOLD_KP). Every joint tracks its
// commanded value within a few thousandths of a radian at that settle.
const PICK_GRASP_QPOS = [-2.495845868805196, 0.4561463351982671, 0.0, -1.6365550289818054, 0.0, -0.012969195368815467];
// Waist bend (Revolute 4, same joint/actuator as the F/R teleop -- see
// BEND_RATE's own comment) that pairs with PICK_GRASP_QPOS above. Held at 0
// through "reach" (the arm alone extends out toward the cup here -- the
// visible "stretching forward" motion), then ramped up only during "lower"
// once the arm is already fully extended, and held through
// "close"/"settle"/"pullIn" before ramping back to upright during "lift" --
// never left bent while walking. -0.934 rad (~54 degrees), comfortably
// inside BEND_MIN (-pi/2) so it's within the same range a teleop user could
// reach by hand.
const PICK_GRASP_BEND = -0.934;
// The arm's pose while actually driving to/from the coffee machine, held
// through "lift"/"driveToCoffee1"/"driveToCoffee2". Elbow bent to ~90
// degrees with the upper arm pulled back close to the body -- the user's
// own ask, "like people bend their arm so coffee won't fall," and it
// doubles as the fix for an earlier crash: an earlier, more outward-reaching
// carry pose put a fingertip wide enough that it swept into the north-run
// counter's own corner during a turn -- confirmed via headless sim, reported
// live as "it crashes into the table." This pose keeps the whole arm's
// swept envelope close to the chassis instead (re-verified collision-free
// along the entire drive, not just the corner that broke before). The cup
// rides along rigidly regardless of which pose the arm is in (see
// applyGripPose), so it's carried at chest height here instead of down at
// the hip.
const PICK_CARRY_QPOS = [0.5, 0.2, 0.0, 1.5708, 0.0, 0.0];
// Reach pose for setting the cup down once parked at PICK_COFFEE_PARK --
// solved the same way as PICK_GRASP_QPOS (grasp-point-vs-forearm objective,
// same method used to verify PICK_GRASP_QPOS: real dynamics, not a
// kinematic snapshot), pairing with PICK_PLACE_BEND below. Settles the
// grasp point within ~11.5cm of PICK_PLACE_TARGET (vs the old pose, which
// used no bend at all and left the palm nowhere near the counter), with the
// fingertips -- not the forearm -- the closest part to the target, same as
// the pickup side.
const PICK_PLACE_QPOS = [-1.858531326660775, 0.39707497009106385, 0.0, -0.7577017369007841, 0.0, 0.04444714196240446];
// Waist bend for placement -- deliberately smaller than PICK_GRASP_BEND
// (~35 degrees vs ~54): the user's own ask ("bend a little bit and place it
// exact on table"), and this counter sits at the same height as the pickup
// one, so less horizontal distance to close here means less bend needed.
// Same ramp shape as PICK_GRASP_BEND: 0 through "lowerPlace" (arm extends
// first), ramps up during "settlePlace", held through "placing"/"release",
// back to 0 during "retractPlace".
const PICK_PLACE_BEND = -0.61;
// Where the cup actually ends up when placed -- on the counter surface
// (z=0.909, the same measured marble-slab height CUP_OBJECT_POS in
// urdf_to_mjcf.py uses, plus the cup's own half-height) just east of the
// coffee machine's own footprint (x -3.48..-3.01, y 3.52..3.81 -- see that
// script's own manifest measurements), not overlapping it. "placing" still
// animates the cup here directly rather than trusting the arm's own joint
// targets to land exactly on it -- PICK_PLACE_QPOS gets close (~11.5cm) but
// not exact -- so this is what guarantees an exact, on-counter landing
// spot; the animated distance is now short enough to read as the hand
// setting the cup down, not a separate slide (see "placing"'s own comment).
const PICK_PLACE_TARGET: [number, number, number] = [-2.95, 3.65, 0.952];
// All 15 right-hand finger joints (4 fingers + thumb, 3 joints each). Each
// one closes toward its own lower jnt_range limit and opens toward its
// upper limit -- confirmed empirically, not assumed: sweeping each joint
// end to end and checking which end brings that finger's tip closer to the
// other fingers' tips gave the same answer (low = closer) for all 15,
// including the thumb -- whose own chain, even fully curled, still lands
// about half a metre from the other four fingertips regardless of joint
// values, i.e. it doesn't actually oppose them. That's why the grasp below
// is a weld, not finger-contact friction: the four fingers that do converge
// approach the object from only one side, with nothing to press it against.
const PICK_FINGER_JOINTS = [
  "Revolute 48", "Revolute 49", "Revolute 50", "Revolute 51", "Revolute 52",
  "Revolute 53", "Revolute 54", "Revolute 55", "Revolute 56", "Revolute 57",
  "Revolute 58", "Revolute 59", "Revolute 60", "Revolute 61", "Revolute 62",
];
// Left hand's own 15 finger joints -- same open/closed convention as the
// right hand (lo=closed, hi=open for all 15, confirmed separately for this
// hand rather than assumed mirrored -- see PICK_FINGER_JOINTS' own comment
// for how that was checked). Manual grip only (Pick & Place doesn't use the
// left hand).
const LEFT_FINGER_JOINTS = [
  "Revolute 69", "Revolute 70", "Revolute 71", "Revolute 72", "Revolute 73",
  "Revolute 74", "Revolute 75", "Revolute 76", "Revolute 77", "Revolute 78",
  "Revolute 79", "Revolute 80", "Revolute 81", "Revolute 82", "Revolute 83",
];
// Where the base must be parked (world x, y, and a fixed heading) for
// PICK_GRASP_QPOS to actually reach the cup -- east of the kitchen island,
// facing west toward it (see getBodyAxisXY's own comment for why yaw=-pi/2
// is "faces -X" on this rig, confirmed empirically the same way). Verified
// clear of the island's own collision box with margin (headless sim: zero
// base-vs-island contacts parked here).
const PICK_PARK_PICK: [number, number] = [1.45, 1.939];
const PICK_PARK_YAW = -Math.PI / 2;
// Route from spawn (0,0) to PICK_PARK_PICK, as two waypoints rather than
// one straight line -- a direct line clips the center table's own
// collision box (_KITCHEN_CENTER_TABLE_BOUNDS in urdf_to_mjcf.py) once the
// base's yaw has turned enough toward PICK_PARK_YAW along the way (checked
// at yaw=-pi/2 specifically: ~15cm deep). Whether that turn has happened
// yet by the time the base is actually near the table depends on timing
// that isn't worth relying on -- these two waypoints instead keep x>=1.7
// (clear of the table's own x<=0.77) until y is past the table's y<=1.85,
// verified collision-free at every yaw the base could plausibly be at
// along the way (0, +-pi/2), not just its final one.
const PICK_WAYPOINT_EAST: [number, number] = [1.7, 0.0];
const PICK_WAYPOINT_EAST_NORTH: [number, number] = [1.7, 2.2];
// Route from the cup's park spot to the coffee machine, as two waypoints
// rather than one straight line -- a direct line between them cuts straight
// through the island's own collision box (checked: crosses it for roughly a
// third of the distance). Route instead goes north along the open corridor
// east of the island/north run (x=1.45 clears both the island's x<=1.0 and
// the north run's x<=0.85 the whole way up), then west through the gap
// between the island and the north run (y=3.0..3.8, clear of every counter
// except the west counter's own shallow run, which only starts at
// x<=-2.85 -- well past this waypoint's x=-2.4) to a stop point just east
// of the coffee machine, still facing -X toward it. y=3.5 sits close to the
// gap's own midpoint (3.4) -- centered, not hugging either edge, since the
// north-run corner in particular has very little margin to spare (see
// PICK_CARRY_QPOS's own comment: even a tucked arm, not just the chassis,
// needs real clearance there). Both legs verified collision-free via
// headless sim (stepped the whole route with the arm actually held at
// PICK_CARRY_QPOS, zero robot-vs-kitchen contacts throughout, cup included).
const PICK_WAYPOINT_NORTH: [number, number] = [1.45, 3.5];
const PICK_COFFEE_PARK: [number, number] = [-2.4, 3.5];

// Autopilot driving, used only by this scripted sequence (never WASD
// teleop): plain world-frame position P-control with an acceleration ramp
// on virtual_base_x/y. Unlike the base's *forward* drive (which projects
// onto the body's current heading, see getBodyAxisXY's own comment), these
// two joints are literal world-X/world-Y translations independent of
// heading -- confirmed via headless sim -- so driving to a world point needs
// no heading math at all, only distance. Yaw is held at PICK_PARK_YAW by a
// separate P-loop, active through every phase below (not just while
// driving): left alone, virtual_base_yaw slowly drifts under any small
// disturbance (confirmed via headless sim -- it is not spring-loaded back
// to anything on its own), which would throw off every joint-space arm
// target below, all of which assume the base is exactly facing
// PICK_PARK_YAW.
const PICK_DRIVE_KP = 1.2;
// Faster than WASD's own DRIVE_SPEED -- purely demo pacing (a scripted
// sequence looks better moving briskly than crawling across a 12x12m
// room), not a workaround. See GRASP_WELD_ANCHOR_BODY in
// model/scripts/urdf_to_mjcf.py for why the carry itself is solid at any
// reasonable speed here (an earlier weld anchor choice made this whole
// sequence only marginally stable regardless of speed -- fixed by
// anchoring the weld to the hand instead, not by driving faster).
const PICK_DRIVE_MAX_SPEED = 1.4; // m/s
const PICK_DRIVE_MAX_ACCEL = 1.2; // m/s^2
const PICK_DRIVE_ARRIVE_DIST = 0.05; // m
// Base XY position hold used only while bent forward (see PICK_GRASP_BEND's
// own comment) -- stiffer than PICK_DRIVE_KP above since it's resisting a
// sustained reaction load from the bend, not tracking a moving waypoint.
// Without this the base drifts off PICK_PARK_PICK/PICK_COFFEE_PARK under
// that load, which throws off every *_QPOS-relative reach math -- confirmed
// via headless dynamics that PICK_DRIVE_KP's own 1.2 isn't stiff enough to
// hold this against the bend (drifted ~0.75m over 6000 steps rather than
// settling); 8.0 holds within a few cm.
const PICK_BEND_HOLD_KP = 8.0;
const PICK_DRIVE_TIMEOUT_S = 20; // s -- see the render loop's own comment on why a drive phase gets aborted, not left to spin forever, past this
const PICK_YAW_KP = 3.0;
const PICK_YAW_MAX_RATE = 1.5; // rad/s

// Phase durations, in seconds of simulated time -- ticked once per physics
// step inside the same catch-up loop as the wave gesture, for the same
// reason (see waveElapsedS's own comment: immune to render-frame hitches by
// construction, since nothing here reads wall-clock time). REACH/LOWER/
// SETTLE are all longer than a bare "looks fine in a screenshot" pass would
// use -- these specific joints (see PICK_GRASP_QPOS's own comment on their
// torque limits) take real seconds to actually settle into a commanded pose
// under gravity, confirmed by holding one under actual dynamics and
// watching the position error decay; cutting these too short captured the
// grip relPose against a hand that was still mid-swing, which read live as
// "it picks the cup up from way off from where it actually is." These
// values are the shortest that still verified accurate in that same
// headless check (a first pass roughly double these also worked, but read
// live as "the workflow is stuck," since W/A/S/D and every other idle-gated
// control are correctly locked out for its entire ~18s run -- see
// PICK_DRIVE_TIMEOUT_S's own comment for the separate, real WASD bug this
// was mixed up with).
const PICK_REACH_S = 1.5; // rest -> grasp arm pose, bend still at 0 (the arm-stretch-forward motion)
const PICK_LOWER_S = 1.5; // arm holds at grasp pose, bend ramps 0 -> PICK_GRASP_BEND (the final lean-in to touch)
const PICK_CLOSE_S = 0.5; // fingers open -> closed
const PICK_SETTLE_S = 1.2; // lets the arm actually finish settling before the grip is captured
// Shortened from 0.5s now that PICK_GRASP_QPOS/PICK_GRASP_BEND land the palm
// within a few cm of CUP_OBJECT_POS -- see "pullIn"'s own comment -- instead
// of the ~0.3-0.6m gap the old no-bend pose left, which needed a slower,
// more visible slide to not look like an outright teleport.
const PICK_PULL_IN_S = 0.2;
const PICK_LIFT_S = 1.2; // grasp -> carry pose, bend ramps back to 0, now holding the object
const PICK_LOWER_PLACE_S = 1.5; // carry -> place arm pose, bend still at 0 (arm-stretch-forward, same as pickup)
const PICK_SETTLE_PLACE_S = 1.0; // arm holds at place pose, bend ramps 0 -> PICK_PLACE_BEND
// Shortened from 0.6s -- PICK_PLACE_QPOS/PICK_PLACE_BEND now land the grasp
// point within ~11.5cm of PICK_PLACE_TARGET (see PICK_PLACE_QPOS's own
// comment) instead of the old no-bend pose's much larger gap.
const PICK_PLACING_S = 0.3;
const PICK_RELEASE_S = 0.7; // fingers closed -> open
const PICK_RETRACT_PLACE_S = 1.2; // place -> carry, arm withdrawing after letting go

type PickPhase =
  | "idle"
  | "driveToPick1"
  | "driveToPick2"
  | "driveToPick3"
  | "reach"
  | "lower"
  | "close"
  | "settle"
  | "pullIn"
  | "lift"
  | "driveToCoffee1"
  | "driveToCoffee2"
  | "lowerPlace"
  | "settlePlace"
  | "placing"
  | "release"
  | "retractPlace";

interface MujocoViewerProps {
  /** Enables orbit camera controls, WASD driving, the wave gesture, and the pause/reset/wave overlay. */
  interactive?: boolean;
  className?: string;
  /** Environment to load first (see lib/mujoco/environments.ts); interactive viewers can switch from there. */
  initialEnvironmentId?: string;
}

type Status = "loading" | "ready" | "error";

/** The object editor's changes to one room, kept for the session (Reset clears them). */
interface SceneEdits {
  added: AddedProp[];
  /** Body names deleted in the editor. Bodies stay in the model, parked and collision-free. */
  removed: Set<string>;
  /** Fixtures (no free joint) moved/rotated in the editor; movable objects' poses live in qpos. */
  staticPoses: Map<string, { pos: EditorVec3; quat: [number, number, number, number] }>;
  nextId: number;
}

function editsIn(all: Map<string, SceneEdits>, envId: string): SceneEdits {
  let edits = all.get(envId);
  if (!edits) {
    edits = { added: [], removed: new Set(), staticPoses: new Map(), nextId: 0 };
    all.set(envId, edits);
  }
  return edits;
}

/** Running state carried across an editor rebuild (see withAddedProps for why array copies are enough). */
interface SimSnapshot {
  envId: string;
  qpos: Float64Array;
  qvel: Float64Array;
  ctrl: Float64Array;
  teleop: unknown;
  camera: { pos: EditorVec3; target: EditorVec3 };
}

export function MujocoViewer({ interactive = false, className, initialEnvironmentId = DEFAULT_ENVIRONMENT_ID }: MujocoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  // Only the most recent upload is kept (it can be up to a few hundred MB in memory).
  const [uploadedEnvironment, setUploadedEnvironment] = useState<SimEnvironment | null>(null);
  // Read by the init effect, which only re-runs on environmentId changes.
  const uploadedEnvironmentRef = useRef<SimEnvironment | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const uploadedList = uploadedEnvironment ? [uploadedEnvironment] : [];
  const environment = getEnvironment(environmentId, uploadedList);
  const [status, setStatus] = useState<Status>("loading");
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<ViewMode>("orbit");
  const [showGuide, setShowGuide] = useState(true);
  const [workflowChoice, setWorkflowChoice] = useState("");
  const pausedRef = useRef(paused);
  const viewRef = useRef(view);
  const resetRef = useRef<() => void>(() => {});
  const pickRef = useRef<() => void>(() => {});
  const isBusyRef = useRef<() => boolean>(() => false);
  // Object editor: per-room edits for the session, the scene API the
  // editor drives, and the state carried across the rebuild an add needs.
  const sceneEditsRef = useRef(new Map<string, SceneEdits>());
  const editorApiRef = useRef<ObjectEditorApi | null>(null);
  const captureRef = useRef<(() => SimSnapshot) | null>(null);
  const restoreRef = useRef<SimSnapshot | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const pausedBeforeEditRef = useRef(false);
  const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let model: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;
    let resizeObserver: ResizeObserver | null = null;
    let removeKeyListeners: (() => void) | null = null;
    const env = getEnvironment(environmentId, uploadedEnvironmentRef.current ? [uploadedEnvironmentRef.current] : []);
    const ORBIT_POSITION = env.camera.orbitPosition;
    const ORBIT_TARGET = env.camera.orbitTarget;
    const CORNER_VIEWS = env.camera.corners;
    resetRef.current = () => {};
    pickRef.current = () => {};
    isBusyRef.current = () => false;
    editorApiRef.current = null;
    captureRef.current = null;
    const edits = editsIn(sceneEditsRef.current, env.id);
    const restore = restoreRef.current?.envId === env.id ? restoreRef.current : null;
    restoreRef.current = null;

    async function init() {
      const container = containerRef.current;
      if (!container) return;

      const mujoco = await loadViewerEngine();
      if (disposed) return;

      const catalog: PropCatalogEntry[] = await loadPropCatalog().catch(() => []);
      if (disposed) return;
      const loaded = await loadHumanoidModel(mujoco, await withAddedProps(env, edits.added, catalog));
      // The engine outlives this effect, so a model compiled after cleanup ran must be freed here.
      if (disposed) {
        loaded.delete?.();
        return;
      }
      model = loaded;
      // Spawn translates the body carrying virtual_base_x (a child of world),
      // so Reset returns there. Not qpos0: slide joints measure displacement
      // from qpos0, so the robot wouldn't move. Base qpos is therefore
      // relative to the spawn point.
      applySpawn(mujoco, model, env.spawn);
      data = new mujoco.MjData(model);
      mujoco.mj_forward(model, data);
      if (disposed) return;

      const { root, bodies } = buildSceneFromModel(mujoco, model);

      const scene = new THREE.Scene();
      // Scoped to the 3D scene alone -- the dashboard chrome around this
      // canvas keeps its own dark theme (see DashboardChrome.tsx).
      scene.background = new THREE.Color(env.background);
      scene.add(root);
      // Warm key light + soft shadows, matching the reference renders'
      // (model/kitchen/kitchen-scene-*.webp) warm daylight look -- shadows
      // were previously disabled entirely because a single angled key light
      // in the old 12x12m room cast shadows from the walls that blacked out
      // half of it. That's no longer the constraint now that the room is
      // this kitchen's own real (much smaller, real-scale) footprint, so
      // re-enabling them (with a properly sized shadow-camera frustum, see
      // topLight.shadow.camera below) actually grounds furniture with real
      // contact shadows the way the reference renders have, instead of the
      // flat, shadowless look this had before. Ambient/hemisphere still
      // carry most of the fill so shadows read as soft, not harsh.
      scene.add(new THREE.AmbientLight(0xfff4e6, 0.65));
      scene.add(new THREE.HemisphereLight(0xf7f0df, 0xcfc9ba, 0.6));

      const topLight = new THREE.DirectionalLight(0xfff1d6, 1.5);
      topLight.position.set(1, 8, 3);
      topLight.target.position.set(...env.lighting.focus);
      topLight.castShadow = true;
      topLight.shadow.mapSize.set(2048, 2048);
      // Orthographic shadow-camera frustum sized to the room's own footprint
      // plus a margin -- the default frustum is far too tight for a room
      // and would clip most of it out of shadow entirely.
      const [shadowHalfX, shadowHalfZ] = env.lighting.shadowHalfExtent;
      topLight.shadow.camera.left = -shadowHalfX;
      topLight.shadow.camera.right = shadowHalfX;
      topLight.shadow.camera.top = shadowHalfZ;
      topLight.shadow.camera.bottom = -shadowHalfZ;
      topLight.shadow.camera.near = 0.5;
      topLight.shadow.camera.far = 20;
      topLight.shadow.bias = -0.0015;
      // Softer penumbra + a touch less key/more ambient -- counter
      // overhangs were casting a hard-edged, high-contrast shadow onto the
      // floor whose lit/shadowed boundary reads as a distinct pale
      // triangular shape rather than a shadow (the user's own report:
      // "white space" on the floor between the counters, not a shadow).
      topLight.shadow.radius = 6;
      topLight.shadow.blurSamples = 16;
      scene.add(topLight, topLight.target);

      const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.4);
      fillLight.position.set(-5, 6, -5);
      fillLight.target.position.set(...env.lighting.focus);
      fillLight.castShadow = false;
      scene.add(fillLight, fillLight.target);

      // Framed to show the whole kitchen (see ORBIT_POSITION/TARGET's own
      // comment on how these are derived from the room's real boundary),
      // not a close-up on the robot alone. Orbit controls (when
      // interactive) still zoom/pan freely.
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
      camera.position.set(...ORBIT_POSITION);
      camera.lookAt(...ORBIT_TARGET);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      // Soft (PCF-filtered) shadows -- see the lighting comment above.
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      container.appendChild(renderer.domElement);

      const resize = () => {
        if (!renderer) return;
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      if (interactive) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(...ORBIT_TARGET);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.update();
      }

      resetRef.current = () => {
        mujoco.mj_resetData(model, data);
        mujoco.mj_forward(model, data);
        // mj_resetData already puts the weld back to inactive and the
        // pickup object back at its qpos0 spawn point on bench_n1 -- this
        // just resets the *sequence's own* bookkeeping to match.
        pickPhase = "idle";
        pickPhaseElapsedS = 0;
        pickDriveVX = 0;
        pickDriveVY = 0;
        liftHeight = LIFT_MIN;
        bendAngle = 0;
        shoulderFwdAngle = 0;
        shoulderLatAngle = 0;
        armRollAngle = 0;
        elbowAngle = 0;
        wristAAngle = 0;
        wristBAngle = 0;
        shoulderFwdAngleL = 0;
        shoulderLatAngleL = 0;
        armRollAngleL = 0;
        elbowAngleL = 0;
        wristAAngleL = 0;
        wristBAngleL = 0;
        rightGripFraction = 0;
        leftGripFraction = 0;
        rightGripEngaged = false;
        leftGripEngaged = false;
        rightHeldBody = -1;
        leftHeldBody = -1;
        rightPull = null;
        leftPull = null;
        for (const obj of MOVABLE_OBJECTS) setRobotCollision(obj, true);
        for (const part of ARTICULATED_PARTS) setRobotCollision(part, true);
        openBothHands();
      };

      // --- Teleop actuator lookups -------------------------------------
      // Names match the placeholder actuators emitted by
      // model/scripts/urdf_to_mjcf.py's _build_actuators(); mj_name2id
      // returns -1 (harmlessly skipped below) if the loaded scene is an
      // older build without one of these.
      const OBJ_ACTUATOR = mujoco.mjtObj.mjOBJ_ACTUATOR.value;
      const OBJ_BODY = mujoco.mjtObj.mjOBJ_BODY.value;
      const actId = (name: string): number => mujoco.mj_name2id(model, OBJ_ACTUATOR, name);
      const ACT_VX = actId("act_base_vx");
      const ACT_VY = actId("act_base_vy");
      const ACT_YAW = actId("act_base_yaw");
      const ACT_WHEEL_L = actId("act_Revolute 32");
      const ACT_WHEEL_R = actId("act_Revolute 33");
      const ACT_LIFT = actId("act_Slider 2");
      const ACT_BEND = actId("act_Revolute 4");
      const ACT_SHOULDER_FWD = actId("act_Revolute 5");
      const ACT_SHOULDER_LAT = actId("act_Revolute 7");
      const ACT_ARM_ROLL = actId("act_Revolute 9");
      const ACT_ELBOW = actId("act_Revolute 11");
      const ACT_WRIST_A = actId("act_Revolute 26");
      const ACT_WRIST_B = actId("act_Revolute 43");
      // Left arm -- same six joint roles, mirrored bodies (see
      // LEFT_MIRROR_SIGN's own comment).
      const ACT_SHOULDER_FWD_L = actId("act_Revolute 6");
      const ACT_SHOULDER_LAT_L = actId("act_Revolute 8");
      const ACT_ARM_ROLL_L = actId("act_Revolute 10");
      const ACT_ELBOW_L = actId("act_Revolute 12");
      const ACT_WRIST_A_L = actId("act_Revolute 27");
      const ACT_WRIST_B_L = actId("act_Revolute 64");
      const BASE_BODY = mujoco.mj_name2id(model, OBJ_BODY, "base_link");
      const canDrive = ACT_VX >= 0 && ACT_VY >= 0 && ACT_YAW >= 0 && BASE_BODY >= 0;
      // face_cover_3_1's own body origin sits nearly 1.3m from where its mesh
      // actually renders (see FPP_EYE_HEIGHT's old comment -- a large local-
      // origin-vs-geometry offset baked into this CAD export), which used to
      // be worked around by guessing a fixed height/forward offset above
      // base_link instead. That guess put the FPP camera off to one side
      // (reported live: "FPP is from the right side, not the robot's eye") --
      // geom_xpos/geom_xmat (unlike body xpos/xmat) already account for a
      // geom's own local pos/quat offset within its body, so they give the
      // mesh's *actual* rendered pose directly, sidestepping the bad body
      // origin entirely.
      const HEAD_BODY = mujoco.mj_name2id(model, OBJ_BODY, "face_cover_3_1");
      const HEAD_GEOM = HEAD_BODY >= 0 ? model.body_geomadr[HEAD_BODY] : -1;
      const canFpp = canDrive && HEAD_GEOM >= 0;
      const canLift = ACT_LIFT >= 0;
      const LIFT_MIN = canLift ? model.actuator_ctrlrange[ACT_LIFT * 2] : 0;
      const LIFT_MAX = canLift ? model.actuator_ctrlrange[ACT_LIFT * 2 + 1] : 0;
      const canBend = ACT_BEND >= 0;
      // BEND_MAX/SHOULDER_*_MAX clamp *below* their joints' own (more
      // permissive) ranges -- see each constant's own comment -- so these
      // aren't simply each actuator's own ctrlrange the way LIFT_MIN/MAX is.
      const BEND_MIN = -BEND_MAX;
      const canShoulderFwd = ACT_SHOULDER_FWD >= 0;
      const canShoulderLat = ACT_SHOULDER_LAT >= 0;
      const canArmRoll = ACT_ARM_ROLL >= 0;
      const ARM_ROLL_MIN = canArmRoll ? model.actuator_ctrlrange[ACT_ARM_ROLL * 2] : 0;
      const ARM_ROLL_MAX = canArmRoll ? model.actuator_ctrlrange[ACT_ARM_ROLL * 2 + 1] : 0;
      const canElbow = ACT_ELBOW >= 0;
      const ELBOW_MAX = canElbow ? model.actuator_ctrlrange[ACT_ELBOW * 2 + 1] : 0;
      const canWristA = ACT_WRIST_A >= 0;
      const WRIST_A_MIN = canWristA ? model.actuator_ctrlrange[ACT_WRIST_A * 2] : 0;
      const WRIST_A_MAX = canWristA ? model.actuator_ctrlrange[ACT_WRIST_A * 2 + 1] : 0;
      const canWristB = ACT_WRIST_B >= 0;
      const WRIST_B_MIN = canWristB ? model.actuator_ctrlrange[ACT_WRIST_B * 2] : 0;
      const WRIST_B_MAX = canWristB ? model.actuator_ctrlrange[ACT_WRIST_B * 2 + 1] : 0;

      const canShoulderFwdL = ACT_SHOULDER_FWD_L >= 0;
      const canShoulderLatL = ACT_SHOULDER_LAT_L >= 0;
      const canArmRollL = ACT_ARM_ROLL_L >= 0;
      const ARM_ROLL_MIN_L = canArmRollL ? model.actuator_ctrlrange[ACT_ARM_ROLL_L * 2] : 0;
      const ARM_ROLL_MAX_L = canArmRollL ? model.actuator_ctrlrange[ACT_ARM_ROLL_L * 2 + 1] : 0;
      const canElbowL = ACT_ELBOW_L >= 0;
      const ELBOW_MIN_L = canElbowL ? model.actuator_ctrlrange[ACT_ELBOW_L * 2] : 0;
      const canWristAL = ACT_WRIST_A_L >= 0;
      const WRIST_A_MIN_L = canWristAL ? model.actuator_ctrlrange[ACT_WRIST_A_L * 2] : 0;
      const WRIST_A_MAX_L = canWristAL ? model.actuator_ctrlrange[ACT_WRIST_A_L * 2 + 1] : 0;
      const canWristBL = ACT_WRIST_B_L >= 0;
      const WRIST_B_MIN_L = canWristBL ? model.actuator_ctrlrange[ACT_WRIST_B_L * 2] : 0;
      const WRIST_B_MAX_L = canWristBL ? model.actuator_ctrlrange[ACT_WRIST_B_L * 2 + 1] : 0;

      // --- Pick & Place lookups ---------------------------------------
      const OBJ_JOINT = mujoco.mjtObj.mjOBJ_JOINT.value;
      const jointId = (name: string): number => mujoco.mj_name2id(model, OBJ_JOINT, name);
      // NOTE: these joint-name arrays are also reused for jointId() lookups
      // below (bare "Revolute N"), so actId() itself takes the actuator's
      // own full name -- the "act_" prefix has to be added here, at the
      // call site, rather than baked into the shared array. Its absence was
      // a real bug: mj_name2id("Revolute 48", ...) against actuators never
      // matches anything (confirmed directly against the compiled model),
      // so every one of these resolved to -1, silently disabling Pick &
      // Place's arm/finger control and the entire manual grip feature.
      const ACT_PICK_ARM = PICK_ARM_JOINTS.map((name) => actId(`act_${name}`));
      const ACT_PICK_FINGERS = PICK_FINGER_JOINTS.map((name) => actId(`act_${name}`));
      // Each finger joint's own [lo, hi] range, read from the model rather
      // than hardcoded -- lo is "closed", hi is "open" (see
      // PICK_FINGER_JOINTS' own comment).
      const PICK_FINGER_CLOSED = PICK_FINGER_JOINTS.map((name) => {
        const jid = jointId(name);
        return jid >= 0 ? model.jnt_range[jid * 2] : 0;
      });
      const PICK_FINGER_OPEN = PICK_FINGER_JOINTS.map((name) => {
        const jid = jointId(name);
        return jid >= 0 ? model.jnt_range[jid * 2 + 1] : 0;
      });
      // qpos/dof addresses for the Workflow's per-substep finger pin (see
      // that block's own comment) -- resolved once here by name instead of
      // calling jointId() (a string lookup) 15 times every physics substep,
      // which for a multi-second hold is a lot of repeated name lookups for
      // an answer that never changes.
      const PICK_FINGER_QPOSADR = PICK_FINGER_JOINTS.map((name) => {
        const jid = jointId(name);
        return jid >= 0 ? model.jnt_qposadr[jid] : -1;
      });
      const PICK_FINGER_DOFADR = PICK_FINGER_JOINTS.map((name) => {
        const jid = jointId(name);
        return jid >= 0 ? model.jnt_dofadr[jid] : -1;
      });
      const YAW_JOINT = jointId("virtual_base_yaw");
      const YAW_QPOS_ADR = YAW_JOINT >= 0 ? model.jnt_qposadr[YAW_JOINT] : -1;
      // --- Manual grip lookups -----------------------------------------
      // Right hand reuses PICK_FINGER_JOINTS/ACT_PICK_FINGERS/
      // PICK_FINGER_CLOSED/OPEN above -- same 15 joints Pick & Place
      // drives, just under direct key control instead of a scripted phase
      // (both gated the same way, by pickPhase === "idle", so they never
      // fight over them).
      const ACT_LEFT_FINGERS = LEFT_FINGER_JOINTS.map((name) => actId(`act_${name}`));
      const LEFT_FINGER_CLOSED = LEFT_FINGER_JOINTS.map((name) => {
        const jid = jointId(name);
        return jid >= 0 ? model.jnt_range[jid * 2] : 0;
      });
      const LEFT_FINGER_OPEN = LEFT_FINGER_JOINTS.map((name) => {
        const jid = jointId(name);
        return jid >= 0 ? model.jnt_range[jid * 2 + 1] : 0;
      });
      // The counter's own coffee cup (see CUP_OBJECT_POS in
      // model/scripts/urdf_to_mjcf.py) -- a second, separate free body, not
      // a reskin of pickup_object, so both can exist (and in principle be
      // held one per hand) at once.
      const CUP_OBJECT_JOINT = jointId("cup_object_free");
      const CUP_OBJECT_DOF = CUP_OBJECT_JOINT >= 0 ? model.jnt_dofadr[CUP_OBJECT_JOINT] : -1;
      const CUP_OBJECT_QPOS_ADR = CUP_OBJECT_JOINT >= 0 ? model.jnt_qposadr[CUP_OBJECT_JOINT] : -1;
      const CUP_OBJECT_BODY = mujoco.mj_name2id(model, OBJ_BODY, "cup_object");
      // Every free body in the scene (environment props, the cup, the
      // pickup block -- the robot itself has no free joint) is a movable
      // object; the ones up to GRAB_MAX_MASS can also be grabbed. Holding is
      // a kinematic follow (see applyGripPose below), not an equality
      // constraint or finger contact.
      const FREE_JOINT = mujoco.mjtJoint.mjJNT_FREE.value;
      type MovableObject = { body: number; dof: number; qposAdr: number; geomAdr: number; geomNum: number };
      const MOVABLE_OBJECTS: MovableObject[] = [];
      for (let j = 0; j < model.njnt; j++) {
        if (model.jnt_type[j] !== FREE_JOINT) continue;
        const body = model.jnt_bodyid[j];
        MOVABLE_OBJECTS.push({
          body,
          dof: model.jnt_dofadr[j],
          qposAdr: model.jnt_qposadr[j],
          geomAdr: model.body_geomadr[body],
          geomNum: model.body_geomnum[body],
        });
      }
      const GRABBABLE_OBJECTS = MOVABLE_OBJECTS.filter((o) => model.body_mass[o.body] <= GRAB_MAX_MASS && o.geomNum > 0);
      // Doors and drawers: the hinge/slide joints outside the robot (whose
      // own joints, virtual base included, all share one root body).
      // Gripping one makes its joint follow the palm instead of the part
      // following it freely (see drivePull).
      const HINGE_JOINT = mujoco.mjtJoint.mjJNT_HINGE.value;
      const SLIDE_JOINT = mujoco.mjtJoint.mjJNT_SLIDE.value;
      const robotRootBody = (() => {
        const b = mujoco.mj_name2id(model, OBJ_BODY, "base_link");
        return b >= 0 ? model.body_rootid[b] : -1;
      })();
      type ArticulatedPart = MovableObject & { joint: number; hinge: boolean; lo: number; hi: number };
      const ARTICULATED_PARTS: ArticulatedPart[] = [];
      for (let j = 0; j < model.njnt; j++) {
        const type = model.jnt_type[j];
        if (type !== HINGE_JOINT && type !== SLIDE_JOINT) continue;
        const body = model.jnt_bodyid[j];
        if (model.body_rootid[body] === robotRootBody || model.body_geomnum[body] === 0) continue;
        ARTICULATED_PARTS.push({
          body,
          joint: j,
          dof: model.jnt_dofadr[j],
          qposAdr: model.jnt_qposadr[j],
          geomAdr: model.body_geomadr[body],
          geomNum: model.body_geomnum[body],
          hinge: type === HINGE_JOINT,
          lo: model.jnt_range[j * 2],
          hi: model.jnt_range[j * 2 + 1],
        });
      }
      const cupObject = MOVABLE_OBJECTS.find((o) => o.body === CUP_OBJECT_BODY);
      // Robot collision per movable object, toggled off while it's held
      // (setRobotCollision). Model arrays survive mj_resetData, so reset
      // turns it back on explicitly.
      const robotCollisionOff = new Set<number>();
      const setRobotCollision = (obj: MovableObject, on: boolean) => {
        if (on ? !robotCollisionOff.has(obj.body) : robotCollisionOff.has(obj.body)) return;
        for (let g = obj.geomAdr; g < obj.geomAdr + obj.geomNum; g++) {
          if (model.geom_contype[g] === 0 && model.geom_conaffinity[g] === 0) continue;
          model.geom_conaffinity[g] = on
            ? model.geom_conaffinity[g] | ROBOT_COLLISION_BIT
            : model.geom_conaffinity[g] & ~ROBOT_COLLISION_BIT;
        }
        if (on) robotCollisionOff.delete(obj.body);
        else robotCollisionOff.add(obj.body);
      };
      const surfaceFrom = (anchorGeom: number, obj: MovableObject) =>
        nearestSurfacePoint(model, data, obj.geomAdr, obj.geomNum, [
          data.geom_xpos[anchorGeom * 3],
          data.geom_xpos[anchorGeom * 3 + 1],
          data.geom_xpos[anchorGeom * 3 + 2],
        ]);
      // finger_tip_1/finger_tip_3's own body ORIGIN sits 0.7-0.9m from where
      // their mesh actually renders -- confirmed not just for these two but
      // for every single fingertip body in this hand rig (a systemic CAD-
      // export quirk, the same class of bug FPP's own eye position had).
      // Using body xpos/xmat as the grip anchor (the original design) meant
      // every "snug" distance check was measured from an invisible point
      // 0.7m+ from the hand, not from the hand itself -- reported live as
      // "the gap between hand and cup is too much." geom_xpos/geom_xmat
      // (indexed by GEOM id here, not body id) give the real mesh pose
      // instead, same fix as HEAD_GEOM uses for the camera.
      //
      // The anchor itself is the palm (palm_right_1/palm_left_1), not a
      // fingertip -- a held object snugged to a single fingertip still
      // reads as "balanced on one finger," not "held in the hand," reported
      // live as "the cup seems to be on the fingertips, it must be on the
      // palm." Fingers close around wherever the object ends up regardless
      // of which point on the hand it's snugged to (see fingerHold's own
      // comment), so anchoring to the broader, more central palm mesh
      // instead reads as the fingers actually wrapping around it.
      const RIGHT_GRIP_ANCHOR_GEOM = mujoco.mj_name2id(model, OBJ_BODY, "palm_right_1") >= 0
        ? model.body_geomadr[mujoco.mj_name2id(model, OBJ_BODY, "palm_right_1")]
        : -1;
      const LEFT_GRIP_ANCHOR_GEOM = mujoco.mj_name2id(model, OBJ_BODY, "palm_left_1") >= 0
        ? model.body_geomadr[mujoco.mj_name2id(model, OBJ_BODY, "palm_left_1")]
        : -1;
      const canGripRight =
        ACT_PICK_FINGERS.every((i) => i >= 0) && GRABBABLE_OBJECTS.length + ARTICULATED_PARTS.length > 0 && RIGHT_GRIP_ANCHOR_GEOM >= 0;
      const canGripLeft =
        ACT_LEFT_FINGERS.every((i) => i >= 0) && GRABBABLE_OBJECTS.length + ARTICULATED_PARTS.length > 0 && LEFT_GRIP_ANCHOR_GEOM >= 0;
      // Grabbable object whose surface is nearest the palm, excluding
      // whatever the *other* hand is already holding (so both hands can
      // each hold their own object, but not fight over one) -- null if
      // nothing is within GRIP_REACH.
      const findGrabTarget = (anchorGeom: number, excludeBody: number) => {
        let best: { obj: MovableObject; surface: [number, number, number] } | null = null;
        let bestDist = GRIP_REACH;
        for (const obj of GRABBABLE_OBJECTS) {
          if (obj.body === excludeBody) continue;
          const { dist, point } = surfaceFrom(anchorGeom, obj);
          if (dist < bestDist) {
            best = { obj, surface: point };
            bestDist = dist;
          }
        }
        return best;
      };
      // A door/drawer near the palm. The pull point is the palm's own position
      // in the part's frame, so the part doesn't jump to the hand on grabbing.
      type Pull = { part: ArticulatedPart; local: [number, number, number] };
      const findPull = (anchorGeom: number, excludeBody: number): Pull | null => {
        let best: ArticulatedPart | null = null;
        let bestDist = GRIP_REACH;
        for (const part of ARTICULATED_PARTS) {
          if (part.body === excludeBody) continue;
          const { dist } = surfaceFrom(anchorGeom, part);
          if (dist < bestDist) {
            best = part;
            bestDist = dist;
          }
        }
        if (!best) return null;
        const b = best.body;
        const d = [0, 1, 2].map((i) => data.geom_xpos[anchorGeom * 3 + i] - data.xpos[b * 3 + i]);
        const m = b * 9;
        const local: [number, number, number] = [0, 1, 2].map(
          (c) => data.xmat[m + c] * d[0] + data.xmat[m + 3 + c] * d[1] + data.xmat[m + 6 + c] * d[2]
        ) as [number, number, number];
        return { part: best, local };
      };
      // Drives the pulled part's joint so its pull point tracks the palm: the
      // signed angle between the two about a hinge's axis, or the palm's offset
      // along a slide's axis. It's a bounded force, not a pose, so contacts
      // still win -- a door swung into a counter stops there instead of
      // passing through, and a drawer carries what's in it by friction.
      const drivePull = (anchorGeom: number, pull: Pull) => {
        const { part, local } = pull;
        const b = part.body;
        const m = b * 9;
        const g = [0, 1, 2].map(
          (r) => data.xpos[b * 3 + r] + data.xmat[m + r * 3] * local[0] + data.xmat[m + r * 3 + 1] * local[1] + data.xmat[m + r * 3 + 2] * local[2]
        );
        const h = [0, 1, 2].map((i) => data.geom_xpos[anchorGeom * 3 + i]);
        const ax = [0, 1, 2].map((i) => data.xaxis[part.joint * 3 + i]);
        let delta: number;
        if (part.hinge) {
          const a = [0, 1, 2].map((i) => data.xanchor[part.joint * 3 + i]);
          const flat = (v: number[]) => {
            const along = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2];
            return v.map((x, i) => x - along * ax[i]);
          };
          const r1 = flat(g.map((x, i) => x - a[i]));
          const r2 = flat(h.map((x, i) => x - a[i]));
          if (Math.hypot(...r1) < 0.02 || Math.hypot(...r2) < 0.02) return;
          const cross = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
          delta = Math.atan2(cross[0] * ax[0] + cross[1] * ax[1] + cross[2] * ax[2], r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2]);
        } else {
          delta = (h[0] - g[0]) * ax[0] + (h[1] - g[1]) * ax[1] + (h[2] - g[2]) * ax[2];
        }
        const q = data.qpos[part.qposAdr];
        const reach = Math.max(part.lo, Math.min(part.hi, q + delta)) - q;
        const inertia = model.dof_M0[part.dof];
        const force = inertia * PULL_OMEGA * (PULL_OMEGA * reach - 2 * data.qvel[part.dof]);
        const cap = part.hinge ? PULL_MAX_TORQUE : PULL_MAX_FORCE;
        data.qfrc_applied[part.dof] = Math.max(-cap, Math.min(cap, force));
      };
      // Held objects don't collide with the robot (the kinematic follow
      // would fight the contact -- see urdf_to_mjcf.py's
      // _build_pickup_object()); everything else does once it's clear of
      // both hands. During the scripted Workflow every object stays off:
      // its arm targets were solved without props in the way.
      // Objects deleted in the editor: collision off, hidden, and held
      // still out of the way every step (removing a body needs a recompile).
      const parkedFree: { qposAdr: number; dof: number }[] = [];
      const syncRobotCollision = () => {
        for (const p of parkedFree) {
          data.qpos.set([0, 0, -50, 1, 0, 0, 0], p.qposAdr);
          for (let k = 0; k < 6; k++) data.qvel[p.dof + k] = 0;
        }
        for (const obj of MOVABLE_OBJECTS) syncObjectCollision(obj);
        for (const part of ARTICULATED_PARTS) syncObjectCollision(part);
      };
      const syncObjectCollision = (obj: MovableObject) => {
        const held =
          obj.body === rightHeldBody ||
          obj.body === leftHeldBody ||
          obj.body === rightPull?.part.body ||
          obj.body === leftPull?.part.body ||
          pickPhase !== "idle";
        if (held) {
          setRobotCollision(obj, false);
        } else if (robotCollisionOff.has(obj.body)) {
          const clear =
            (RIGHT_GRIP_ANCHOR_GEOM < 0 || surfaceFrom(RIGHT_GRIP_ANCHOR_GEOM, obj).dist > ROBOT_COLLISION_CLEARANCE) &&
            (LEFT_GRIP_ANCHOR_GEOM < 0 || surfaceFrom(LEFT_GRIP_ANCHOR_GEOM, obj).dist > ROBOT_COLLISION_CLEARANCE);
          if (clear) setRobotCollision(obj, true);
        }
      };
      // Kinematic follow: pose the held object at (anchor's current world
      // pose) composed with the fixed relPos/relQuat captured at grab time
      // -- see model/scripts/urdf_to_mjcf.py's own comment on why this
      // replaced an equality-weld design. Inverse of computeGripRelpose's
      // own math (relPos/relQuat are body1 expressed in body2/anchor's
      // frame, so worldPos = anchorPos + anchorRot*relPos and worldQuat =
      // anchorQuat*relQuat).
      const applyGripPose = (
        anchorGeom: number,
        relPos: [number, number, number],
        relQuat: [number, number, number, number],
        qposAdr: number,
        dof: number
      ) => {
        const ax = data.geom_xpos[anchorGeom * 3];
        const ay = data.geom_xpos[anchorGeom * 3 + 1];
        const az = data.geom_xpos[anchorGeom * 3 + 2];
        const m = anchorGeom * 9;
        data.qpos[qposAdr] =
          ax + data.geom_xmat[m] * relPos[0] + data.geom_xmat[m + 1] * relPos[1] + data.geom_xmat[m + 2] * relPos[2];
        data.qpos[qposAdr + 1] =
          ay + data.geom_xmat[m + 3] * relPos[0] + data.geom_xmat[m + 4] * relPos[1] + data.geom_xmat[m + 5] * relPos[2];
        data.qpos[qposAdr + 2] =
          az + data.geom_xmat[m + 6] * relPos[0] + data.geom_xmat[m + 7] * relPos[1] + data.geom_xmat[m + 8] * relPos[2];
        const anchorQuat = mat3ToQuat(data.geom_xmat, m);
        const worldQuat = quatMul(anchorQuat, relQuat);
        data.qpos[qposAdr + 3] = worldQuat[0];
        data.qpos[qposAdr + 4] = worldQuat[1];
        data.qpos[qposAdr + 5] = worldQuat[2];
        data.qpos[qposAdr + 6] = worldQuat[3];
        for (let k = 0; k < 6; k++) data.qvel[dof + k] = 0;
      };
      const canPick =
        env.workflows.includes("serveCoffee") &&
        canDrive &&
        YAW_QPOS_ADR >= 0 &&
        CUP_OBJECT_DOF >= 0 &&
        CUP_OBJECT_QPOS_ADR >= 0 &&
        CUP_OBJECT_BODY >= 0 &&
        RIGHT_GRIP_ANCHOR_GEOM >= 0 &&
        ACT_PICK_ARM.every((i) => i >= 0) &&
        ACT_PICK_FINGERS.every((i) => i >= 0);
      if (!canPick && env.workflows.includes("serveCoffee")) {
        // The Workflow dropdown always renders (see the wave button's own
        // precedent) and silently no-ops if unsupported -- fine for an old
        // build missing the feature entirely, but indistinguishable from
        // "the workflow does nothing" if the loaded scene *should* support
        // it and one lookup below just failed (e.g. a stale cached
        // /mujoco/scene/humanoid.xml missing the cup a newer build added).
        // Logged once at load time so that's not a silent dead end to debug
        // from the user's report alone.
        console.warn("[MujocoViewer] Workflow unavailable in this scene:", {
          canDrive,
          YAW_QPOS_ADR,
          CUP_OBJECT_DOF,
          CUP_OBJECT_QPOS_ADR,
          CUP_OBJECT_BODY,
          RIGHT_GRIP_ANCHOR_GEOM,
          missingArmActuators: PICK_ARM_JOINTS.filter((_, i) => ACT_PICK_ARM[i] < 0),
          missingFingerActuators: PICK_FINGER_JOINTS.filter((_, i) => ACT_PICK_FINGERS[i] < 0),
        });
      }

      // Both hands' finger actuators default to ctrl=0 on load, same as
      // every other actuator -- but 0 happens to equal *closed* for 14 of
      // each hand's 15 finger joints (their own jnt_range is [0, hi], see
      // PICK_FINGER_JOINTS' own comment: lo=closed, hi=open), while the
      // thumb's own root joint (Revolute 48 / Revolute 69) has an
      // asymmetric range that doesn't start at 0. qpos0 is 0 for all of
      // them too (no <keyframe> sets otherwise), so on every load and
      // reset the four fingers snap straight to fully closed while the
      // thumb sits at a mid-range position instead of joining them --
      // looking exactly like a fist that won't quite finish closing,
      // reported as "it automatically tries to close its hands but
      // something is stopping it." Fixed by explicitly starting both hands
      // fully open -- qpos *and* ctrl together, so there's no first-frame
      // snap in either direction -- right after load and after every
      // reset (see resetRef.current above).
      const openHandJoints = (joints: string[], acts: number[], openTarget: number[]) => {
        for (let i = 0; i < joints.length; i++) {
          const jid = jointId(joints[i]);
          if (jid >= 0) data.qpos[model.jnt_qposadr[jid]] = openTarget[i];
          if (acts[i] >= 0) data.ctrl[acts[i]] = openTarget[i];
        }
      };
      const openBothHands = () => {
        openHandJoints(PICK_FINGER_JOINTS, ACT_PICK_FINGERS, PICK_FINGER_OPEN);
        openHandJoints(LEFT_FINGER_JOINTS, ACT_LEFT_FINGERS, LEFT_FINGER_OPEN);
        mujoco.mj_forward(model, data);
      };
      openBothHands();

      const pressedKeys = new Set<string>();

      // Pick & Place state -- see the PICK_* constants above for the phase
      // list/durations. Ticked once per physics step inside the substep
      // catch-up loop below (never from wall-clock/performance.now()) so a
      // slow/backgrounded render frame can't desync it -- a real hitch would
      // otherwise make a fast-moving target jump discontinuously once the
      // catch-up loop resumes and fast-forwards several steps at once.
      // pickDriveVX/VY hold the autopilot's own current commanded velocity
      // across steps, for its acceleration ramp.
      let pickPhase: PickPhase = "idle";
      let pickPhaseElapsedS = 0;
      let pickDriveVX = 0;
      let pickDriveVY = 0;

      // Lift column height target (U/L teleop, see LIFT_RATE's own
      // comment). Starts at LIFT_MIN -- the height every PICK_*_QPOS arm
      // pose was solved against -- so a fresh load reaches exactly where
      // the offline IK assumed; Pick & Place forces it back to LIFT_MIN
      // for the same reason if the user had raised it before starting.
      let liftHeight = LIFT_MIN;
      // Waist bend target (F/R teleop, see BEND_RATE's own comment). Starts
      // at 0 (straight) for the same reason liftHeight starts at LIFT_MIN --
      // every PICK_*_QPOS arm pose was solved with the waist straight, so
      // Pick & Place forces this back to 0 too.
      let bendAngle = 0;
      // Right-arm joint teleop targets (T/G, Y/H, I/K, O/P -- see each
      // *_RATE constant's own comment). All start at 0 (each joint's own
      // neutral/straight reference). Unlike liftHeight/bendAngle, these
      // aren't force-held to a fixed value throughout a Pick & Place run
      // (that sequence needs to freely move these same four joints through
      // its own reach/grasp poses) -- instead they're simply not written to
      // ctrl at all while pickPhase !== "idle" (same idle-gating below as
      // every other teleop control), and reset to 0 only once retract
      // finishes and the arm has actually physically returned to
      // PICK_REST_QPOS (all zeros) -- see that transition below.
      let shoulderFwdAngle = 0;
      let shoulderLatAngle = 0;
      let armRollAngle = 0;
      let elbowAngle = 0;
      let wristAAngle = 0;
      let wristBAngle = 0;
      // Left arm -- same six, own dedicated keys (see LEFT_MIRROR_SIGN's
      // own comment).
      let shoulderFwdAngleL = 0;
      let shoulderLatAngleL = 0;
      let armRollAngleL = 0;
      let elbowAngleL = 0;
      let wristAAngleL = 0;
      let wristBAngleL = 0;

      // Manual grip (C/X right hand, [/] left) -- 0 (open) to 1
      // (closed), ramped by GRIP_RATE like every other hold-to-move
      // control. *Engaged tracks whether that hand's weld is currently
      // holding the object (see GRIP_ENGAGE_AT/GRIP_RELEASE_AT's own
      // comment) -- separate from the fraction itself since engaging only
      // happens on crossing the threshold near the object, not just from
      // being closed.
      let rightGripFraction = 0;
      let leftGripFraction = 0;
      let rightGripEngaged = false;
      let leftGripEngaged = false;
      let rightHeldBody = -1; // which GRABBABLE_OBJECTS entry (by body id) rightGripEngaged refers to, -1 = none
      let leftHeldBody = -1;
      // The rest of what's needed to kinematically hold that object every
      // step (see applyGripPose) -- captured once at grab time, reused
      // every frame until release. Placeholder values until the first
      // grab; never read while *HeldBody is -1.
      let rightHeldRelPos: [number, number, number] = [0, 0, 0];
      let rightHeldRelQuat: [number, number, number, number] = [1, 0, 0, 0];
      let rightHeldDof = -1;
      let rightHeldQposAdr = -1;
      let leftHeldRelPos: [number, number, number] = [0, 0, 0];
      let leftHeldRelQuat: [number, number, number, number] = [1, 0, 0, 0];
      let leftHeldDof = -1;
      let leftHeldQposAdr = -1;
      // A door/drawer each hand is pulling instead (see drivePull); a hand
      // holds either an object or a part, never both.
      let rightPull: Pull | null = null;
      let leftPull: Pull | null = null;
      // Cup's own pose at the start of "pullIn" (still resting on the
      // counter) or "placing" (wherever it was rigidly following the palm
      // to) -- captured once when each phase begins, so that phase can
      // smoothly blend the cup from there to its own target over its own
      // duration. Reused across both phases since they never overlap.
      let placeAnimStartPos: [number, number, number] = [0, 0, 0];
      let placeAnimStartQuat: [number, number, number, number] = [1, 0, 0, 0];

      // FPP head look-around: drag to turn the head like OrbitControls'
      // drag-to-orbit, just clamped to a human-ish range and re-centered
      // on the base's own forward direction (not a fixed world direction)
      // every frame -- see the render loop below.
      let fppYaw = 0;
      let fppPitch = 0;
      let fppDragging = false;
      let fppLastX = 0;
      let fppLastY = 0;

      if (interactive) {
        const onKeyDown = (e: KeyboardEvent) => {
          pressedKeys.add(e.key.toLowerCase());
        };
        const onKeyUp = (e: KeyboardEvent) => {
          pressedKeys.delete(e.key.toLowerCase());
        };
        // A key released while the tab was unfocused (e.g. alt-tabbing away
        // mid-hold) never fires its own keyup, which would otherwise leave
        // it stuck "held" -- clear everything on blur to catch that.
        const onBlur = () => {
          pressedKeys.clear();
        };
        window.addEventListener("blur", onBlur);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        const onPointerDown = (e: PointerEvent) => {
          if (viewRef.current !== "fpp") return;
          fppDragging = true;
          fppLastX = e.clientX;
          fppLastY = e.clientY;
        };
        const onPointerMove = (e: PointerEvent) => {
          if (!fppDragging) return;
          const dx = e.clientX - fppLastX;
          const dy = e.clientY - fppLastY;
          fppLastX = e.clientX;
          fppLastY = e.clientY;
          fppYaw = Math.max(-FPP_MAX_YAW, Math.min(FPP_MAX_YAW, fppYaw - dx * FPP_LOOK_SENSITIVITY));
          fppPitch = Math.max(FPP_MIN_PITCH, Math.min(FPP_MAX_PITCH, fppPitch - dy * FPP_LOOK_SENSITIVITY));
        };
        const onPointerUp = () => {
          fppDragging = false;
        };
        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);

        removeKeyListeners = () => {
          window.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("keyup", onKeyUp);
          window.removeEventListener("blur", onBlur);
          renderer?.domElement.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
        };

        if (canPick) {
          pickRef.current = () => {
            if (pickPhase === "idle") {
              // A manually-grabbed object (see canGripRight/Left above)
              // would otherwise keep getting kinematically pinned to
              // whichever hand grabbed it (see applyGripPose) all through
              // this workflow's own reach for the cup -- clearing the
              // engaged flags first stops that (the workflow re-engages
              // rightGripEngaged itself once it actually grasps the cup).
              if (rightGripEngaged) {
                rightGripEngaged = false;
                rightHeldBody = -1;
              }
              rightPull = null;
              leftPull = null;
              if (leftGripEngaged) {
                leftGripEngaged = false;
                leftHeldBody = -1;
              }
              pickPhase = "driveToPick1";
              pickPhaseElapsedS = 0;
              pickDriveVX = 0;
              pickDriveVY = 0;
            }
          };
        }
      }

      // --- Object editor (see ObjectEditor.tsx) -------------------------
      const BASE_LINK_BODY = mujoco.mj_name2id(model, OBJ_BODY, "base_link");
      const ROBOT_ROOT = BASE_LINK_BODY >= 0 ? model.body_rootid[BASE_LINK_BODY] : -1;
      const bodyOfGroup = new Map<THREE.Object3D, number>();
      for (const [b, group] of Object.entries(bodies)) bodyOfGroup.set(group, Number(b));
      const parkedBodies = new Set<number>();
      const bodyName = (b: number): string => mujoco.mj_id2name(model, OBJ_BODY, b) ?? "";
      // Inner faces of the room's four <room>_wall_<side> boxes (the built-in
      // rooms all have them); the default camera sits outside the room, so
      // rays can land on the walls' outside faces.
      const roomBounds = (() => {
        const OBJ_GEOM = mujoco.mjtObj.mjOBJ_GEOM.value;
        const inner: Partial<Record<"south" | "north" | "east" | "west", number>> = {};
        for (let g = 0; g < model.ngeom; g++) {
          if (model.geom_bodyid[g] !== 0) continue;
          const side = /_wall_(south|north|east|west)$/.exec(mujoco.mj_id2name(model, OBJ_GEOM, g) ?? "")?.[1] as keyof typeof inner | undefined;
          if (!side) continue;
          const axis = side === "east" || side === "west" ? 0 : 1;
          const sign = side === "east" || side === "north" ? -1 : 1;
          inner[side] = model.geom_pos[g * 3 + axis] + sign * model.geom_size[g * 3 + axis];
        }
        const { south, north, east, west } = inner;
        return south !== undefined && north !== undefined && east !== undefined && west !== undefined ? { south, north, east, west } : null;
      })();
      const freeJointOf = (b: number) =>
        model.body_jntnum[b] > 0 && model.jnt_type[model.body_jntadr[b]] === FREE_JOINT ? model.body_jntadr[b] : -1;
      const isEditable = (b: number) =>
        b > 0 && model.body_parentid[b] === 0 && model.body_rootid[b] !== ROBOT_ROOT && !parkedBodies.has(b);
      // An editable object is a top-level body plus everything under it (a
      // fridge's doors, a cabinet's drawers).
      const bodiesOf = (b: number) => {
        const out: number[] = [];
        for (let k = b; k < model.nbody; k++) if (model.body_rootid[k] === b) out.push(k);
        return out;
      };
      const partsOf = (b: number) => ARTICULATED_PARTS.filter((p) => model.body_rootid[p.body] === b);
      const BOX_GEOM = mujoco.mjtGeom.mjGEOM_BOX.value;
      // Free objects whose center is inside a part's box geoms' bounds (in the part's
      // frame at `pos`/`quat`), with a little headroom for things sticking out of a drawer.
      const contentsOf = (p: ArticulatedPart, pos: Vec3Tuple, quat: QuatTuple) => {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let g = p.geomAdr; g < p.geomAdr + p.geomNum; g++) {
          if (model.geom_type[g] !== BOX_GEOM) continue;
          for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i], model.geom_pos[g * 3 + i] - model.geom_size[g * 3 + i]);
            hi[i] = Math.max(hi[i], model.geom_pos[g * 3 + i] + model.geom_size[g * 3 + i]);
          }
        }
        if (!(lo[0] < hi[0])) return [];
        const inv = quatConj(quat);
        return MOVABLE_OBJECTS.filter((o) => {
          const c = vec3At(data.xipos, o.body);
          const l = quatRotate(inv, [c[0] - pos[0], c[1] - pos[1], c[2] - pos[2]]);
          return l.every((v, i) => v > lo[i] - 0.01 && v < hi[i] + (i === 2 ? 0.1 : 0.01));
        });
      };
      const isOpen = (p: ArticulatedPart) => data.qpos[p.qposAdr] - p.lo > 0.05 * (p.hi - p.lo);
      const describe = (b: number): SceneObjectInfo => {
        const name = bodyName(b);
        const propId = propIdForBody(name, catalog);
        const entry = propId ? catalog.find((e) => e.id === propId) : undefined;
        const label = entry?.name ?? (name === "cup_object" ? "Coffee cup" : name === "pickup_object" ? "Block" : name.replace(/^u_/, ""));
        const parts = partsOf(b);
        return {
          body: b,
          label,
          mass: entry?.mass ?? model.body_mass[b],
          movable: freeJointOf(b) >= 0,
          deletable: !(b === CUP_OBJECT_BODY && env.workflows.includes("serveCoffee")),
          openable: parts.length > 0,
          open: parts.some(isOpen),
        };
      };
      // The robot is most of the scene's triangles and is never a pick or
      // placement target, so the editor's rays skip its groups entirely.
      const castTargets: THREE.Object3D[] = [
        ...(bodies[0]?.children.filter((c) => !bodyOfGroup.has(c)) ?? []),
        ...Object.entries(bodies)
          .filter(([b]) => Number(b) > 0 && model.body_rootid[Number(b)] !== ROBOT_ROOT)
          .map(([, group]) => group),
      ];
      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      // Top-level body a ray hit belongs to (a door resolves to its fridge), -1 if none.
      const bodyOfHit = (obj: THREE.Object3D | null) => {
        for (let o = obj; o; o = o.parent) {
          const b = bodyOfGroup.get(o);
          if (b !== undefined) return b > 0 ? model.body_rootid[b] : b;
        }
        return -1;
      };
      const isShown = (obj: THREE.Object3D | null) => {
        for (let o = obj; o; o = o.parent) if (!o.visible) return false;
        return true;
      };
      const castAt = (clientX: number, clientY: number) => {
        const rect = renderer!.domElement.getBoundingClientRect();
        pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointerNdc, camera);
        return raycaster.intersectObjects(castTargets, true).filter((h) => isShown(h.object));
      };
      // Lowest point of a body's geoms below its origin, so moved objects rest on the surface.
      const bottomOffset = (b: number) => {
        let minZ = Infinity;
        for (let g = model.body_geomadr[b]; g < model.body_geomadr[b] + model.body_geomnum[b]; g++) {
          const m = g * 9;
          let z = data.geom_xpos[g * 3 + 2];
          for (let i = 0; i < 3; i++) {
            const r = data.geom_xmat[m + 6 + i];
            z += r * model.geom_aabb[g * 6 + i] - Math.abs(r) * model.geom_aabb[g * 6 + 3 + i];
          }
          minZ = Math.min(minZ, z);
        }
        return Number.isFinite(minZ) ? data.xpos[b * 3 + 2] - minZ : 0;
      };
      const recordStaticPose = (b: number) => {
        edits.staticPoses.set(bodyName(b), {
          pos: [model.body_pos[b * 3], model.body_pos[b * 3 + 1], model.body_pos[b * 3 + 2]],
          quat: [model.body_quat[b * 4], model.body_quat[b * 4 + 1], model.body_quat[b * 4 + 2], model.body_quat[b * 4 + 3]],
        });
      };
      const releaseIfHeld = (b: number) => {
        if (b === rightHeldBody) {
          rightGripEngaged = false;
          rightHeldBody = -1;
        }
        if (b === leftHeldBody) {
          leftGripEngaged = false;
          leftHeldBody = -1;
        }
        if (rightPull && model.body_rootid[rightPull.part.body] === b) rightPull = null;
        if (leftPull && model.body_rootid[leftPull.part.body] === b) leftPull = null;
      };
      const removeObject = (b: number) => {
        if (!isEditable(b)) return;
        releaseIfHeld(b);
        for (const k of bodiesOf(b)) {
          for (let g = model.body_geomadr[k]; g < model.body_geomadr[k] + model.body_geomnum[k]; g++) {
            model.geom_contype[g] = 0;
            model.geom_conaffinity[g] = 0;
          }
          robotCollisionOff.delete(k);
          if (bodies[k]) bodies[k].visible = false;
        }
        const j = freeJointOf(b);
        if (j >= 0) parkedFree.push({ qposAdr: model.jnt_qposadr[j], dof: model.jnt_dofadr[j] });
        else model.body_pos[b * 3 + 2] = -50;
        for (const list of [MOVABLE_OBJECTS, GRABBABLE_OBJECTS]) {
          const i = list.findIndex((o) => o.body === b);
          if (i >= 0) list.splice(i, 1);
        }
        for (const part of partsOf(b)) {
          data.qfrc_applied[part.dof] = 0;
          ARTICULATED_PARTS.splice(ARTICULATED_PARTS.indexOf(part), 1);
        }
        parkedBodies.add(b);
        edits.removed.add(bodyName(b));
        syncRobotCollision();
        mujoco.mj_forward(model, data);
      };

      const ghost = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.25, depthWrite: false })
      );
      const ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(ghost.geometry), new THREE.LineBasicMaterial({ color: 0x4ade80 }));
      ghost.add(ghostEdges);
      ghost.visible = false;
      scene.add(ghost);
      // Selection outline around every group of the selected object (doors included), refit each frame.
      const selectionBox = new THREE.Box3();
      const selectionHelper = new THREE.Box3Helper(selectionBox, 0xf5c542);
      selectionHelper.visible = false;
      scene.add(selectionHelper);
      let selectionGroups: THREE.Object3D[] = [];
      const updateSelection = () => {
        if (!selectionGroups.length) return;
        selectionBox.makeEmpty();
        for (const g of selectionGroups) selectionBox.expandByObject(g);
      };

      editorApiRef.current = {
        pickObject(clientX, clientY) {
          const hits = castAt(clientX, clientY);
          const first = hits.find((h) => model.body_rootid[bodyOfHit(h.object)] !== ROBOT_ROOT);
          const hitBody = first ? bodyOfHit(first.object) : -1;
          if (isEditable(hitBody)) return describe(hitBody);
          // Small items (forks, markers) are hard to hit exactly: take the
          // nearest object within a few pixels of the cursor instead.
          const rect = renderer!.domElement.getBoundingClientRect();
          const v = new THREE.Vector3();
          let best = -1;
          let bestPx = 22;
          for (let b = 1; b < model.nbody; b++) {
            if (!isEditable(b)) continue;
            getPosition(data.xipos, b, v).project(camera);
            if (v.z > 1) continue;
            const px = Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - clientX, rect.top + ((1 - v.y) / 2) * rect.height - clientY);
            if (px < bestPx) {
              best = b;
              bestPx = px;
            }
          }
          return best >= 0 ? describe(best) : null;
        },
        surfaceAt(clientX, clientY, excludeBody = -1) {
          const hit = castAt(clientX, clientY).find((h) => {
            const b = bodyOfHit(h.object);
            return b !== excludeBody && model.body_rootid[b] !== ROBOT_ROOT;
          });
          if (!hit) return null;
          const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
          if (n.dot(raycaster.ray.direction) > 0) n.negate();
          return { point: [hit.point.x, -hit.point.z, hit.point.y], normal: [n.x, -n.z, n.y], facesUp: n.y > 0.7 };
        },
        insideRoom([x, y]) {
          return !roomBounds || (x > roomBounds.west && x < roomBounds.east && y > roomBounds.south && y < roomBounds.north);
        },
        setGhost(g) {
          ghost.visible = g !== null;
          if (!g) return;
          const [sx, sy, sz] = g.entry.size;
          const [cx, cy, cz] = g.entry.center;
          const yaw = (g.yawDeg * Math.PI) / 180;
          const wx = g.pos[0] + Math.cos(yaw) * cx - Math.sin(yaw) * cy;
          const wy = g.pos[1] + Math.sin(yaw) * cx + Math.cos(yaw) * cy;
          ghost.scale.set(Math.max(sx, 0.01), Math.max(sz, 0.01), Math.max(sy, 0.01));
          ghost.rotation.set(0, yaw, 0);
          ghost.position.set(wx, g.pos[2] + cz, -wy);
          const color = g.valid ? 0x4ade80 : 0xf87171;
          (ghost.material as THREE.MeshBasicMaterial).color.setHex(color);
          (ghostEdges.material as THREE.LineBasicMaterial).color.setHex(color);
        },
        setSelected(b) {
          selectionGroups = b !== null && isEditable(b) ? bodiesOf(b).flatMap((k) => (bodies[k] ? [bodies[k]] : [])) : [];
          selectionHelper.visible = selectionGroups.length > 0;
          updateSelection();
        },
        toggleOpen(b) {
          if (!isEditable(b)) return null;
          releaseIfHeld(b);
          const parts = partsOf(b);
          const close = parts.some(isOpen);
          // Snapping a part to its new position would leave what's in a drawer
          // behind (inside the carcass once closed), so its contents move with it.
          const carried = new Map<MovableObject, { part: ArticulatedPart; pos: Vec3Tuple; quat: QuatTuple }>();
          for (const p of parts) {
            const pos = vec3At(data.xpos, p.body);
            const quat = quatAt(data.xquat, p.body);
            for (const o of contentsOf(p, pos, quat)) if (!carried.has(o)) carried.set(o, { part: p, pos, quat });
          }
          for (const p of parts) {
            // Doors open to a right angle (or their stop, if that's less); drawers all the way.
            data.qpos[p.qposAdr] = close ? p.lo : p.hinge ? Math.min(p.hi, Math.PI / 2) : p.hi;
            data.qvel[p.dof] = 0;
          }
          mujoco.mj_forward(model, data);
          for (const [o, { part, pos, quat }] of carried) {
            const rel = quatMul(quatAt(data.xquat, part.body), quatConj(quat));
            const newPos = vec3At(data.xpos, part.body);
            const a = o.qposAdr;
            const offset = quatRotate(rel, [data.qpos[a] - pos[0], data.qpos[a + 1] - pos[1], data.qpos[a + 2] - pos[2]]);
            for (let i = 0; i < 3; i++) data.qpos[a + i] = newPos[i] + offset[i];
            const q = quatMul(rel, [data.qpos[a + 3], data.qpos[a + 4], data.qpos[a + 5], data.qpos[a + 6]]);
            const n = Math.hypot(...q);
            for (let i = 0; i < 4; i++) data.qpos[a + 3 + i] = q[i] / n;
            for (let i = 0; i < 6; i++) data.qvel[o.dof + i] = 0;
          }
          if (carried.size) mujoco.mj_forward(model, data);
          return describe(b);
        },
        moveObject(b, point) {
          if (!isEditable(b)) return;
          releaseIfHeld(b);
          const j = freeJointOf(b);
          if (j >= 0) {
            const adr = model.jnt_qposadr[j];
            const z = point[2] + bottomOffset(b) + 0.002;
            data.qpos[adr] = point[0];
            data.qpos[adr + 1] = point[1];
            data.qpos[adr + 2] = z;
            for (let k = 0; k < 6; k++) data.qvel[model.jnt_dofadr[j] + k] = 0;
          } else {
            model.body_pos[b * 3] = point[0];
            model.body_pos[b * 3 + 1] = point[1];
            recordStaticPose(b);
          }
          mujoco.mj_forward(model, data);
        },
        rotateObject(b, deg) {
          if (!isEditable(b)) return;
          releaseIfHeld(b);
          const half = (deg * Math.PI) / 360;
          const turn: [number, number, number, number] = [Math.cos(half), 0, 0, Math.sin(half)];
          const j = freeJointOf(b);
          const arr = j >= 0 ? data.qpos : model.body_quat;
          const at = j >= 0 ? model.jnt_qposadr[j] + 3 : b * 4;
          const q = quatMul(turn, [arr[at], arr[at + 1], arr[at + 2], arr[at + 3]]);
          const n = Math.hypot(...q) || 1;
          for (let k = 0; k < 4; k++) arr[at + k] = q[k] / n;
          if (j < 0) recordStaticPose(b);
          mujoco.mj_forward(model, data);
        },
        removeObject,
        activeMovableCount: () => MOVABLE_OBJECTS.length,
      };
      isBusyRef.current = () => pickPhase !== "idle";

      const captureTeleop = () => ({
        liftHeight, bendAngle,
        shoulderFwdAngle, shoulderLatAngle, armRollAngle, elbowAngle, wristAAngle, wristBAngle,
        shoulderFwdAngleL, shoulderLatAngleL, armRollAngleL, elbowAngleL, wristAAngleL, wristBAngleL,
        rightGripFraction, leftGripFraction, rightGripEngaged, leftGripEngaged, rightHeldBody, leftHeldBody,
        rightHeldRelPos, rightHeldRelQuat, rightHeldDof, rightHeldQposAdr,
        leftHeldRelPos, leftHeldRelQuat, leftHeldDof, leftHeldQposAdr,
        fppYaw, fppPitch,
      });
      captureRef.current = () => ({
        envId: env.id,
        qpos: Float64Array.from(data.qpos),
        qvel: Float64Array.from(data.qvel),
        ctrl: Float64Array.from(data.ctrl),
        teleop: captureTeleop(),
        camera: {
          pos: [camera.position.x, camera.position.y, camera.position.z],
          target: controls ? [controls.target.x, controls.target.y, controls.target.z] : [ORBIT_TARGET[0], ORBIT_TARGET[1], ORBIT_TARGET[2]],
        },
      });
      if (restore && restore.qpos.length <= model.nq && restore.qvel.length <= model.nv && restore.ctrl.length === model.nu) {
        data.qpos.set(restore.qpos);
        data.qvel.set(restore.qvel);
        data.ctrl.set(restore.ctrl);
        const t = restore.teleop as ReturnType<typeof captureTeleop>;
        ({ liftHeight, bendAngle } = t);
        ({ shoulderFwdAngle, shoulderLatAngle, armRollAngle, elbowAngle, wristAAngle, wristBAngle } = t);
        ({ shoulderFwdAngleL, shoulderLatAngleL, armRollAngleL, elbowAngleL, wristAAngleL, wristBAngleL } = t);
        ({ rightGripFraction, leftGripFraction, rightGripEngaged, leftGripEngaged, rightHeldBody, leftHeldBody } = t);
        ({ rightHeldRelPos, rightHeldRelQuat, rightHeldDof, rightHeldQposAdr } = t);
        ({ leftHeldRelPos, leftHeldRelQuat, leftHeldDof, leftHeldQposAdr } = t);
        ({ fppYaw, fppPitch } = t);
        camera.position.set(...restore.camera.pos);
        controls?.target.set(...restore.camera.target);
        controls?.update();
      }
      for (const [name, pose] of edits.staticPoses) {
        const b = mujoco.mj_name2id(model, OBJ_BODY, name);
        if (b < 0) continue;
        model.body_pos.set(pose.pos, b * 3);
        model.body_quat.set(pose.quat, b * 4);
      }
      for (const name of edits.removed) {
        const b = mujoco.mj_name2id(model, OBJ_BODY, name);
        if (b >= 0) removeObject(b);
      }
      mujoco.mj_forward(model, data);

      const tmpPos = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();
      const fppForward = new THREE.Vector3();
      const fppLookAt = new THREE.Vector3();
      const timestepMs = model.opt.timestep * 1000;
      let lastFrameTime: number | null = null;
      let lastView: ViewMode = "orbit";

      renderer.setAnimationLoop((now: number) => {
        if (disposed || !renderer) return;
        // Orbit controls own the camera only in "Center Stage"; every
        // other view (a fixed corner, or FPP -- both handled below, after
        // this frame's body positions are updated) takes the camera over
        // completely, so disable orbit's own input/update while active
        // rather than fight it. `enabled = false` also stops it from
        // consuming the pointer events FPP's own look-around needs.
        const isOrbitView = viewRef.current === "orbit";
        if (controls) controls.enabled = isOrbitView;
        if (isOrbitView) {
          // Re-entering orbit from a corner/FPP view: OrbitControls.update()
          // re-derives its internal orbit state from wherever camera.position
          // *currently* is, every call -- it doesn't remember a separately
          // preserved state -- so without resetting the camera first, it
          // would resume orbiting around whatever leftover FPP/corner
          // position the camera was last at instead of the original framing.
          if (lastView !== "orbit") {
            camera.position.set(...ORBIT_POSITION);
            controls?.target.set(...ORBIT_TARGET);
          }
          controls?.update();
        }
        lastView = viewRef.current;

        // WASD base teleop: W/S drive forward/back along the base's current
        // heading, A/D turn in place -- a standard unicycle-style scheme.
        // "Forward" is this body's own local +Z axis (BASE_FORWARD_AXIS),
        // read directly off its rotation matrix every frame via
        // getBodyAxisXY -- see that function's own comment for why (a
        // previous version derived a "yaw" angle and reconstructed a
        // heading from cos/sin of it, which was off by a constant 90
        // degrees and drove the robot sideways). Confirmed the *axis*
        // choice itself (not just the extraction method) by checking which
        // way the two hands sit relative to each other -- local +X is the
        // hand-to-hand line, so it's not the forward axis; local +Z is the
        // only one left. Wheel spin (cosmetic -- see DRIVE_WHEEL_RADIUS) is
        // kept in sync with commanded speed, not derived from ground
        // contact.
        if (canDrive && pickPhase === "idle") {
          const forward = (pressedKeys.has("w") ? 1 : 0) - (pressedKeys.has("s") ? 1 : 0);
          const turn = (pressedKeys.has("a") ? 1 : 0) - (pressedKeys.has("d") ? 1 : 0);
          const [fx, fy] = getBodyAxisXY(data.xmat, BASE_BODY, BASE_FORWARD_AXIS);
          data.ctrl[ACT_VX] = forward * DRIVE_SPEED * fx;
          data.ctrl[ACT_VY] = forward * DRIVE_SPEED * fy;
          data.ctrl[ACT_YAW] = turn * TURN_SPEED;
          const wheelSpeed = (forward * DRIVE_SPEED) / DRIVE_WHEEL_RADIUS;
          if (ACT_WHEEL_L >= 0) data.ctrl[ACT_WHEEL_L] = wheelSpeed;
          if (ACT_WHEEL_R >= 0) data.ctrl[ACT_WHEEL_R] = wheelSpeed;
        }

        if (!pausedRef.current) {
          if (lastFrameTime === null) lastFrameTime = now;
          // Cap physics catch-up so a slow/backgrounded tab doesn't try to
          // fast-forward the simulation into instability once it resumes.
          let remaining = Math.min(now - lastFrameTime, 50);
          lastFrameTime = now;
          const dtS = timestepMs / 1000;
          // Right-arm vs left-arm key checks -- separate, non-overlapping
          // key sets (no modifier), see LEFT_MIRROR_SIGN's own comment on
          // why this replaced an earlier Shift-chord scheme.
          const keyR = (k: string) => pressedKeys.has(k);
          const keyL = (k: string) => pressedKeys.has(k);
          // Set whenever this frame's substeps kinematically overrode
          // anything (held-object follow or the Workflow's finger pin) --
          // see the one mj_forward call after the loop, below, for why.
          let neededForwardSync = false;
          while (remaining > 0) {
            // Lift column teleop (U/L) -- disabled mid-sequence (forced back
            // to LIFT_MIN instead, see the Pick & Place block below) so a
            // height change never invalidates its offline-solved arm poses.
            if (canLift && pickPhase === "idle") {
              const liftInput = (pressedKeys.has("u") ? 1 : 0) - (pressedKeys.has("l") ? 1 : 0);
              liftHeight = Math.max(LIFT_MIN, Math.min(LIFT_MAX, liftHeight + liftInput * LIFT_RATE * dtS));
              data.ctrl[ACT_LIFT] = liftHeight;
            }

            // Waist bend teleop (F/R) -- same hold-to-move/disabled-mid-
            // sequence pattern as the lift column above. F bends forward
            // (negative, see BEND_MAX's own comment on the sign convention);
            // R straightens back toward 0.
            if (canBend && pickPhase === "idle") {
              const bendInput = (pressedKeys.has("r") ? 1 : 0) - (pressedKeys.has("f") ? 1 : 0);
              bendAngle = Math.max(BEND_MIN, Math.min(0, bendAngle + bendInput * BEND_RATE * dtS));
              data.ctrl[ACT_BEND] = bendAngle;
            }

            // Right shoulder, forward/back (T/G) -- see SHOULDER_FWD_MAX's
            // own comment on the sign convention (T is negative/forward, G
            // is positive/back, same reasoning as bend's F/R). 1/2 mirror
            // this onto the left shoulder (see LEFT_MIRROR_SIGN).
            if (canShoulderFwd && pickPhase === "idle") {
              const input = (keyR("g") ? 1 : 0) - (keyR("t") ? 1 : 0);
              shoulderFwdAngle = Math.max(
                -SHOULDER_FWD_MAX,
                Math.min(SHOULDER_BACK_MAX, shoulderFwdAngle + input * SHOULDER_FWD_RATE * dtS)
              );
              data.ctrl[ACT_SHOULDER_FWD] = shoulderFwdAngle;
            }
            if (canShoulderFwdL && pickPhase === "idle") {
              const input = (keyL("2") ? 1 : 0) - (keyL("1") ? 1 : 0);
              shoulderFwdAngleL = Math.max(
                -SHOULDER_BACK_MAX,
                Math.min(SHOULDER_FWD_MAX, shoulderFwdAngleL + input * SHOULDER_FWD_RATE * dtS * LEFT_MIRROR_SIGN)
              );
              data.ctrl[ACT_SHOULDER_FWD_L] = shoulderFwdAngleL;
            }

            // Right shoulder, lateral raise (Y/H); 3/4 mirrors to left.
            if (canShoulderLat && pickPhase === "idle") {
              const input = (keyR("y") ? 1 : 0) - (keyR("h") ? 1 : 0);
              shoulderLatAngle = Math.max(0, Math.min(SHOULDER_LAT_MAX, shoulderLatAngle + input * SHOULDER_LAT_RATE * dtS));
              data.ctrl[ACT_SHOULDER_LAT] = shoulderLatAngle;
            }
            if (canShoulderLatL && pickPhase === "idle") {
              const input = (keyL("3") ? 1 : 0) - (keyL("4") ? 1 : 0);
              shoulderLatAngleL = Math.max(
                -SHOULDER_LAT_MAX,
                Math.min(0, shoulderLatAngleL + input * SHOULDER_LAT_RATE * dtS * LEFT_MIRROR_SIGN)
              );
              data.ctrl[ACT_SHOULDER_LAT_L] = shoulderLatAngleL;
            }

            // Right upper-arm roll (I/K) -- full mechanical range, no
            // separate raise-angle spec given for this one (see
            // ARM_ROLL_RATE's own comment). 5/6 mirrors to left.
            if (canArmRoll && pickPhase === "idle") {
              const input = (keyR("i") ? 1 : 0) - (keyR("k") ? 1 : 0);
              armRollAngle = Math.max(ARM_ROLL_MIN, Math.min(ARM_ROLL_MAX, armRollAngle + input * ARM_ROLL_RATE * dtS));
              data.ctrl[ACT_ARM_ROLL] = armRollAngle;
            }
            if (canArmRollL && pickPhase === "idle") {
              const input = (keyL("5") ? 1 : 0) - (keyL("6") ? 1 : 0);
              armRollAngleL = Math.max(
                ARM_ROLL_MIN_L,
                Math.min(ARM_ROLL_MAX_L, armRollAngleL + input * ARM_ROLL_RATE * dtS * LEFT_MIRROR_SIGN)
              );
              data.ctrl[ACT_ARM_ROLL_L] = armRollAngleL;
            }

            // Right elbow (O/P) -- 0 (straight) to the joint's own positive
            // limit (bent); same reasoning as ARM_ROLL above. 7/8 mirrors to
            // left (the left elbow's own positive limit bends the *other*
            // way, per LEFT_MIRROR_SIGN, so 0 is still straight but the bent
            // end is ELBOW_MIN_L, not a max).
            if (canElbow && pickPhase === "idle") {
              const input = (keyR("o") ? 1 : 0) - (keyR("p") ? 1 : 0);
              elbowAngle = Math.max(0, Math.min(ELBOW_MAX, elbowAngle + input * ELBOW_RATE * dtS));
              data.ctrl[ACT_ELBOW] = elbowAngle;
            }
            if (canElbowL && pickPhase === "idle") {
              const input = (keyL("7") ? 1 : 0) - (keyL("8") ? 1 : 0);
              elbowAngleL = Math.max(ELBOW_MIN_L, Math.min(0, elbowAngleL + input * ELBOW_RATE * dtS * LEFT_MIRROR_SIGN));
              data.ctrl[ACT_ELBOW_L] = elbowAngleL;
            }

            // Right wrist, axis A (J/N) and axis B (V/B) -- each just uses
            // its own full mechanical range (see WRIST_A_RATE's own
            // comment). 9/0 and =/- mirror to the left wrist.
            if (canWristA && pickPhase === "idle") {
              const input = (keyR("j") ? 1 : 0) - (keyR("n") ? 1 : 0);
              wristAAngle = Math.max(WRIST_A_MIN, Math.min(WRIST_A_MAX, wristAAngle + input * WRIST_A_RATE * dtS));
              data.ctrl[ACT_WRIST_A] = wristAAngle;
            }
            if (canWristAL && pickPhase === "idle") {
              const input = (keyL("9") ? 1 : 0) - (keyL("0") ? 1 : 0);
              wristAAngleL = Math.max(
                WRIST_A_MIN_L,
                Math.min(WRIST_A_MAX_L, wristAAngleL + input * WRIST_A_RATE * dtS * LEFT_MIRROR_SIGN)
              );
              data.ctrl[ACT_WRIST_A_L] = wristAAngleL;
            }
            if (canWristB && pickPhase === "idle") {
              const input = (keyR("v") ? 1 : 0) - (keyR("b") ? 1 : 0);
              wristBAngle = Math.max(WRIST_B_MIN, Math.min(WRIST_B_MAX, wristBAngle + input * WRIST_B_RATE * dtS));
              data.ctrl[ACT_WRIST_B] = wristBAngle;
            }
            if (canWristBL && pickPhase === "idle") {
              const input = (keyL("=") ? 1 : 0) - (keyL("-") ? 1 : 0);
              wristBAngleL = Math.max(
                WRIST_B_MIN_L,
                Math.min(WRIST_B_MAX_L, wristBAngleL + input * WRIST_B_RATE * dtS * LEFT_MIRROR_SIGN)
              );
              data.ctrl[ACT_WRIST_B_L] = wristBAngleL;
            }

            // Manual grip -- C/X right hand, [/] left. Ramps the
            // fraction like every other hold-to-move control, and separately
            // handles grabbing/letting go on crossing
            // GRIP_ENGAGE_AT/GRIP_RELEASE_AT (see that constant's own
            // comment) -- the finger motion itself always runs regardless of
            // whether anything is actually in reach to grab. Holding itself
            // is a kinematic follow (applyGripPose, called every step while
            // engaged), not an equality constraint -- see that function's
            // own comment for why.
            if (canGripRight && pickPhase === "idle") {
              const input = (keyR("c") ? 1 : 0) - (keyR("x") ? 1 : 0);
              rightGripFraction = Math.max(0, Math.min(1, rightGripFraction + input * GRIP_RATE * dtS));
              const fingerTarget = lerpArr(PICK_FINGER_OPEN, PICK_FINGER_CLOSED, rightGripFraction);
              for (let i = 0; i < ACT_PICK_FINGERS.length; i++) data.ctrl[ACT_PICK_FINGERS[i]] = fingerTarget[i];

              if (!rightGripEngaged && !rightPull && rightGripFraction > GRIP_ENGAGE_AT) {
                const target = findGrabTarget(RIGHT_GRIP_ANCHOR_GEOM, leftHeldBody);
                if (target) {
                  const { relPos, relQuat } = computeGripRelpose(data, RIGHT_GRIP_ANCHOR_GEOM, target.obj.body);
                  rightGripEngaged = true;
                  rightHeldBody = target.obj.body;
                  rightHeldRelPos = snugRelPos(data, RIGHT_GRIP_ANCHOR_GEOM, relPos, target.surface);
                  rightHeldRelQuat = relQuat;
                  rightHeldDof = target.obj.dof;
                  rightHeldQposAdr = target.obj.qposAdr;
                } else {
                  rightPull = findPull(RIGHT_GRIP_ANCHOR_GEOM, leftPull?.part.body ?? -1);
                }
              } else if ((rightGripEngaged || rightPull) && rightGripFraction < GRIP_RELEASE_AT) {
                rightGripEngaged = false;
                rightHeldBody = -1;
                rightPull = null;
              }
              // Following the held object itself (applyGripPose) happens
              // once, after mj_step, below -- see that block's own comment.
            }
            if (canGripLeft && pickPhase === "idle") {
              const input = (keyL("[") ? 1 : 0) - (keyL("]") ? 1 : 0);
              leftGripFraction = Math.max(0, Math.min(1, leftGripFraction + input * GRIP_RATE * dtS));
              const fingerTarget = lerpArr(LEFT_FINGER_OPEN, LEFT_FINGER_CLOSED, leftGripFraction);
              for (let i = 0; i < ACT_LEFT_FINGERS.length; i++) data.ctrl[ACT_LEFT_FINGERS[i]] = fingerTarget[i];

              if (!leftGripEngaged && !leftPull && leftGripFraction > GRIP_ENGAGE_AT) {
                const target = findGrabTarget(LEFT_GRIP_ANCHOR_GEOM, rightHeldBody);
                if (target) {
                  const { relPos, relQuat } = computeGripRelpose(data, LEFT_GRIP_ANCHOR_GEOM, target.obj.body);
                  leftGripEngaged = true;
                  leftHeldBody = target.obj.body;
                  leftHeldRelPos = snugRelPos(data, LEFT_GRIP_ANCHOR_GEOM, relPos, target.surface);
                  leftHeldRelQuat = relQuat;
                  leftHeldDof = target.obj.dof;
                  leftHeldQposAdr = target.obj.qposAdr;
                } else {
                  leftPull = findPull(LEFT_GRIP_ANCHOR_GEOM, rightPull?.part.body ?? -1);
                }
              } else if ((leftGripEngaged || leftPull) && leftGripFraction < GRIP_RELEASE_AT) {
                leftGripEngaged = false;
                leftHeldBody = -1;
                leftPull = null;
              }
              // Following the held object itself (applyGripPose) happens
              // once, after mj_step, below -- see that block's own comment.
            }

            // Scripted Workflow: see the PICK_* constants' own comments for
            // the phase list, timings, and the offline-solved arm targets.
            // Advances pickPhaseElapsedS the same way waveElapsedS advances
            // above, for the same frame-hitch-immunity reason.
            // Fingers are cosmetic once the grip is engaged (the cup is
            // held by applyGripPose below, not finger contact), and get
            // forced kinematically to fingerTarget every step from "close"
            // through the end of the carry (see fingerHold's own comment) --
            // set here so that override has this frame's actual target to
            // use.
            let fingerTarget = PICK_FINGER_OPEN;
            let fingerHold = false;
            // Set only during "pullIn"/"placing" -- a directly scripted cup
            // position/orientation for this step (see those phases' own
            // comments), applied after mj_step the same way fingerHold's
            // override is.
            let cupAnimPos: [number, number, number] | null = null;
            let cupAnimQuat: [number, number, number, number] | null = null;
            if (
              canPick &&
              pickPhase !== "idle" &&
              (pickPhase === "driveToPick1" ||
                pickPhase === "driveToPick2" ||
                pickPhase === "driveToPick3" ||
                pickPhase === "driveToCoffee1" ||
                pickPhase === "driveToCoffee2") &&
              pickPhaseElapsedS > PICK_DRIVE_TIMEOUT_S
            ) {
              // Safety net: the drive phases assume a specific starting
              // position (spawn for driveToPick) and a specific, verified-
              // clear route -- triggering the workflow from some other,
              // unverified position/orientation (e.g. after driving around
              // manually first) could in principle walk the straight-line
              // P-controller into an obstacle it was never checked against,
              // where it would just push against it forever, permanently
              // blocking every other idle-gated control (WASD included)
              // along with it. Aborting back to idle after a generous
              // timeout means a bad start position degrades to "the
              // workflow didn't finish," not "WASD is broken now."
              rightGripEngaged = false;
              rightHeldBody = -1;
              pickPhase = "idle";
              pickPhaseElapsedS = 0;
              pickDriveVX = 0;
              pickDriveVY = 0;
            }
            if (canPick && pickPhase !== "idle") {
              // Yaw hold, active through every phase -- see PICK_YAW_KP's
              // own comment on why this can't be left uncontrolled.
              const yawErr = Math.atan2(Math.sin(PICK_PARK_YAW - data.qpos[YAW_QPOS_ADR]), Math.cos(PICK_PARK_YAW - data.qpos[YAW_QPOS_ADR]));
              data.ctrl[ACT_YAW] = Math.max(-PICK_YAW_MAX_RATE, Math.min(PICK_YAW_MAX_RATE, PICK_YAW_KP * yawErr));

              const t = pickPhaseElapsedS;
              let armTarget = PICK_REST_QPOS;
              // Waist bend target -- see PICK_GRASP_BEND's own comment for
              // the pickup side's ramp (0 through "reach", up during
              // "lower", held, back to 0 during "lift") and PICK_PLACE_BEND's
              // for the placement side's equivalent, smaller ramp. Defaults
              // to upright; only those phases ever change it, same as
              // PICK_REST_QPOS's default above.
              let bendTarget = 0;
              let driveTarget: [number, number] | null = null;
              let nextOnArrive: PickPhase | null = null;

              if (pickPhase === "driveToPick1") {
                driveTarget = PICK_WAYPOINT_EAST;
                nextOnArrive = "driveToPick2";
              } else if (pickPhase === "driveToPick2") {
                driveTarget = PICK_WAYPOINT_EAST_NORTH;
                nextOnArrive = "driveToPick3";
              } else if (pickPhase === "driveToPick3") {
                driveTarget = PICK_PARK_PICK;
                nextOnArrive = "reach";
              } else if (pickPhase === "reach") {
                // Arm-only: stretches from resting straight out to the full
                // grasp pose while the torso stays upright -- the visible
                // "reaching forward" motion (the user's own ask: "arms
                // stretch with T button... arm moves forward and reaches to
                // cup"). The waist bend that finishes closing the gap to the
                // cup happens next, in "lower", once the arm's already fully
                // extended -- not blended in here -- so the two read as
                // distinct motions instead of one folding blob.
                armTarget = lerpArr(PICK_REST_QPOS, PICK_GRASP_QPOS, smoothstep(t / PICK_REACH_S));
                bendTarget = 0;
                if (t >= PICK_REACH_S) {
                  pickPhase = "lower";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "lower") {
                // Arm holds at full extension; only the waist bends now, to
                // bring the already-outstretched hand the rest of the way
                // down to the cup.
                armTarget = PICK_GRASP_QPOS;
                bendTarget = PICK_GRASP_BEND * smoothstep(t / PICK_LOWER_S);
                if (t >= PICK_LOWER_S) {
                  pickPhase = "close";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "close") {
                armTarget = PICK_GRASP_QPOS;
                bendTarget = PICK_GRASP_BEND;
                fingerTarget = lerpArr(PICK_FINGER_OPEN, PICK_FINGER_CLOSED, smoothstep(t / PICK_CLOSE_S));
                fingerHold = true;
                if (t >= PICK_CLOSE_S) {
                  pickPhase = "settle";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "settle") {
                armTarget = PICK_GRASP_QPOS;
                bendTarget = PICK_GRASP_BEND;
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                if (t >= PICK_SETTLE_S) {
                  // Only now -- once the arm has actually finished settling
                  // into PICK_GRASP_QPOS, not the instant fingers finish
                  // closing -- compute the grip (see PICK_REACH_S's own
                  // comment on why: these joints take real seconds to
                  // settle, and capturing early froze in whatever
                  // still-mid-swing offset existed at that moment). Not
                  // engaged yet, though -- even this bent-forward reach still
                  // leaves the palm a few cm from the cup (see
                  // PICK_GRASP_QPOS's own comment), so snapping straight to
                  // the snugged relPos here would still show a small final
                  // jump. "pullIn" (next) animates that last bit shut over
                  // real time instead -- now short enough (PICK_PULL_IN_S) to
                  // read as the hand settling onto the cup, not a slide.
                  const { relPos, relQuat } = computeGripRelpose(data, RIGHT_GRIP_ANCHOR_GEOM, CUP_OBJECT_BODY);
                  const cupSurface = cupObject ? surfaceFrom(RIGHT_GRIP_ANCHOR_GEOM, cupObject).point : null;
                  rightHeldRelPos = cupSurface ? snugRelPos(data, RIGHT_GRIP_ANCHOR_GEOM, relPos, cupSurface) : relPos;
                  rightHeldRelQuat = relQuat;
                  rightHeldDof = CUP_OBJECT_DOF;
                  rightHeldQposAdr = CUP_OBJECT_QPOS_ADR;
                  placeAnimStartPos = [
                    data.xpos[CUP_OBJECT_BODY * 3],
                    data.xpos[CUP_OBJECT_BODY * 3 + 1],
                    data.xpos[CUP_OBJECT_BODY * 3 + 2],
                  ];
                  placeAnimStartQuat = [
                    data.xquat[CUP_OBJECT_BODY * 4],
                    data.xquat[CUP_OBJECT_BODY * 4 + 1],
                    data.xquat[CUP_OBJECT_BODY * 4 + 2],
                    data.xquat[CUP_OBJECT_BODY * 4 + 3],
                  ];
                  pickPhase = "pullIn";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "pullIn") {
                // Animates the cup from where it actually was resting
                // (placeAnimStartPos/Quat, captured above) to the snugged
                // grip pose -- recomputed live off the anchor every step,
                // not just once, so this still lands correctly even though
                // the arm/fingers are still finishing their own settling
                // during this same window. Once the blend reaches 1, the
                // cup is already exactly where applyGripPose would put it,
                // so engaging rightGripEngaged then is a seamless handoff,
                // not a second jump.
                armTarget = PICK_GRASP_QPOS;
                bendTarget = PICK_GRASP_BEND;
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                {
                  const blend = smoothstep(t / PICK_PULL_IN_S);
                  const am = RIGHT_GRIP_ANCHOR_GEOM * 9;
                  const ax = data.geom_xpos[RIGHT_GRIP_ANCHOR_GEOM * 3];
                  const ay = data.geom_xpos[RIGHT_GRIP_ANCHOR_GEOM * 3 + 1];
                  const az = data.geom_xpos[RIGHT_GRIP_ANCHOR_GEOM * 3 + 2];
                  const liveTargetPos: [number, number, number] = [
                    ax +
                      data.geom_xmat[am] * rightHeldRelPos[0] +
                      data.geom_xmat[am + 1] * rightHeldRelPos[1] +
                      data.geom_xmat[am + 2] * rightHeldRelPos[2],
                    ay +
                      data.geom_xmat[am + 3] * rightHeldRelPos[0] +
                      data.geom_xmat[am + 4] * rightHeldRelPos[1] +
                      data.geom_xmat[am + 5] * rightHeldRelPos[2],
                    az +
                      data.geom_xmat[am + 6] * rightHeldRelPos[0] +
                      data.geom_xmat[am + 7] * rightHeldRelPos[1] +
                      data.geom_xmat[am + 8] * rightHeldRelPos[2],
                  ];
                  const liveTargetQuat = quatMul(mat3ToQuat(data.geom_xmat, am), rightHeldRelQuat);
                  cupAnimPos = lerpArr(placeAnimStartPos, liveTargetPos, blend) as [number, number, number];
                  const rawQuat = lerpArr(placeAnimStartQuat, liveTargetQuat, blend);
                  const qn = Math.hypot(rawQuat[0], rawQuat[1], rawQuat[2], rawQuat[3]) || 1;
                  cupAnimQuat = [rawQuat[0] / qn, rawQuat[1] / qn, rawQuat[2] / qn, rawQuat[3] / qn];
                }
                if (t >= PICK_PULL_IN_S) {
                  rightGripEngaged = true;
                  rightGripFraction = 1;
                  rightHeldBody = CUP_OBJECT_BODY;
                  pickPhase = "lift";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "lift") {
                armTarget = lerpArr(PICK_GRASP_QPOS, PICK_CARRY_QPOS, smoothstep(t / PICK_LIFT_S));
                bendTarget = PICK_GRASP_BEND * (1 - smoothstep(t / PICK_LIFT_S));
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                if (t >= PICK_LIFT_S) {
                  pickPhase = "driveToCoffee1";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "driveToCoffee1") {
                armTarget = PICK_CARRY_QPOS;
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                driveTarget = PICK_WAYPOINT_NORTH;
                nextOnArrive = "driveToCoffee2";
              } else if (pickPhase === "driveToCoffee2") {
                armTarget = PICK_CARRY_QPOS;
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                driveTarget = PICK_COFFEE_PARK;
                if (
                  Math.hypot(
                    PICK_COFFEE_PARK[0] - data.xpos[BASE_BODY * 3],
                    PICK_COFFEE_PARK[1] - data.xpos[BASE_BODY * 3 + 1]
                  ) < PICK_DRIVE_ARRIVE_DIST
                ) {
                  pickPhase = "lowerPlace";
                  pickPhaseElapsedS = 0;
                  pickDriveVX = 0;
                  pickDriveVY = 0;
                }
              } else if (pickPhase === "lowerPlace") {
                // Arm-only stretch toward the coffee-machine counter, same
                // shape as "reach" -- bend stays at 0 while the arm extends.
                armTarget = lerpArr(PICK_CARRY_QPOS, PICK_PLACE_QPOS, smoothstep(t / PICK_LOWER_PLACE_S));
                bendTarget = 0;
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                if (t >= PICK_LOWER_PLACE_S) {
                  pickPhase = "settlePlace";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "settlePlace") {
                // Arm holds at full extension; the small placement bend (see
                // PICK_PLACE_BEND's own comment) ramps in now to bring the
                // hand the rest of the way down to the counter.
                armTarget = PICK_PLACE_QPOS;
                bendTarget = PICK_PLACE_BEND * smoothstep(t / PICK_SETTLE_PLACE_S);
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                if (t >= PICK_SETTLE_PLACE_S) {
                  // Stop following the palm and hand off to "placing" instead
                  // of just letting go here -- PICK_PLACE_QPOS/PICK_PLACE_BEND
                  // get close (~11.5cm) but not exact, so releasing at this
                  // exact point would leave the cup sitting slightly off from
                  // a clean, on-counter spot rather than exactly on it.
                  placeAnimStartPos = [
                    data.xpos[CUP_OBJECT_BODY * 3],
                    data.xpos[CUP_OBJECT_BODY * 3 + 1],
                    data.xpos[CUP_OBJECT_BODY * 3 + 2],
                  ];
                  placeAnimStartQuat = [
                    data.xquat[CUP_OBJECT_BODY * 4],
                    data.xquat[CUP_OBJECT_BODY * 4 + 1],
                    data.xquat[CUP_OBJECT_BODY * 4 + 2],
                    data.xquat[CUP_OBJECT_BODY * 4 + 3],
                  ];
                  rightGripEngaged = false;
                  rightHeldBody = -1;
                  pickPhase = "placing";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "placing") {
                // Animates the cup the short remaining distance from wherever
                // the palm left it to PICK_PLACE_TARGET, on the counter next
                // to the machine -- a fixed world point, not a joint-space arm
                // target, since PICK_PLACE_QPOS/PICK_PLACE_BEND land close but
                // not exactly on it (see that constant's own comment).
                // Orientation is left as it was at handoff (only position
                // blends) -- the cup was already upright throughout the
                // carry, nothing needs to rotate here.
                armTarget = PICK_PLACE_QPOS;
                bendTarget = PICK_PLACE_BEND;
                fingerTarget = PICK_FINGER_CLOSED;
                fingerHold = true;
                {
                  const blend = smoothstep(t / PICK_PLACING_S);
                  cupAnimPos = lerpArr(placeAnimStartPos, PICK_PLACE_TARGET, blend) as [number, number, number];
                  cupAnimQuat = placeAnimStartQuat;
                }
                if (t >= PICK_PLACING_S) {
                  pickPhase = "release";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "release") {
                armTarget = PICK_PLACE_QPOS;
                bendTarget = PICK_PLACE_BEND;
                fingerTarget = lerpArr(PICK_FINGER_CLOSED, PICK_FINGER_OPEN, smoothstep(t / PICK_RELEASE_S));
                fingerHold = true;
                if (t >= PICK_RELEASE_S) {
                  pickPhase = "retractPlace";
                  pickPhaseElapsedS = 0;
                }
              } else if (pickPhase === "retractPlace") {
                armTarget = lerpArr(PICK_PLACE_QPOS, PICK_CARRY_QPOS, smoothstep(t / PICK_RETRACT_PLACE_S));
                bendTarget = PICK_PLACE_BEND * (1 - smoothstep(t / PICK_RETRACT_PLACE_S));
                fingerTarget = PICK_FINGER_OPEN;
                fingerHold = true;
                if (t >= PICK_RETRACT_PLACE_S) {
                  // Workflow done -- sync the idle teleop targets to
                  // PICK_CARRY_QPOS (where the arm actually is now) so
                  // T/G/Y/H/I/K/O/P/J/N/V/B resume from here instead of
                  // snapping the arm somewhere else on the first
                  // idle-gated key.
                  const [sf, sl, ar, el, wa, wb] = PICK_CARRY_QPOS;
                  shoulderFwdAngle = sf;
                  shoulderLatAngle = sl;
                  armRollAngle = ar;
                  elbowAngle = el;
                  wristAAngle = wa;
                  wristBAngle = wb;
                  rightGripFraction = 0;
                  pickPhase = "idle";
                  pickPhaseElapsedS = 0;
                }
              }

              if (driveTarget && nextOnArrive) {
                const ex = driveTarget[0] - data.xpos[BASE_BODY * 3 + 0];
                const ey = driveTarget[1] - data.xpos[BASE_BODY * 3 + 1];
                const dist = Math.hypot(ex, ey);
                if (dist < PICK_DRIVE_ARRIVE_DIST) {
                  pickDriveVX = 0;
                  pickDriveVY = 0;
                  pickPhase = nextOnArrive;
                  pickPhaseElapsedS = 0;
                } else {
                  const desiredVX = Math.max(-PICK_DRIVE_MAX_SPEED, Math.min(PICK_DRIVE_MAX_SPEED, PICK_DRIVE_KP * ex));
                  const desiredVY = Math.max(-PICK_DRIVE_MAX_SPEED, Math.min(PICK_DRIVE_MAX_SPEED, PICK_DRIVE_KP * ey));
                  const maxDelta = PICK_DRIVE_MAX_ACCEL * dtS;
                  pickDriveVX += Math.max(-maxDelta, Math.min(maxDelta, desiredVX - pickDriveVX));
                  pickDriveVY += Math.max(-maxDelta, Math.min(maxDelta, desiredVY - pickDriveVY));
                }
              } else if (driveTarget) {
                // driveToCoffee2's own arrival is handled inline above (it
                // needs to run the teleop-sync/release-to-idle logic, not
                // just switch phases), but still needs the same P-control
                // drive while en route.
                const ex = driveTarget[0] - data.xpos[BASE_BODY * 3 + 0];
                const ey = driveTarget[1] - data.xpos[BASE_BODY * 3 + 1];
                const dist = Math.hypot(ex, ey);
                if (dist < PICK_DRIVE_ARRIVE_DIST) {
                  pickDriveVX = 0;
                  pickDriveVY = 0;
                } else {
                  const desiredVX = Math.max(-PICK_DRIVE_MAX_SPEED, Math.min(PICK_DRIVE_MAX_SPEED, PICK_DRIVE_KP * ex));
                  const desiredVY = Math.max(-PICK_DRIVE_MAX_SPEED, Math.min(PICK_DRIVE_MAX_SPEED, PICK_DRIVE_KP * ey));
                  const maxDelta = PICK_DRIVE_MAX_ACCEL * dtS;
                  pickDriveVX += Math.max(-maxDelta, Math.min(maxDelta, desiredVX - pickDriveVX));
                  pickDriveVY += Math.max(-maxDelta, Math.min(maxDelta, desiredVY - pickDriveVY));
                }
              } else if (
                pickPhase === "reach" || pickPhase === "lower" || pickPhase === "close" ||
                pickPhase === "settle" || pickPhase === "pullIn" || pickPhase === "lift" ||
                pickPhase === "lowerPlace" || pickPhase === "settlePlace" || pickPhase === "placing" ||
                pickPhase === "release" || pickPhase === "retractPlace"
              ) {
                // See PICK_BEND_HOLD_KP's own comment -- these are the only
                // phases that ever bend the waist, so they're the only ones
                // that need this stiffer hold instead of a plain zero. Two
                // different park spots to hold against depending on which
                // side of the workflow this is.
                const holdPark = pickPhase === "reach" || pickPhase === "lower" || pickPhase === "close" ||
                  pickPhase === "settle" || pickPhase === "pullIn" || pickPhase === "lift"
                  ? PICK_PARK_PICK
                  : PICK_COFFEE_PARK;
                const ex = holdPark[0] - data.xpos[BASE_BODY * 3 + 0];
                const ey = holdPark[1] - data.xpos[BASE_BODY * 3 + 1];
                pickDriveVX = Math.max(-PICK_DRIVE_MAX_SPEED, Math.min(PICK_DRIVE_MAX_SPEED, PICK_BEND_HOLD_KP * ex));
                pickDriveVY = Math.max(-PICK_DRIVE_MAX_SPEED, Math.min(PICK_DRIVE_MAX_SPEED, PICK_BEND_HOLD_KP * ey));
              } else {
                pickDriveVX = 0;
                pickDriveVY = 0;
              }
              data.ctrl[ACT_VX] = pickDriveVX;
              data.ctrl[ACT_VY] = pickDriveVY;

              for (let i = 0; i < ACT_PICK_ARM.length; i++) data.ctrl[ACT_PICK_ARM[i]] = armTarget[i];
              for (let i = 0; i < ACT_PICK_FINGERS.length; i++) data.ctrl[ACT_PICK_FINGERS[i]] = fingerTarget[i];
              // Every PICK_*_QPOS arm target was solved at LIFT_MIN -- force
              // that regardless of whatever the user last set with U/L.
              if (canLift) {
                liftHeight = LIFT_MIN;
                data.ctrl[ACT_LIFT] = LIFT_MIN;
              }
              // Waist bend now follows bendTarget (see PICK_GRASP_BEND's own
              // comment) instead of being forced to 0 -- it's 0 outside
              // "reach".."lift" anyway (bendTarget's own default above), so
              // this still overrides whatever the user last set with F/R
              // during every other phase, same as before.
              if (canBend) {
                bendAngle = bendTarget;
                data.ctrl[ACT_BEND] = bendTarget;
              }

              pickPhaseElapsedS += dtS;
            }

            mujoco.mj_step(model, data);

            // Kinematically pin the right hand's fingers to fingerTarget
            // instead of trusting their own actuators for the rest of this
            // step -- these specific finger joints have been confirmed (via
            // extended headless simulation) to slowly drift open under
            // gravity at the grasp pose regardless of how long they're
            // given to "settle": holding them via their normal position
            // actuators there is not just slow to converge, it never
            // converges. Since the cup itself is held by applyGripPose
            // below, not finger contact, the fingers are purely cosmetic
            // here and can be driven directly without affecting the hold.
            // No mj_forward here (or after applyGripPose below) -- the
            // *next* mj_step already recomputes forward kinematics from
            // whatever qpos it's handed as the very first thing it does,
            // same as if this were any other qpos edit between steps. An
            // explicit mj_forward call per substep (there can be dozens per
            // rendered frame -- see the catch-up loop's own comment) was
            // pure wasted work that scaled with how many objects were held,
            // permanently, from the moment anything was first grabbed --
            // reported live as the whole page turning sluggish/unresponsive
            // (WASD included) as soon as something was picked up. One
            // mj_forward after the whole loop (below) is enough to make the
            // very last correction visible to this frame's render.
            if (fingerHold) {
              for (let i = 0; i < PICK_FINGER_QPOSADR.length; i++) {
                if (PICK_FINGER_QPOSADR[i] < 0) continue;
                data.qpos[PICK_FINGER_QPOSADR[i]] = fingerTarget[i];
                data.qvel[PICK_FINGER_DOFADR[i]] = 0;
              }
              neededForwardSync = true;
            }

            // Kinematic follow for whatever's currently grabbed (manual
            // grip or the Workflow above) -- runs regardless of pickPhase
            // now, since the Workflow can hold the cup through phases other
            // than "idle" (see the "settle" phase above, and manual grip's
            // own engage logic higher up, which no longer applies this
            // itself -- see that block's own updated comment).
            if (rightGripEngaged) {
              applyGripPose(RIGHT_GRIP_ANCHOR_GEOM, rightHeldRelPos, rightHeldRelQuat, rightHeldQposAdr, rightHeldDof);
              neededForwardSync = true;
            }
            if (leftGripEngaged) {
              applyGripPose(LEFT_GRIP_ANCHOR_GEOM, leftHeldRelPos, leftHeldRelQuat, leftHeldQposAdr, leftHeldDof);
              neededForwardSync = true;
            }
            for (const part of ARTICULATED_PARTS) data.qfrc_applied[part.dof] = 0;
            if (rightPull) drivePull(RIGHT_GRIP_ANCHOR_GEOM, rightPull);
            if (leftPull) drivePull(LEFT_GRIP_ANCHOR_GEOM, leftPull);
            // "pullIn"/"placing"'s own directly-scripted cup pose (see
            // those phases' own comments) -- set instead of, not alongside,
            // the two blocks above (neither is engaged during either
            // phase).
            if (cupAnimPos && cupAnimQuat) {
              data.qpos[CUP_OBJECT_QPOS_ADR] = cupAnimPos[0];
              data.qpos[CUP_OBJECT_QPOS_ADR + 1] = cupAnimPos[1];
              data.qpos[CUP_OBJECT_QPOS_ADR + 2] = cupAnimPos[2];
              data.qpos[CUP_OBJECT_QPOS_ADR + 3] = cupAnimQuat[0];
              data.qpos[CUP_OBJECT_QPOS_ADR + 4] = cupAnimQuat[1];
              data.qpos[CUP_OBJECT_QPOS_ADR + 5] = cupAnimQuat[2];
              data.qpos[CUP_OBJECT_QPOS_ADR + 6] = cupAnimQuat[3];
              for (let k = 0; k < 6; k++) data.qvel[CUP_OBJECT_DOF + k] = 0;
              neededForwardSync = true;
            }
            syncRobotCollision();

            remaining -= timestepMs;
          }
          // Exactly one forward pass for the whole frame (not one per
          // substep -- see that loop's own comment) so the render below
          // sees this frame's very last kinematic correction, not
          // whatever mj_step's own internal forward pass computed just
          // before it.
          if (neededForwardSync) mujoco.mj_forward(model, data);
        } else {
          lastFrameTime = null;
        }

        for (let b = 0; b < model.nbody; b++) {
          const body = bodies[b];
          if (!body) continue;
          body.position.copy(getPosition(data.xpos, b, tmpPos));
          body.quaternion.copy(getQuaternion(data.xquat, b, tmpQuat));
        }
        updateSelection();

        // FPP: camera mounted at the head, looking the same direction the
        // base's own drive logic (above) treats as "forward" -- so this is
        // literally "the direction WASD's W currently drives," which is
        // what makes it useful for seeing where the robot is headed into a
        // corner the fixed orbit view can't frame well. Bypasses
        // three.js's Y-up bodies entirely except for the head's position
        // (bodies[] is already swizzled by getPosition above); the look
        // direction is computed straight from mujoco's own xmat and
        // swizzled by hand (mujoco (x,y,0) horizontal -> three.js (x,0,-y)),
        // same convention getPosition/getQuaternion use.
        if (viewRef.current.startsWith("corner")) {
          // Fixed "security camera" shots -- see CORNER_VIEWS. Static, but
          // cheap enough to just re-apply every frame rather than track
          // "did the view just change."
          const idx = Number(viewRef.current.slice(-1)) - 1;
          const preset = CORNER_VIEWS[idx];
          if (preset) {
            camera.position.set(...preset.pos);
            camera.lookAt(...preset.lookAt);
          }
        } else if (viewRef.current === "fpp" && canFpp) {
          // FPP: camera mounted exactly at the head geom's own live world
          // pose (data.geom_xpos/HEAD_GEOM -- see canFpp's own comment for
          // why this, not base_link + a guessed height/forward offset, is
          // what actually lands the camera at the robot's eye instead of
          // off to one side). Look direction is still "the direction WASD's
          // W currently drives" (same getBodyAxisXY this frame's teleop
          // above used), turned further by the head look-around drag
          // (fppYaw/fppPitch, see the pointer handlers above) -- there's no
          // independent neck joint on this rig, so aiming still follows the
          // base's own heading, only the camera's *position* comes from the
          // head now. Built as an explicit (yaw, pitch) -> direction,
          // three.js's usual FPS-camera convention, rather than rotating
          // the forward vector by hand -- much harder to get a sign wrong.
          const [fx, fy] = getBodyAxisXY(data.xmat, BASE_BODY, BASE_FORWARD_AXIS);
          const baseYaw = Math.atan2(fx, -fy); // three.js horizontal forward (fx, -fy) -> angle
          const totalYaw = baseYaw + fppYaw;
          const cosPitch = Math.cos(fppPitch);
          fppForward.set(Math.sin(totalYaw) * cosPitch, Math.sin(fppPitch), Math.cos(totalYaw) * cosPitch);
          getPosition(data.geom_xpos, HEAD_GEOM, camera.position);
          // The head geom's own bounding radius is ~0.158m (measured) --
          // sitting exactly at its center (as above) puts the camera inside
          // its own mesh, which reads as a plain black view (looking at the
          // inside of a shell, whatever isn't backface-culled sitting right
          // up against the near clip plane). Nudged forward, along the
          // level (unpitched) heading rather than the full look direction,
          // so looking sharply up/down doesn't dive the camera into the
          // ceiling/floor mesh instead -- comfortably past that radius.
          camera.position.x += Math.sin(totalYaw) * FPP_FORWARD_CLEARANCE;
          camera.position.z += Math.cos(totalYaw) * FPP_FORWARD_CLEARANCE;
          fppLookAt.copy(camera.position).add(fppForward);
          camera.lookAt(fppLookAt);
        }

        renderer.render(scene, camera);
      });

      setStatus("ready");
    }

    init().catch((err) => {
      console.error("Failed to load MuJoCo simulation:", err);
      if (!disposed) setStatus("error");
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      removeKeyListeners?.();
      controls?.dispose();
      renderer?.setAnimationLoop(null);
      if (renderer) {
        const canvas = renderer.domElement;
        renderer.dispose();
        canvas.remove();
      }
      data?.delete?.();
      model?.delete?.();
    };
    // Switching environment recompiles the whole model, so it re-runs this
    // effect from scratch (new model on the shared engine). `interactive`
    // only changes camera controls, not worth re-initializing for -- it's
    // fixed per mount in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentId, sceneVersion]);

  const reloadScene = (carryState: boolean) => {
    restoreRef.current = carryState ? (captureRef.current?.() ?? null) : null;
    editorApiRef.current = null;
    setStatus("loading");
    setSceneVersion((v) => v + 1);
  };

  const addObject = (item: Omit<AddedProp, "name">) => {
    const edits = editsIn(sceneEditsRef.current, environment.id);
    edits.added.push({ ...item, name: `added_${item.propId}_${edits.nextId++}` });
    setAddedCounts((c) => ({ ...c, [environment.id]: edits.added.length }));
    reloadScene(true);
  };

  const toggleEditing = () => {
    if (editing) {
      setEditing(false);
      setPaused(pausedBeforeEditRef.current);
      return;
    }
    if (isBusyRef.current()) {
      setEditorNotice("Wait for the workflow to finish before editing objects.");
      return;
    }
    setEditorNotice(null);
    pausedBeforeEditRef.current = paused;
    setPaused(true);
    setView("orbit");
    setEditing(true);
  };

  // Reset restores the room as built: if the editor changed it, that means a rebuild.
  const resetScene = () => {
    const edits = sceneEditsRef.current.get(environment.id);
    if (edits && (edits.added.length || edits.removed.size || edits.staticPoses.size)) {
      sceneEditsRef.current.delete(environment.id);
      setAddedCounts((c) => ({ ...c, [environment.id]: 0 }));
      reloadScene(false);
    } else {
      resetRef.current();
    }
  };

  const showControls = interactive && status === "ready";
  const buttonClass =
    "rounded-sm border border-border-strong bg-panel/90 px-4 py-2 text-xs text-off-white backdrop-blur transition-colors hover:bg-panel-raised cursor-pointer";

  const controlButtons = (
    <>
      <select
        value={environmentId}
        aria-label="Environment"
        title={environment.description}
        onChange={(e) => {
          // Same type-ahead focus issue as the Workflow select below.
          e.target.blur();
          if (e.target.value === UPLOAD_OPTION) {
            setShowUpload(true);
            return;
          }
          setUploadWarnings([]);
          if (editing) {
            setEditing(false);
            setPaused(pausedBeforeEditRef.current);
          }
          setStatus("loading");
          setEnvironmentId(e.target.value);
        }}
        className={clsx(buttonClass, "appearance-none pr-8")}
      >
        {[...ENVIRONMENTS, ...uploadedList].map((env) => (
          <option key={env.id} value={env.id} className="bg-panel text-off-white">
            {env.name}
          </option>
        ))}
        <option value={UPLOAD_OPTION} className="bg-panel text-off-white">
          Upload your own…
        </option>
      </select>
      <button onClick={() => setPaused((p) => !p)} className={buttonClass}>
        {paused ? "Resume" : "Pause"}
      </button>
      <button onClick={resetScene} className={buttonClass}>
        Reset
      </button>
      <button onClick={toggleEditing} className={clsx(buttonClass, editing && "bg-sand/30")} aria-pressed={editing}>
        {editing ? "Done editing" : "Objects"}
      </button>
      <select
        value={view}
        onChange={(e) => setView(e.target.value as ViewMode)}
        className={clsx(buttonClass, "appearance-none pr-8")}
      >
        {VIEW_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-panel text-off-white">
            {opt.label}
          </option>
        ))}
      </select>
      {/* A trigger, not a persistent mode -- picking an action starts it
          (pickRef.current(), the same scripted-sequence entry point the old
          "Pick & Place" button used) and the select snaps straight back to
          the placeholder, rather than staying "selected" on an action that
          already ran. */}
      {environment.workflows.length > 0 && (
        <select
          value={workflowChoice}
          onChange={(e) => {
            const choice = e.target.value;
            // A focused <select> intercepts the W/A/S/D keys that WASD drive
            // listens for as its own type-ahead ("jump to the option starting
            // with this letter") on some browsers, before the page's own
            // keydown handling ever sees them -- reported live as "WASD
            // stopped working" right after picking a workflow. Blurring hands
            // keyboard focus back to the page the instant a choice is made.
            e.target.blur();
            setWorkflowChoice("");
            if (choice === "pickupCoffee") pickRef.current();
          }}
          className={clsx(buttonClass, "appearance-none pr-8")}
        >
          <option value="" className="bg-panel text-off-white">
            Workflow…
          </option>
          {environment.workflows.includes("serveCoffee") && (
            <option value="pickupCoffee" className="bg-panel text-off-white">
              Serve coffee
            </option>
          )}
        </select>
      )}
    </>
  );

  return (
    <div className={clsx("flex h-full w-full", className)}>
      {/* min-w-0 is load-bearing here: without it a flex child won't shrink
          below its content's natural width, and the canvas column (below)
          would refuse to give up space to the guide panel instead of
          resizing -- exactly the "views overlap" failure mode this avoids. */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            ref={containerRef}
            style={{ backgroundColor: environment.background }}
            className="h-full w-full [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full"
          />

          {status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sand" />
              <p className="text-technical text-xs text-sand">LOADING PHYSICS ENGINE</p>
            </div>
          )}

          {showUpload && (
            <EnvironmentUploadPanel
              loadEngine={loadEngine}
              onClose={() => setShowUpload(false)}
              onLoaded={(env, warnings) => {
                uploadedEnvironmentRef.current = env;
                setUploadedEnvironment(env);
                setUploadWarnings(warnings);
                setShowUpload(false);
                setStatus("loading");
                setEnvironmentId(env.id);
              }}
            />
          )}

          {interactive && editing && (
            <ObjectEditor
              apiRef={editorApiRef}
              containerRef={containerRef}
              sceneKey={`${environment.id}:${sceneVersion}:${status}`}
              addedCount={addedCounts[environment.id] ?? 0}
              onAdd={addObject}
              onClose={toggleEditing}
            />
          )}

          {showControls && editorNotice && !editing && (
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-sm border border-border-strong bg-panel/90 px-3 py-2 text-xs text-off-white/80 backdrop-blur">
              {editorNotice}
              <button onClick={() => setEditorNotice(null)} aria-label="Dismiss" className="cursor-pointer text-off-white/60 hover:text-off-white">
                ×
              </button>
            </div>
          )}

          {showControls && uploadWarnings.length > 0 && (
            <div className="absolute top-4 right-4 z-10 max-w-sm rounded-sm border border-border-strong bg-panel/90 px-3 py-2 text-xs text-off-white/80 backdrop-blur">
              <div className="mb-1 flex items-center justify-between gap-4">
                <span className="text-technical text-sand">UPLOAD NOTES</span>
                <button onClick={() => setUploadWarnings([])} aria-label="Dismiss" className="cursor-pointer text-off-white/60 hover:text-off-white">
                  ×
                </button>
              </div>
              <ul className="list-disc space-y-1 pl-4">
                {uploadWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center">
              <p className="text-technical text-xs text-error">SIMULATION FAILED TO LOAD</p>
              <p className="text-xs text-text-muted">Check the browser console for details.</p>
            </div>
          )}

          {showControls && (
            <div className="absolute top-4 left-4 rounded-sm border border-border-strong bg-panel/90 px-3 py-2 text-xs text-off-white/70 backdrop-blur">
              {view === "fpp" ? (
                <>
                  <span className="text-off-white">FIRST PERSON</span> -- what the robot sees ·
                  drag to look around
                </>
              ) : view === "orbit" ? (
                <>
                  <span className="text-off-white">W A S D</span> to drive · orbit-drag to look ·{" "}
                  {showGuide ? "keys at right" : "open the key guide at right"}
                </>
              ) : (
                <>
                  <span className="text-off-white">W A S D</span> to drive · fixed camera view ·{" "}
                  {showGuide ? "keys at right" : "open the key guide at right"}
                </>
              )}
            </div>
          )}
        </div>

        {showControls && (
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border-strong bg-panel/60 py-3">
            {controlButtons}
          </div>
        )}
      </div>

      {showControls && (
        <div className="relative shrink-0">
          {/* The arrow sits on the boundary itself (half in the canvas
              column, half in the panel) so it stays reachable whether the
              panel is open or fully collapsed to w-0 below. */}
          <button
            onClick={() => setShowGuide((v) => !v)}
            aria-label={showGuide ? "Hide key guide" : "Show key guide"}
            className="absolute top-1/2 left-0 z-10 flex h-9 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border border-border-strong bg-panel text-off-white/70 hover:bg-panel-raised cursor-pointer"
          >
            {showGuide ? "›" : "‹"}
          </button>
          <div
            className={clsx(
              "h-full overflow-hidden border-l border-border-strong bg-panel/95 backdrop-blur transition-[width] duration-200 ease-out",
              showGuide ? "w-64" : "w-0"
            )}
          >
            {/* h-full is required here, not just on the outer wrapper --
                overflow-y-auto only ever kicks in once this div's own height
                is actually bounded; without it the div just grows to fit
                every KEY_GUIDE row (now well over one screen's worth) and
                the outer `overflow-hidden` silently clips the rest instead
                of making it scrollable. */}
            <div className="h-full w-64 overflow-y-auto px-4 py-4">
              <p className="text-technical text-xs text-sand mb-4">KEY GUIDE</p>
              {KEY_GUIDE.map((group) => (
                <div key={group.section} className="mb-4 last:mb-0">
                  <p className="text-technical text-[11px] text-text-muted mb-1.5">{group.section}</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.key} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-2 text-off-white font-mono whitespace-nowrap align-top">{row.key}</td>
                          <td className="py-1.5 text-off-white/70">{row.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
