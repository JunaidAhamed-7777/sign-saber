"""Render the actual authored arena through Blender MCP; no camera/user image input.
Preview-only emission/lighting is restored and is not part of exported GLBs.
"""
import bpy
import pathlib
import math
from mathutils import Vector
source=pathlib.Path(bpy.data.filepath).resolve()
if source.name!='signsaber_assets.blend' or not bpy.context.scene.get('sign_saber_asset_session'):
    raise RuntimeError('Dedicated authoring file required')
scene=bpy.context.scene
original_camera=scene.camera
hidden={obj:obj.hide_render for obj in scene.objects}
created=[]
emissions=[]
def at(point): return Vector((point[0],-point[2],point[1]))
try:
    for obj in scene.objects: obj.hide_render=not obj.name.startswith('arena_')
    camera_data=bpy.data.cameras.new('sign_saber_preview_camera')
    camera=bpy.data.objects.new('sign_saber_preview_camera',camera_data)
    scene.collection.objects.link(camera);created.append(camera)
    camera.location=at((0,4.4,12))
    camera.rotation_euler=(at((0,2.4,-28))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.lens=24;scene.camera=camera
    for i,(pos,power,color) in enumerate([((0,7,8),3000,(.35,.65,1)),((-8,5,-15),1800,(.10,.9,1)),((8,5,-30),1800,(1,.10,.6))]):
        data=bpy.data.lights.new('sign_saber_preview_light_%s'%i,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=12
        obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj);created.append(obj);obj.location=at(pos)
        obj.rotation_euler=(at((0,0,-20))-obj.location).to_track_quat('-Z','Y').to_euler()
    for material in bpy.data.materials:
        if material.name.startswith('arena_neon_'):
            node=material.node_tree.nodes.get('Principled BSDF')
            color=node.inputs.get('Emission Color');strength=node.inputs.get('Emission Strength')
            if color and strength:
                emissions.append((color,tuple(color.default_value),strength,strength.default_value))
                color.default_value=node.inputs['Base Color'].default_value;strength.default_value=3
    scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(source.parent/'arena-preview.png')
    scene.world.color=(.025,.035,.06)
    scene.world.use_nodes=True
    background=scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value=(.002,.004,.008,1)
    background.inputs['Strength'].default_value=.15
    bpy.ops.render.render(write_still=True)
    print('ACTUAL_BLENDER_RENDER '+scene.render.filepath)
finally:
    for color,value,strength,power in emissions: color.default_value=value;strength.default_value=power
    for obj,value in hidden.items(): obj.hide_render=value
    scene.camera=original_camera
    for obj in created: bpy.data.objects.remove(obj,do_unlink=True)
