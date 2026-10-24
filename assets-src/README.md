# Asset sources

Source files for assets that are exported into `app/public/assets/`. Nothing here is loaded at runtime.

| Folder | Contents | Pipeline |
| --- | --- | --- |
| `blender/` | `.blend` files and the `bpy` scripts used with Blender MCP to produce the GLBs (fractured block, glyphs, armor, beam ring, pylon) | [docs/18-blender-mcp-asset-pipeline.md](../docs/18-blender-mcp-asset-pipeline.md) |
| `textures/` | Glyph atlas source (SVG), hazard stripe source | docs/11 |
| `audio/` | Raw SFX takes and the CC0 track originals before encoding | docs/15 §SFX bus, docs/09 §Bundled tracks |

No production assets are committed yet. Record provenance, author, source URL, permitted transformations, license and exported-file hash as assets are added. Original project assets may use MIT; imported models, textures, fonts and audio retain their own licenses. Third-party audio is recorded in the [track registry](../app/public/assets/tracks/README.md). Blender/MCP is optional; [18](../docs/18-blender-mcp-asset-pipeline.md) specifies both manual and procedural fallbacks.
