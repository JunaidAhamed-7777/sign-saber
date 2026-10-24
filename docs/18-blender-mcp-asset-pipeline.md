# 18 — Blender MCP Asset Pipeline

Sign Saber needs a handful of small, stylised 3D assets. Blender and optional **Blender MCP** produce authored geometry; the runtime loads glTF Binary assets and has a **procedural Three.js fallback** for every asset. Build those fallbacks during P1/P2 before authored P3 assets ([roadmap](../ROADMAP.md)). The first authored pack is now implemented through the official Blender MCP local add-on bridge. [The asset manifest](../app/public/assets/models/manifest.json) and [source build notes](../assets-src/blender/README.md) identify actual tool versions, six GLBs, original geometry, source blend, hashes and validation. The pack is 3,320 triangles / 194,488 bytes. Cell Fracture is unavailable in this Blender install: the block is the complete eight-octant fallback, not 14 cells. Human gameplay/performance evidence remains separate.

Rendering consumers: [11](11-rendering-blocks-and-destruction.md) (fractured cube, armour, beam ring, glyphs), [13](13-rendering-environment-camera-postfx.md) (pylons), [14](14-ui-ux.md) (results podium).

## 1. Setup

1. Choose and record one Blender release plus the Cell Fracture extension/add-on version; verify availability in a fresh asset-only file. Do not assume every Blender install bundles the same operator. [Blender's 4.2 pipeline notes](https://developer.blender.org/docs/release_notes/4.2/pipeline_assets_io/) describe exporter changes; the actual installed RNA operator schema controls scripts below.
2. Optional: install the add-on/server from the [Blender MCP upstream project](https://github.com/ahujasid/blender-mcp), recording the exact release/commit. Use its current installation guidance rather than an assumed sidebar label; the upstream documents localhost port 9876. This is an authoring tool, not a runtime dependency.
3. Register that server with the chosen AI client and confirm a read-only scene-info operation. Save the fresh asset file before any generated Python; keep authoring independent from the running game and use manual Blender operations if MCP is unavailable.
4. Set the scene unit scale to metric, 1.0 (`Scene Properties → Units`), and work in a fresh file saved as `assets-src/blender/signsaber_assets.blend`.
5. Export path convention: all GLBs go to `app/public/assets/models/<name>.glb`. Commit the `.blend` and the exported GLBs.

Any step may be done by hand in Blender's UI instead of via MCP; the MCP route is simply faster for the scripted parts (fracture, origins, batch export).

## 2. Global conventions

| Rule | Value |
| --- | --- |
| Units | 1 Blender unit = 1 metre; the game scales where needed |
| Up axis | glTF export converts Blender +Z up to glTF +Y up automatically (`export_yup=True`) |
| Transforms | Apply rotation and scale before export; scale MUST be 1. Preserve each shard's centroid location and the authored pivot. Applying location blindly would destroy the shard-offset contract. |
| Modifiers | Applied on export (`export_apply=True`) |
| Materials | Principled BSDF, base colour only, **no textures**, no emission (emission is done in shaders) |
| Excluded | Cameras, lights, animations, shape keys, skins |
| Naming | lowercase snake_case object names; the game looks children up by name |
| Polycount | Per asset budgets below; total of all assets ≤ 6 000 triangles |
| Format | glTF Binary (`.glb`), no Draco (keeps the loader simple; files are tiny) |

## 3. Asset list

### 3.1 `block_fractured.glb` — pre-fractured cube (smash shards)

| Spec | Value |
| --- | --- |
| Source | 1 × 1 × 1 m cube centred at the origin |
| Fracture | Cell Fracture, **14 cells**, deterministic child-vertex seed points, no additional unseeded noise, margin 0.001, recursion 0. Record seed and extension version. |
| Shards | 14 meshes named `shard_00` … `shard_13`, each with **origin at its own centroid** (`Origin to Center of Mass (Volume)`), each a closed convex mesh |
| Interior faces | Cell Fracture's inner faces get material slot `inner` (base colour `#FFFFFF`) so the shader can tint cross-sections; outer faces slot `outer` (`#808080`) |
| Polycount | ≤ 700 tris total (shards are convex polyhedra; ~40–60 tris each) |
| Validation | Σ shard volumes ≈ 1.0 m³ ± 2 % |

Consumer: [11 §4](11-rendering-blocks-and-destruction.md#4-shatter-smash-blocks). The game multiplies by `BLOCK_SIZE`.

### 3.2 `glyphs.glb` — gesture glyph meshes

| Spec | Value |
| --- | --- |
| Objects | `glyph_palm`, `glyph_fist`, `glyph_point` |
| Size | Each fits a 0.8 × 0.8 m square in XY, extruded 0.04 m in Z, origin at its centre |
| Style | Bold stylised silhouettes (icon-like, no fingers thinner than 0.08 m so they survive at small screen size) |
| Method | Import SVG (`File → Import → SVG`) of three hand icons drawn as single filled paths → convert to mesh → extrude → remesh/decimate; or model from primitives (palm: rounded rect + 4 capsule fingers + thumb; fist: rounded box + 4 knuckle bumps; point: fist + 1 extended capsule) |
| Polycount | ≤ 400 tris each |

Consumer: Results podium and Song Select decoration ([14](14-ui-ux.md)). In-lane blocks use a 2D glyph atlas instead ([11 §2.2](11-rendering-blocks-and-destruction.md#22-material-custom-glass-shadermaterial)); the atlas SVGs SHOULD be the same paths used here so the icons match.

### 3.3 `armor.glb` — armour plates (smash blocks)

| Spec | Value |
| --- | --- |
| Objects | `armor_plates` (single merged mesh) |
| Geometry | 4 plates on the ±X and ±Y faces of a 1 m cube: each 0.84 × 0.84 m, 0.06 m thick, sitting 0.02 m proud of the face, bevel 0.03 m with 3 segments, a shallow 0.015 m groove cross on each plate |
| Origin | Cube centre |
| Polycount | ≤ 900 tris |

Consumer: [11 §2.4](11-rendering-blocks-and-destruction.md#24-armour-plates-smash). Scaled by `BLOCK_SIZE`.

### 3.4 `beam_ring.glb` — beam target ring

| Spec | Value |
| --- | --- |
| Object | `beam_ring` |
| Geometry | Torus, major radius 0.42 m, minor radius 0.03 m, 48 major × 8 minor segments; 4 small 0.06 m box "nodes" at 0°/90°/180°/270° merged in |
| Origin | Centre, ring in the XY plane |
| Polycount | ≤ 900 tris |

### 3.5 `pylon.glb` — environment pylon

| Spec | Value |
| --- | --- |
| Object | `pylon` |
| Geometry | 6 m tall, faceted: a hexagonal prism 0.5 m across tapering to 0.3 m at the top, with a 0.08 m wide vertical strip recessed on the lane-facing side running from 0.5 m to 5.5 m |
| Emissive mask | Vertex colour attribute `Col`: strip vertices white, rest black (the shader reads it as the emissive mask) |
| Origin | Base centre (so y = 0 places it on the grid) |
| Polycount | ≤ 600 tris |

Consumer: [13 §3](13-rendering-environment-camera-postfx.md#3-pylons-dust-horizon-glow).

### 3.6 `obstacle_frame.glb` — wall frame [POLISH]

| Spec | Value |
| --- | --- |
| Object | `obstacle_frame` |
| Geometry | A 1 × 1 × 1 m bevelled wireframe-style frame: 12 edge beams 0.05 m square with 0.01 m bevel; the game scales it non-uniformly to the wall box |
| Origin | Leading-face centre (the +Z face centre, so scaling in Z extends the frame backward) |
| Polycount | ≤ 600 tris |

### 3.7 `results_podium.glb` — results podium [POLISH]

| Spec | Value |
| --- | --- |
| Object | `results_podium` |
| Geometry | Hexagonal disc 1.6 m across, 0.12 m thick, with a 0.02 m inset ring groove at 0.7 m radius; origin at the top-face centre |
| Polycount | ≤ 300 tris |

## 4. Step-by-step via Blender MCP

Issue these as instructions to the assistant connected to Blender MCP (each maps to one or more `execute_blender_code` calls). Verify after each step with "get scene info" / a viewport screenshot.

1. **Start a fresh asset file**: create the named asset collection and set units to metric, scale 1.0. Do not reset a shared or unsaved working scene.
2. **Fractured cube**: "Create a 1 m cube at the origin named `block_src`. Run the fracture script below (§5.1). Confirm 14 objects named shard_00..shard_13 exist, each with origin at centre of mass, and report the total volume."
3. **Armour**: "Create four 0.84×0.84×0.06 m plates on the ±X and ±Y faces of a unit cube at 0.02 m offset, bevel 0.03 m/3 segments, join into one mesh named `armor_plates`, origin at world origin, apply transforms."
4. **Beam ring**: "Add a torus major 0.42 minor 0.03, 48×8 segments, named `beam_ring`, with four 0.06 m cubes at the cardinal points joined in. Apply transforms."
5. **Glyphs**: "Import `assets-src/textures/glyphs/{palm,fist,point}.svg`, convert each to a mesh, scale to fit 0.8 m, extrude 0.04 m, set origin to geometry centre, name `glyph_palm/glyph_fist/glyph_point`." (If no SVGs exist yet, "model the three icons from primitives" per §3.2.)
6. **Pylon**: "Create a hexagonal prism 6 m tall (radius 0.25 at base, 0.15 at top), inset a 0.08 m strip on the +Y side from z=0.5 to 5.5, paint vertex colour `Col` white on strip faces and black elsewhere, origin at base centre, name `pylon`."
7. **Frame / podium** [POLISH]: as per §3.6/§3.7.
8. **Export**: "Run the export script below (§5.2)." It exports each asset group to its own `.glb` with the settings in §2.
9. **Save** `assets-src/blender/signsaber_assets.blend`.

## 5. Authoring script templates

These templates require the pinned Blender/extension versions and must be validated in Blender before they become a supported script. First inspect the available operator schema:

```python
import bpy
print("Blender:", bpy.app.version_string)
for op in (bpy.ops.object.add_fracture_cell_objects, bpy.ops.export_scene.gltf):
    try:
        print(op.idname(), sorted(op.get_rna_type().properties.keys()))
    except RuntimeError as exc:
        raise RuntimeError("Required authoring operator unavailable; use the manual or procedural path") from exc
```

Record this output with the asset build, not as a claim that the templates ran. Operator names/options can change; fail with the missing capability rather than silently exporting an incomplete asset.

### 5.1 Fracture script (paste into MCP `execute_blender_code` or Blender's Text Editor)

```python
import bpy, bmesh, random
from mathutils import Vector

SRC = "block_src"
CELLS = 14
SEED = 7

src = bpy.data.objects[SRC]
bpy.ops.object.select_all(action='DESELECT')
src.select_set(True)
bpy.context.view_layer.objects.active = src

# Two material slots so the shader can tell interior faces apart
def ensure_mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1.0)
    return m
src.data.materials.clear()
src.data.materials.append(ensure_mat("outer", (0.5, 0.5, 0.5)))
src.data.materials.append(ensure_mat("inner", (1.0, 1.0, 1.0)))

# Seed points: random points inside the cube, slightly biased to the centre so shards are irregular
rng = random.Random(SEED)
points = [Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45))) for _ in range(CELLS)]

# Cell Fracture (add-on must be enabled). Uses our points via a temporary particle-free path:
# the operator can take 'PENCIL'/'PARTICLE_OWN'/'VERT_OWN' sources; we feed vertices of a helper mesh.
helper_me = bpy.data.meshes.new("fracture_points")
helper_me.from_pydata([p for p in points], [], [])
helper = bpy.data.objects.new("fracture_points", helper_me)
bpy.context.collection.objects.link(helper)
helper.parent = src
helper_name = helper.name

fracture_options = dict(
    source={'VERT_CHILD'},
    source_limit=CELLS,
    source_noise=0.0,          # all randomness is already in our recorded seed points
    cell_scale=(1.0, 1.0, 1.0),
    recursion=0,
    use_smooth_faces=False,
    use_sharp_edges=True,
    use_data_match=True,
    use_island_split=False,
    margin=0.001,
    material_index=1,          # interior faces → slot 1 = "inner"
    use_interior_vgroup=False,
    mass_mode='VOLUME',
    use_recenter=True,         # origin to centre of each shard
    use_remove_original=True,
    collection_name="shards",
    use_debug_points=False,
)
supported = set(bpy.ops.object.add_fracture_cell_objects.get_rna_type().properties.keys())
missing = set(fracture_options) - supported
if missing:
    raise RuntimeError(f"Fracture template needs adaptation for this version: {sorted(missing)}")
result = bpy.ops.object.add_fracture_cell_objects(**fracture_options)
assert 'FINISHED' in result, f"Fracture did not finish: {result}"

if helper_name in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects[helper_name], do_unlink=True)

# Rename, recentre precisely to centre of mass, apply transforms, report volume
shards = [o for o in bpy.data.collections["shards"].objects if o.type == 'MESH']
shards.sort(key=lambda o: (o.location.z, o.location.y, o.location.x))
total = 0.0
for i, o in enumerate(shards):
    o.name = f"shard_{i:02d}"
    o.data.name = o.name
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type='ORIGIN_CENTER_OF_VOLUME')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm = bmesh.new(); bm.from_mesh(o.data); total += bm.calc_volume(signed=False); bm.free()
print(f"{len(shards)} shards, total volume {total:.4f} m^3 (expect ~1.0)")
assert len(shards) == CELLS, "cell count mismatch: adjust CELLS or seed"
assert 0.98 <= total <= 1.02, "volume validation failed; do not export"
```

The [Blender-maintained legacy Cell Fracture source](https://github.com/blender/blender-addons/blob/main/object_fracture_cell/__init__.py) documents `VERT_CHILD`; this is not a guarantee for every extension release. If the installed schema differs, adapt and verify the template against that version or use the complete eight-octant fallback. Do not substitute an unseeded particle system and call the output reproducible. Also verify closedness and inner/outer materials before export; a volume sum alone does not prove the meshes are usable.

### 5.2 Export script

```python
import bpy, os

OUT = bpy.path.abspath("//../../app/public/assets/models")   # relative to assets-src/blender/
os.makedirs(OUT, exist_ok=True)

GROUPS = {
    "block_fractured": [f"shard_{i:02d}" for i in range(14)],
    "armor":           ["armor_plates"],
    "beam_ring":       ["beam_ring"],
    "glyphs":          ["glyph_palm", "glyph_fist", "glyph_point"],
    "pylon":           ["pylon"],
    "obstacle_frame":  ["obstacle_frame"],
    "results_podium":  ["results_podium"],
}

def export(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    missing = [n for n in objects if n not in bpy.data.objects]
    if missing:
        if name in {"obstacle_frame", "results_podium"} and len(missing) == len(objects):
            print(f"optional asset omitted: {name}"); return
        raise RuntimeError(f"{name}: missing required objects {missing}")
    found = [bpy.data.objects[n] for n in objects]
    for o in found: o.select_set(True)
    bpy.context.view_layer.objects.active = found[0]
    options = dict(
        filepath=os.path.join(OUT, f"{name}.glb"),
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_texcoords=True,
        export_normals=True,
        export_extras=False,
    )
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    missing_options = set(options) - supported
    if missing_options:
        raise RuntimeError(f"Export template needs adaptation: {sorted(missing_options)}")
    # Vertex-colour export option names vary by exporter release. Enable the active
    # colour attribute in the pinned version's UI/schema, then inspect COLOR_0 in GLB.
    result = bpy.ops.export_scene.gltf(**options)
    assert 'FINISHED' in result, f"Export failed for {name}: {result}"
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in found)
    print(f"exported {name}.glb: {len(found)} objects, {tris} tris")

for name, objs in GROUPS.items():
    export(name, objs)
```

## 6. Validation in the browser

The implemented `node scripts/check-model-assets.mjs` and `node --test scripts/check-model-assets.test.mjs` verify the authored pack. The retained Khronos report is separate from the independent geometry report. No `inspect-glb.ts` command is advertised. Until then, the planned browser inspection uses the bundled Three.js `GLTFLoader` (this is a developer-console excerpt, not a shipped menu):

```ts
const gltf = await new GLTFLoader().loadAsync(url);
gltf.scene.traverse(o => {
  if ((o as Mesh).isMesh) {
    const g = (o as Mesh).geometry;
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    console.log(o.name, tris, 'tris', 'origin', o.position.toArray(), 'scale', o.scale.toArray());
  }
});
```

Checks that MUST pass:

- `block_fractured.glb`: exactly the 14 semantic shard nodes `shard_00..shard_13` after traversing hierarchy; each has `scale = (1,1,1)`; transformed centroids lie within the unit cube; Σ |signed volume| ∈ [0.98, 1.02] (compute with the planned slicer test helper from [11 §9](11-rendering-blocks-and-destruction.md#9-tests)); `inner` faces exist as material groups or primitives. Account for exporter-created roots and material splits rather than requiring 14 direct scene children.
- `pylon.glb`: has a `color` attribute; strip vertices have `r > 0.9`.
- Every asset: `scale = (1,1,1)` after load; Y is up (the pylon's height is along +Y); tri counts within budget.

## 7. Procedural fallbacks (Three.js)

If Blender MCP or Blender is unavailable, `render/assets.ts` returns these when a GLB fails to load (and logs a warning once). The game MUST be fully playable with fallbacks.

| Asset | Fallback recipe |
| --- | --- |
| `block_fractured` | Eight complete box octants with known centroids and `aShard` ids, built once at boot. This path does not depend on the runtime cube slicer accepting arbitrary clipped polyhedra. |
| `glyphs` | `ExtrudeGeometry` from `THREE.Shape`s built from the same SVG paths used for the atlas (`SVGLoader.parse` → `toShapes`), depth 0.04 |
| `armor` | 4 × `RoundedBoxGeometry(0.84, 0.84, 0.06, 3, 0.03)` (three/examples) positioned on the ±X/±Y faces at 0.02 m offset, merged with `mergeGeometries` |
| `beam_ring` | `TorusGeometry(0.42, 0.03, 8, 48)` + 4 `BoxGeometry(0.06)` merged |
| `pylon` | Six-sided tapered cylinder translated upward by half its height to put its base at the origin, plus a thin merged strip with explicit vertex colour. Do not rely on selecting strip vertices that the low-poly cylinder does not contain. |
| `obstacle_frame` | 12 thin `BoxGeometry` beams merged (0.05 m square), pivot moved to the +Z face centre |
| `results_podium` | `CylinderGeometry(0.8, 0.8, 0.12, 6)` |

## 8. Licensing

Planned team-authored geometry is released under the repository's MIT licence when committed. Record the authoring-tool/extension versions and their own licences separately; a tool's licence is not the asset's provenance. Glyph SVGs MUST be drawn by the team or sourced with an explicit compatible licence and attribution. Record actual source URLs, licence files and any modifications in the asset manifest. No unlicensed third-party models or invented asset credits.

## 9. Reproducibility and failure proof

Each authored asset build records source `.blend` path, Blender/exporter/extension/MCP versions, generator seed, expected node names, triangle count, byte size, SHA-256 and licence/source. Validate both the GLB structure and its in-game appearance; glTF may introduce hierarchy roots and split material primitives, so inspect semantic mesh names rather than assuming exactly 14 direct scene children. Use [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator) for structural errors and the browser for rendering/pivot/axis correctness.

Load the entire required group or select its procedural fallback: a partial shard list is an asset failure. Exercise missing, corrupt and wrong-schema GLBs, and record which fallback appeared. Preload/merge geometry before PLAYING; no network request or new GLTF parsing may occur on a hit. Reuse pooled geometry and dispose replaced owned resources. Benchmark authored and fallback assets with the same fixed event replay and tier; record both asset mode and hash in the evidence. The shipped game must boot without Blender, MCP, network access or an asset-authoring account after its local assets are installed.

## 10. Checklist

- [ ] Blender 4.x with Cell Fracture enabled; Blender MCP server connected and responding.
- [ ] `block_fractured.glb`: 14 named shards, centroid origins, volume ≈ 1.0, `inner`/`outer` materials.
- [ ] `armor.glb`, `beam_ring.glb`, `glyphs.glb`, `pylon.glb` exported with the §2 settings; `obstacle_frame.glb`, `results_podium.glb` if time allows.
- [ ] Browser validation passes for every exported file (names, scale 1, Y-up, tri budgets).
- [ ] Procedural fallbacks implemented and exercised once by temporarily renaming the `models/` folder.
- [ ] `.blend` and GLBs committed; attribution file present if any CC0 icon source was used.
- [ ] Total asset payload ≤ 1 MB.

## 11. Rigged avatar

**Status: implemented.** `assets-src/blender/generate_avatar.py` authors the upper-body avatar in a dedicated `signsaber_avatar.blend` through the same official MCP bridge (a separate instance via `--port`/`--blend`). This asset is a documented exception to §2: it contains one skin, an armature and `COLOR_0` details, and has its own manifest (`app/public/assets/models/avatar-manifest.json`) and triangle budget (≤ 16,000) outside the six-asset pack total.

| Spec | Value |
| --- | --- |
| Scope | Head (brow, eyes, nose, mouth, jaw, ears, hair), neck, torso to a closed hip finish with a rim, arms, hands with thumb + four three-phalanx fingers. **No legs.** |
| Construction | Signed-distance primitives with smooth unions/subtractions (lofted torso profile, muscle masses, per-finger blend groups), polygonised by surface nets, projected onto the field, collapse-decimated, relaxed and re-projected; accent seams are tubes on surface-projected curves |
| Axes / units | glTF +Y up, facing +Z, metres, origin at the hip-joint midpoint; A-pose rest (arms 48° from vertical) |
| Bones | `hips, spine, chest, neck, head`, `shoulder/upper_arm/forearm/hand.L/.R`, `thumb/index/middle/ring/pinky_01–03.L/.R` (43); three.js strips the dot when loading |
| Weights | Bone heat (suit, hands) with nearest-bone fallback, procedural head/neck blend, rigid hair/eyes, seams copy nearest suit weights; ≤ 4 influences, normalised |
| Materials | `avatar_suit`, `avatar_skin`, `avatar_accent`, `avatar_eye`, `avatar_hair` (base colour only); `COLOR_0` multiplies in brows, lips and iris/pupil |
| Anchors | Armature extras `sign_saber_anchors`: rest positions of MediaPipe-equivalent landmarks (nose, eyes, ears, shoulders, elbows, wrists, hips, index/pinky/thumb) used by runtime retargeting |

`render_avatar_preview.py` renders actual Workbench/EEVEE previews; `pose_avatar_preview.py` poses the rig (raised arm, 120° elbow, fist, point, wrist twist, overhead) for deformation checks and always restores the rest pose. Structural checker coverage is pending.

## Constants required

None beyond `BLOCK_SIZE`, `PYLON_SPACING_M`, `PYLON_X` (proposed in [13](13-rendering-environment-camera-postfx.md)).
