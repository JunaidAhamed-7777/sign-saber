"""Render actual Blender previews of the authored avatar (no camera/user image input).

Temporary cameras/lights are removed afterwards and are never exported. Set
SIGN_SABER_PREVIEW_DIR to choose the output folder and SIGN_SABER_PREVIEW_VIEWS to a
subset of view names; SIGN_SABER_PREVIEW_ENGINE selects 'BLENDER_WORKBENCH' (shape) or
'BLENDER_EEVEE' (material). Game axes: X avatar-left, Y up, Z toward the viewer.
"""
import bpy
import math
import pathlib
from mathutils import Vector

source = pathlib.Path(bpy.data.filepath).resolve()
if source.name != 'signsaber_avatar.blend' or not bpy.context.scene.get('sign_saber_asset_session'):
    raise RuntimeError('Dedicated avatar authoring file required')
out_dir = pathlib.Path(globals().get('SIGN_SABER_PREVIEW_DIR', str(source.parent)))
out_dir.mkdir(parents=True, exist_ok=True)
engine = globals().get('SIGN_SABER_PREVIEW_ENGINE', 'BLENDER_WORKBENCH')
prefix = globals().get('SIGN_SABER_PREVIEW_PREFIX', 'avatar')


def at(p):
    return Vector((p[0], -p[2], p[1]))


# name: (camera position, look-at, orthographic scale or lens mm, resolution)
VIEWS = {
    'front': ((0, 0.40, 3.0), (0, 0.38, 0), ('ORTHO', 1.45), (900, 1000)),
    'three_quarter': ((1.55, 0.75, 2.35), (0, 0.38, 0), ('PERSP', 50), (900, 1000)),
    'side': ((3.0, 0.40, 0), (0, 0.38, 0), ('ORTHO', 1.45), (700, 1000)),
    'back': ((0, 0.40, -3.0), (0, 0.38, 0), ('ORTHO', 1.45), (900, 1000)),
    'head': ((0.22, 0.76, 0.55), (0, 0.735, 0.02), ('PERSP', 85), (800, 900)),
    'head_front': ((0, 0.75, 0.6), (0, 0.745, 0), ('PERSP', 85), (800, 900)),
    'hand': ((0.62, 0.32, 0.45), (0.64, 0.09, 0.0), ('PERSP', 85), (900, 800)),
    'hand_palm': ((0.40, -0.05, 0.25), (0.64, 0.09, 0.0), ('PERSP', 85), (900, 800)),
    'wide_front': ((0, 0.55, 3.0), (0, 0.55, 0), ('ORTHO', 1.9), (1000, 1000)),
    'wide_three_quarter': ((-1.4, 0.9, 2.4), (0, 0.5, 0), ('PERSP', 40), (1000, 1000)),
    'wide_close': ((0.9, 0.7, 1.3), (0.15, 0.55, 0.1), ('PERSP', 45), (1000, 1000)),
}
selected = globals().get('SIGN_SABER_PREVIEW_VIEWS', list(VIEWS))
scene = bpy.context.scene
original_camera = scene.camera
original_engine = scene.render.engine
created = []
written = []
hidden = {obj: obj.hide_render for obj in scene.objects}
try:
    for obj in scene.objects:
        obj.hide_render = not obj.get('sign_saber_avatar_owned') or obj.type not in {'MESH'}
    scene.render.engine = engine
    if engine == 'BLENDER_WORKBENCH':
        shading = scene.display.shading
        shading.light = 'STUDIO'
        shading.color_type = 'MATERIAL'
        shading.show_cavity = True
        shading.cavity_type = 'BOTH'
        shading.show_specular_highlight = True
        scene.display.render_aa = '8'
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (0.02, 0.025, 0.04, 1)
    background.inputs['Strength'].default_value = 1.0
    if engine != 'BLENDER_WORKBENCH':
        for i, (pos, power, color) in enumerate([((1.2, 1.6, 2.2), 260, (1, 0.97, 0.92)), ((-1.8, 1.0, 1.2), 90, (0.6, 0.75, 1.0)), ((0, 1.4, -2.0), 160, (0.6, 0.8, 1.0))]):
            data = bpy.data.lights.new('avatar_preview_light_%d' % i, 'AREA')
            data.energy = power
            data.color = color
            data.size = 1.2
            light = bpy.data.objects.new(data.name, data)
            scene.collection.objects.link(light)
            created.append(light)
            light.location = at(pos)
            light.rotation_euler = (at((0, 0.4, 0)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    for name in selected:
        pos, target, (kind, value), (rx, ry) = VIEWS[name]
        data = bpy.data.cameras.new('avatar_preview_camera')
        camera = bpy.data.objects.new('avatar_preview_camera', data)
        scene.collection.objects.link(camera)
        created.append(camera)
        camera.location = at(pos)
        camera.rotation_euler = (at(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        if kind == 'ORTHO':
            data.type = 'ORTHO'
            data.ortho_scale = value
        else:
            data.lens = value
        data.clip_start = 0.01
        scene.camera = camera
        scene.render.resolution_x = rx
        scene.render.resolution_y = ry
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        path = out_dir / ('%s_%s.png' % (prefix, name))
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        written.append(str(path))
    print('ACTUAL_BLENDER_RENDER ' + ' '.join(written))
finally:
    for obj, value in hidden.items():
        obj.hide_render = value
    scene.camera = original_camera
    scene.render.engine = original_engine
    for obj in created:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if isinstance(data, bpy.types.Camera):
            bpy.data.cameras.remove(data)
        elif isinstance(data, bpy.types.Light):
            bpy.data.lights.remove(data)
