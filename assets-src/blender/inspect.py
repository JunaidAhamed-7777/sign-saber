import bpy
import json
result = {'blender': bpy.app.version_string, 'file': bpy.data.filepath, 'scene': bpy.context.scene.name}
try:
    result['cell_fracture_options'] = sorted(bpy.ops.object.add_fracture_cell_objects.get_rna_type().properties.keys())
except Exception as error:
    result['cell_fracture_unavailable'] = type(error).__name__
result['gltf_options'] = sorted(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
for key in ('export_vertex_color', 'export_image_format'):
    prop = bpy.ops.export_scene.gltf.get_rna_type().properties[key]
    result[key] = [item.identifier for item in prop.enum_items]
print(json.dumps(result))
