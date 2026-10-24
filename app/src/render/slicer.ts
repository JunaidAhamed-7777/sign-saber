/**
 * Sign Saber — render/slicer.ts
 *
 * Responsibility: Convex plane-cut of the cube along the swing plane; two capped halves with ballistic motion.
 * Spec: docs/11-rendering-blocks-and-destruction.md §Slice
 * Inputs: note:hit with cutPlane
 * Outputs: Half meshes
 *
 * Implemented with bounded buffers; 200 seeded geometry assertions are separate from live visual QA.
 */
import type { Plane, Vec3 } from '../core/types';
import { BLOCK_SIZE } from '../core/constants';

const CAPACITY = 128;
const PLANE_EPSILON = 1e-6,
  WELD_EPSILON_SQ = 1e-10,
  VOLUME_EPSILON = 1e-9;
/** Four outward-CCW corners per face (in half-extent units), followed by its outward normal. */
export type SlicerFaces = readonly (readonly number[])[];
const FACES: SlicerFaces = [
  [1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, 0, 0],
  [-1, -1, 1, -1, 1, 1, -1, 1, -1, -1, -1, -1, -1, 0, 0],
  [-1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1, 0, 1, 0],
  [-1, -1, 1, -1, -1, -1, 1, -1, -1, 1, -1, 1, 0, -1, 0],
  [-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, 0, 0, 1],
  [1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 0, 0, -1],
];
/**
 * The Slash target's convex rhombic prism: tips at ±1 on X and Y, half-depth `halfDepth` (both in
 * half-extent units). Same quad topology as the cube, so the bounded clipper and capacity still apply.
 */
export function diamondFaces(halfDepth: number): SlicerFaces {
  const t = halfDepth,
    s = Math.SQRT1_2,
    ring = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const,
    sides: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = ring[i]!,
      [bx, by] = ring[(i + 1) % 4]!;
    sides.push([ax, ay, -t, bx, by, -t, bx, by, t, ax, ay, t, (ax + bx) * s, (ay + by) * s, 0]);
  }
  return [
    [1, 0, t, 0, 1, t, -1, 0, t, 0, -1, t, 0, 0, 1],
    [0, -1, -t, -1, 0, -t, 0, 1, -t, 1, 0, -t, 0, 0, -1],
    ...sides,
  ];
}
export interface CutHalf {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  caps: Float32Array;
  count: number;
  bodyCount: number;
  volume: number;
  centroid: Vec3;
}
export interface CubeCut {
  positive: CutHalf;
  negative: CutHalf;
  normal: Vec3;
  fallback: boolean;
}
function half(): CutHalf {
  return {
    positions: new Float32Array(CAPACITY * 3),
    normals: new Float32Array(CAPACITY * 3),
    uvs: new Float32Array(CAPACITY * 2),
    caps: new Float32Array(CAPACITY),
    count: 0,
    bodyCount: 0,
    volume: 0,
    centroid: { x: 0, y: 0, z: 0 },
  };
}

/** A bounded convex cube clipper. All output and polygon scratch storage is owned per pool slot. */
export class CubeSlicer {
  readonly result: CubeCut = {
    positive: half(),
    negative: half(),
    normal: { x: 1, y: 0, z: 0 },
    fallback: false,
  };
  private readonly polygon = new Float64Array(24);
  private readonly caps = new Float64Array(72);
  private readonly order = new Uint8Array(24);
  private readonly angles = new Float64Array(24);
  private capCount = 0;
  constructor(
    readonly size = BLOCK_SIZE,
    private readonly faces: SlicerFaces = FACES,
  ) {
    if (!Number.isFinite(size) || size <= 0) throw new Error('Cube size must be positive.');
  }
  cut(plane: Plane): CubeCut {
    const n = this.result.normal,
      length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z);
    const valid =
      Number.isFinite(length) &&
      length > PLANE_EPSILON &&
      Number.isFinite(plane.point.x) &&
      Number.isFinite(plane.point.y) &&
      Number.isFinite(plane.point.z);
    n.x = valid ? plane.normal.x / length : 1;
    n.y = valid ? plane.normal.y / length : 0;
    n.z = valid ? plane.normal.z / length : 0;
    const distance = valid ? n.x * plane.point.x + n.y * plane.point.y + n.z * plane.point.z : 0;
    this.result.fallback = !valid;
    this.clip(distance);
    if (this.result.positive.volume < VOLUME_EPSILON || this.result.negative.volume < VOLUME_EPSILON) {
      this.result.fallback = true;
      this.clip(0);
    }
    return this.result;
  }
  private signed(x: number, y: number, z: number, d: number): number {
    const n = this.result.normal,
      s = n.x * x + n.y * y + n.z * z - d;
    return Math.abs(s) < PLANE_EPSILON ? 0 : s;
  }
  private cap(x: number, y: number, z: number): void {
    for (let i = 0; i < this.capCount; i++) {
      const at = i * 3;
      if (
        (this.caps[at]! - x) ** 2 + (this.caps[at + 1]! - y) ** 2 + (this.caps[at + 2]! - z) ** 2 <
        WELD_EPSILON_SQ
      )
        return;
    }
    const at = this.capCount++ * 3;
    this.caps[at] = x;
    this.caps[at + 1] = y;
    this.caps[at + 2] = z;
  }
  private triangle(
    out: CutHalf,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    cap: number,
  ): void {
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az,
      vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < VOLUME_EPSILON) return;
    if (out.count + 3 > CAPACITY) throw new Error('Cube cut exceeded its registered vertex capacity.');
    for (let i = 0; i < 3; i++) {
      const index = out.count++,
        at = index * 3,
        x = i === 0 ? ax : i === 1 ? bx : cx,
        y = i === 0 ? ay : i === 1 ? by : cy,
        z = i === 0 ? az : i === 1 ? bz : cz;
      out.positions[at] = x;
      out.positions[at + 1] = y;
      out.positions[at + 2] = z;
      out.normals[at] = nx;
      out.normals[at + 1] = ny;
      out.normals[at + 2] = nz;
      out.uvs[index * 2] = 0.5 + x / this.size;
      out.uvs[index * 2 + 1] = 0.5 + y / this.size;
      out.caps[index] = cap;
    }
  }
  private clip(distance: number): void {
    this.result.positive.count = this.result.negative.count = 0;
    this.capCount = 0;
    const extent = this.size / 2;
    for (const face of this.faces)
      for (let side = 0; side < 2; side++) {
        const out = side === 0 ? this.result.positive : this.result.negative;
        let count = 0;
        for (let edge = 0; edge < 4; edge++) {
          const a = edge * 3,
            b = ((edge + 1) % 4) * 3,
            ax = face[a]! * extent,
            ay = face[a + 1]! * extent,
            az = face[a + 2]! * extent,
            bx = face[b]! * extent,
            by = face[b + 1]! * extent,
            bz = face[b + 2]! * extent;
          const sa = this.signed(ax, ay, az, distance),
            sb = this.signed(bx, by, bz, distance),
            insideA = side === 0 ? sa >= 0 : sa <= 0,
            insideB = side === 0 ? sb >= 0 : sb <= 0;
          if (insideA) {
            this.polygon[count * 3] = ax;
            this.polygon[count * 3 + 1] = ay;
            this.polygon[count * 3 + 2] = az;
            count++;
            if (side === 0 && sa === 0) this.cap(ax, ay, az);
          }
          if (insideA !== insideB) {
            const t = sa / (sa - sb),
              x = ax + (bx - ax) * t,
              y = ay + (by - ay) * t,
              z = az + (bz - az) * t;
            this.polygon[count * 3] = x;
            this.polygon[count * 3 + 1] = y;
            this.polygon[count * 3 + 2] = z;
            count++;
            if (side === 0) this.cap(x, y, z);
          }
        }
        for (let i = 1; i < count - 1; i++)
          this.triangle(
            out,
            this.polygon[0]!,
            this.polygon[1]!,
            this.polygon[2]!,
            this.polygon[i * 3]!,
            this.polygon[i * 3 + 1]!,
            this.polygon[i * 3 + 2]!,
            this.polygon[(i + 1) * 3]!,
            this.polygon[(i + 1) * 3 + 1]!,
            this.polygon[(i + 1) * 3 + 2]!,
            face[12]!,
            face[13]!,
            face[14]!,
            0,
          );
      }
    this.result.positive.bodyCount = this.result.positive.count;
    this.result.negative.bodyCount = this.result.negative.count;
    const n = this.result.normal;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < this.capCount; i++) {
      cx += this.caps[i * 3]!;
      cy += this.caps[i * 3 + 1]!;
      cz += this.caps[i * 3 + 2]!;
    }
    cx /= this.capCount || 1;
    cy /= this.capCount || 1;
    cz /= this.capCount || 1;
    let tx = Math.abs(n.x) < 0.9 ? 0 : n.z,
      ty = Math.abs(n.x) < 0.9 ? -n.z : 0,
      tz = Math.abs(n.x) < 0.9 ? n.y : -n.x;
    const length = Math.hypot(tx, ty, tz);
    tx /= length;
    ty /= length;
    tz /= length;
    const bx = n.y * tz - n.z * ty,
      by = n.z * tx - n.x * tz,
      bz = n.x * ty - n.y * tx;
    for (let i = 0; i < this.capCount; i++) {
      const x = this.caps[i * 3]! - cx,
        y = this.caps[i * 3 + 1]! - cy,
        z = this.caps[i * 3 + 2]! - cz;
      this.angles[i] = Math.atan2(x * bx + y * by + z * bz, x * tx + y * ty + z * tz);
      this.order[i] = i;
    }
    for (let i = 1; i < this.capCount; i++) {
      const value = this.order[i]!;
      let j = i;
      while (j > 0 && this.angles[this.order[j - 1]!]! > this.angles[value]!) {
        this.order[j] = this.order[j - 1]!;
        j--;
      }
      this.order[j] = value;
    }
    for (let i = 0; i < this.capCount; i++) {
      const a = this.order[i]! * 3,
        b = this.order[(i + 1) % this.capCount]! * 3;
      this.triangle(
        this.result.positive,
        cx,
        cy,
        cz,
        this.caps[b]!,
        this.caps[b + 1]!,
        this.caps[b + 2]!,
        this.caps[a]!,
        this.caps[a + 1]!,
        this.caps[a + 2]!,
        -n.x,
        -n.y,
        -n.z,
        1,
      );
      this.triangle(
        this.result.negative,
        cx,
        cy,
        cz,
        this.caps[a]!,
        this.caps[a + 1]!,
        this.caps[a + 2]!,
        this.caps[b]!,
        this.caps[b + 1]!,
        this.caps[b + 2]!,
        n.x,
        n.y,
        n.z,
        1,
      );
    }
    this.measure(this.result.positive);
    this.measure(this.result.negative);
  }
  private measure(out: CutHalf): void {
    let volume = 0,
      x = 0,
      y = 0,
      z = 0;
    const p = out.positions;
    for (let i = 0; i < out.count * 3; i += 9) {
      const ax = p[i]!,
        ay = p[i + 1]!,
        az = p[i + 2]!,
        bx = p[i + 3]!,
        by = p[i + 4]!,
        bz = p[i + 5]!,
        cx = p[i + 6]!,
        cy = p[i + 7]!,
        cz = p[i + 8]!;
      const v = (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
      volume += v;
      x += ((ax + bx + cx) / 4) * v;
      y += ((ay + by + cy) / 4) * v;
      z += ((az + bz + cz) / 4) * v;
    }
    out.volume = Math.abs(volume);
    out.centroid.x = volume ? x / volume : 0;
    out.centroid.y = volume ? y / volume : 0;
    out.centroid.z = volume ? z / volume : 0;
  }
}
