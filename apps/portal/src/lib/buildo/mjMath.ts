// Small vector/quaternion/linear-algebra helpers for applyActionChunk.ts.
//
// Not calling @mujoco/mujoco's own mju_* functions (mju_mat2Quat,
// mju_jacSite, etc.) -- verified directly (see this repo's Phase 4 notes)
// that this WASM build's embind bindings copy array arguments into C++ by
// value and never write results back into them, so any function whose
// *output* is one of its array parameters (mj_jacSite included) is a
// silent no-op through this API. MujocoViewer.tsx hit the same wall
// earlier and already carries its own hand-written mat3ToQuat for exactly
// this reason (see that function's own comment) -- this file is that same
// approach, generalized to the rest of what differential IK needs.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // w, x, y, z, matching MuJoCo's convention

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function vecScale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecNorm(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

/** m is a row-major 3x3 matrix starting at m[base..base+9). */
export function mat3MulVec3(m: ArrayLike<number>, base: number, v: Vec3): Vec3 {
  return [
    m[base + 0] * v[0] + m[base + 1] * v[1] + m[base + 2] * v[2],
    m[base + 3] * v[0] + m[base + 4] * v[1] + m[base + 5] * v[2],
    m[base + 6] * v[0] + m[base + 7] * v[1] + m[base + 8] * v[2],
  ];
}

/** Same algorithm as MujocoViewer.tsx's mat3ToQuat (duplicated, not
 * imported -- see this file's own header comment on why). */
export function mat3ToQuat(m: ArrayLike<number>, base: number): Quat {
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

export function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** Conjugate == inverse for a unit quaternion. */
export function quatConj(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

/** Log map: a unit quaternion representing a small rotation -> its
 * axis*angle rotation vector. Equivalent to mju_quat2Vel(res, q, 1.0). */
export function quatToRotVec(q: Quat): Vec3 {
  const w = Math.max(-1, Math.min(1, q[0]));
  const xyz: Vec3 = [q[1], q[2], q[3]];
  const s = vecNorm(xyz);
  if (s < 1e-9) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, w);
  return vecScale(xyz, angle / s);
}

/** Gaussian elimination with partial pivoting for a 6x6 system -- the only
 * size differential IK's damped-least-squares step needs (J J^T is always
 * 6x6, one row/col per position+rotation error component). */
export function solveLinear6(A: number[][], b: number[]): number[] {
  const n = 6;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pivotVal = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pivotVal;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
