"""Original MIT geometry, executed through the official Blender MCP bridge.
Game coordinates are glTF +Y-up; authoring maps them to Blender +Z-up explicitly.
"""
import bpy
import bmesh
import hashlib
import json
import math
import pathlib
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
CONSTANTS_SOURCE = (ROOT / 'app' / 'src' / 'core' / 'constants.ts').read_text(encoding='utf8')
def shared_metres(name):
    match = re.search(r'\b' + re.escape(name) + r'\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*[,;]', CONSTANTS_SOURCE)
    if not match:
        raise RuntimeError('Update the build-input adapter for shared constant: ' + name)
    return float(match.group(1))
PYLON_SPACING_M = shared_metres('PYLON_SPACING_M')
PYLON_X = shared_metres('PYLON_X')
old_meshes=set()
for obj in list(bpy.data.objects):
    if obj.get('sign_saber_owned'):
        if obj.type=='MESH': old_meshes.add(obj.data)
        bpy.data.objects.remove(obj, do_unlink=True)
for data in old_meshes:
    if data.users==0 and data.get('sign_saber_owned'):
        bpy.data.meshes.remove(data)
groups = {}

def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4

def material(name, hexcolor):
    mat = bpy.data.materials.get(name)
    if mat and not mat.get('sign_saber_owned'):
        raise RuntimeError('Preserving non-generated material: ' + name)
    mat = mat or bpy.data.materials.new(name)
    mat['sign_saber_owned'] = True
    mat.use_nodes = True
    rgb = tuple(linear(int(hexcolor[i:i+2], 16) / 255) for i in (1, 3, 5))
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    mat.diffuse_color = (*rgb, 1)
    return mat

outer = material('outer', '#808080')
inner = material('inner', '#FFFFFF')
cyan = material('arena_neon_cyan', '#19F5FF')
magenta = material('arena_neon_magenta', '#FF2BD6')
gold = material('arena_neon_gold', '#FFC32B')
body = material('pylon_body', '#25394F')
floor_mat = material('arena_floor_dark', '#080D18')
grid_mat = material('arena_grid_blue', '#24506C')

def to_blender(point):
    return (point[0], -point[2], point[1])

def mesh(name, vertices, faces, mat=outer, location=(0, 0, 0)):
    if bpy.data.objects.get(name):
        raise RuntimeError('Preserving existing non-generated object: ' + name)
    prior=bpy.data.meshes.get(name)
    if prior and prior.users==0:
        # Preserve pre-migration unlinked data while keeping export names stable.
        prior.name='archived_unused_'+name
    data = bpy.data.meshes.new(name)
    data['sign_saber_owned']=True
    data.from_pydata([to_blender(v) for v in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = to_blender(location)
    obj['sign_saber_owned'] = True
    if mat:
        data.materials.append(mat)
    return obj

def box(name, dimensions, center=(0, 0, 0), mat=outer):
    x, y, z = (v / 2 for v in dimensions)
    vertices = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    return mesh(name, vertices, faces, mat, center)

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def join(name, objects):
    for obj in objects:
        obj.select_set(False)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    obj.name = name
    prior=bpy.data.meshes.get(name)
    if prior and prior!=obj.data and prior.users==0: prior.name='archived_unused_'+name
    obj.data.name = name
    return obj

def torus(name, radius, minor, major_segments, minor_segments, center=(0,0,0), mat=gold):
    vertices, faces = [], []
    for i in range(major_segments):
        theta = i * math.tau / major_segments
        for j in range(minor_segments):
            phi = j * math.tau / minor_segments
            vertices.append(((radius + minor * math.cos(phi))*math.cos(theta), (radius + minor * math.cos(phi))*math.sin(theta), minor*math.sin(phi)))
    for i in range(major_segments):
        for j in range(minor_segments):
            faces.append((i*minor_segments+j, ((i+1)%major_segments)*minor_segments+j, ((i+1)%major_segments)*minor_segments+(j+1)%minor_segments, i*minor_segments+(j+1)%minor_segments))
    return mesh(name, vertices, faces, mat, center)

# Cell Fracture is not installed in this Blender session. Complete eight-octant
# fallback: closed convex cubes, true centroid pivots, exact aggregate volume 1.
shards = []
for x in (-.25,.25):
    for y in (-.25,.25):
        for z in (-.25,.25):
            obj = box('shard_%02d' % len(shards), (.5,.5,.5), (x,y,z), outer)
            obj.data.materials.append(inner)
            for face in obj.data.polygons:
                points = [obj.location + obj.data.vertices[i].co for i in face.vertices]
                is_outer = any(all(abs(abs(point[axis])-.5) < 1e-6 for point in points) for axis in range(3))
                face.material_index = 0 if is_outer else 1
            shards.append(obj)
groups['block_fractured'] = shards

# Four actual bevelled, cross-grooved plates on game-space +/-X and +/-Y.
plates = []
for axis in (0,1):
    for sign in (-1,1):
        center = [0,0,0]; center[axis] = sign * .55
        dimensions = [.84,.84,.84]; dimensions[axis] = .06
        plate = box('armor_plate_%s_%s' % (axis,sign), dimensions, center, outer)
        activate(plate)
        bevel = plate.modifiers.new('edge_bevel_003', 'BEVEL'); bevel.width=.03-ARMOR_BEVEL_CLEARANCE_M; bevel.segments=3
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        for groove_axis in [a for a in range(3) if a != axis]:
            cutter_dimensions = [.9,.9,.9]; cutter_dimensions[axis] = .03; cutter_dimensions[groove_axis] = .04
            cutter_center = list(center); cutter_center[axis] = sign * .58
            cutter = box('armor_groove_cutter', cutter_dimensions, cutter_center, None)
            activate(plate)
            boolean = plate.modifiers.new('groove_0015', 'BOOLEAN'); boolean.operation='DIFFERENCE'; boolean.solver='EXACT'; boolean.object=cutter
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

ring_parts = [torus('beam_ring_core', .42, .03, 48, 8)]
for i in range(4):
    angle=i*math.pi/2
    ring_parts.append(box('beam_node_%02d'%i, (.06,.06,.06), (.42*math.cos(angle),.42*math.sin(angle),0), gold))
groups['beam_ring'] = [join('beam_ring', ring_parts)]

def extruded_icon(name, points):
    minx,maxx=min(x for x,y in points),max(x for x,y in points)
    miny,maxy=min(y for x,y in points),max(y for x,y in points)
    cx,cy=(minx+maxx)/2,(miny+maxy)/2
    points=[(x-cx,y-cy) for x,y in points]
    # Tessellate the original concave outline for robust closed front/back caps.
    vectors=[Vector((x,y,0)) for x,y in points]
    triangles=tessellate_polygon([vectors])
    lookup={(round(v.x,7),round(v.y,7)):i for i,v in enumerate(vectors)}
    n=len(points); vertices=[(x,y,z) for z in (-.02,.02) for x,y in points]; faces=[]
    for triangle in triangles:
        indices=[v if isinstance(v,int) else lookup[(round(v.x,7),round(v.y,7))] for v in triangle]
        faces.append(tuple(reversed(indices))); faces.append(tuple(i+n for i in indices))
    for i in range(n):
        j=(i+1)%n; faces.append((i,j,j+n,i+n))
    return mesh(name,vertices,faces,inner)

palm=[(-.15,-.38),(.15,-.38),(.22,-.18),(.22,.29),(.13,.29),(.13,.08),(.10,.38),(.01,.38),(.01,.09),(-.02,.40),(-.11,.40),(-.11,.09),(-.14,.32),(-.23,.32),(-.23,.06),(-.34,.13),(-.40,.05),(-.24,-.18)]
fist=[(-.21,-.30),(.23,-.30),(.28,-.12),(.26,.16),(.16,.22),(.07,.22),(.04,.17),(-.01,.23),(-.10,.23),(-.14,.18),(-.20,.22),(-.29,.18),(-.31,.03),(-.40,-.02),(-.34,-.16)]
point=[(-.20,-.34),(.21,-.34),(.26,-.16),(.23,.02),(.11,.08),(.01,.04),(-.02,.40),(-.12,.40),(-.14,.02),(-.23,.01),(-.32,.10),(-.40,.02),(-.32,-.16)]
groups['glyphs']=[extruded_icon('glyph_palm',palm),extruded_icon('glyph_fist',fist),extruded_icon('glyph_point',point)]

# Faceted pylon with a real recessed lane-facing strip and explicit Col mask.
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
pylon=mesh('pylon',vertices,faces,body); pylon.data.materials.append(cyan)
for i,polygon in enumerate(pylon.data.polygons):
    polygon.material_index=materials[i]
bm=bmesh.new(); bm.from_mesh(pylon.data); bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000001)
if not all(edge.is_manifold for edge in bm.edges): raise RuntimeError('Pylon strip is not closed')
bm.to_mesh(pylon.data); bm.free()
color=pylon.data.color_attributes.new(name='Col',type='BYTE_COLOR',domain='CORNER')
for polygon in pylon.data.polygons:
    for loop in polygon.loop_indices: color.data[loop].color=(1,1,1,1) if polygon.material_index else (0,0,0,1)
pylon.data.color_attributes.active_color=color
groups['pylon']=[pylon]

# A distant open neon arena, with no upright opaque geometry in the human stage.
arena=[box('arena_floor',(24,.08,72),(0,-.44,-32),floor_mat)]
grid=[]
for x in range(-12,13,2): grid.append(box('grid_x_%s'%x,(.012,.008,68),(x,-.392,-30),grid_mat))
for z in range(-64,5,4): grid.append(box('grid_z_%s'%z,(24,.008,.012),(0,-.392,z),grid_mat))
arena.append(join('arena_grid',grid))
for name,xs,mat in [('arena_rail_cyan',(-3.4,3.4),cyan),('arena_rail_magenta',(-7.5,7.5),magenta)]:
    arena.append(join(name,[box(name+'_%s'%i,(.045,.035,66),(x,-.36,-30),mat) for i,x in enumerate(xs)]))
for side,sign in [('left',-1),('right',1)]:
    for i in range(4):
        z = -(i + 1) * PYLON_SPACING_M
        obj=bpy.data.objects.new('arena_pylon_%s_%02d'%(side,i),pylon.data)
        bpy.context.scene.collection.objects.link(obj); obj.location=to_blender((sign*PYLON_X,0,z)); obj['sign_saber_owned']=True; arena.append(obj)
for i,z in enumerate((-38,-58)):
    mat=cyan if i==0 else gold
    parts=[box('arch_%s_%s'%(i,j),dim,loc,mat) for j,(dim,loc) in enumerate([((.12,10,.14),(-8,4.6,z)),((.12,10,.14),(8,4.6,z)),((16,.12,.14),(0,9.6,z))])]
    arena.append(join('arena_arch_%02d'%i,parts))
arena.append(torus('arena_horizon_ring',10,.055,64,4,(0,9.5,-64),gold))
groups['arena_environment']=arena

def triangles(obj): return sum(len(p.vertices)-2 for p in obj.data.polygons)
budgets={'block_fractured':700,'armor':900,'beam_ring':900,'glyphs':1200,'pylon':600,'arena_environment':3000}
total=sum(triangles(obj) for objects in groups.values() for obj in objects)
if total>6000: raise RuntimeError('Total triangle budget exceeded: '+str(total))
records=[]
options_supported=set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
for name,objects in groups.items():
    tri=sum(triangles(obj) for obj in objects)
    if tri>budgets[name]: raise RuntimeError(name+' triangle budget exceeded: '+str(tri))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    options=dict(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_animations=False,export_skins=False,export_morph=False,export_cameras=False,export_lights=False,export_materials='EXPORT',export_image_format='NONE',export_texcoords=False,export_normals=True,export_extras=False,export_vertex_color='ACTIVE',export_all_vertex_colors=True,export_draco_mesh_compression_enable=False,export_copyright='Original Sign Saber procedural geometry; MIT')
    missing=set(options)-options_supported
    if missing: raise RuntimeError('Unsupported glTF options: '+str(sorted(missing)))
    result=bpy.ops.export_scene.gltf(**options)
    if 'FINISHED' not in result: raise RuntimeError('Export did not finish: '+name)
    path=OUT/(name+'.glb'); data=path.read_bytes()
    records.append({'id':name,'path':'/assets/models/'+name+'.glb','nodes':[obj.name for obj in objects],'triangles':tri,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'license':'MIT'})
volume=0
for obj in shards:
    bm=bmesh.new(); bm.from_mesh(obj.data)
    if not all(edge.is_manifold for edge in bm.edges): raise RuntimeError('Open shard mesh: '+obj.name)
    volume+=bm.calc_volume(signed=False); bm.free()
if abs(volume-1)>0.02: raise RuntimeError('Shard volume invalid: '+str(volume))
manifest={'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'sourceBlend':'assets-src/blender/signsaber_assets.blend','sourceGenerator':'assets-src/blender/generate_assets.py','authoringRoute':'official Blender MCP add-on JSON TCP execute_code; local 127.0.0.1:9876','blenderVersion':bpy.app.version_string,'blenderBuildHash':bpy.app.build_hash.decode(),'gltfExporter':'Blender bundled io_scene_gltf2','mcp':{'upstream':'https://github.com/ahujasid/blender-mcp','commit':'febcd90ece59c3416d7c55fd3723cea46bcaa59d','addonSha256':'8e193a249e2ed1262f3e794ee2254efd8e3d1f0224385245f2b989154c837083','addonVersion':'1.8','protocolVersion':15},'seed':SEED,'units':'metres','upAxis':'Y','materials':'Principled base color, no textures or emission','fractureMode':'complete-eight-octant fallback; Cell Fracture operator unavailable','armorSimplification':'Constructed with 0.03m 3-segment bevel and 0.015m Boolean grooves, then topology-preserving collapse from1024 to896 triangles to meet900-triangle budget.','shardCount':len(shards),'shardVolumeM3':volume,'clearStage':{'x':[-3,3],'z':[-5,4],'y':[0,3],'note':'No upright opaque geometry intersects the central human play stage; floor is below y=0.'},'assets':records,'totalTriangles':total,'totalGlbBytes':sum(r['bytes'] for r in records),'provenance':'Original script-authored geometry. No Poly Haven, Sketchfab, generative asset service or third-party meshes/textures used. MIT repository license.'}
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE),compress=True)
manifest['sourceBlendSha256']=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
manifest['sourceGeneratorSha256']=hashlib.sha256((ROOT/manifest['sourceGenerator']).read_bytes()).hexdigest()
manifest['sharedConstants']={'source':'app/src/core/constants.ts','PYLON_SPACING_M':PYLON_SPACING_M,'PYLON_X':PYLON_X}
manifest['armorConstruction']={'bevelOffsetM':.03-ARMOR_BEVEL_CLEARANCE_M,'bevelClearanceM':ARMOR_BEVEL_CLEARANCE_M,'bevelSegments':3,'grooveDepthM':.015,'preSimplifyTriangles':armor_triangles,'exportTriangles':triangles(armor)}
manifest['armorSimplification']='Three-segment bevel at 0.02999m (10 micrometres below half thickness avoids coincident corner seams), 0.015m grooves; budget simplification from %s to %s triangles.'%(armor_triangles,triangles(armor))
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
(OUT/'ASSET_LICENSE.txt').write_text((ROOT/'LICENSE').read_text(encoding='utf8'),encoding='utf8')
print('SIGN_SABER_ASSETS '+json.dumps({'assets':len(records),'triangles':total,'bytes':manifest['totalGlbBytes'],'shardCount':len(shards),'shardVolumeM3':volume}))
