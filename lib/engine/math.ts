import type { TileBasis, Vec3 } from "@/lib/magnetic-tiles/types";

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function add(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

export function subtract(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

export function scale(point: Vec3, amount: number): Vec3 {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

export function dot(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

export function cross(first: Vec3, second: Vec3): Vec3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x
  };
}

export function magnitude(point: Vec3): number {
  return Math.sqrt(dot(point, point));
}

export function distance(first: Vec3, second: Vec3): number {
  return magnitude(subtract(first, second));
}

export function normalize(point: Vec3): Vec3 {
  const length = magnitude(point);
  if (length <= 0.000001) return { x: 0, y: 0, z: 0 };
  return scale(point, 1 / length);
}

export function midpoint(first: Vec3, second: Vec3): Vec3 {
  return scale(add(first, second), 0.5);
}

export function transformLocal(point: Vec3, origin: Vec3, basis: TileBasis): Vec3 {
  return add(add(scale(basis.xAxis, point.x), scale(basis.yAxis, point.y)), add(scale(basis.zAxis, point.z), origin));
}

export function worldToLocal(point: Vec3, origin: Vec3, basis: TileBasis): Vec3 {
  const relative = subtract(point, origin);
  return {
    x: dot(relative, basis.xAxis),
    y: dot(relative, basis.yAxis),
    z: dot(relative, basis.zAxis)
  };
}

export function basisToQuaternion(basis: TileBasis): Quat {
  const m00 = basis.xAxis.x;
  const m01 = basis.yAxis.x;
  const m02 = basis.zAxis.x;
  const m10 = basis.xAxis.y;
  const m11 = basis.yAxis.y;
  const m12 = basis.zAxis.y;
  const m20 = basis.xAxis.z;
  const m21 = basis.yAxis.z;
  const m22 = basis.zAxis.z;
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return normalizeQuaternion({
      w: 0.25 * s,
      x: (m21 - m12) / s,
      y: (m02 - m20) / s,
      z: (m10 - m01) / s
    });
  }

  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuaternion({
      w: (m21 - m12) / s,
      x: 0.25 * s,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s
    });
  }

  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuaternion({
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: 0.25 * s,
      z: (m12 + m21) / s
    });
  }

  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuaternion({
    w: (m10 - m01) / s,
    x: (m02 + m20) / s,
    y: (m12 + m21) / s,
    z: 0.25 * s
  });
}

export function quaternionToBasis(rotation: Quat): TileBasis {
  const q = normalizeQuaternion(rotation);
  const xx = q.x * q.x;
  const yy = q.y * q.y;
  const zz = q.z * q.z;
  const xy = q.x * q.y;
  const xz = q.x * q.z;
  const yz = q.y * q.z;
  const wx = q.w * q.x;
  const wy = q.w * q.y;
  const wz = q.w * q.z;

  return {
    xAxis: {
      x: 1 - 2 * (yy + zz),
      y: 2 * (xy + wz),
      z: 2 * (xz - wy)
    },
    yAxis: {
      x: 2 * (xy - wz),
      y: 1 - 2 * (xx + zz),
      z: 2 * (yz + wx)
    },
    zAxis: {
      x: 2 * (xz + wy),
      y: 2 * (yz - wx),
      z: 1 - 2 * (xx + yy)
    }
  };
}

function normalizeQuaternion(rotation: Quat): Quat {
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (length <= 0.000001) return { x: 0, y: 0, z: 0, w: 1 };
  return {
    x: rotation.x / length,
    y: rotation.y / length,
    z: rotation.z / length,
    w: rotation.w / length
  };
}
