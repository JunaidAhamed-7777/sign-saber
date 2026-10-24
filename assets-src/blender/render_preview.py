"""Render the actual authored arena through Blender MCP; no camera/user image input.
Preview-only camera, lights and emission are temporary and removed again; exported GLBs stay
base-colour only. Writes arena-preview.png from the gameplay camera (CAM_POS/CAM_LOOK_AT/CAM_FOV_DEG)
and asset-sheet/arena_overview.png from an elevated three-quarter view.
"""
import bpy
import math
import pathlib
import re
from mathutils import Vector

source = pathlib.Path(bpy.data.filepath).resolve()
if source.name != 'signsaber_assets.blend' or not bpy.context.scene.get('sign_saber_asset_session'):
    raise RuntimeError('Dedicated authoring file required')
constants = (source.parents[2] / 'app' / 'src' / 'core' / 'constants.ts').read_text(encoding='utf8')
def vec3(name):
    match = re.search(name + r'\s*=\s*\{\s*x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+)', constants)
    if not match: raise RuntimeError('Missing camera constant ' + name)
    return tuple(float(v) for v in match.groups())
CAM_POS, CAM_LOOK_AT = vec3('CAM_POS'), vec3('CAM_LOOK_AT')
CAM_FOV_DEG = float(re.search(r'CAM_FOV_DEG\s*=\s*([\d.]+)', constants).group(1))
scene = bpy.context.scene
original_camera = scene.camera
hidden = {obj: obj.hide_render for obj in scene.objects}
created = []
emissions = []
def at(point): return Vector((point[0], -point[2], point[1]))
try:
    for obj in scene.objects: obj.hide_render = not obj.name.startswith('arena_')
    camera_data = bpy.data.cameras.new('sign_saber_preview_camera')
    camera = bpy.data.objects.new('sign_saber_preview_camera', camera_data)
    scene.collection.objects.link(camera); created.append(camera)
    camera_data.sensor_fit = 'VERTICAL'
    camera_data.angle = math.radians(CAM_FOV_DEG)
    camera_data.clip_end = 400
    scene.camera = camera
    for i, (pos, power, color) in enumerate([((0, 9, 6), 2500, (.35, .55, 1)), ((-10, 6, -18), 2200, (.10, .9, 1)), ((10, 6, -30), 2200, (1, .15, .7))]):
        data = bpy.data.lights.new('sign_saber_preview_light_%s' % i, 'AREA'); data.energy = power; data.color = color; data.shape = 'DISK'; data.size = 14
        obj = bpy.data.objects.new(data.name, data); scene.collection.objects.link(obj); created.append(obj); obj.location = at(pos)
        obj.rotation_euler = (at((0, 0, -20)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    for material in bpy.data.materials:
        if material.get('sign_saber_owned') and material.get('preview_emission'):
            node = material.node_tree.nodes.get('Principled BSDF')
            color = node.inputs.get('Emission Color'); strength = node.inputs.get('Emission Strength')
            emissions.append((color, tuple(color.default_value), strength, strength.default_value))
            color.default_value = node.inputs['Base Color'].default_value; strength.default_value = float(material['preview_emission'])
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (.0016, .002, .0045, 1)
    background.inputs['Strength'].default_value = 1
    shots = [
        (source.parent / 'arena-preview.png', CAM_POS, CAM_LOOK_AT, 1440, 900, None),
        (source.parent / 'asset-sheet' / 'arena_overview.png', (16, 14, 14), (0, 1, -30), 1440, 900, 40),
    ]
    for path, eye, look, width, height, lens in shots:
        path.parent.mkdir(exist_ok=True)
        scene.render.resolution_x = width; scene.render.resolution_y = height
        camera.location = at(eye)
        camera.rotation_euler = (at(look) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        if lens:
            camera_data.sensor_fit = 'AUTO'; camera_data.lens = lens
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        print('ACTUAL_BLENDER_RENDER ' + str(path))
finally:
    for color, value, strength, power in emissions: color.default_value = value; strength.default_value = power
    for obj, value in hidden.items(): obj.hide_render = value
    scene.camera = original_camera
    for obj in created:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if isinstance(data, bpy.types.Camera): bpy.data.cameras.remove(data)
        elif isinstance(data, bpy.types.Light): bpy.data.lights.remove(data)
