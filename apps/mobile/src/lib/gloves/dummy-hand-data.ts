// Synthetic WireHandPacket generator -- NOT real telemetry. Lets the hand
// rig in GloveHandView be demoed/tested with no physical glove connected,
// by producing packets in the exact same shape a real one sends (same slot
// order, same struct, per PROTOCOL_GLOVES_UPDATED.md §4) so the view needs
// zero demo-specific branches: it can't tell this apart from a real
// packet, and callers must make clear in the UI that this is dummy data.
import type { WireFsrFinger, WireHandPacket, WireImuSample } from "./protocol";

function axisAngleQuat(angleRad: number): { w: number; x: number; y: number; z: number } {
  // Fixed axis (1,0,0) -- GloveHandView's own curl math only ever reads
  // the unsigned rotation *magnitude* back out (2*acos(|w|)), so which
  // axis we pick here doesn't change what's rendered, only picking one
  // keeps this simple.
  const half = angleRad / 2;
  return { w: Math.cos(half), x: Math.sin(half), y: 0, z: 0 };
}

const DEG = Math.PI / 180;

// One finger curls, then releases, then waits out the rest of its period --
// a half-sine pulse -- staggered per finger index so they visibly wave in
// sequence (thumb -> index -> middle -> ring -> pinky) rather than all
// moving in lockstep, which would look like one rigid block, not a hand.
function curlFactor(elapsedS: number, fingerIndex: number, periodS: number, staggerS: number): number {
  const phase = elapsedS - fingerIndex * staggerS;
  return Math.max(0, Math.sin((2 * Math.PI * phase) / periodS));
}

const FINGER_MAX_PROXIMAL_DEG = 60;
const FINGER_MAX_DISTAL_DEG = 85;
const PERIOD_S = 2;
const STAGGER_S = 0.3;

function imuSample(angleRad: number, accuracy: number): WireImuSample {
  const q = axisAngleQuat(angleRad);
  return { present: true, w: q.w, x: q.x, y: q.y, z: q.z, accuracy };
}

function fsrFinger(pressureLevel: number): WireFsrFinger {
  // Six raw-ADC-shaped channels, rising together with curl like a
  // fingertip actually pressing harder, plus a small fixed per-channel
  // offset so they're not all identical -- deterministic, not random, so
  // the demo is reproducible run to run.
  const base = 200 + pressureLevel * 1400;
  const channels: WireFsrFinger["channels"] = [0, 1, 2, 3, 4, 5].map((i) => Math.round(base + i * 35)) as WireFsrFinger["channels"];
  return { present: true, buttons: 0, channels };
}

export function generateDummyHandPacket(elapsedMs: number, seq: number): WireHandPacket {
  const t = elapsedMs / 1000;

  const fingerCurls = [0, 1, 2, 3, 4].map((i) => curlFactor(t, i, PERIOD_S, STAGGER_S));

  // Slot order per protocol.ts: 0,1=thumb 2,3=index 4,5=middle 6,7=ring
  // 8,9=pinky 10=palm 11=wrist.
  const imu: WireImuSample[] = [];
  for (const factor of fingerCurls) {
    imu.push(imuSample(factor * FINGER_MAX_PROXIMAL_DEG * DEG, 3));
    imu.push(imuSample(factor * FINGER_MAX_DISTAL_DEG * DEG, 3));
  }
  const palmAngle = 10 * DEG * Math.sin((2 * Math.PI * t) / 4);
  const wristAngle = 6 * DEG * Math.sin((2 * Math.PI * t) / 4 + Math.PI / 4);
  imu.push(imuSample(palmAngle, 3)); // slot 10: palm
  imu.push(imuSample(wristAngle, 3)); // slot 11: wrist

  const fsr: WireFsrFinger[] = fingerCurls.map((factor) => fsrFinger(factor));

  return { bootId: 1, seq, assembledAtMs: elapsedMs, imu, fsr };
}
