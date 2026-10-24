"""Original MIT geometry, executed through the official Blender MCP bridge.
Game coordinates are glTF +Y-up; authoring maps them to Blender +Z-up explicitly.
Every random choice is drawn from seeded generators, so repeat exports are byte-identical.
"""
import bpy
import bmesh
import hashlib
import json
import math
import pathlib
import random
import re
from datetime import datetime, timezone
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

SOURCE = pathlib.Path(bpy.data.filepath).resolve()
if SOURCE.name != 'signsaber_assets.blend' or not bpy.context.scene.get('sign_saber_asset_session'):
    raise RuntimeError('Refusing to alter any scene except the dedicated Sign Saber authoring file')
ROOT = SOURCE.parents[2]
OUT = ROOT / 'app' / 'public' / 'assets' / 'models'
OUT.mkdir(parents=True, exist_ok=True)
SEED = 7
ARMOR_BEVEL_CLEARANCE_M = 0.00001
# Voronoi fracture: seeded cell sites inside the unit cube, kept apart so no sliver cells form.
SHARD_COUNT = 14
SHARD_SITE_EXTENT_M = 0.4
SHARD_SITE_MIN_SPACING_M = 0.27
# Glyph relief: total depth is the 0.04 m contract; the front edge carries a readable chamfer.
GLYPH_DEPTH_M = 0.04
GLYPH_CHAMFER_M = 0.009
GLYPH_RELIEF_STEP_M = 0.008
# Block shell: 1 m authored cube (scaled by BLOCK_SIZE at runtime) with emissive bevel trims.
# Target families (1 m authored, scaled by BLOCK_SIZE at runtime). Slash: a thin bladed rhombic slab with a
# glowing cut seam. Beam: a faceted orb with an equator band. Smash reuses the Voronoi shards (cracked cube).
SLASH_CHAMFER_M = 0.05
SLASH_SEAM_M = 0.032
ORB_BAND_DEG = 7
CONSTANTS_SOURCE = (ROOT / 'app' / 'src' / 'core' / 'constants.ts').read_text(encoding='utf8')
def shared_metres(name):
    match = re.search(r'\b' + re.escape(name) + r'\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)\s*[,;]', CONSTANTS_SOURCE)
    if not match:
        raise RuntimeError('Update the build-input adapter for shared constant: ' + name)
    return float(match.group(1))
PYLON_SPACING_M = shared_metres('PYLON_SPACING_M')
PYLON_X = shared_metres('PYLON_X')
SILHOUETTE_Z = shared_metres('SILHOUETTE_Z')
SLASH_SLAB_DEPTH_M = shared_metres('SLASH_SLAB_DEPTH')
ORB_RADIUS_M = shared_metres('BEAM_ORB_RADIUS')
old_meshes = set()
for obj in list(bpy.data.objects):
    if obj.get('sign_saber_owned'):
        if obj.type == 'MESH': old_meshes.add(obj.data)
        bpy.data.objects.remove(obj, do_unlink=True)
for data in old_meshes:
    if data.users == 0 and data.get('sign_saber_owned'):
        bpy.data.meshes.remove(data)
groups = {}

def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4

def material(name, hexcolor, preview_emission=0.0):
    mat = bpy.data.materials.get(name)
    if mat and not mat.get('sign_saber_owned'):
        raise RuntimeError('Preserving non-generated material: ' + name)
    mat = mat or bpy.data.materials.new(name)
    mat['sign_saber_owned'] = True
    # Preview-only: render_preview/render_asset_sheet light this; exports stay base-colour only.
    mat['preview_emission'] = preview_emission
    mat.use_nodes = True
    rgb = tuple(linear(int(hexcolor[i:i+2], 16) / 255) for i in (1, 3, 5))
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    mat.diffuse_color = (*rgb, 1)
    return mat

outer = material('outer', '#808080')
inner = material('inner', '#FFFFFF', 1.5)
glass = material('block_glass', '#9FB4CC')
cyan = material('arena_neon_cyan', '#19F5FF', 4)
magenta = material('arena_neon_magenta', '#FF2BD6', 4)
gold = material('arena_neon_gold', '#FFC32B', 4)
blue = material('arena_neon_blue', '#2A48FF', 3)
stage_neon = material('arena_neon_stage', '#19F5FF', 3)
pylon_strip = material('pylon_strip', '#19F5FF', 5)
body = material('pylon_body', '#25394F')
floor_mat = material('arena_floor_dark', '#070B14')
metal = material('arena_metal_dark', '#1A2335')
stage_top = material('arena_stage_top', '#0E1628')
speaker = material('arena_speaker_black', '#07090F')
sky_dark = material('arena_sky_dark', '#0C1426')
sky_window = material('arena_sky_window', '#7FD8FF', 3)
sky_halo = material('arena_sky_halo', '#B36BFF', 4)
ring_mat = material('beam_ring_gold', '#FFC32B', 3)
glyph_mat = material('glyph_white', '#F2F6FF', 1)
armor_mat = material('armor_metal', '#2A2238')

def to_blender(point):
    return (point[0], -point[2], point[1])

def mesh(name, vertices, faces, mats=(outer,), location=(0, 0, 0), face_materials=None):
    if bpy.data.objects.get(name):
        raise RuntimeError('Preserving existing non-generated object: ' + name)
    prior = bpy.data.meshes.get(name)
    if prior and prior.users == 0:
        # Preserve pre-migration unlinked data while keeping export names stable.
        prior.name = 'archived_unused_' + name
    data = bpy.data.meshes.new(name)
    data['sign_saber_owned'] = True
    data.from_pydata([to_blender(v) for v in vertices], [], [tuple(f) for f in faces])
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = to_blender(location)
    obj['sign_saber_owned'] = True
    for m in mats:
        if m: data.materials.append(m)
    if face_materials is not None:
        for polygon, index in zip(data.polygons, face_materials):
            polygon.material_index = index
    return obj

def box(name, dimensions, center=(0, 0, 0), mat=outer):
    x, y, z = (v / 2 for v in dimensions)
    vertices = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    return mesh(name, vertices, faces, (mat,), center)

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    obj.name = name
    prior = bpy.data.meshes.get(name)
    if prior and prior != obj.data and prior.users == 0: prior.name = 'archived_unused_' + name
    obj.data.name = name
    return obj

def set_mask(obj, white):
    """Corner-domain Col mask (white = emissive trim/strip) read by the runtime shaders."""
    color = obj.data.color_attributes.new(name='Col', type='BYTE_COLOR', domain='CORNER')
    for polygon in obj.data.polygons:
        value = (1, 1, 1, 1) if white(polygon) else (0, 0, 0, 1)
        for loop in polygon.loop_indices: color.data[loop].color = value
    obj.data.color_attributes.active_color = color

def closed(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    ok = all(edge.is_manifold and edge.is_contiguous for edge in bm.edges)
    bm.free()
    return ok

# ---------------------------------------------------------------- 2D outline tools
def dedupe(points, eps=1e-4):
    out = []
    for p in points:
        if not out or math.hypot(p[0]-out[-1][0], p[1]-out[-1][1]) > eps: out.append(p)
    while len(out) > 2 and math.hypot(out[0][0]-out[-1][0], out[0][1]-out[-1][1]) <= eps: out.pop()
    return out

def signed_area(points):
    return sum(points[i-1][0]*points[i][1] - points[i][0]*points[i-1][1] for i in range(len(points))) / 2

def ccw(points):
    return points if signed_area(points) > 0 else list(reversed(points))

def fillet(spec, step):
    """spec: (x, y, radius). Replaces each corner by a tangent arc, clamped to its edges."""
    out = []
    n = len(spec)
    for i in range(n):
        px, py, r = spec[i]
        ax, ay = spec[i-1][0], spec[i-1][1]
        bx, by = spec[(i+1) % n][0], spec[(i+1) % n][1]
        ux, uy = ax-px, ay-py; lu = math.hypot(ux, uy); ux /= lu; uy /= lu
        vx, vy = bx-px, by-py; lv = math.hypot(vx, vy); vx /= lv; vy /= lv
        angle = math.acos(max(-1.0, min(1.0, ux*vx + uy*vy)))
        if r <= 0 or angle < 1e-3 or angle > math.pi - 1e-3:
            out.append((px, py)); continue
        t = min(r / math.tan(angle/2), .48*lu, .48*lv)
        r = t * math.tan(angle/2)
        hx, hy = ux+vx, uy+vy; lh = math.hypot(hx, hy); hx /= lh; hy /= lh
        d = r / math.sin(angle/2)
        cx, cy = px + hx*d, py + hy*d
        a0 = math.atan2(py + uy*t - cy, px + ux*t - cx)
        a1 = math.atan2(py + vy*t - cy, px + vx*t - cx)
        sweep = a1 - a0
        while sweep > math.pi: sweep -= math.tau
        while sweep < -math.pi: sweep += math.tau
        segments = max(1, math.ceil(abs(sweep) / step - 1e-9))
        for k in range(segments + 1):
            a = a0 + sweep * k / segments
            out.append((cx + r*math.cos(a), cy + r*math.sin(a)))
    return dedupe(out)

def inset(points, d):
    out = []
    n = len(points)
    for i in range(n):
        p0, p1, p2 = points[i-1], points[i], points[(i+1) % n]
        e1 = (p1[0]-p0[0], p1[1]-p0[1]); l1 = math.hypot(*e1)
        e2 = (p2[0]-p1[0], p2[1]-p1[1]); l2 = math.hypot(*e2)
        n1 = (e1[1]/l1, -e1[0]/l1); n2 = (e2[1]/l2, -e2[0]/l2)
        mx, my = n1[0]+n2[0], n1[1]+n2[1]; lm = math.hypot(mx, my); mx /= lm; my /= lm
        k = max(.45, mx*n1[0] + my*n1[1])
        out.append((p1[0] - mx*d/k, p1[1] - my*d/k))
    return out

def cap(points, base, z, up):
    vectors = [Vector((x, y, 0)) for x, y in points]
    lookup = {(round(v.x, 7), round(v.y, 7)): i for i, v in enumerate(vectors)}
    faces = []
    for triangle in tessellate_polygon([vectors]):
        ids = [v if isinstance(v, int) else lookup[(round(v.x, 7), round(v.y, 7))] for v in triangle]
        a, b, c = (points[i] for i in ids)
        area = (b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1])
        if (area > 0) != up: ids = ids[::-1]
        faces.append(tuple(base + i for i in ids))
    return faces

def relief(outline, z0, z1, chamfer):
    """Closed extrusion of a CCW outline between z0..z1 with an inset chamfer on the +Z face."""
    outline = ccw(dedupe(outline))
    front = inset(outline, chamfer)
    n = len(outline)
    vertices = [(x, y, z0) for x, y in outline] + [(x, y, z1 - chamfer) for x, y in outline] + [(x, y, z1) for x, y in front]
    faces = cap(outline, 0, z0, False) + cap(front, 2*n, z1, True)
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j+n, i+n))
        faces.append((i+n, j+n, j+2*n, i+2*n))
    return vertices, faces

def prism_xy(outline, z0, z1):
    outline = ccw(dedupe(outline))
    n = len(outline)
    vertices = [(x, y, z0) for x, y in outline] + [(x, y, z1) for x, y in outline]
    faces = cap(outline, 0, z0, False) + cap(outline, n, z1, True)
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j+n, i+n))
    return vertices, faces

def combine(parts):
    vertices, faces = [], []
    for v, f in parts:
        base = len(vertices)
        vertices.extend(v)
        faces.extend(tuple(base + i for i in face) for face in f)
    return vertices, faces

def transform2d(points, angle=0.0, offset=(0, 0), scale=1.0):
    c, s = math.cos(angle), math.sin(angle)
    return [(offset[0] + scale*(x*c - y*s), offset[1] + scale*(x*s + y*c)) for x, y in points]

# ---------------------------------------------------------------- Voronoi fracture
def poly_volume_centroid(vertices, faces):
    volume = 0.0; moment = Vector((0, 0, 0))
    for face in faces:
        a = Vector(vertices[face[0]])
        for k in range(1, len(face) - 1):
            b = Vector(vertices[face[k]]); c = Vector(vertices[face[k+1]])
            v = a.dot(b.cross(c)) / 6
            volume += v; moment += v * (a + b + c) / 4
    return volume, moment / volume

rng = random.Random(SEED)
sites = []
attempts = 0
while len(sites) < SHARD_COUNT:
    attempts += 1
    if attempts > 20000: raise RuntimeError('Could not place well-spaced fracture sites')
    candidate = Vector(tuple(rng.uniform(-SHARD_SITE_EXTENT_M, SHARD_SITE_EXTENT_M) for _ in range(3)))
    if all((candidate - other).length >= SHARD_SITE_MIN_SPACING_M for other in sites): sites.append(candidate)
cells = []
for i, site in enumerate(sites):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for face in bm.faces: face.material_index = 0
    for j, other in enumerate(sites):
        if i == j: continue
        normal = (other - site).normalized()
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7,
                               plane_co=(site + other) / 2, plane_no=normal, clear_outer=True)
        boundary = [edge for edge in bm.edges if edge.is_boundary]
        if boundary:
            for face in bmesh.ops.holes_fill(bm, edges=boundary, sides=0)['faces']: face.material_index = 1
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if not all(edge.is_manifold for edge in bm.edges): raise RuntimeError('Open Voronoi cell %d' % i)
    bm.verts.index_update()
    vertices = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    face_materials = [f.material_index for f in bm.faces]
    bm.free()
    volume, centroid = poly_volume_centroid(vertices, faces)
    if volume <= 0: raise RuntimeError('Inverted Voronoi cell %d' % i)
    cells.append((centroid, [tuple(Vector(v) - centroid) for v in vertices], faces, face_materials, volume))
cells.sort(key=lambda cell: (round(cell[0].y, 6), round(cell[0].z, 6), round(cell[0].x, 6)))
shards = []
for index, (centroid, vertices, faces, face_materials, volume) in enumerate(cells):
    shards.append(mesh('shard_%02d' % index, vertices, faces, (outer, inner), tuple(centroid), face_materials))
groups['block_fractured'] = shards

# ---------------------------------------------------------------- armour (unchanged contract)
# Four actual bevelled, cross-grooved plates on game-space +/-X and +/-Y.
plates = []
for axis in (0, 1):
    for sign in (-1, 1):
        center = [0, 0, 0]; center[axis] = sign * .55
        dimensions = [.84, .84, .84]; dimensions[axis] = .06
        plate = box('armor_plate_%s_%s' % (axis, sign), dimensions, center, armor_mat)
        activate(plate)
        bevel = plate.modifiers.new('edge_bevel_003', 'BEVEL'); bevel.width = .03 - ARMOR_BEVEL_CLEARANCE_M; bevel.segments = 3
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        for groove_axis in [a for a in range(3) if a != axis]:
            cutter_dimensions = [.9, .9, .9]; cutter_dimensions[axis] = .03; cutter_dimensions[groove_axis] = .04
            cutter_center = list(center); cutter_center[axis] = sign * .58
            cutter = box('armor_groove_cutter', cutter_dimensions, cutter_center, None)
            activate(plate)
            boolean = plate.modifiers.new('groove_0015', 'BOOLEAN'); boolean.operation = 'DIFFERENCE'; boolean.solver = 'EXACT'; boolean.object = cutter
            bpy.ops.object.modifier_apply(modifier=boolean.name)
            bpy.data.objects.remove(cutter, do_unlink=True)
        activate(plate)
        planar = plate.modifiers.new('merge_coplanar_boolean_faces', 'DECIMATE')
        planar.decimate_type = 'DISSOLVE'; planar.angle_limit = 0.000001
        bpy.ops.object.modifier_apply(modifier=planar.name)
        plates.append(plate)
groups['armor'] = [join('armor_plates', plates)]
armor = groups['armor'][0]
armor_triangles = sum(len(p.vertices)-2 for p in armor.data.polygons)
if armor_triangles > 896:
    activate(armor)
    simplify = armor.modifiers.new('budgeted_bevel_groove_simplification', 'DECIMATE')
    simplify.decimate_type = 'COLLAPSE'; simplify.ratio = 896 / armor_triangles; simplify.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=simplify.name)

# ---------------------------------------------------------------- beam ring
def torus_data(radius, minor, major_segments, minor_segments, phase=0.0):
    vertices, faces = [], []
    for i in range(major_segments):
        theta = i * math.tau / major_segments
        for j in range(minor_segments):
            phi = j * math.tau / minor_segments + phase
            vertices.append(((radius + minor*math.cos(phi))*math.cos(theta), (radius + minor*math.cos(phi))*math.sin(theta), minor*math.sin(phi)))
    for i in range(major_segments):
        for j in range(minor_segments):
            a = i*minor_segments + j; b = ((i+1) % major_segments)*minor_segments + j
            c = ((i+1) % major_segments)*minor_segments + (j+1) % minor_segments; d = i*minor_segments + (j+1) % minor_segments
            faces.append((a, b, c, d))
    return vertices, faces

ring_parts = [torus_data(.42, .03, 48, 6, math.pi/6)]
# Inward-pointing chevrons mark the fixed aim centre; diagonal ticks frame it without spinning detail.
chevron = [(.30, 0), (.375, -.062), (.375, -.03), (.34, 0), (.375, .03), (.375, .062)]
for k in range(4):
    ring_parts.append(prism_xy(transform2d(chevron, k * math.pi/2), -.016, .016))
tick = [(.475, -.014), (.535, -.014), (.535, .014), (.475, .014)]
for k in range(4):
    ring_parts.append(prism_xy(transform2d(tick, math.pi/4 + k * math.pi/2), -.012, .012))
ring_vertices, ring_faces = combine(ring_parts)
groups['beam_ring'] = [mesh('beam_ring', ring_vertices, ring_faces, (ring_mat,))]

# ---------------------------------------------------------------- glyphs
def glyph(name, base_spec, step, relief_specs=()):
    parts = []
    base_top = GLYPH_DEPTH_M/2 - (GLYPH_RELIEF_STEP_M if relief_specs else 0)
    parts.append(relief(fillet(base_spec, step), -GLYPH_DEPTH_M/2, base_top, GLYPH_CHAMFER_M))
    for spec in relief_specs:
        parts.append(relief(fillet(spec, step), -GLYPH_DEPTH_M/4, GLYPH_DEPTH_M/2, GLYPH_CHAMFER_M * .8))
    vertices, faces = combine(parts)
    xs = [v[0] for v in vertices]; ys = [v[1] for v in vertices]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    vertices = [(x - cx, y - cy, z) for x, y, z in vertices]
    return mesh(name, vertices, faces, (glyph_mat,))

palm = [(-.15,-.40,.06),(.17,-.40,.06),(.27,-.08,.10),(.26,.19,.05),(.16,.19,.05),(.145,.05,.012),(.13,.31,.05),(.03,.31,.05),(.01,.07,.012),
        (-.01,.37,.05),(-.11,.37,.05),(-.13,.06,.012),(-.15,.29,.05),(-.25,.29,.05),(-.255,-.02,.02),(-.33,.07,.055),(-.41,0,.055),(-.25,-.22,.05)]
fist = [(-.27,-.30,.08),(.25,-.30,.08),(.31,.02,.10),(.30,.20,.06),(.19,.22,.055),(.17,.17,.01),(.16,.26,.06),(.04,.27,.06),(.025,.21,.01),
        (.01,.28,.06),(-.11,.28,.06),(-.125,.21,.01),(-.14,.26,.06),(-.26,.24,.06),(-.33,.08,.08),(-.36,-.10,.08)]
fist_thumb = [(-.31,-.14,.06),(.10,-.17,.06),(.12,-.05,.06),(-.29,-.01,.06)]
point = [(-.25,-.36,.08),(.24,-.36,.08),(.30,-.08,.09),(.28,.08,.06),(.17,.10,.05),(.15,.05,.01),(.14,.12,.05),(.03,.12,.03),(-.02,.10,.02),
         (-.02,.38,.055),(-.13,.38,.055),(-.14,.06,.02),(-.27,.02,.07),(-.32,-.16,.08)]
point_thumb = [(-.30,-.19,.06),(.06,-.22,.06),(.08,-.10,.06),(-.28,-.07,.06)]
arrow = [(-.34,-.20,.03),(0,.12,.02),(.34,-.20,.03),(.34,-.04,.03),(0,.30,.045),(-.34,-.04,.03)]
groups['glyphs'] = [
    glyph('glyph_palm', palm, math.pi/4),
    glyph('glyph_fist', fist, math.pi/4, (fist_thumb,)),
    glyph('glyph_point', point, math.pi/4, (point_thumb,)),
    glyph('glyph_arrow', arrow, math.pi/4),
]

# ---------------------------------------------------------------- pylon
# Faceted pylon with a real recessed lane-facing strip and explicit Col mask, plus a plinth and lit crown.
vertices=[]; faces=[]; materials=[]
for y,r in ((0,.25),(6,.15)):
    for i in range(6):
        a=i*math.tau/6; vertices.append((r*math.cos(a),y,r*math.sin(a)))
faces.append(tuple(reversed(range(6)))); materials.append(0)
faces.append(tuple(range(6,12))); materials.append(0)
for i in range(6):
    if i==1: continue
    faces.append((i,(i+1)%6,(i+1)%6+6,i+6)); materials.append(0)
def front_z(y): return (.25-.1*y/6)*math.sqrt(3)/2
def quad(coords, mat_index=0):
    start=len(vertices); vertices.extend(coords); faces.append(tuple(range(start,start+4))); materials.append(mat_index)
quad([(.125,0,front_z(0)),(-.125,0,front_z(0)),(-.04,.5,front_z(.5)),(.04,.5,front_z(.5))])
quad([(.04,5.5,front_z(5.5)),(-.04,5.5,front_z(5.5)),(-.075,6,front_z(6)),(.075,6,front_z(6))])
quad([(.125,0,front_z(0)),(.04,.5,front_z(.5)),(.04,5.5,front_z(5.5)),(.075,6,front_z(6))])
quad([(-.04,.5,front_z(.5)),(-.125,0,front_z(0)),(-.075,6,front_z(6)),(-.04,5.5,front_z(5.5))])
quad([(-.04,.5,front_z(.5)-.006),(.04,.5,front_z(.5)-.006),(.04,5.5,front_z(5.5)-.006),(-.04,5.5,front_z(5.5)-.006)],1)
for sign in (-1,1):
    x=sign*.04; quad([(x,.5,front_z(.5)),(x,.5,front_z(.5)-.006),(x,5.5,front_z(5.5)-.006),(x,5.5,front_z(5.5))])
# Face all exterior shell patches outwards; the right inset wall faces the recess.
faces=[tuple(reversed(face)) if i!=11 and i!=12 else face for i,face in enumerate(faces)]
quad([(-.04,.5,front_z(.5)),(.04,.5,front_z(.5)),(.04,.5,front_z(.5)-.006),(-.04,.5,front_z(.5)-.006)])
quad([(-.04,5.5,front_z(5.5)-.006),(.04,5.5,front_z(5.5)-.006),(.04,5.5,front_z(5.5)),(-.04,5.5,front_z(5.5))])
def hex_band(r0, r1, y0, y1, lit):
    """Closed hexagonal frustum shell in game XZ (vertex 0 on +X, matching the prism)."""
    start = len(vertices)
    for y, r in ((y0, r0), (y1, r1)):
        for i in range(6):
            a = i*math.tau/6; vertices.append((r*math.cos(a), y, r*math.sin(a)))
    faces.append(tuple(start + i for i in reversed(range(6)))); materials.append(0)
    faces.append(tuple(start + 6 + i for i in range(6))); materials.append(0)
    for i in range(6):
        faces.append((start + (i+1) % 6, start + i, start + i + 6, start + (i+1) % 6 + 6)); materials.append(1 if lit else 0)
hex_band(.36, .31, 0, .24, False)
hex_band(.2, .2, 5.8, 6, True)
pylon=mesh('pylon',vertices,faces,(body,pylon_strip),face_materials=materials)
bm=bmesh.new(); bm.from_mesh(pylon.data); bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000001)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(pylon.data); bm.free()
if not closed(pylon): raise RuntimeError('Pylon shells are not closed')
set_mask(pylon, lambda polygon: polygon.material_index == 1)
groups['pylon']=[pylon]

# ---------------------------------------------------------------- target families
def slab(outline, depth, chamfer):
    """Closed extrusion with an inset chamfer on both the +Z and -Z faces. Returns (vertices, faces, chamfer_face_ids)."""
    outline = ccw(dedupe(outline))
    face_inset = inset(outline, chamfer)
    n = len(outline)
    rings = [(face_inset, -depth/2), (outline, -depth/2 + chamfer), (outline, depth/2 - chamfer), (face_inset, depth/2)]
    vertices = [(x, y, z) for ring, z in rings for x, y in ring]
    faces = cap(face_inset, 0, -depth/2, False)
    chamfers = []
    for r in range(3):
        for i in range(n):
            j = (i + 1) % n
            if r != 1: chamfers.append(len(faces))
            faces.append((r*n + i, r*n + j, (r+1)*n + j, (r+1)*n + i))
    faces += cap(face_inset, 3*n, depth/2, True)
    return vertices, faces, chamfers

# Slash: a thin bladed rhombus (point up/down/left/right) whose chamfered rims and horizontal cut seam glow.
# Corner radius exceeds the chamfer inset so the inset rim never folds over at the tips.
rhombus = [(0, .5, .075), (-.5, 0, .075), (0, -.5, .075), (.5, 0, .075)]
slab_vertices, slab_faces, slab_trims = slab(fillet(rhombus, math.pi/6), SLASH_SLAB_DEPTH_M, SLASH_CHAMFER_M)
seam = prism_xy([(-.43, -SLASH_SEAM_M/2), (.43, -SLASH_SEAM_M/2), (.43, SLASH_SEAM_M/2), (-.43, SLASH_SEAM_M/2)],
                -SLASH_SLAB_DEPTH_M/2 - .012, SLASH_SLAB_DEPTH_M/2 + .012)
seam_start = len(slab_faces)
slash_vertices, slash_faces = combine([(slab_vertices, slab_faces), seam])
slash_trim_ids = set(slab_trims) | set(range(seam_start, len(slash_faces)))
slash_block = mesh('block_slash', slash_vertices, slash_faces, (glass,))
set_mask(slash_block, lambda polygon: polygon.index in slash_trim_ids)

# Beam: a faceted orb; the thin equator band glows like a powered reticle core.
latitudes = [60, 30, ORB_BAND_DEG, -ORB_BAND_DEG, -30, -60]
segments = 12
orb_vertices = [(0, ORB_RADIUS_M, 0)]
for lat in latitudes:
    phi = math.radians(lat)
    for k in range(segments):
        theta = k * math.tau / segments
        orb_vertices.append((ORB_RADIUS_M*math.cos(phi)*math.cos(theta), ORB_RADIUS_M*math.sin(phi), ORB_RADIUS_M*math.cos(phi)*math.sin(theta)))
orb_vertices.append((0, -ORB_RADIUS_M, 0))
bottom = len(orb_vertices) - 1
orb_faces = []
band_ids = set()
for k in range(segments):
    orb_faces.append((0, 1 + (k+1) % segments, 1 + k))
for ring in range(len(latitudes) - 1):
    for k in range(segments):
        a = 1 + ring*segments + k; b = 1 + ring*segments + (k+1) % segments
        if latitudes[ring] == ORB_BAND_DEG: band_ids.add(len(orb_faces))
        orb_faces.append((a, b, b + segments, a + segments))
last = 1 + (len(latitudes) - 1) * segments
for k in range(segments):
    orb_faces.append((bottom, last + k, last + (k+1) % segments))
orb_block = mesh('block_orb', orb_vertices, orb_faces, (glass,))
bm = bmesh.new(); bm.from_mesh(orb_block.data)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(orb_block.data); bm.free()
set_mask(orb_block, lambda polygon: polygon.index in band_ids)
for obj in (slash_block, orb_block):
    if not closed(obj): raise RuntimeError('Open block mesh: ' + obj.name)

# ---------------------------------------------------------------- arena environment
class Builder:
    """Front-facing arena patches. Arena meshes are not required to be closed; faces are oriented
    toward the playfield camera so the open shells read solid from every gameplay view."""
    def __init__(self):
        self.vertices = []; self.faces = []; self.materials = []
    def quad(self, a, b, c, d, outward, mat=0):
        a, b, c, d = (Vector(p) for p in (a, b, c, d))
        normal = (b - a).cross(c - b)
        start = len(self.vertices)
        self.vertices.extend(tuple(p) for p in (a, b, c, d))
        face = (start, start+1, start+2, start+3)
        self.faces.append(face if normal.dot(Vector(outward)) >= 0 else face[::-1]); self.materials.append(mat)
    def box(self, size, center, sides, mat=0):
        hx, hy, hz = (s/2 for s in size); cx, cy, cz = center
        corner = lambda ix, iy, iz: (cx + (hx if ix else -hx), cy + (hy if iy else -hy), cz + (hz if iz else -hz))
        table = {'+x': ((1,0,0),(1,1,0),(1,1,1),(1,0,1)), '-x': ((0,0,0),(0,0,1),(0,1,1),(0,1,0)),
                 '+y': ((0,1,0),(0,1,1),(1,1,1),(1,1,0)), '-y': ((0,0,0),(1,0,0),(1,0,1),(0,0,1)),
                 '+z': ((0,0,1),(1,0,1),(1,1,1),(0,1,1)), '-z': ((0,0,0),(0,1,0),(1,1,0),(1,0,0))}
        normals = {'+x': (1,0,0), '-x': (-1,0,0), '+y': (0,1,0), '-y': (0,-1,0), '+z': (0,0,1), '-z': (0,0,-1)}
        for side in sides:
            self.quad(*(corner(*c) for c in table[side]), normals[side], mat)
    def beam(self, p0, p1, width, depth, faces, mat=0, up=(0, 0, 1)):
        p0 = Vector(p0); p1 = Vector(p1); t = (p1 - p0).normalized()
        w = t.cross(Vector(up)).normalized(); u = w.cross(t)
        for sign_u, sign_w, label in ((1, 0, '+u'), (-1, 0, '-u'), (0, 1, '+w'), (0, -1, '-w')):
            if label not in faces: continue
            n = u*sign_u + w*sign_w
            side = (w if sign_u else u) * (width/2 if sign_u else depth/2)
            offset = n * (depth/2 if sign_u else width/2)
            self.quad(p0 + offset - side, p0 + offset + side, p1 + offset + side, p1 + offset - side, tuple(n), mat)
    def disc(self, center, radius, segments, normal, mat=0, inner=0.0, phase=0.0):
        """Flat annulus/polygon facing +normal in the plane perpendicular to a principal axis."""
        n = Vector(normal); a = Vector((0, 1, 0)) if abs(n.y) < .9 else Vector((1, 0, 0))
        e1 = a.cross(n).normalized(); e2 = n.cross(e1)
        c = Vector(center)
        ring = [c + (e1*math.cos(phase + k*math.tau/segments) + e2*math.sin(phase + k*math.tau/segments)) for k in range(segments)]
        for k in range(segments):
            p, q = ring[k], ring[(k+1) % segments]
            if inner > 0:
                self.quad(c + (p-c)*inner, c + (q-c)*inner, c + (q-c)*radius, c + (p-c)*radius, tuple(n), mat)
            else:
                start = len(self.vertices)
                tri = [tuple(c), tuple(c + (p-c)*radius), tuple(c + (q-c)*radius)]
                normal_tri = (Vector(tri[1]) - Vector(tri[0])).cross(Vector(tri[2]) - Vector(tri[1]))
                self.vertices.extend(tri)
                face = (start, start+1, start+2)
                self.faces.append(face if normal_tri.dot(n) >= 0 else face[::-1]); self.materials.append(mat)
    def build(self, name, mats):
        return mesh(name, self.vertices, self.faces, mats, face_materials=self.materials)

arena = [box('arena_floor', (80, .08, 150), (0, -.44, -60), floor_mat)]
# Player dais: an octagonal stage under the silhouette plane, top below y=0 so the stage volume stays clear.
dais = Builder()
stage_z = SILHOUETTE_Z
octagon = lambda r, y: [(r*math.cos(math.pi/8 + k*math.pi/4), y, stage_z + r*math.sin(math.pi/8 + k*math.pi/4)) for k in range(8)]
top = octagon(2.6, -.30); rim = octagon(2.66, -.33); foot = octagon(2.66, -.40)
for k in range(8):
    j = (k + 1) % 8
    out = ((top[k][0] + top[j][0]) / 2, 0, (top[k][2] + top[j][2]) / 2 - stage_z)
    dais.quad(top[k], top[j], rim[j], rim[k], (out[0], .6, out[2]), 1)
    dais.quad(rim[k], rim[j], foot[j], foot[k], out, 0)
start = len(dais.vertices); dais.vertices.extend(top)
dais.faces.append(tuple(start + k for k in reversed(range(8)))); dais.materials.append(0)
dais.disc((0, -.296, stage_z), 2.32, 32, (0, 1, 0), 1, inner=2.32 - .05)
dais.disc((0, -.296, stage_z), 1.05, 24, (0, 1, 0), 1, inner=1.05 - .025)
arena.append(dais.build('arena_stage', (stage_top, stage_neon)))
# Recessed light channels: dark housings with neon cores, plus cross channels that carry the bass pulse.
for name, xs, mat in [('arena_rail_cyan', (-3.4, 3.4), cyan), ('arena_rail_magenta', (-7.5, 7.5), magenta)]:
    rails = Builder()
    for x in xs:
        rails.box((.05, .03, 70), (x, -.355, -31), ('+y', '-x', '+x', '+z'), 0)
    arena.append(rails.build(name, (mat,)))
housing = Builder()
for x in (-3.4, 3.4, -7.5, 7.5):
    for side in (-1, 1):
        housing.box((.05, .06, 70), (x + side*.085, -.37, -31), ('+y', '+z', '-x' if side > 0 else '+x'), 0)
arena.append(housing.build('arena_channel_housing', (metal,)))
pulse = Builder()
for k in range(8):
    z = -6 - k * PYLON_SPACING_M
    pulse.box((6.6, .01, .07), (0, -.392, z), ('+y',), 0)
arena.append(pulse.build('arena_floor_channels', (blue,)))
for side, sign in [('left', -1), ('right', 1)]:
    for i in range(4):
        z = -(i + 1) * PYLON_SPACING_M
        obj = bpy.data.objects.new('arena_pylon_%s_%02d' % (side, i), pylon.data)
        bpy.context.scene.collection.objects.link(obj); obj.location = to_blender((sign * PYLON_X, 0, z)); obj['sign_saber_owned'] = True; arena.append(obj)
# Speaker stacks between the light towers (clear of the HUD side panels): woofers recessed, inner edge lit.
for side, sign in [('left', -1), ('right', 1)]:
    stack = Builder()
    x, z = sign * 11.2, -26
    lane = '+x' if sign < 0 else '-x'
    for level in range(3):
        y = -.4 + .55 + level * 1.08
        stack.box((1.4, 1.04, .95), (x, y, z), ('+z', lane) + (('+y',) if level == 2 else ()), 1)
        stack.disc((x, y - .08, z + .476), .4, 8, (0, 0, 1), 0, inner=.29, phase=math.pi/8)
        stack.disc((x, y - .08, z + .468), .29, 8, (0, 0, 1), 1, phase=math.pi/8)
        stack.disc((x - sign*.42, y + .36, z + .476), .085, 6, (0, 0, 1), 2)
    stack.box((.05, 3.2, .05), (x - sign*.73, 1.2, z + .5), ('+z', lane), 3)
    arena.append(stack.build('arena_speaker_stack_%s' % side, (metal, speaker, gold, magenta)))
# Light towers with lamp heads; overhead truss arcs spring from their tops across the far lane.
TOWER_X, TOWER_TOP = 11.2, 8.2
for tower_index, z in enumerate((-16, -36)):
    for side, sign in [('left', -1), ('right', 1)]:
        tower = Builder()
        x = sign * TOWER_X
        lane = '+x' if sign < 0 else '-x'
        for dx in (-.65, .65):
            for dz in (-.65, .65):
                tower.box((.18, TOWER_TOP + .4, .18), (x + dx, (TOWER_TOP - .4) / 2, z + dz), ('+z', lane), 0)
        inner_x = x - sign * .65
        for level in range(3):
            y0 = .4 + level * 2.5
            tower.beam((inner_x, y0, z + .65), (inner_x, y0 + 2.5, z - .65), .08, .08, ('+u', '-u', '+w', '-w'), 0, up=(1, 0, 0))
            tower.beam((x - .65, y0, z + .65), (x + .65, y0 + 2.5, z + .65), .08, .08, ('+u',), 0)
        tower.box((1.9, .28, 1.9), (x, TOWER_TOP, z), ('+z', lane, '-y'), 0)
        for k in (-1, 0, 1):
            head = (x - sign * .5, TOWER_TOP + .45, z + k * .55)
            tower.box((.4, .5, .42), head, ('+z', lane, '-y'), 0)
            tower.disc((head[0] - sign * .205, head[1], head[2]), .15, 8, (-sign, 0, 0), 1)
        for level in range(2):
            y = .3 + level * 1.15
            tower.box((1.15, 1.08, .9), (x, y, z), ('+z', lane, '+y'), 2)
            tower.disc((x, y, z + .455), .36, 8, (0, 0, 1), 0, inner=.24, phase=math.pi/8)
        tower.box((.06, TOWER_TOP - .6, .06), (inner_x, TOWER_TOP / 2, z + .73), ('+z', lane), 3)
        arena.append(tower.build('arena_tower_%s_%02d' % (side, tower_index), (metal, gold, speaker, magenta)))
    truss = Builder()
    segments = 10
    path = []
    for k in range(segments + 1):
        t = k / segments
        path.append(Vector((-TOWER_X + 2*TOWER_X*t, TOWER_TOP + .2 + 3.6*math.sin(math.pi*t), z)))
    for chord_offset in (0, .62):
        for k in range(segments):
            a = path[k] + Vector((0, chord_offset, 0)); b = path[k+1] + Vector((0, chord_offset, 0))
            truss.beam(a, b, .1, .1, ('+u', '+w'), 0)
    for k in range(segments):
        low = path[k]; high = path[k+1] + Vector((0, .62, 0))
        if k % 2: low, high = path[k+1], path[k] + Vector((0, .62, 0))
        truss.beam(low, high, .05, .05, ('+u',), 0)
    for k in range(segments):
        a, b = path[k], path[k+1]
        tangent = (b - a).normalized(); normal = Vector((tangent.y, -tangent.x, 0))
        truss.beam(a + normal * .1, b + normal * .1, .07, .02, ('+w', '+u'), 1)
    arena.append(truss.build('arena_truss_%02d' % tower_index, (metal, gold)))
# Distant skyline beyond the fog line: silhouettes with lit window bands around a clear horizon valley.
sky = Builder()
skyline_rng = random.Random(SEED + 101)
for sign in (-1, 1):
    x = 13.0
    while x < 78:
        width = skyline_rng.uniform(4.5, 9.5)
        height = skyline_rng.uniform(7, 15) + (x - 13) * skyline_rng.uniform(.18, .42)
        depth = skyline_rng.uniform(4, 8)
        z = -skyline_rng.uniform(98, 124)
        cx = sign * (x + width / 2)
        lane = '-x' if sign > 0 else '+x'
        sky.box((width, height, depth), (cx, -.4 + height / 2, z), ('+z', lane), 0)
        for band in range(skyline_rng.randint(2, 5)):
            y = -.4 + height * skyline_rng.uniform(.25, .92)
            span = width * skyline_rng.uniform(.35, .8)
            sky.quad((cx - span/2, y, z + depth/2 + .05), (cx + span/2, y, z + depth/2 + .05),
                     (cx + span/2, y + .32, z + depth/2 + .05), (cx - span/2, y + .32, z + depth/2 + .05), (0, 0, 1), 1)
        if skyline_rng.random() < .35:
            sky.box((.25, height * .3, .25), (cx, -.4 + height * 1.15, z), ('+z', lane), 0)
            sky.box((.5, .5, .1), (cx, -.4 + height * 1.3, z + .2), ('+z',), 1)
        x += width + skyline_rng.uniform(.6, 3.5)
for k in range(5):
    width = 3.5 + k % 2 * 1.5
    cx = -9 + k * 4.5
    sky.box((width, 2.2 + (k % 3) * .7, 3), (cx, .7 + (k % 3) * .35, -104 - k % 2 * 6), ('+z',), 0)
arena.append(sky.build('arena_skyline', (sky_dark, sky_window)))
halo_vertices, halo_faces = torus_data(19, .16, 64, 3)
halo = mesh('arena_horizon_ring', [(x, y, z) for x, y, z in halo_vertices], halo_faces, (sky_halo,), (0, 8, -132))
arena.append(halo)
groups['arena_environment'] = arena
groups['block_targets'] = [slash_block, orb_block]

# ---------------------------------------------------------------- validation and export
def triangles(obj): return sum(len(p.vertices)-2 for p in obj.data.polygons)
budgets = {'block_fractured':700,'armor':900,'beam_ring':900,'glyphs':1200,'pylon':600,'arena_environment':3000,'block_targets':400}
total = sum(triangles(obj) for objects in groups.values() for obj in objects)
if total > 6000: raise RuntimeError('Total triangle budget exceeded: '+str(total))
for obj in shards + groups['glyphs'] + [groups['beam_ring'][0], slash_block, orb_block]:
    if not closed(obj): raise RuntimeError('Open closed-contract mesh: ' + obj.name)
for obj in groups['glyphs']:
    if triangles(obj) > 400: raise RuntimeError(obj.name + ' exceeds 400 triangles: ' + str(triangles(obj)))
records = []
options_supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
for name, objects in groups.items():
    tri = sum(triangles(obj) for obj in objects)
    if tri > budgets[name]: raise RuntimeError(name+' triangle budget exceeded: '+str(tri))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    options = dict(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_animations=False,export_skins=False,export_morph=False,export_cameras=False,export_lights=False,export_materials='EXPORT',export_image_format='NONE',export_texcoords=False,export_normals=True,export_extras=False,export_vertex_color='ACTIVE',export_all_vertex_colors=True,export_draco_mesh_compression_enable=False,export_copyright='Original Sign Saber procedural geometry; MIT')
    missing = set(options) - options_supported
    if missing: raise RuntimeError('Unsupported glTF options: '+str(sorted(missing)))
    result = bpy.ops.export_scene.gltf(**options)
    if 'FINISHED' not in result: raise RuntimeError('Export did not finish: '+name)
    path = OUT/(name+'.glb'); data = path.read_bytes()
    records.append({'id':name,'path':'/assets/models/'+name+'.glb','nodes':[obj.name for obj in objects],'triangles':tri,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'license':'MIT'})
volume = 0
for obj in shards:
    bm = bmesh.new(); bm.from_mesh(obj.data)
    if not all(edge.is_manifold for edge in bm.edges): raise RuntimeError('Open shard mesh: '+obj.name)
    volume += bm.calc_volume(signed=False); bm.free()
if abs(volume-1) > 0.02: raise RuntimeError('Shard volume invalid: '+str(volume))
# Ids this generator owns, including retired ones it must not carry forward as foreign entries.
own_ids = {record['id'] for record in records} | {'block_shell'}
manifest_path = OUT/'manifest.json'
# Preserve entries authored by other generators (for example a separately built avatar) in stable order.
foreign = []
if manifest_path.exists():
    try:
        foreign = [entry for entry in json.loads(manifest_path.read_text(encoding='utf8')).get('assets', []) if entry.get('id') not in own_ids]
    except ValueError:
        foreign = []
all_records = records + foreign
manifest={'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'sourceBlend':'assets-src/blender/signsaber_assets.blend','sourceGenerator':'assets-src/blender/generate_assets.py','authoringRoute':'official Blender MCP add-on JSON TCP execute_code; local 127.0.0.1 dedicated instance','blenderVersion':bpy.app.version_string,'blenderBuildHash':bpy.app.build_hash.decode(),'gltfExporter':'Blender bundled io_scene_gltf2','mcp':{'upstream':'https://github.com/ahujasid/blender-mcp','commit':'febcd90ece59c3416d7c55fd3723cea46bcaa59d','addonSha256':'8e193a249e2ed1262f3e794ee2254efd8e3d1f0224385245f2b989154c837083','addonVersion':'1.8','protocolVersion':15},'seed':SEED,'units':'metres','upAxis':'Y','materials':'Principled base color, no textures or emission','fractureMode':'seeded %d-cell Voronoi (bmesh bisect_plane + holes_fill); Cell Fracture operator unavailable' % SHARD_COUNT,'fracture':{'cells':SHARD_COUNT,'siteExtentM':SHARD_SITE_EXTENT_M,'siteMinSpacingM':SHARD_SITE_MIN_SPACING_M,'siteAttempts':attempts,'shardTriangles':[triangles(s) for s in shards]},'shardCount':len(shards),'shardVolumeM3':volume,'clearStage':{'x':[-3,3],'z':[-5,4],'y':[0,3],'note':'No upright opaque geometry intersects the central human play stage; floor and dais tops are below y=0.'},'assets':all_records,'totalTriangles':sum(r['triangles'] for r in all_records),'totalGlbBytes':sum(r['bytes'] for r in all_records),'provenance':'Original script-authored geometry. No Poly Haven, Sketchfab, generative asset service or third-party meshes/textures used. MIT repository license.'}
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE),compress=True)
manifest['sourceBlendSha256'] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
manifest['sourceGeneratorSha256'] = hashlib.sha256((ROOT/manifest['sourceGenerator']).read_bytes()).hexdigest()
manifest['sharedConstants'] = {'source':'app/src/core/constants.ts','PYLON_SPACING_M':PYLON_SPACING_M,'PYLON_X':PYLON_X,'SILHOUETTE_Z':SILHOUETTE_Z,'SLASH_SLAB_DEPTH':SLASH_SLAB_DEPTH_M,'BEAM_ORB_RADIUS':ORB_RADIUS_M}
manifest['armorConstruction'] = {'bevelOffsetM':.03-ARMOR_BEVEL_CLEARANCE_M,'bevelClearanceM':ARMOR_BEVEL_CLEARANCE_M,'bevelSegments':3,'grooveDepthM':.015,'preSimplifyTriangles':armor_triangles,'exportTriangles':triangles(armor)}
manifest['armorSimplification'] = 'Three-segment bevel at 0.02999m (10 micrometres below half thickness avoids coincident corner seams), 0.015m grooves; budget simplification from %s to %s triangles.'%(armor_triangles,triangles(armor))
manifest['blockTargets'] = {'slash':{'node':'block_slash','shape':'rhombic slab with chamfered faces and cut seam','depthM':SLASH_SLAB_DEPTH_M,'chamferM':SLASH_CHAMFER_M,'seamM':SLASH_SEAM_M},'beam':{'node':'block_orb','shape':'faceted 12-segment orb with equator band','radiusM':ORB_RADIUS_M,'bandDeg':ORB_BAND_DEG},'smash':'runtime assembly of the authored block_fractured shards with crack gaps (no duplicate geometry)','trimMask':'Col white on emissive trims/seam/band, black on glass'}
manifest['glyphConstruction'] = {'depthM':GLYPH_DEPTH_M,'chamferM':GLYPH_CHAMFER_M,'reliefStepM':GLYPH_RELIEF_STEP_M,'nodes':{g.name:triangles(g) for g in groups['glyphs']}}
# LF on every platform so the committed text matches Git's canonical bytes.
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8',newline='\n')
(OUT/'ASSET_LICENSE.txt').write_text((ROOT/'LICENSE').read_text(encoding='utf8'),encoding='utf8',newline='\n')
print('SIGN_SABER_ASSETS '+json.dumps({'assets':len(records),'triangles':total,'bytes':sum(r['bytes'] for r in records),'shardCount':len(shards),'shardVolumeM3':volume,'perAsset':{r['id']:r['triangles'] for r in records}}))
