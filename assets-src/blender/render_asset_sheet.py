"""Render a contact sheet of every exported asset group through the Blender MCP bridge.
Preview-only camera, lights and emission are temporary and are removed again; the source
file is not saved. Output: assets-src/blender/asset-sheet/<group>.png (1 image per group).
"""
import bpy
import math
import pathlib
from mathutils import Vector

source = pathlib.Path(bpy.data.filepath).resolve()
if source.name != 'signsaber_assets.blend' or not bpy.context.scene.get('sign_saber_asset_session'):
    raise RuntimeError('Dedicated authoring file required')
scene = bpy.context.scene
OUT = source.parent / 'asset-sheet'
OUT.mkdir(exist_ok=True)
GROUPS = {
    'block_shell': (['block_shell', 'block_core'], (1.3, -1.6, 1.0), 0.0),
    'block_fractured': (['shard_'], (1.6, -2.2, 1.4), 0.55),
    'armor': (['armor_plates'], (1.6, -2.2, 1.3), 0.0),
    'beam_ring': (['beam_ring'], (0.0, -1.6, 0.25), 0.0),
    'glyphs': (['glyph_'], (0.0, -3.4, 0.0), 0.0),
    'pylon': (['pylon'], (2.4, -5.5, 3.6), 0.0),
}
original_camera = scene.camera
hidden = {obj: obj.hide_render for obj in scene.objects}
saved_locations = {}
created = []
emissions = []
try:
    camera_data = bpy.data.cameras.new('sheet_camera')
    camera = bpy.data.objects.new('sheet_camera', camera_data)
    scene.collection.objects.link(camera)
    created.append(camera)
    scene.camera = camera
    for i, (pos, power) in enumerate([((3, -4, 5), 900), ((-4, -2, 2), 450), ((0, 5, 3), 650)]):
        data = bpy.data.lights.new('sheet_light_%s' % i, 'AREA')
        data.energy = power
        data.size = 4
        obj = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(obj)
        created.append(obj)
        obj.location = pos
        obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    for material in bpy.data.materials:
        if material.get('sign_saber_owned') and material.get('preview_emission'):
            node = material.node_tree.nodes.get('Principled BSDF')
            color = node.inputs.get('Emission Color')
            strength = node.inputs.get('Emission Strength')
            emissions.append((color, tuple(color.default_value), strength, strength.default_value))
            color.default_value = node.inputs['Base Color'].default_value
            strength.default_value = float(material['preview_emission'])
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (.004, .006, .012, 1)
    background.inputs['Strength'].default_value = 1
    for group, (prefixes, eye, explode) in GROUPS.items():
        members = [o for o in scene.objects if o.type == 'MESH' and o.get('sign_saber_owned') and any(o.name == p or (p.endswith('_') and o.name.startswith(p)) for p in prefixes)]
        if not members:
            continue
        for obj in scene.objects:
            obj.hide_render = obj not in members and obj.type == 'MESH'
        if explode:
            for obj in members:
                saved_locations[obj] = obj.location.copy()
                obj.location = obj.location * (1 + explode * 2)
        if group == 'glyphs':
            for index, obj in enumerate(sorted(members, key=lambda o: o.name)):
                saved_locations.setdefault(obj, obj.location.copy())
                obj.location = Vector(((index % 2 - .5) * 0.95, 0, .48 - (index // 2) * 0.95))
        camera.location = eye
        target = Vector((0, 0, 3.0 if group == 'pylon' else 0))
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera_data.lens = 50
        scene.render.filepath = str(OUT / (group + '.png'))
        bpy.ops.render.render(write_still=True)
        for obj, location in saved_locations.items():
            obj.location = location
        saved_locations.clear()
    print('ASSET_SHEET ' + str(OUT))
finally:
    for obj, location in saved_locations.items():
        obj.location = location
    for color, value, strength, power in emissions:
        color.default_value = value
        strength.default_value = power
    for obj, value in hidden.items():
        obj.hide_render = value
    scene.camera = original_camera
    for obj in created:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if isinstance(data, bpy.types.Camera): bpy.data.cameras.remove(data)
        elif isinstance(data, bpy.types.Light): bpy.data.lights.remove(data)
