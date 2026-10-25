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
parser.add_argument('--port', type=int, default=9876, help='Local bridge port; use a distinct port per concurrent authoring instance')
parser.add_argument('--blend', default='signsaber_assets.blend', help='Dedicated authoring file name under assets-src/blender')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = pathlib.Path(args.root).resolve()
addon_path = pathlib.Path(args.addon).resolve()
if bpy.data.filepath or bpy.data.is_dirty:
    raise RuntimeError('Bootstrap requires a new untouched --factory-startup process; preserving the current scene')
expected = '8e193a249e2ed1262f3e794ee2254efd8e3d1f0224385245f2b989154c837083'
if hashlib.sha256(addon_path.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Official Blender MCP add-on hash does not match the pinned source')
if pathlib.Path(args.blend).name != args.blend or not args.blend.endswith('.blend'):
    raise RuntimeError('--blend must be a plain .blend file name under assets-src/blender')
if not 1024 <= args.port <= 65535:
    raise RuntimeError('--port must be an unprivileged TCP port')
asset_file = root / 'assets-src' / 'blender' / args.blend
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
# This pinned, isolated authoring session must not phone home for updates.
update_timer = getattr(addon, '_addon_update_check_on_startup', None)
if update_timer and bpy.app.timers.is_registered(update_timer):
    bpy.app.timers.unregister(update_timer)
bpy.context.scene.blendermcp_auto_start_server = False
for name in ('blendermcp_use_polyhaven', 'blendermcp_use_hyper3d', 'blendermcp_use_sketchfab', 'blendermcp_use_hunyuan3d', 'blendermcp_use_polypizza', 'blendermcp_use_tripo', 'blendermcp_use_meshy'):
    if hasattr(bpy.context.scene, name):
        setattr(bpy.context.scene, name, False)
server = addon.BlenderMCPServer(host='127.0.0.1', port=args.port)
bpy.types.blendermcp_server = server
server.start()
if not server.running:
    raise RuntimeError('Blender MCP bridge did not start; use a GUI or isolated virtual display, not background mode')
print('SIGN_SABER_BLENDER_MCP_READY', bpy.app.version_string, str(asset_file), args.port, flush=True)
