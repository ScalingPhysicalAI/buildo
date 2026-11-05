// Live 2D glove-shaped visualization of one glove's hand, from real
// WireHandPacket data (TCP 5008, §4 of PROTOCOL_GLOVES_UPDATED.md) --
// debug screen only, mirrors the pitch-only forward-kinematics approach of
// this project's own Python reference dashboard (tools/dashboard.py /
// dashboard.html, not shipped in this repo): parse the quaternions
// directly, build a wrist -> palm -> per-finger bone chain, and drive each
// bone's bend from a calibrated rest pose rather than the sensor's raw
// absolute orientation.
//
// Shape and sensor-puck layout are modeled on the real product photo used
// on the gadgets order screen (apps/mobile/src/app/gadgets/order.tsx's own
// "Teleoperation gloves" image, buildo-kit-gloves.png): a two-tone
// glove -- gray finger fabric, solid black back-of-hand + wrist cuff --
// with a round sensor puck on each of the two fabric panels per finger.
// Each puck here maps 1:1 to one of the packet's 12 IMU slots (2 per
// finger x 5, plus palm, plus wrist), so what's drawn is literally where
// each sensor sits on the real hardware, not an abstract skeleton.
//
// Deliberately 2D, not a full 3D quaternion render: this app has no
// WebGL/Three.js dependency, and adding one is a native-module decision
// this task wasn't asked to make. A flat, unsigned "curl amount" per joint
// is enough to see live finger/palm motion on the debug screen.
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

import type { WireHandPacket, WireImuSample } from "../lib/gloves/protocol";
import { colors, fonts, radii, spacing } from "../theme";
import { Button } from "./Button";

interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

function invertQuat(q: Quat): Quat {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

// Unsigned rotation magnitude between a captured rest pose and the current
// sample, in radians -- delta = inverse(rest) * current, same math as the
// Python reference dashboard, then just the angle part of that delta
// (2*acos(|w|)) rather than a signed per-axis angle.
//
// Deliberately unsigned: PROTOCOL_GLOVES_UPDATED.md never documents how
// each BNO08x is mounted relative to the finger it's strapped to, so there
// is no honest way to know which sign of which axis means "curling toward
// the palm" for a given slot. Fingers only mechanically curl one direction
// from straight, so treating this as a curl *amount* and always bending
// the on-screen joint the same way is the right simplification here, not a
// guess at an undocumented convention.
function curlRadians(rest: Quat, current: Quat): number {
  const delta = multiplyQuat(invertQuat(rest), current);
  const w = Math.min(1, Math.max(-1, Math.abs(delta.w)));
  return 2 * Math.acos(w);
}

const MAX_CURL_RAD = (100 * Math.PI) / 180; // clamp -- noisy data shouldn't fold a bone past a real fingertip curl

function clampCurl(rad: number): number {
  return Math.min(MAX_CURL_RAD, Math.max(0, rad));
}

// accuracy is BNO08x's own 0-3 fusion-confidence field (§4) -- 0 right
// after a mag disturbance or before the filter settles, 3 once it's fully
// converged. It's a fact about the sensor itself, not about our rest-pose
// calibration, so it's shown on a puck as soon as that slot is present --
// it doesn't wait for Calibrate the way bend angle does.
const ACCURACY_RING_COLOR = ["#DC2626", "#F97316", "#EAB308", "#16A34A"];

// Two-tone, matching the real glove photo: dark fabric on the fingers,
// solid near-black on the back of the hand and the wrist cuff.
const PALM_COLOR = colors.black;
const FINGER_FABRIC_COLOR = "#3A3630";
const UNCALIBRATED_COLOR = colors.textMuted;
const NO_SENSOR_COLOR = "#B8B2A6";
const PUCK_COLOR = "#0D0D0D";
const SEAM_COLOR = "rgba(255,255,255,0.14)";

// Slot order per PROTOCOL_GLOVES_UPDATED.md §4 / protocol.ts's own comment:
// 0,1=thumb(proximal,distal) 2,3=index 4,5=middle 6,7=ring 8,9=pinky
// 10=palm 11=wrist. FSR order: thumb, index, middle, ring, pinky.
interface FingerSpec {
  name: string;
  proximalSlot: number;
  distalSlot: number;
  fsrIndex: number;
  anchorX: number;
  anchorY: number;
  baseAngleDeg: number; // 0 = pointing straight up from the anchor
  proximalLen: number;
  distalLen: number;
  proximalThickness: number;
  distalThickness: number;
  // +1 or -1: which way curl rotates this finger's angle so it ends up
  // swinging toward the wrist (down, ~180 in bonePoint's convention) as it
  // closes, not away from it. The four fingers all curl the same
  // direction; the thumb opposes them (its baseAngleDeg sits on the other
  // side of "straight up" from the rest), same as how a thumb opposes the
  // fingers when a real hand closes into a fist -- without this, adding
  // curl the same way for every slot swung the thumb outward instead of
  // in.
  curlSign: 1 | -1;
}

const WRIST_SLOT = 11;
const PALM_SLOT = 10;
const WRIST_POINT = { x: 150, y: 312 };

// Anchors sit along the palm shape's own top/side edge (see PALM_PATH
// below) and converge slightly toward the centerline, same as real
// fingers fanning out from a palm rather than four parallel rods.
const FINGERS: FingerSpec[] = [
  {
    name: "thumb",
    proximalSlot: 0,
    distalSlot: 1,
    fsrIndex: 0,
    anchorX: 92,
    anchorY: 214,
    baseAngleDeg: -48,
    proximalLen: 30,
    distalLen: 22,
    proximalThickness: 26,
    distalThickness: 20,
    curlSign: -1,
  },
  {
    name: "index",
    proximalSlot: 2,
    distalSlot: 3,
    fsrIndex: 1,
    anchorX: 128,
    anchorY: 158,
    baseAngleDeg: -7,
    proximalLen: 38,
    distalLen: 26,
    proximalThickness: 23,
    distalThickness: 18,
    curlSign: 1,
  },
  {
    name: "middle",
    proximalSlot: 4,
    distalSlot: 5,
    fsrIndex: 2,
    anchorX: 150,
    anchorY: 146,
    baseAngleDeg: 0,
    proximalLen: 44,
    distalLen: 30,
    proximalThickness: 25,
    distalThickness: 19,
    curlSign: 1,
  },
  {
    name: "ring",
    proximalSlot: 6,
    distalSlot: 7,
    fsrIndex: 3,
    anchorX: 172,
    anchorY: 158,
    baseAngleDeg: 7,
    proximalLen: 39,
    distalLen: 27,
    proximalThickness: 22,
    distalThickness: 17,
    curlSign: 1,
  },
  {
    name: "pinky",
    proximalSlot: 8,
    distalSlot: 9,
    fsrIndex: 4,
    anchorX: 191,
    anchorY: 176,
    baseAngleDeg: 16,
    proximalLen: 30,
    distalLen: 20,
    proximalThickness: 18,
    distalThickness: 14,
    curlSign: 1,
  },
];

// A compact, rounded palm/back-of-hand silhouette with a scalloped top
// edge that rises under each finger and dips in the webbing between them
// -- and a bulge on the left (the thenar area) the thumb anchors into --
// so fingers read as part of one continuous hand, not separate rods
// glued onto a box. Must move together with FINGERS' own anchors above if
// either changes.
const PALM_PATH =
  "M100,178 Q110,150 128,148 Q140,165 150,146 Q162,165 172,148 " +
  "Q184,162 191,172 Q198,180 198,190 L200,276 " +
  "Q200,300 180,308 Q165,312 150,312 Q135,312 120,308 Q100,300 100,276 " +
  "Q86,250 90,214 Q92,195 100,178 Z";

// The glove's cuff -- the photo's wrist band below the palm -- flares
// slightly and sits just past WRIST_POINT, with one lighter stitch line
// near its top edge echoing the real product's seam there.
const CUFF_PATH = "M118,300 C118,296 128,293 150,293 C172,293 182,296 182,300 L186,330 C186,336 170,340 150,340 C130,340 114,336 114,330 Z";
const CUFF_SEAM = { x1: 116, y1: 306, x2: 184, y2: 306 };

interface Calibration {
  imuRest: (Quat | null)[]; // index = IMU slot 0-11, null = wasn't present at calibration time
  fsrBaseline: number[]; // per finger (0-4), max raw ADC channel at calibration time
}

function toQuat(sample: WireImuSample): Quat {
  return { w: sample.w, x: sample.x, y: sample.y, z: sample.z };
}

function captureCalibration(packet: WireHandPacket): Calibration {
  return {
    imuRest: packet.imu.map((s) => (s.present ? toQuat(s) : null)),
    fsrBaseline: packet.fsr.map((f) => (f.present ? Math.max(...f.channels) : 0)),
  };
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// One rigid bone: a line from (x,y) at `angleDeg`, `len` long, returning
// its own end point for the next bone in the chain to continue from
// (standard forward kinematics -- a child bone's rotation is relative to
// where its parent ended up, not to the world).
function bonePoint(x: number, y: number, angleDeg: number, len: number) {
  const rad = (angleDeg * Math.PI) / 180;
  // SVG y grows downward; angleDeg 0 means "straight up" (-y).
  return { x: x + len * Math.sin(rad), y: y - len * Math.cos(rad) };
}

// The finger fabric's own fill: the glove's real fabric tone once there's
// a trustworthy, calibrated bend reading; gray while there isn't.
function fingerFill(present: boolean, calibrated: boolean): string {
  if (!present) return NO_SENSOR_COLOR;
  if (!calibrated) return UNCALIBRATED_COLOR;
  return FINGER_FABRIC_COLOR;
}

// A sensor puck, drawn at its real position on the glove: filled + a
// confidence ring once that slot is reporting, hollow if the sensor isn't
// even present. Independent of calibration -- accuracy is the sensor's own
// fact, not ours.
function PuckMarker({ at, present, accuracy }: { at: { x: number; y: number }; present: boolean; accuracy: number }) {
  if (!present) {
    return <Circle cx={at.x} cy={at.y} r={6} fill="none" stroke={NO_SENSOR_COLOR} strokeWidth={1.5} strokeDasharray="2,2" />;
  }
  return (
    <G>
      <Circle cx={at.x} cy={at.y} r={6} fill={PUCK_COLOR} />
      <Circle
        cx={at.x}
        cy={at.y}
        r={8}
        fill="none"
        stroke={ACCURACY_RING_COLOR[Math.max(0, Math.min(3, accuracy))]}
        strokeWidth={1.75}
      />
    </G>
  );
}

// A single rigid, rounded capsule from `from` to `to` -- react-native-svg
// has no "line with thickness and rounded ends that isn't a <Line>" of its
// own, so this draws a horizontal rounded Rect of the right length and
// rotates it into place around its own start point, rather than fighting
// with Line's lack of width-driven rounding.
function Capsule({ from, to, thickness, fill }: { from: { x: number; y: number }; to: { x: number; y: number }; thickness: number; fill: string }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <G rotation={angleDeg} origin={`${from.x}, ${from.y}`}>
      <Rect x={from.x} y={from.y - thickness / 2} width={length} height={thickness} rx={thickness / 2} fill={fill} />
    </G>
  );
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function GloveHandView({
  packet,
  autoCalibrate = false,
  handedness = "right",
  compact = false,
  label,
}: {
  packet: WireHandPacket | null;
  // For a dummy-data preview, not real hardware: its very first frame is
  // defined to already be the "straight" rest pose, so there's nothing
  // for a human to physically hold flat before tapping Calibrate the way
  // there is with a real glove -- capture rest from the first packet
  // automatically instead of waiting for the button.
  autoCalibrate?: boolean;
  // The glove protocol itself carries no handedness field -- this just
  // mirrors the same drawing horizontally so the same single hand design
  // can stand in for either one. Not tied to which physical glove the
  // packet came from (there's no way to know that from the wire data).
  handedness?: "left" | "right";
  // Hides the per-instance header/legend so two of these can sit side by
  // side (left + right) under one shared caption instead of each dragging
  // its own copy along.
  compact?: boolean;
  label?: string;
}) {
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const autoCalibratedRef = useRef(false);

  useEffect(() => {
    if (autoCalibrate && packet && !autoCalibratedRef.current) {
      autoCalibratedRef.current = true;
      setCalibration(captureCalibration(packet));
    }
  }, [autoCalibrate, packet]);

  function onCalibrate() {
    if (packet) setCalibration(captureCalibration(packet));
  }

  // Palm (§4 slot 10) and wrist (slot 11) drive the whole hand's tilt, not
  // a finger's curl -- rotate every finger's anchor along with it (same
  // forward-kinematics idea as a finger's own proximal/distal chain, just
  // one level further up: wrist is the root everything else hangs off).
  const handRoot = useMemo(() => {
    const palmSample = packet?.imu[PALM_SLOT] ?? null;
    const wristSample = packet?.imu[WRIST_SLOT] ?? null;
    let tiltDeg = 0;
    if (packet && calibration) {
      const palmRest = calibration.imuRest[PALM_SLOT];
      const wristRest = calibration.imuRest[WRIST_SLOT];
      const palmDeg = palmSample?.present && palmRest ? deg(clampCurl(curlRadians(palmRest, toQuat(palmSample)))) : 0;
      const wristDeg = wristSample?.present && wristRest ? deg(clampCurl(curlRadians(wristRest, toQuat(wristSample)))) : 0;
      tiltDeg = Math.min(45, palmDeg * 0.6 + wristDeg * 0.4);
    }
    return {
      tiltDeg,
      palmPresent: palmSample?.present ?? false,
      palmAccuracy: palmSample?.accuracy ?? 0,
      wristPresent: wristSample?.present ?? false,
      wristAccuracy: wristSample?.accuracy ?? 0,
    };
  }, [packet, calibration]);

  const fingerGeometry = useMemo(() => {
    if (!packet) return null;
    return FINGERS.map((finger) => {
      const proximalSample = packet.imu[finger.proximalSlot];
      const distalSample = packet.imu[finger.distalSlot];
      const proximalRest = calibration?.imuRest[finger.proximalSlot] ?? null;
      const distalRest = calibration?.imuRest[finger.distalSlot] ?? null;

      const proximalCurlDeg =
        proximalSample.present && proximalRest ? deg(clampCurl(curlRadians(proximalRest, toQuat(proximalSample)))) : 0;
      const distalCurlDeg =
        distalSample.present && distalRest ? deg(clampCurl(curlRadians(distalRest, toQuat(distalSample)))) : 0;

      // finger.curlSign points every finger's bend toward the wrist as it
      // closes (see FingerSpec's own comment on why the thumb's sign is
      // opposite the other four) -- curlRadians itself still only gives an
      // unsigned magnitude (see its own comment on why), curlSign is what
      // turns that magnitude into "toward the palm" for this finger.
      const proximalAngle = finger.baseAngleDeg + finger.curlSign * proximalCurlDeg;
      const distalAngle = proximalAngle + finger.curlSign * distalCurlDeg;

      const anchor = { x: finger.anchorX, y: finger.anchorY };
      const mid = bonePoint(finger.anchorX, finger.anchorY, proximalAngle, finger.proximalLen);
      const tip = bonePoint(mid.x, mid.y, distalAngle, finger.distalLen);

      const fsr = packet.fsr[finger.fsrIndex];
      const pressure = fsr.present ? Math.max(...fsr.channels) : 0;
      const baseline = calibration?.fsrBaseline[finger.fsrIndex] ?? null;
      const pressureDelta = baseline != null ? Math.max(0, pressure - baseline) : 0;

      return {
        finger,
        anchor,
        mid,
        tip,
        proximalFill: fingerFill(proximalSample.present, !!calibration),
        distalFill: fingerFill(distalSample.present, !!calibration),
        proximalAngle,
        distalAngle,
        // Pucks sit at the midpoint of each fabric panel, same as the real
        // glove photo -- not at the joints.
        proximalPuck: lerp(anchor, mid, 0.5),
        distalPuck: lerp(mid, tip, 0.55),
        proximalPresent: proximalSample.present,
        distalPresent: distalSample.present,
        proximalAccuracy: proximalSample.accuracy,
        distalAccuracy: distalSample.accuracy,
        fsrPresent: fsr.present,
        pressureOpacity: baseline != null ? Math.min(1, 0.2 + pressureDelta / 1200) : 0,
      };
    });
  }, [packet, calibration]);

  return (
    <View>
      {compact ? null : (
        <View style={styles.header}>
          <Text style={styles.hint}>
            {calibration
              ? "Calibrated -- the colored ring at each fingertip is IMU fusion confidence, the gold halo is fingertip pressure."
              : autoCalibrate
                ? "Calibrating from the first dummy frame…"
                : "Hold the hand flat, then calibrate -- bend amount is relative to a rest pose, not the sensor's raw orientation."}
          </Text>
          {autoCalibrate ? null : (
            <Button label="Calibrate (rest pose)" variant="secondary" disabled={!packet} onPress={onCalibrate} style={styles.calibrateBtn} />
          )}
        </View>
      )}

      {label ? <Text style={styles.handLabel}>{label}</Text> : null}

      {!packet ? (
        <Text style={styles.hint}>No hand packets yet -- start recording with the glove connected to see it move.</Text>
      ) : (
        <View style={styles.svgCard}>
          <Svg width="100%" height={compact ? 220 : 300} viewBox="0 0 300 350">
            {/* The protocol carries no handedness -- this is purely a
                horizontal mirror of the same drawing around the hand's own
                centerline, standing in for "the other hand" until there are
                two real gloves to tell them apart by. */}
            <G scaleX={handedness === "left" ? -1 : 1} origin="150, 0">
              <G rotation={handRoot.tiltDeg} origin={`${WRIST_POINT.x}, ${WRIST_POINT.y}`}>
                <Path d={CUFF_PATH} fill={PALM_COLOR} />
                <Rect x={CUFF_SEAM.x1} y={CUFF_SEAM.y1 - 1} width={CUFF_SEAM.x2 - CUFF_SEAM.x1} height={2} fill={SEAM_COLOR} />
                <Path d={PALM_PATH} fill={PALM_COLOR} />
                <PuckMarker at={{ x: 150, y: 225 }} present={handRoot.palmPresent} accuracy={handRoot.palmAccuracy} />
                <PuckMarker at={WRIST_POINT} present={handRoot.wristPresent} accuracy={handRoot.wristAccuracy} />

                {fingerGeometry?.map(
                  ({
                    finger,
                    anchor,
                    mid,
                    tip,
                    proximalFill,
                    distalFill,
                    proximalPuck,
                    distalPuck,
                    proximalPresent,
                    distalPresent,
                    proximalAccuracy,
                    distalAccuracy,
                    fsrPresent,
                    pressureOpacity,
                  }) => (
                    <G key={finger.name}>
                      <Capsule from={anchor} to={mid} thickness={finger.proximalThickness} fill={proximalFill} />
                      <Capsule from={mid} to={tip} thickness={finger.distalThickness} fill={distalFill} />
                      {/* Blends each bone's own round cap into the palm and
                          into the next segment, so a finger reads as one
                          continuous shape rather than separate rods -- no
                          seam line between phalanges, same as real skin. */}
                      <Circle cx={anchor.x} cy={anchor.y} r={finger.proximalThickness / 2} fill={proximalFill} />
                      <Circle cx={mid.x} cy={mid.y} r={Math.max(finger.proximalThickness, finger.distalThickness) / 2} fill={proximalFill} />
                      <Circle cx={tip.x} cy={tip.y} r={finger.distalThickness / 2 + 1} fill={distalFill} />
                      {fsrPresent && pressureOpacity > 0 ? (
                        <Circle
                          cx={tip.x}
                          cy={tip.y}
                          r={finger.distalThickness / 2 + 7}
                          fill="none"
                          stroke={colors.sandDark}
                          strokeWidth={3}
                          opacity={pressureOpacity}
                        />
                      ) : null}
                      <PuckMarker at={proximalPuck} present={proximalPresent} accuracy={proximalAccuracy} />
                      <PuckMarker at={distalPuck} present={distalPresent} accuracy={distalAccuracy} />
                    </G>
                  )
                )}
              </G>
            </G>
          </Svg>
        </View>
      )}

      {packet && !compact ? (
        <View style={styles.legendRow}>
          <LegendDot color={PALM_COLOR} label="Back of hand / cuff" />
          <LegendDot color={FINGER_FABRIC_COLOR} label="Finger (calibrated)" />
          <LegendDot color={UNCALIBRATED_COLOR} label="Not calibrated yet" />
          <LegendDot color={PUCK_COLOR} label="Sensor puck (1 per IMU)" />
          <LegendDot color={ACCURACY_RING_COLOR[3]} label="Ring = fusion confidence" />
          <LegendDot color={colors.sandDark} label="Halo = fingertip pressure" />
        </View>
      ) : null}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  hint: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  calibrateBtn: {
    minHeight: 40,
    paddingVertical: 10,
  },
  handLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: 4,
    textAlign: "center",
  },
  svgCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: radii.sm / 2,
  },
  legendLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
  },
});
