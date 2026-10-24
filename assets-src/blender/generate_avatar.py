"""Original MIT upper-body avatar, executed through the official Blender MCP bridge.

Head, neck, torso to a closed hip finish, arms and five-digit hands. No legs are modelled.
Shapes are signed-distance primitives (smooth unions/subtractions) polygonised with
surface nets, projected back onto the field, smoothed, decimated and rigged. Authoring
coordinates are game/glTF axes (X = avatar left, Y up, Z toward the viewer, metres); the
`to_blender` adapter maps them to Blender +Z-up. Deterministic: no random input.

Set SIGN_SABER_AVATAR_MODE = 'shape' before executing to stop after meshing (preview
iteration); the default 'export' also rigs, weights, exports the GLB and writes the manifest.
"""
import bpy
import bmesh
import hashlib
import json
import math
import pathlib
from datetime import datetime, timezone

import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

MODE = globals().get('SIGN_SABER_AVATAR_MODE', 'export')
SOURCE = pathlib.Path(bpy.data.filepath).resolve()
if SOURCE.name != 'signsaber_avatar.blend' or not bpy.context.scene.get('sign_saber_asset_session'):
    raise RuntimeError('Refusing to alter any scene except the dedicated Sign Saber avatar authoring file')
ROOT = SOURCE.parents[2]
OUT = ROOT / 'app' / 'public' / 'assets' / 'models'
TAG = 'sign_saber_avatar_owned'
RIG_VERSION = 1

# ---------------------------------------------------------------------------------------
# Clean previous generated data (only objects/data carrying our tag).
for obj in list(bpy.data.objects):
    if obj.get(TAG):
        bpy.data.objects.remove(obj, do_unlink=True)
for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
    for data in list(collection):
        if data.get(TAG) and data.users == 0:
            collection.remove(data)


def to_blender(p):
    return (float(p[0]), float(-p[2]), float(p[1]))


def v3(*a):
    return np.array(a, dtype=np.float64)


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


# ---------------------------------------------------------------------------------------
# Anatomy (game axes, metres, origin = midpoint of the hip joints).
ARM_ANGLE_DEG = 48.0  # A-pose: arm angle from the downward vertical
THETA = math.radians(ARM_ANGLE_DEG)
ARM_DIR = {'L': v3(math.sin(THETA), -math.cos(THETA), 0.0), 'R': v3(-math.sin(THETA), -math.cos(THETA), 0.0)}
SIDE_SIGN = {'L': 1.0, 'R': -1.0}
SHOULDER = {s: v3(0.185 * SIDE_SIGN[s], 0.505, -0.008) for s in 'LR'}
UPPER_ARM_LEN, FOREARM_LEN = 0.285, 0.255
ELBOW = {s: SHOULDER[s] + UPPER_ARM_LEN * ARM_DIR[s] for s in 'LR'}
WRIST = {s: ELBOW[s] + FOREARM_LEN * ARM_DIR[s] for s in 'LR'}
HIP_JOINT = {s: v3(0.095 * SIDE_SIGN[s], 0.0, 0.0) for s in 'LR'}
HIP_CUT_Y = -0.062
NECK_CUT_Y = 0.588
SLEEVE_CUT = 0.012  # sleeve ends this far before the wrist joint


def hand_frame(side):
    """Axes of the rest hand: a = toward fingers, t = thumb side (front), n = palmar normal."""
    a = ARM_DIR[side]
    t = v3(0, 0, 1)
    n = np.cross(a, t) if side == 'L' else np.cross(t, a)
    return a, t, unit(n)


# Fingers: (name, MCP offset along a, MCP offset along t, spread deg toward t, segment lengths, radii)
FINGERS = [
    ('index', 0.092, 0.027, 6.0, (0.041, 0.025, 0.021), (0.0092, 0.0085, 0.0076, 0.0065)),
    ('middle', 0.096, 0.008, 1.5, (0.046, 0.029, 0.022), (0.0096, 0.0089, 0.0079, 0.0067)),
    ('ring', 0.092, -0.0115, -3.5, (0.043, 0.027, 0.021), (0.0090, 0.0083, 0.0074, 0.0064)),
    ('pinky', 0.083, -0.030, -9.0, (0.034, 0.020, 0.019), (0.0080, 0.0073, 0.0066, 0.0058)),
]
THUMB_LENGTHS = (0.046, 0.033, 0.028)
THUMB_RADII = (0.0150, 0.0118, 0.0106, 0.0090)


def rotate_toward(v, toward, deg):
    v = unit(v)
    w = unit(toward - np.dot(toward, v) * v)
    r = math.radians(deg)
    return unit(math.cos(r) * v + math.sin(r) * w)


def hand_joints(side):
    """Rest joint centres for one hand: dict name -> list of points (base..tip)."""
    a, t, n = hand_frame(side)
    w = WRIST[side]
    out = {}
    for name, along, across, spread, lengths, _ in FINGERS:
        d = rotate_toward(a, t, spread)
        p = w + along * a + across * t - 0.001 * n
        pts = [p]
        for length in lengths:
            p = p + length * d
            pts.append(p)
        out[name] = pts
    # Thumb from the carpometacarpal joint, opposed forward and toward the palm.
    base = w + 0.024 * a + 0.019 * t + 0.007 * n
    d = unit(math.cos(math.radians(27)) * a + math.sin(math.radians(27)) * t + 0.42 * n)
    pts = [base]
    p = base
    for i, length in enumerate(THUMB_LENGTHS):
        p = p + length * d
        pts.append(p)
        d = rotate_toward(d, a, 9.0)
    out['thumb'] = pts
    return out


HAND_JOINTS = {s: hand_joints(s) for s in 'LR'}

# ---------------------------------------------------------------------------------------
# Signed-distance primitives (vectorised over (N, 3) point arrays).
TRUNC = 0.03


class Prim:
    def __init__(self, fn, lo=None, hi=None, grid=None):
        self.fn, self.grid = fn, grid
        self.lo = None if lo is None else np.asarray(lo, dtype=np.float64)
        self.hi = None if hi is None else np.asarray(hi, dtype=np.float64)


def _len(v):
    return np.sqrt(np.einsum('ij,ij->i', v, v))


def ellipsoid(c, r, axes=None):
    c = np.asarray(c, dtype=np.float64)
    r = np.asarray(r, dtype=np.float64)
    R = np.eye(3) if axes is None else np.array([unit(x) for x in axes])

    def fn(p):
        q = ((p - c) @ R.T) / r
        k0 = _len(q)
        k1 = _len(q / r)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)

    ext = np.abs(R.T) @ r
    return Prim(fn, c - ext, c + ext)


def round_cone(a, b, ra, rb):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    ba = b - a
    l2 = float(ba @ ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1.0 / l2

    def fn(p):
        pa = p - a
        y = pa @ ba
        z = y - l2
        xv = pa * l2 - y[:, None] * ba
        x2 = np.einsum('ij,ij->i', xv, xv)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d_end = np.sqrt(x2 + z2) * il2 - rb
        d_start = np.sqrt(x2 + y2) * il2 - ra
        d_side = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - ra
        return np.where(np.sign(z) * a2 * z2 > k, d_end, np.where(np.sign(y) * a2 * y2 < k, d_start, d_side))

    m = max(ra, rb)
    return Prim(fn, np.minimum(a, b) - m, np.maximum(a, b) + m)


def squashed(prim, center, axis, scale):
    """Compress a primitive along `axis` about `center` (approximate distance)."""
    c = np.asarray(center, dtype=np.float64)
    ax = unit(axis)

    def fn(p):
        q = p - c
        along = q @ ax
        return prim.fn(p + np.outer(along * (1.0 / scale - 1.0), ax)) * scale

    return Prim(fn, prim.lo, prim.hi)


def round_box(c, half, radius, axes):
    c = np.asarray(c, dtype=np.float64)
    half = np.asarray(half, dtype=np.float64)
    R = np.array([unit(x) for x in axes])

    def fn(p):
        q = np.abs((p - c) @ R.T) - (half - radius)
        return _len(np.maximum(q, 0.0)) + np.minimum(q.max(axis=1), 0.0) - radius

    ext = np.abs(R.T) @ half
    return Prim(fn, c - ext, c + ext)


def capped_cylinder_beyond(origin, axis, start, radius):
    """Solid of points beyond `start` along axis and within `radius` of the axis line."""
    o = np.asarray(origin, dtype=np.float64)
    ax = unit(axis)

    def fn(p):
        q = p - o
        along = q @ ax
        radial = _len(q - np.outer(along, ax))
        return np.maximum(start - along, radial - radius)

    far = o + ax * (start + 0.25)
    near = o + ax * start
    return Prim(fn, np.minimum(near, far) - radius, np.maximum(near, far) + radius)


def half_space_y(y0, keep_above=True):
    def fn(p):
        return (y0 - p[:, 1]) if keep_above else (p[:, 1] - y0)

    def grid(xs, ys, zs):
        y = ys[None, :, None]
        return np.broadcast_to((y0 - y) if keep_above else (y - y0), (len(xs), len(ys), len(zs)))

    return Prim(fn, grid=grid)


def tilted_half_space(normal, d):
    """Inside where dot(normal, p) > d (normal need not be unit length)."""
    raw = np.asarray(normal, dtype=np.float64)
    scale = float(np.linalg.norm(raw))
    n = raw / scale
    dd = d / scale

    def fn(p):
        return dd - p @ n

    def grid(xs, ys, zs):
        return dd - (n[0] * xs[:, None, None] + n[1] * ys[None, :, None] + n[2] * zs[None, None, :])

    return Prim(fn, grid=grid)


def loft(ys, half_widths, fronts, backs, centers):
    """Vertical loft of elliptical cross-sections (front/back semi-axes may differ)."""
    ys = np.asarray(ys, float)
    hw, fr, bk, cz = (np.asarray(x, float) for x in (half_widths, fronts, backs, centers))

    def fn(p):
        y = p[:, 1]
        a = np.interp(y, ys, hw)
        c = np.interp(y, ys, cz)
        z = p[:, 2] - c
        rz = np.where(z > 0, np.interp(y, ys, fr), np.interp(y, ys, bk))
        q0 = np.stack([p[:, 0] / a, z / rz], axis=1)
        q1 = np.stack([p[:, 0] / (a * a), z / (rz * rz)], axis=1)
        k0 = _len(q0)
        k1 = _len(q1)
        d2 = k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)
        return np.maximum(d2, np.maximum(ys[0] - y, y - ys[-1]))

    m = max(hw.max(), fr.max(), bk.max())
    return Prim(fn, (-m, ys[0], cz.min() - m), (m, ys[-1], cz.max() + m))


def scaled_about(prim, pivot, s):
    pv = np.asarray(pivot, float)

    def fn(p):
        return prim.fn((p - pv) / s + pv) * s

    lo = None if prim.lo is None else pv + (prim.lo - pv) * s
    hi = None if prim.hi is None else pv + (prim.hi - pv) * s
    return Prim(fn, lo, hi)


class Group(Prim):
    """Independent sub-field (blends inside it never leak into siblings)."""

    def __init__(self, ops):
        self.ops = ops
        los = [prim.lo for _, prim, _ in ops if prim.lo is not None and _ != 'subtract']
        his = [prim.hi for _, prim, _ in ops if prim.hi is not None and _ != 'subtract']
        super().__init__(lambda p: eval_points(ops, p), np.min(los, axis=0), np.max(his, axis=0))


class MultiBlend(Prim):
    """min_i smin(base, part_i, k): each part blends into the base but never into another part."""

    def __init__(self, base_ops, parts, k):
        self.base, self.parts, self.k = Group(base_ops), [Group(p) for p in parts], k
        lo = np.min([self.base.lo] + [g.lo for g in self.parts], axis=0)
        hi = np.max([self.base.hi] + [g.hi for g in self.parts], axis=0)

        def fn(p):
            b = self.base.fn(p)
            return np.min([smin(b, g.fn(p), self.k) for g in self.parts], axis=0)

        super().__init__(fn, lo, hi)
        self.grid = self.grid_eval

    def grid_eval(self, xs, ys, zs):
        b = eval_grid_axes(self.base.ops, xs, ys, zs)
        out = None
        for g in self.parts:
            v = smin(b, eval_grid_axes(g.ops, xs, ys, zs), self.k)
            out = v if out is None else np.minimum(out, v)
        return out


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def combine(kind, d, v, k):
    if kind == 'union':
        return smin(d, v, k)
    if kind == 'subtract':
        return smax(d, -v, k)
    if kind == 'intersect':
        return smax(d, v, k)
    if kind == 'inflate':
        return d - v
    raise ValueError(kind)


def band_y(y_lo, y_hi, amp, soft):
    def fn(p):
        y = p[:, 1]
        return amp * smoothstep(y_lo - soft, y_lo, y) * (1.0 - smoothstep(y_hi, y_hi + soft, y))

    def grid(xs, ys, zs):
        y = ys[None, :, None]
        w = amp * smoothstep(y_lo - soft, y_lo, y) * (1.0 - smoothstep(y_hi, y_hi + soft, y))
        return np.broadcast_to(w, (len(xs), len(ys), len(zs)))

    return Prim(fn, grid=grid)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def eval_points(ops, p):
    # Untruncated off-grid evaluation keeps gradients valid far from the surface.
    d = np.full(len(p), 1.0)
    for kind, prim, k in ops:
        d = combine(kind, d, prim.fn(p), k)
    return d


def eval_grid_axes(ops, xs, ys, zs):
    lo = np.array([xs[0], ys[0], zs[0]])
    h = float(xs[1] - xs[0])
    d = np.full((len(xs), len(ys), len(zs)), TRUNC)
    for kind, prim, k in ops:
        if prim.grid is not None:
            d = combine(kind, d, prim.grid(xs, ys, zs), k)
            continue
        if kind in ('union', 'subtract') and prim.lo is not None:
            m = TRUNC + k + 2 * h
            i0 = max(0, int(math.floor((prim.lo[0] - m - lo[0]) / h)))
            i1 = min(len(xs), int(math.ceil((prim.hi[0] + m - lo[0]) / h)) + 1)
            j0 = max(0, int(math.floor((prim.lo[1] - m - lo[1]) / h)))
            j1 = min(len(ys), int(math.ceil((prim.hi[1] + m - lo[1]) / h)) + 1)
            k0 = max(0, int(math.floor((prim.lo[2] - m - lo[2]) / h)))
            k1 = min(len(zs), int(math.ceil((prim.hi[2] + m - lo[2]) / h)) + 1)
        else:
            i0, i1, j0, j1, k0, k1 = 0, len(xs), 0, len(ys), 0, len(zs)
        if i0 >= i1 or j0 >= j1 or k0 >= k1:
            continue
        X, Y, Z = np.meshgrid(xs[i0:i1], ys[j0:j1], zs[k0:k1], indexing='ij')
        pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
        sub = d[i0:i1, j0:j1, k0:k1]
        d[i0:i1, j0:j1, k0:k1] = combine(kind, sub, prim.fn(pts).reshape(sub.shape), k)
    return d


def eval_grid(ops, lo, hi, h):
    xs = np.arange(lo[0], hi[0] + 0.5 * h, h)
    ys = np.arange(lo[1], hi[1] + 0.5 * h, h)
    zs = np.arange(lo[2], hi[2] + 0.5 * h, h)
    return eval_grid_axes(ops, xs, ys, zs), np.array([xs[0], ys[0], zs[0]])


# ---------------------------------------------------------------------------------------
# Surface nets polygonisation, field projection and tangential smoothing.
CORNERS = np.array([(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)])
EDGES = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]


def surface_nets(d, origin, h):
    nx, ny, nz = d.shape
    s = d < 0
    shape = (nx - 1, ny - 1, nz - 1)
    code = np.zeros(shape, dtype=np.uint8)
    for bit, (dx, dy, dz) in enumerate(CORNERS):
        code |= s[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz].astype(np.uint8) << bit
    active = (code != 0) & (code != 255)
    cells = np.argwhere(active)
    vid = -np.ones(shape, dtype=np.int64)
    vid[active] = np.arange(len(cells))
    acc = np.zeros((len(cells), 3))
    cnt = np.zeros(len(cells))
    ci, cj, ck = cells.T
    for a, b in EDGES:
        ca, cb = CORNERS[a], CORNERS[b]
        fa = d[ci + ca[0], cj + ca[1], ck + ca[2]]
        fb = d[ci + cb[0], cj + cb[1], ck + cb[2]]
        m = (fa < 0) != (fb < 0)
        t = fa[m] / (fa[m] - fb[m])
        acc[m] += ca + t[:, None] * (cb - ca)
        cnt[m] += 1
    verts = origin + h * (cells + acc / cnt[:, None])
    quads = []
    for axis in range(3):
        u, v = [x for x in range(3) if x != axis]
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, -1)
        sl1[axis] = slice(1, None)
        start = s[tuple(sl0)]
        change = start != s[tuple(sl1)]
        trim = [slice(None)] * 3
        trim[u] = slice(0, 1)
        change[tuple(trim)] = False
        trim[u] = slice(-1, None)
        change[tuple(trim)] = False
        trim = [slice(None)] * 3
        trim[v] = slice(0, 1)
        change[tuple(trim)] = False
        trim[v] = slice(-1, None)
        change[tuple(trim)] = False
        e = np.argwhere(change)
        inside_first = start[tuple(e.T)]

        def cell(du, dv):
            c = e.copy()
            c[:, u] += du
            c[:, v] += dv
            return vid[c[:, 0], c[:, 1], c[:, 2]]

        q = np.stack([cell(-1, -1), cell(0, -1), cell(0, 0), cell(-1, 0)], axis=1)
        flip = inside_first != (axis != 1)
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    return verts, np.concatenate(quads)


def gradient(ops, p, eps):
    g = np.zeros_like(p)
    for axis in range(3):
        o = np.zeros(3)
        o[axis] = eps
        g[:, axis] = (eval_points(ops, p + o) - eval_points(ops, p - o)) / (2 * eps)
    return g


def project(ops, p, eps, iterations=3):
    for _ in range(iterations):
        f = eval_points(ops, p)
        g = gradient(ops, p, eps)
        p = p - (f / np.maximum(np.einsum('ij,ij->i', g, g), 1e-12))[:, None] * g
    return p


def smooth_project(ops, verts, quads, h, rounds=2):
    n = len(verts)
    a = quads.ravel()
    b = np.roll(quads, -1, axis=1).ravel()
    for _ in range(rounds):
        acc = np.zeros((n, 3))
        cnt = np.zeros(n)
        np.add.at(acc, a, verts[b])
        np.add.at(acc, b, verts[a])
        np.add.at(cnt, a, 1)
        np.add.at(cnt, b, 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        verts = verts + 0.6 * (avg - verts)
        verts = project(ops, verts, 0.5 * h, 2)
    return verts


def polygonise(name, ops, lo, hi, h):
    d, origin = eval_grid(ops, np.asarray(lo, float), np.asarray(hi, float), h)
    verts, quads = surface_nets(d, origin, h)
    verts = project(ops, verts, 0.5 * h, 3)
    verts = smooth_project(ops, verts, quads, h)
    return verts, quads


# ---------------------------------------------------------------------------------------
# Shapes.
HEAD_SCALE = 1.07
HEAD_PIVOT = v3(0.0, 0.60, -0.02)


def head_point(p):
    return HEAD_PIVOT + HEAD_SCALE * (np.asarray(p, float) - HEAD_PIVOT)


def arm_ops(side):
    s, e, w, a = SHOULDER[side], ELBOW[side], WRIST[side], ARM_DIR[side]
    sg = SIDE_SIGN[side]
    out_up = v3(math.cos(THETA) * sg, math.sin(THETA), 0.0)
    front = v3(0, 0, 1)
    across = unit(np.cross(a, front))
    return [
        # Deltoid cap, aligned to the arm.
        ('union', ellipsoid(s + 0.038 * a + 0.012 * out_up, (0.080, 0.062, 0.062), (a, out_up, front)), 0.025),
        ('union', round_cone(s + 0.05 * a, e - 0.01 * a, 0.048, 0.039), 0.02),
        # Biceps (front) and triceps (back) masses.
        ('union', ellipsoid(s + 0.150 * a + 0.010 * front, (0.075, 0.036, 0.039), (a, across, front)), 0.02),
        ('union', ellipsoid(s + 0.130 * a - 0.012 * front + 0.006 * out_up, (0.085, 0.037, 0.036), (a, across, front)), 0.02),
        ('union', ellipsoid(e, (0.036, 0.036, 0.036)), 0.015),
        # Forearm: muscular near the elbow, flatter toward the wrist.
        ('union', ellipsoid(e + 0.075 * a + 0.004 * front, (0.085, 0.040, 0.040), (a, across, front)), 0.02),
        ('union', squashed(round_cone(e + 0.02 * a, w, 0.039, 0.030), w, hand_frame(side)[2], 0.78), 0.02),
    ]


TORSO_PROFILE = {
    # height y: half width, front, back, centre z (metres)
    'y': (-0.10, -0.04, 0.02, 0.08, 0.14, 0.20, 0.27, 0.34, 0.40, 0.46, 0.52, 0.57, 0.61),
    'half_width': (0.138, 0.144, 0.146, 0.137, 0.127, 0.122, 0.134, 0.150, 0.162, 0.167, 0.150, 0.112, 0.072),
    'front': (0.078, 0.082, 0.085, 0.086, 0.086, 0.087, 0.094, 0.106, 0.112, 0.101, 0.078, 0.058, 0.048),
    'back': (0.102, 0.106, 0.108, 0.097, 0.083, 0.078, 0.084, 0.093, 0.097, 0.097, 0.090, 0.076, 0.060),
    'center': (-0.008, -0.008, -0.010, -0.008, -0.002, 0.002, 0.000, -0.004, -0.008, -0.014, -0.020, -0.024, -0.024),
}


def torso_ops():
    p = TORSO_PROFILE
    ops = [('union', loft(p['y'], p['half_width'], p['front'], p['back'], p['center']), 0.0)]
    for sg in (1, -1):
        ops += [
            ('union', ellipsoid((0.070 * sg, 0.425, 0.060), (0.080, 0.050, 0.038)), 0.04),
            ('union', ellipsoid((0.120 * sg, 0.355, -0.035), (0.050, 0.105, 0.060)), 0.04),
            ('union', ellipsoid((0.075 * sg, 0.430, -0.082), (0.060, 0.070, 0.030)), 0.04),
            ('union', round_cone((0, 0.580, -0.045), (0.165 * sg, 0.533, -0.022), 0.052, 0.034), 0.04),
        ]
    ops += [
        ('union', ellipsoid((0, 0.215, 0.062), (0.070, 0.130, 0.036)), 0.03),
        ('union', round_cone((0, 0.500, -0.026), (0, 0.615, -0.022), 0.072, 0.068), 0.03),
    ]
    return ops


def suit_ops():
    ops = torso_ops()
    for side in 'LR':
        ops += arm_ops(side)
    # Open collar and cuffs (head/hands are separate skin meshes) and the closed hip finish.
    ops.append(('subtract', capped_cylinder_beyond((0, 0, -0.022), v3(0, 1, 0), NECK_CUT_Y, 0.10), 0.004))
    for side in 'LR':
        cut = UPPER_ARM_LEN + FOREARM_LEN - SLEEVE_CUT
        ops.append(('subtract', capped_cylinder_beyond(SHOULDER[side], ARM_DIR[side], cut, 0.065), 0.003))
    ops.append(('intersect', half_space_y(HIP_CUT_Y, keep_above=True), 0.016))
    return ops


def head_local_ops():
    ops = [
        ('union', ellipsoid((0, 0.765, -0.012), (0.076, 0.098, 0.096)), 0.0),
        ('union', ellipsoid((0, 0.780, 0.022), (0.068, 0.070, 0.068)), 0.03),
        ('union', ellipsoid((0, 0.708, 0.030), (0.061, 0.066, 0.068)), 0.035),
        ('union', ellipsoid((0, 0.678, 0.055), (0.032, 0.030, 0.034)), 0.03),
        ('union', round_cone((0, 0.470, -0.026), (0, 0.700, -0.022), 0.064, 0.054), 0.025),
        ('union', ellipsoid((0, 0.633, 0.071), (0.022, 0.018, 0.020)), 0.018),
    ]
    for sg in (1, -1):
        ops += [
            ('union', round_cone((0.046 * sg, 0.670, 0.002), (0.018 * sg, 0.637, 0.064), 0.017, 0.016), 0.03),
            ('union', ellipsoid((0.047 * sg, 0.726, 0.054), (0.020, 0.013, 0.020)), 0.025),
            ('union', ellipsoid((0.040 * sg, 0.705, 0.050), (0.020, 0.020, 0.020)), 0.03),
            ('union', round_cone((0.051 * sg, 0.766, 0.066), (0.017 * sg, 0.772, 0.087), 0.0095, 0.009), 0.012),
            ('union', ellipsoid((0.0795 * sg, 0.737, -0.006), (0.011, 0.029, 0.019)), 0.006),
        ]
    ops += [
        ('union', round_cone((-0.017, 0.771, 0.087), (0.017, 0.771, 0.087), 0.009, 0.009), 0.01),
        # Nose: bridge, tip and alae.
        ('union', round_cone((0, 0.752, 0.089), (0, 0.713, 0.111), 0.0075, 0.0092), 0.007),
        ('union', ellipsoid((0, 0.708, 0.109), (0.0105, 0.0095, 0.0095)), 0.006),
    ]
    for sg in (1, -1):
        ops.append(('union', ellipsoid((0.012 * sg, 0.704, 0.098), (0.0078, 0.0068, 0.0078)), 0.006))
    ops += [
        ('union', ellipsoid((0, 0.6795, 0.089), (0.020, 0.0055, 0.0075)), 0.004),
        ('union', ellipsoid((0, 0.667, 0.087), (0.017, 0.006, 0.008)), 0.004),
        ('subtract', ellipsoid((0, 0.6732, 0.095), (0.021, 0.0012, 0.008)), 0.002),
    ]
    for sg in (1, -1):
        ops += [
            ('subtract', ellipsoid((0.033 * sg, 0.743, 0.092), (0.020, 0.013, 0.013)), 0.010),
            ('union', ellipsoid((0.033 * sg, 0.7536, 0.0800), (0.0170, 0.0036, 0.0080)), 0.0035),
            ('union', ellipsoid((0.033 * sg, 0.7330, 0.0792), (0.0155, 0.0030, 0.0070)), 0.0030),
            ('subtract', ellipsoid((0.0855 * sg, 0.739, -0.004), (0.0055, 0.019, 0.011)), 0.004),
        ]
    return ops


def scale_head(ops):
    return [(kind, scaled_about(prim, HEAD_PIVOT, HEAD_SCALE), k * HEAD_SCALE) for kind, prim, k in ops]


def head_ops():
    return scale_head(head_local_ops()) + [('intersect', half_space_y(0.475, keep_above=True), 0.004)]


EYE_CENTER = {s: head_point((0.033 * SIDE_SIGN[s], 0.743, 0.0700)) for s in 'LR'}
EYE_RADIUS = 0.0133 * HEAD_SCALE


def hair_ops():
    ops = [
        ('union', ellipsoid((0, 0.766, -0.013), (0.0815, 0.1035, 0.1015)), 0.0),
        ('union', ellipsoid((0, 0.812, -0.010), (0.070, 0.064, 0.095)), 0.03),
        ('union', ellipsoid((0, 0.846, 0.030), (0.052, 0.028, 0.052)), 0.03),
        ('intersect', tilted_half_space((0, 1, -1.1), 0.779), 0.006),
    ]
    for sg in (1, -1):
        ops.append(('subtract', ellipsoid((0.080 * sg, 0.735, -0.004), (0.028, 0.034, 0.028)), 0.01))
        ops.append(('subtract', ellipsoid((0.066 * sg, 0.806, 0.066), (0.024, 0.030, 0.026)), 0.012))
    return scale_head(ops)


def hand_ops(side):
    a, t, n = hand_frame(side)
    w = WRIST[side]
    joints = HAND_JOINTS[side]
    palm = [
        # Wrist stub reaching back into the sleeve.
        ('union', squashed(round_cone(w - 0.035 * a, w + 0.012 * a, 0.027, 0.026), w, n, 0.72), 0.0),
        ('union', round_box(w + 0.052 * a - 0.002 * n, (0.046, 0.036, 0.0122), 0.011, (a, t, n)), 0.018),
        # Thenar and hypothenar pads on the palmar side.
        ('union', ellipsoid(w + 0.036 * a + 0.019 * t + 0.008 * n, (0.032, 0.017, 0.013), (a, t, n)), 0.012),
        ('union', ellipsoid(w + 0.045 * a - 0.023 * t + 0.006 * n, (0.034, 0.012, 0.010), (a, t, n)), 0.012),
    ]
    for name, *_ in FINGERS:
        palm.append(('union', ellipsoid(joints[name][0] - 0.005 * n, (0.009, 0.0085, 0.007), (a, t, n)), 0.008))
    parts = []
    for name, _, _, _, _, radii in FINGERS:
        pts = joints[name]
        parts.append([('union', squashed(round_cone(pts[i], pts[i + 1], radii[i], radii[i + 1]), pts[i], n, 0.88), 0.004) for i in range(3)])
    th = joints['thumb']
    index_mcp = joints['index'][0]
    web = unit(index_mcp - th[1])
    parts.append([
        ('union', round_cone(th[0], th[1], THUMB_RADII[0], THUMB_RADII[1]), 0.0),
        ('union', round_cone(th[1], th[2], THUMB_RADII[1], THUMB_RADII[2]), 0.005),
        ('union', squashed(round_cone(th[2], th[3], THUMB_RADII[2], THUMB_RADII[3]), th[2], n, 0.9), 0.005),
        ('union', ellipsoid(0.5 * (th[1] + index_mcp) + 0.003 * n - 0.010 * a, (0.022, 0.011, 0.009), (web, np.cross(n, web), n)), 0.010),
    ])
    return [('union', MultiBlend(palm, parts, 0.010), 0.0)]


def hand_bounds(side):
    pts = [WRIST[side] - 0.04 * ARM_DIR[side]]
    for chain in HAND_JOINTS[side].values():
        pts += chain
    pts = np.array(pts)
    return pts.min(axis=0) - 0.03, pts.max(axis=0) + 0.03


# ---------------------------------------------------------------------------------------
# Blender mesh helpers.
def material(name, hexcolor, roughness=0.6):
    mat = bpy.data.materials.get(name)
    if mat and not mat.get(TAG):
        raise RuntimeError('Preserving non-generated material: ' + name)
    mat = mat or bpy.data.materials.new(name)
    mat[TAG] = True
    mat.use_nodes = True

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    rgb = tuple(lin(int(hexcolor[i:i + 2], 16) / 255) for i in (1, 3, 5))
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    mat.diffuse_color = (*rgb, 1)
    return mat


MATERIALS = {
    'suit': material('avatar_suit', '#1B2331', 0.75),
    'skin': material('avatar_skin', '#C79178', 0.55),
    'accent': material('avatar_accent', '#19F5FF', 0.35),
    'eye': material('avatar_eye', '#FFFFFF', 0.25),
    'hair': material('avatar_hair', '#2A1D17', 0.7),
}
MATERIAL_ORDER = ['suit', 'skin', 'accent', 'eye', 'hair']


def new_mesh_object(name, verts, faces, slot):
    if bpy.data.objects.get(name):
        raise RuntimeError('Preserving existing non-generated object: ' + name)
    data = bpy.data.meshes.new(name)
    data[TAG] = True
    data.from_pydata([to_blender(v) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    data.update()
    obj = bpy.data.objects.new(name, data)
    obj[TAG] = True
    bpy.context.scene.collection.objects.link(obj)
    for key in MATERIAL_ORDER:
        data.materials.append(MATERIALS[key])
    index = MATERIAL_ORDER.index(slot)
    for poly in data.polygons:
        poly.material_index = index
        poly.use_smooth = True
    return obj


def clean_largest(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    seen = set()
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, island = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            island.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        islands.append(island)
    islands.sort(key=len, reverse=True)
    for island in islands[1:]:
        bmesh.ops.delete(bm, geom=island, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(islands)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimate(obj, target, symmetric=True):
    current = triangle_count(obj)
    if current <= target:
        return
    activate(obj)
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = target / current
    mod.use_symmetry = symmetric
    mod.symmetry_axis = 'X'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in obj.data.polygons:
        poly.use_smooth = True


def relax_project(obj, ops, h, rounds=2, factor=0.35):
    """Tangential relaxation of reduced meshes, then exact projection onto the field."""
    mesh = obj.data
    count = len(mesh.vertices)
    co = np.empty(count * 3)
    mesh.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    p = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
    edges = np.empty(len(mesh.edges) * 2, dtype=np.int64)
    mesh.edges.foreach_get('vertices', edges)
    edges = edges.reshape(-1, 2)
    a, b = edges[:, 0], edges[:, 1]
    for _ in range(rounds):
        acc = np.zeros((count, 3))
        cnt = np.zeros(count)
        np.add.at(acc, a, p[b])
        np.add.at(acc, b, p[a])
        np.add.at(cnt, a, 1)
        np.add.at(cnt, b, 1)
        delta = acc / np.maximum(cnt, 1)[:, None] - p
        g = gradient(ops, p, 0.5 * h)
        g /= np.maximum(np.linalg.norm(g, axis=1), 1e-12)[:, None]
        delta -= np.einsum('ij,ij->i', delta, g)[:, None] * g
        p = project(ops, p + factor * delta, 0.5 * h, 3)
    out = np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)
    mesh.vertices.foreach_set('co', out.ravel())
    mesh.update()


def build_part(name, ops, lo, hi, h, slot, target, symmetric=True, method='decimate'):
    verts, quads = polygonise(name, ops, lo, hi, h)
    obj = new_mesh_object(name, verts, quads, slot)
    clean_largest(obj)
    if method == 'quadriflow':
        activate(obj)
        result = bpy.ops.object.quadriflow_remesh(
            target_faces=target // 2, use_mesh_symmetry=symmetric, use_preserve_sharp=False,
            use_preserve_boundary=False, smooth_normals=False, mode='FACES', seed=0)
        if 'FINISHED' not in result:
            raise RuntimeError('QuadriFlow failed for ' + name)
        mesh = obj.data
        mesh.materials.clear()
        for key in MATERIAL_ORDER:
            mesh.materials.append(MATERIALS[key])
        for poly in mesh.polygons:
            poly.material_index = MATERIAL_ORDER.index(slot)
            poly.use_smooth = True
    else:
        decimate(obj, target, symmetric)
    relax_project(obj, ops, h, rounds=4, factor=0.45)
    return obj


# ---------------------------------------------------------------------------------------
# Accent tubes along curves projected onto the suit surface.
def catmull(points, samples_per_segment):
    pts = [np.asarray(p, float) for p in points]
    pts = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(samples_per_segment):
            t = s / samples_per_segment
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-2])
    return np.array(out)


def resample(points, spacing, closed=False):
    pts = np.asarray(points, float)
    if closed:
        pts = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    count = max(2, int(round(cum[-1] / spacing)))
    if closed:
        ts = np.linspace(0, cum[-1], count, endpoint=False)
    else:
        ts = np.linspace(0, cum[-1], count + 1)
    return np.stack([np.interp(ts, cum, pts[:, i]) for i in range(3)], axis=1)


def on_surface(ops, pts, offset):
    p = project(ops, np.asarray(pts, float), 0.001, 6)
    g = gradient(ops, p, 0.001)
    g /= np.linalg.norm(g, axis=1)[:, None]
    return p + offset * g, g


def ring_points(ops, center, axis, ref, count, height):
    """Star-shaped cross-section ring: bisect along radial rays in the plane."""
    ax = unit(axis)
    u = unit(ref - np.dot(ref, ax) * ax)
    w = np.cross(ax, u)
    c = np.asarray(center, float) + height * ax
    out = []
    for i in range(count):
        ang = 2 * math.pi * i / count
        r = math.cos(ang) * u + math.sin(ang) * w
        lo, hi = 0.0, 0.3
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            if eval_points(ops, (c + mid * r)[None])[0] < 0:
                lo = mid
            else:
                hi = mid
        out.append(c + lo * r)
    return np.array(out)


def tube(name, centers, normals, radius, sides, closed):
    n = len(centers)
    verts, faces = [], []
    prev_u = None
    for i in range(n):
        if closed:
            tang = centers[(i + 1) % n] - centers[i - 1]
        else:
            tang = centers[min(i + 1, n - 1)] - centers[max(i - 1, 0)]
        tang = unit(tang)
        nrm = normals[i] - np.dot(normals[i], tang) * tang
        u = unit(nrm)
        if prev_u is not None and np.dot(u, prev_u) < 0:
            u = -u
        prev_u = u
        w = np.cross(tang, u)
        for k in range(sides):
            ang = 2 * math.pi * (k + 0.5) / sides
            verts.append(centers[i] + radius * (math.cos(ang) * u + math.sin(ang) * w))
    rings = n if closed else n - 1
    for i in range(rings):
        j = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, j * sides + k2, j * sides + k))
    if not closed:
        a = len(verts)
        verts.append(centers[0] - 0.4 * radius * unit(centers[1] - centers[0]))
        b = len(verts)
        verts.append(centers[-1] + 0.4 * radius * unit(centers[-1] - centers[-2]))
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((a, k2, k))
            faces.append((b, (n - 1) * sides + k, (n - 1) * sides + k2))
    obj = new_mesh_object(name, verts, faces, 'accent')
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def accent_curves(ops):
    curves = []
    r_line, r_ring = 0.0032, 0.0042
    for side in 'LR':
        sg = SIDE_SIGN[side]
        a = ARM_DIR[side]
        out_up = v3(math.cos(THETA) * sg, math.sin(THETA), 0.0)
        s = SHOULDER[side]
        ctrl = [v3(0.050 * sg, 0.575, 0.0), v3(0.115 * sg, 0.548, 0.004), v3(0.180 * sg, 0.545, 0.004)]
        for t in (0.06, 0.16, 0.30, 0.42, UPPER_ARM_LEN + FOREARM_LEN - SLEEVE_CUT - 0.012):
            ctrl.append(s + t * a + 0.07 * out_up)
        pts = resample(catmull(ctrl, 8), 0.022)
        curves.append(('accent_arm_' + side, pts, r_line, False))
        # Chest chevron half and side seam.
        chest = [v3(0.150 * sg, 0.520, 0.030), v3(0.110 * sg, 0.470, 0.090), v3(0.050 * sg, 0.400, 0.110), v3(0.0, 0.370, 0.115)]
        curves.append(('accent_chest_' + side, resample(catmull(chest, 8), 0.018), r_line, False))
        side_pts = [v3(0.150 * sg, 0.400, 0.000), v3(0.150 * sg, 0.300, 0.000), v3(0.140 * sg, 0.200, 0.000), v3(0.150 * sg, 0.110, 0.000)]
        curves.append(('accent_side_' + side, resample(catmull(side_pts, 8), 0.02), r_line, False))
    return curves


def build_accents(ops):
    objects = []
    for name, pts, radius, closed in accent_curves(ops):
        centers, normals = on_surface(ops, pts, radius * 0.45)
        objects.append(tube(name, centers, normals, radius, 4, closed))
    rings = [
        ('accent_collar', v3(0, 0, -0.022), v3(0, 1, 0), NECK_CUT_Y - 0.006, 32),
        ('accent_belt', v3(0, 0, -0.004), v3(0, 1, 0), 0.060, 48),
        ('accent_hip_rim', v3(0, 0, -0.006), v3(0, 1, 0), HIP_CUT_Y + 0.016, 48),
    ]
    for side in 'LR':
        rings.append(('accent_cuff_' + side, SHOULDER[side], ARM_DIR[side], UPPER_ARM_LEN + FOREARM_LEN - SLEEVE_CUT - 0.006, 20))
    for name, center, axis, height, count in rings:
        ref = v3(0, 0, 1)
        pts = ring_points(ops, center, axis, ref, count, height)
        radius = 0.0045 if name != 'accent_belt' else 0.004
        centers, normals = on_surface(ops, pts, radius * 0.45)
        objects.append(tube(name, centers, normals, radius, 4, True))
    return objects


def build_eyes():
    objects = []
    for side in 'LR':
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=EYE_RADIUS)
        verts = [EYE_CENTER[side] + v3(v.co.x, v.co.z, v.co.y) for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces]
        bm.free()
        obj = new_mesh_object('eye_' + side, verts, faces, 'eye')
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
        objects.append(obj)
    return objects


# ---------------------------------------------------------------------------------------
# Build.
timings = {}
t0 = datetime.now()
suit_ops_list = suit_ops()
suit = build_part('avatar_suit_part', suit_ops_list, (-0.64, -0.09, -0.16), (0.64, 0.64, 0.15), 0.004, 'suit', 4300)
timings['suit'] = (datetime.now() - t0).total_seconds()
head_ops_list = head_ops()
head = build_part('avatar_head_part', head_ops_list, (-0.12, 0.46, -0.14), (0.12, 0.90, 0.145), 0.002, 'skin', 3500, symmetric=False)
hair = build_part('avatar_hair_part', hair_ops(), (-0.12, 0.65, -0.14), (0.12, 0.91, 0.13), 0.0025, 'hair', 650, symmetric=False)
hands = {}
for side in 'LR':
    lo, hi = hand_bounds(side)
    hands[side] = build_part('avatar_hand_part_' + side, hand_ops(side), lo, hi, 0.0015, 'skin', 2000, symmetric=False)
eyes = build_eyes()
accents = build_accents(suit_ops_list)
timings['total'] = (datetime.now() - t0).total_seconds()
parts = [suit, head, hair, hands['L'], hands['R']] + eyes + accents
summary = {obj.name: triangle_count(obj) for obj in parts}
summary['total'] = sum(triangle_count(obj) for obj in parts)
print('SIGN_SABER_AVATAR_SHAPE ' + json.dumps({'triangles': summary, 'seconds': timings}))


# ---------------------------------------------------------------------------------------
# Rig: standard bone names, rest pose = authored A-pose facing +Z (glTF) / -Y (Blender).
FRONT = v3(0, 0, 1)
UP = v3(0, 1, 0)
NECK_BASE = v3(0, 0.505, -0.026)
HEAD_JOINT = head_point((0, 0.676, -0.020))


def bone_specs():
    """(name, head, tail, parent, connected, roll-Z hint) in game axes."""
    specs = [
        ('hips', v3(0, 0, 0), v3(0, 0.10, -0.004), None, False, FRONT),
        ('spine', v3(0, 0.10, -0.004), v3(0, 0.26, -0.004), 'hips', True, FRONT),
        ('chest', v3(0, 0.26, -0.004), v3(0, 0.47, -0.020), 'spine', True, FRONT),
        ('neck', NECK_BASE, HEAD_JOINT, 'chest', False, FRONT),
        ('head', HEAD_JOINT, head_point((0, 0.86, -0.012)), 'neck', True, FRONT),
    ]
    for side in 'LR':
        sg = SIDE_SIGN[side]
        a, t, n = hand_frame(side)
        joints = HAND_JOINTS[side]
        sfx = '.' + side
        specs += [
            ('shoulder' + sfx, v3(0.030 * sg, 0.498, -0.012), SHOULDER[side], 'chest', False, FRONT),
            ('upper_arm' + sfx, SHOULDER[side], ELBOW[side], 'shoulder' + sfx, True, FRONT),
            ('forearm' + sfx, ELBOW[side], WRIST[side], 'upper_arm' + sfx, True, FRONT),
            ('hand' + sfx, WRIST[side], joints['middle'][0], 'forearm' + sfx, True, -n),
        ]
        for name in ('thumb', 'index', 'middle', 'ring', 'pinky'):
            pts = joints[name]
            for i in range(3):
                parent = 'hand' + sfx if i == 0 else '%s_%02d%s' % (name, i, sfx)
                specs.append(('%s_%02d%s' % (name, i + 1, sfx), pts[i], pts[i + 1], parent, i > 0, -n))
    return specs


BONE_SPECS = bone_specs()


def build_armature():
    data = bpy.data.armatures.new('avatar_rig')
    data[TAG] = True
    rig = bpy.data.objects.new('avatar_rig', data)
    rig[TAG] = True
    bpy.context.scene.collection.objects.link(rig)
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    edit = data.edit_bones
    for name, head, tail, parent, connected, roll in BONE_SPECS:
        bone = edit.new(name)
        bone.head = to_blender(head)
        bone.tail = to_blender(tail)
        if parent:
            bone.parent = edit[parent]
            bone.use_connect = connected
        bone.align_roll(Vector(to_blender(roll)))
        bone.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def smoothstep_scalar(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def game_co(v):
    return v3(v.co.x, v.co.z, -v.co.y)


def assign(obj, weights_fn):
    groups = {}
    for v in obj.data.vertices:
        for bone, w in weights_fn(game_co(v)).items():
            if w <= 1e-4:
                continue
            group = groups.get(bone) or obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            groups[bone] = group
            group.add([v.index], float(w), 'REPLACE')


def head_weights(p):
    head = smoothstep_scalar(0.645, 0.678, p[1] + 0.9 * max(p[2], 0.0))
    chest = 1.0 - smoothstep_scalar(0.50, 0.565, p[1])
    neck = max(0.0, 1.0 - head - chest)
    return {'head': head, 'neck': neck, 'chest': chest}


def copy_nearest_weights(source, targets):
    tree = KDTree(len(source.data.vertices))
    for v in source.data.vertices:
        tree.insert(v.co, v.index)
    tree.balance()
    names = {g.index: g.name for g in source.vertex_groups}
    for obj in targets:
        for v in obj.data.vertices:
            _, index, _ = tree.find(v.co)
            for g in source.data.vertices[index].groups:
                name = names[g.group]
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.add([v.index], g.weight, 'REPLACE')


def fill_unweighted(obj, rig, allowed):
    """Bone heat can leave isolated vertices empty; bind them to the nearest allowed bone."""
    segments = []
    for bone in rig.data.bones:
        if bone.name in allowed:
            segments.append((bone.name, np.array(bone.head_local), np.array(bone.tail_local)))
    fixed = 0
    for v in obj.data.vertices:
        if sum(g.weight for g in v.groups) > 1e-3:
            continue
        p = np.array(v.co)
        best, best_d = None, 1e9
        for name, a, b in segments:
            ab = b - a
            t = min(1.0, max(0.0, float(np.dot(p - a, ab) / np.dot(ab, ab))))
            d = float(np.linalg.norm(a + t * ab - p))
            if d < best_d:
                best, best_d = name, d
        group = obj.vertex_groups.get(best) or obj.vertex_groups.new(name=best)
        group.add([v.index], 1.0, 'REPLACE')
        fixed += 1
    return fixed


def set_colors(obj, color_fn):
    attr = obj.data.color_attributes.get('Col') or obj.data.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    for v in obj.data.vertices:
        attr.data[v.index].color = color_fn(game_co(v))
    obj.data.color_attributes.active_color = attr
    obj.data.attributes.default_color_name = 'Col'


def white(_):
    return (1.0, 1.0, 1.0, 1.0)


def head_color(p):
    q = HEAD_PIVOT + (p - HEAD_PIVOT) / HEAD_SCALE  # back to head-local authoring coordinates
    x, y, z = abs(q[0]), q[1], q[2]
    # Brows: band above the eye sockets on the brow ridge.
    if z > 0.062 and 0.013 < x < 0.053:
        u = (x - 0.013) / 0.040
        centre = 0.7712 + 0.0035 * math.sin(math.pi * 0.8 * u) - 0.0045 * u
        if abs(y - centre) < 0.0044 * (1.0 - 0.45 * u):
            return (0.36, 0.27, 0.22, 1.0)
    # Lips.
    lip = ((x / 0.022) ** 2 + ((y - 0.6732) / 0.0115) ** 2) <= 1.0 and z > 0.080
    if lip:
        return (0.93, 0.68, 0.66, 1.0)
    return (1.0, 1.0, 1.0, 1.0)


def eye_color_fn(side):
    c = EYE_CENTER[side]

    def fn(p):
        d = unit(p - c)
        angle = math.degrees(math.acos(max(-1.0, min(1.0, float(d[2])))))
        if angle < 13.0:
            return (0.03, 0.03, 0.035, 1.0)
        if angle < 29.0:
            return (0.30, 0.20, 0.13, 1.0)
        if angle < 32.0:
            return (0.12, 0.09, 0.07, 1.0)
        return (0.93, 0.91, 0.88, 1.0)

    return fn


def anchors():
    """Rest landmark positions (game axes) used by runtime retargeting; MediaPipe semantics."""
    out = {
        'nose': head_point((0, 0.707, 0.118)),
        'mouth.L': head_point((0.020, 0.673, 0.090)),
        'mouth.R': head_point((-0.020, 0.673, 0.090)),
    }
    for side in 'LR':
        sg = SIDE_SIGN[side]
        out['eye.' + side] = head_point((0.033 * sg, 0.743, 0.083))
        out['ear.' + side] = head_point((0.074 * sg, 0.737, 0.004))
        out['shoulder.' + side] = SHOULDER[side]
        out['elbow.' + side] = ELBOW[side]
        out['wrist.' + side] = WRIST[side]
        out['hip.' + side] = HIP_JOINT[side]
        joints = HAND_JOINTS[side]
        out['index.' + side] = joints['index'][0]
        out['pinky.' + side] = joints['pinky'][0]
        out['thumb.' + side] = joints['thumb'][1]
    return {k: [round(float(c), 6) for c in v] for k, v in out.items()}


def rig_and_export(parts):
    suit_obj, head_obj, hair_obj, hand_objs, eye_objs, accent_objs = parts
    rig = build_armature()
    # Vertex colours (multiplied with material base colour by glTF/three.js).
    for obj in [suit_obj, hair_obj, hand_objs['L'], hand_objs['R']] + accent_objs:
        set_colors(obj, white)
    set_colors(head_obj, head_color)
    for side, obj in zip('LR', eye_objs):
        set_colors(obj, eye_color_fn(side))
    # Bone-heat weights for the suit and hands.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (suit_obj, hand_objs['L'], hand_objs['R']):
        obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    body_bones = {b[0] for b in BONE_SPECS if not any(f in b[0] for f in ('thumb', 'index', 'middle', 'ring', 'pinky', 'hand'))}
    fixed = {'suit': fill_unweighted(suit_obj, rig, body_bones)}
    for side in 'LR':
        allowed = {b[0] for b in BONE_SPECS if b[0].endswith('.' + side) and not b[0].startswith(('shoulder', 'upper_arm'))}
        fixed['hand_' + side] = fill_unweighted(hand_objs[side], rig, allowed)
    # Rigid/procedural weights for the head, hair and eyes; accents follow the suit surface.
    assign(head_obj, head_weights)
    for obj in [hair_obj] + eye_objs:
        assign(obj, lambda p: {'head': 1.0})
    copy_nearest_weights(suit_obj, accent_objs)
    # Join into a single skinned mesh.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [suit_obj, head_obj, hair_obj, hand_objs['L'], hand_objs['R']] + eye_objs + accent_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = suit_obj
    bpy.ops.object.join()
    body = suit_obj
    body.name = 'avatar_body'
    body.data.name = 'avatar_body'
    body[TAG] = True
    body.data[TAG] = True
    if body.parent != rig:
        body.parent = rig
    if not any(m.type == 'ARMATURE' for m in body.modifiers):
        mod = body.modifiers.new('armature', 'ARMATURE')
        mod.object = rig
    activate(body)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    for poly in body.data.polygons:
        poly.use_smooth = True
    rig['sign_saber_rig_version'] = RIG_VERSION
    rig['sign_saber_anchors'] = anchors()
    rig['sign_saber_axes'] = 'game/glTF: X avatar-left, Y up, Z toward viewer; metres; origin at hip-joint midpoint'
    return rig, body, fixed


def export(rig, body, fixed, summary):
    path = OUT / 'avatar.glb'
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = rig
    options = dict(
        filepath=str(path), export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_animations=False, export_skins=True, export_def_bones=False, export_rest_position_armature=True,
        export_influence_nb=4, export_all_influences=False, export_morph=False, export_cameras=False,
        export_lights=False, export_materials='EXPORT', export_image_format='NONE', export_texcoords=False,
        export_normals=True, export_tangents=False, export_extras=True, export_vertex_color='ACTIVE',
        export_all_vertex_colors=False, export_draco_mesh_compression_enable=False,
        export_armature_object_remove=False,
        export_copyright='Original Sign Saber procedural avatar; MIT')
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    missing = set(options) - supported
    if missing:
        raise RuntimeError('Unsupported glTF options: ' + str(sorted(missing)))
    if 'FINISHED' not in bpy.ops.export_scene.gltf(**options):
        raise RuntimeError('Avatar export did not finish')
    data = path.read_bytes()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
    bones = [b[0] for b in BONE_SPECS]
    slots = {}
    for poly in body.data.polygons:
        key = body.data.materials[poly.material_index].name
        slots[key] = slots.get(key, 0) + len(poly.vertices) - 2
    manifest = {
        'schemaVersion': 1,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'id': 'avatar',
        'path': '/assets/models/avatar.glb',
        'sourceBlend': 'assets-src/blender/signsaber_avatar.blend',
        'sourceGenerator': 'assets-src/blender/generate_avatar.py',
        'authoringRoute': 'official Blender MCP add-on JSON TCP execute_code; dedicated local instance',
        'blenderVersion': bpy.app.version_string,
        'blenderBuildHash': bpy.app.build_hash.decode(),
        'gltfExporter': 'Blender bundled io_scene_gltf2',
        'mcp': {'upstream': 'https://github.com/ahujasid/blender-mcp', 'commit': 'febcd90ece59c3416d7c55fd3723cea46bcaa59d', 'addonSha256': '8e193a249e2ed1262f3e794ee2254efd8e3d1f0224385245f2b989154c837083', 'addonVersion': '1.8', 'protocolVersion': 15},
        'units': 'metres',
        'upAxis': 'Y',
        'facing': '+Z',
        'restPose': 'A-pose, arms %.0f degrees from vertical; straight fingers; head level' % ARM_ANGLE_DEG,
        'scope': 'Upper body only: head, neck, torso to a closed hip finish, arms and five-digit hands. No legs.',
        'construction': 'Signed-distance primitives (smooth unions/subtractions) polygonised by surface nets, projected onto the field, collapse-decimated, relaxed and re-projected; accent seams are tubes on projected curves.',
        'weights': 'Bone-heat for suit and hands (unweighted fallback to nearest bone), procedural head/neck blend, rigid hair/eyes, accents copy nearest suit weights; max 4 influences, normalised.',
        'unweightedFallbackVertices': fixed,
        'mesh': 'avatar_body',
        'armature': 'avatar_rig',
        'bones': bones,
        'materials': {k: MATERIALS[k].name for k in MATERIAL_ORDER},
        'materialTriangles': slots,
        'parts': summary,
        'triangles': sum(len(p.vertices) - 2 for p in body.data.polygons),
        'vertices': len(body.data.vertices),
        'triangleBudget': 16000,
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'anchors': anchors(),
        'rigVersion': RIG_VERSION,
        'license': 'MIT',
        'provenance': 'Original script-authored geometry. No scans, marketplace, generative or third-party meshes/textures.',
    }
    manifest['sourceBlendSha256'] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    manifest['sourceGeneratorSha256'] = hashlib.sha256((ROOT / manifest['sourceGenerator']).read_bytes()).hexdigest()
    (OUT / 'avatar-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    return manifest


if MODE != 'shape':
    rig_obj, body_obj, fixed_counts = rig_and_export((suit, head, hair, hands, eyes, accents))
    result = export(rig_obj, body_obj, fixed_counts, summary)
    print('SIGN_SABER_AVATAR ' + json.dumps({k: result[k] for k in ('triangles', 'vertices', 'bytes', 'sha256', 'unweightedFallbackVertices', 'materialTriangles')}))
