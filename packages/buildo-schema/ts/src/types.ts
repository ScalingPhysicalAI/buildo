import { z } from "zod";

// Normative source: ../../spec/SCHEMA.md. Keep this file and the Python
// equivalent (../../python/buildo_schema/types.py) in lockstep with that
// doc -- the conformance test in ../../conformance is what actually proves
// they still agree, not this comment.

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Quat = z.tuple([z.number(), z.number(), z.number(), z.number()]); // w, x, y, z

export const CameraFrameSchema = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  encoding: z.enum(["rgb8", "jpeg"]),
  data: z.instanceof(Uint8Array),
});
export type CameraFrame = z.infer<typeof CameraFrameSchema>;

const BaseStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  yaw: z.number(),
  vx: z.number(),
  vy: z.number(),
  yawRate: z.number(),
});

const LiftStateSchema = z.object({
  height: z.number(),
  velocity: z.number(),
});

const ArmStateSchema = z.object({
  jointPositions: z.array(z.number()),
  eePosition: Vec3,
  eeOrientationQuat: Quat,
});

const HandStateSchema = z.object({
  fingerPositions: z.array(z.number()),
  gripClosed: z.boolean(),
});

export const BuildoObservationSchema = z.object({
  schemaVersion: z.literal("buildo-observation/1.0"),
  sequenceId: z.string(),
  timestamp: z.number(),
  instruction: z.string(),
  cameraFrames: z.array(CameraFrameSchema),
  baseState: BaseStateSchema,
  liftState: LiftStateSchema,
  leftArmState: ArmStateSchema,
  rightArmState: ArmStateSchema,
  leftHandState: HandStateSchema,
  rightHandState: HandStateSchema,
  leftTactile: z.array(z.number()).nullish(),
  rightTactile: z.array(z.number()).nullish(),
});
export type BuildoObservation = z.infer<typeof BuildoObservationSchema>;

const ActionEntrySchema = z.object({
  base: z.object({ vx: z.number(), vy: z.number(), yawRate: z.number() }),
  lift: z.object({ height: z.number() }),
  leftArm: z.object({ eePosition: Vec3, eeOrientationQuat: Quat }),
  rightArm: z.object({ eePosition: Vec3, eeOrientationQuat: Quat }),
  leftHand: z.object({ gripTarget: z.number().min(0).max(1) }),
  rightHand: z.object({ gripTarget: z.number().min(0).max(1) }),
});
export type ActionEntry = z.infer<typeof ActionEntrySchema>;

export const BuildoActionChunkSchema = z.object({
  schemaVersion: z.literal("buildo-action-chunk/1.0"),
  sequenceId: z.string(),
  modelVersion: z.string(),
  actionStartTime: z.number(),
  actionDt: z.number().positive(),
  actions: z.array(ActionEntrySchema),
});
export type BuildoActionChunk = z.infer<typeof BuildoActionChunkSchema>;
