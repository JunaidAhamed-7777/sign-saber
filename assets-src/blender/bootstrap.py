"""Start an isolated authoring file and the verified official Blender MCP bridge.
Invoke Blender in a NEW --factory-startup process; never run against a user scene.
"""
import argparse
import hashlib
import importlib.util
import pathlib
import sys
import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--addon', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = pathlib.Path(args.root).resolve()
addon_path = pathlib.Path(args.addon).resolve()
if bpy.data.filepath or bpy.data.is_dirty:
    raise RuntimeError('Bootstrap requires a new untouched --factory-startup process; preserving the current scene')
expected = '8e193a249e2ed1262f3e794ee2254efd8e3d1f0224385245f2b989154c837083'
if hashlib.sha256(addon_path.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Official Blender MCP add-on hash does not match the pinned source')
asset_file = root / 'assets-src' / 'blender' / 'signsaber_assets.blend'
asset_file.parent.mkdir(parents=True, exist_ok=True)
if asset_file.exists():
    bpy.ops.wm.open_mainfile(filepath=str(asset_file))
else:
    for obj in list(bpy.context.scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.scene.name = 'SignSaberAssetAuthoring'
    bpy.context.scene['sign_saber_asset_session'] = True
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0
    bpy.ops.wm.save_as_mainfile(filepath=str(asset_file))
spec = importlib.util.spec_from_file_location('sign_saber_blender_mcp', addon_path)
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.scene.blendermcp_auto_start_server = False
for name in ('blendermcp_use_polyhaven', 'blendermcp_use_hyper3d', 'blendermcp_use_sketchfab', 'blendermcp_use_hunyuan3d', 'blendermcp_use_polypizza'):
    if hasattr(bpy.context.scene, name):
        setattr(bpy.context.scene, name, False)
server = addon.BlenderMCPServer(host='127.0.0.1', port=9876)
bpy.types.blendermcp_server = server
server.start()
print('SIGN_SABER_BLENDER_MCP_READY', bpy.app.version_string, str(asset_file), flush=True)
