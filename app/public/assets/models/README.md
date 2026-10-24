# Authored local model pack

Actual Blender MCP-authored assets, source and reproducible generation scripts: [Blender source](../../../../assets-src/blender/README.md). Runtime files are local; Blender and MCP are not needed to play a prepared build.

The pack contains `block_fractured.glb`, `armor.glb`, `beam_ring.glb`, `glyphs.glb`, `pylon.glb` and `arena_environment.glb`. Exact semantic node names, measured triangles/bytes, SHA-256 hashes, source/tool provenance, coordinate conventions and documented fallbacks are in [manifest.json](manifest.json). The source geometry and these exports use [the project MIT license](ASSET_LICENSE.txt).

The shard asset deliberately uses eight complete octants because Cell Fracture was unavailable. Armour retains the authored bevel/groove construction with a documented budget simplification. No textures, emission, animation, skin, camera or light is embedded in these GLBs. The game controls shading and music response. A missing/corrupt asset must use the renderer's procedural fallback; the presence of a file is not proof that it loaded in a browser.

[validation.json](validation.json) records actual structural checks; [khronos-validation.json](khronos-validation.json) retains the separate Khronos validation run. The [Blender render](../../../../assets-src/blender/arena-preview.png) illustrates the authored arena with a temporary preview lighting rig; it is not a screenshot of gameplay.
