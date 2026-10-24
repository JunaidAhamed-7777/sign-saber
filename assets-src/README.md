# Asset sources

Source files for assets that are exported into `app/public/assets/`. Nothing here is loaded at runtime.

| Folder | Contents | Pipeline |
| --- | --- | --- |
| `blender/` | `.blend` files and the `bpy` scripts used with Blender MCP to produce the GLBs (fractured block, glyphs, armor, beam ring, pylon) | [docs/18-blender-mcp-asset-pipeline.md](../docs/18-blender-mcp-asset-pipeline.md) |
| `textures/` | Glyph atlas source (SVG), hazard stripe source | docs/11 |
| `audio/` | Raw SFX takes and the CC0 track originals before encoding | docs/15 §SFX bus, docs/09 §Bundled tracks |

All assets created here are our own work and are released under the repository's MIT license. Third-party audio is listed with its license in `app/public/assets/tracks/README.md`.
