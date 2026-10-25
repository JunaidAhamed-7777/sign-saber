# Blender-authored Sign Saber assets

These are actual authored assets, created in **Blender 5.2.2 LTS** through the official **Blender MCP add-on JSON TCP API**, then exported to [the local model pack](../../app/public/assets/models/manifest.json). This uses the add-on's documented bridge on `127.0.0.1:9876`; a Blender connector tool was not available in the chat. No user scene was reset: authoring used a separate hidden factory-startup process and the dedicated `signsaber_assets.blend` file.

The pinned upstream is [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp/tree/febcd90ece59c3416d7c55fd3723cea46bcaa59d), commit `febcd90ece59c3416d7c55fd3723cea46bcaa59d`, add-on 1.8/protocol 15. Its `addon.py` SHA-256 is `8e193a249e2ed1262f3e794ee2254efd8e3d1f0224385245f2b989154c837083`. The bootstrap verifies that digest. Poly Haven, Sketchfab, Hyper3D and Hunyuan integrations stay disabled. All exported geometry is original script-authored work under the repository MIT license; no third-party meshes, icons, textures or user images were acquired.

- `generate_assets.py` builds the six pack members. Blender coordinates are explicitly adapted to game/glTF +Y-up metres. Glyphs and the beam ring face +Z in the XY plane.
- `signsaber_assets.blend` is the actual compressed source file. Its current hash is in the model manifest.
- `arena-preview.png` is an actual Blender render of the authored arena, using temporary preview lights/emission. It is not gameplay or webcam evidence; exported materials retain base color only.
- `render_preview.py` recreates that preview through the bridge without saving preview overrides into the source file.
- `inspect.py` reads actual operator capabilities. Cell Fracture was unavailable (`get_rna_type()` raised `KeyError`), so `block_fractured.glb` contains the documented complete **eight-octant fallback**, with closed convex shards, centroid pivots and total volume 1 m³. This is not a claim of 14-cell Cell Fracture output.

The armour uses a 0.02999 m three-segment bevel: a documented 10 µm clearance below half the plate thickness prevents coincident corner seams. Grooves are 0.015 m deep. It is simplified from 1,024 to 896 triangles to meet its 900-triangle budget, then checked for closed, consistently oriented geometry. The manifest records these adjustments. The pylon includes a closed recessed strip with its `Col` vertex-color mask. Arena geometry keeps the central human stage clear; the floor remains below it. Pylon positions consume `PYLON_X` and `PYLON_SPACING_M` from the shared constants source.

Two consecutive actual Blender MCP regenerations produced identical GLB SHA-256 hashes. The source `.blend` contains normal Blender save metadata and is recorded by its actual hash; no byte-identical `.blend` promise is made.

With a freshly launched dedicated instance and the pinned upstream add-on already downloaded, the existing commands are:

```powershell
# Start a NEW Blender process with --factory-startup, then run bootstrap.py:
# --python <absolute bootstrap.py path> -- --root <repository path> --addon <pinned addon.py path>
node scripts/blender-mcp.mjs get_scene_info
node scripts/blender-mcp.mjs execute_code assets-src/blender/inspect.py
node scripts/blender-mcp.mjs execute_code assets-src/blender/generate_assets.py
node scripts/blender-mcp.mjs execute_code assets-src/blender/render_preview.py
node scripts/check-model-assets.mjs
node --test scripts/check-model-assets.test.mjs
```

Concurrent authoring uses a separate dedicated instance and file: pass `--port <port> --blend <name>.blend` to bootstrap.py and set `BLENDER_MCP_PORT=<port>` for `scripts/blender-mcp.mjs`. The defaults remain port 9876 and `signsaber_assets.blend`. The bootstrap refuses a dirty or already-open scene. The generator refuses any file without the dedicated authoring marker, deletes only its own tagged generated objects, and preserves other objects instead of silently reusing their names. The bridge client is local-only and bounds command responses/timeouts.

The [structural validation report](../../app/public/assets/models/validation.json) checks actual GLB bytes, hashes, semantic nodes, unit scale, axes, glyph bounds/thickness, watertightness/volume/pivots, pylon color data and central-stage clearance. The separate [Khronos report](../../app/public/assets/models/khronos-validation.json) retains the actual **Khronos glTF Validator 2.0.0-dev.3.10** outcomes: all six files had zero errors, warnings and infos. The optional `--khronos=<absolute path to gltf-validator/index.js>` flag reruns that validator when installed as an authoring QA tool. A structural-only run does not overwrite the separate Khronos report. It is not a game runtime dependency. Browser appearance and live gameplay are separate checks.

## Isolated bridge checks

The bootstrap cancels the pinned add-on’s automatic update timer, disables all optional third-party asset services and refuses to report readiness when the loopback server fails to start. Run `python scripts/test_blender_bootstrap.py` from the repository root for five offline safety checks. These use mocks and require neither Blender nor network access; they do not replace actual GUI/bridge verification.
