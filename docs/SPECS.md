# Technical Specification: Roman Empire Voxel World Map

Version: 2.0
Status: Reference Specification
Scope: Complete technical design for a persistent MMO voxel world of the Roman Empire

---

## 1. Map and Chunk System

### Map Dimensions

- **Total map size**: 2048 x 2048 tiles
- **Chunk size**: 32 x 32 tiles per chunk
- **Chunk grid**: 64 x 64 chunks = 4,096 chunks total

### Canonical Coordinate and Runtime Contracts

- Coordinates are integer tile coordinates in range `0..2047` and chunk coordinates in range `0..63` for both axes.
- `chunks` table binaries are authoritative world data. Clients may cache for throughput, but all authoritative reads and simulation queries must use Supabase chunk rows.
- Chunk-level activation is deterministic:
  - `active=true`: contributes to rendering and collision
  - `active=false`: remains unloaded except for cache
- Runtime systems must never invent terrain or province values for simulation-critical logic.

### Binary Chunk Format

Each chunk occupies exactly 4,104 bytes uncompressed (~4.01 KiB) and follows a fixed binary layout.

| Section   | Size (bytes) | Encoding                                                               |
| --------- | ------------ | ---------------------------------------------------------------------- |
| Header    | 8            | Magic number (2B), Version (2B), ChunkX (2B), ChunkY (2B)             |
| Heights   | 1,024        | uint8 per tile, height range 0--127                                    |
| Biomes    | 1,024        | uint8 per tile, biome type 0--15                                       |
| Flags     | 1,024        | Bitfield per tile: has_city, has_resource, has_road, is_river, province_border |
| Province  | 1,024        | uint8 Province-ID per tile                                             |

**Total sizes**:

- Per LOD level (4,096 chunks): ~16.8 MB uncompressed
- All 4 LOD levels: ~67.2 MB uncompressed
- Per LOD level (Brotli): ~4--6 MB

### Chunk Border Handling

Chunks store 32 x 32 core tiles in the database (4,104-byte binary format). At load time, the client's ChunkManager assembles a 34 x 34 working region by combining the 32 x 32 core with 1-tile borders sampled from already-loaded neighboring chunks. This eliminates data duplication in storage while providing seamless meshing and AO at chunk boundaries.

If a neighboring chunk is not yet loaded, the border defaults to sea level (height 32, biome=shallow\_sea). Chunks are loaded from Supabase `chunks` table via `SELECT data FROM chunks WHERE x=? AND y=? AND lod=?`.

### Tile/Chunk Activation Contract (Switchable)

- The voxel landscape is strictly tile-based (`2048x2048`) and streamed as chunk tiles (`32x32`) from Supabase.
- Every chunk is runtime-switchable on the client:
  - `active=true`: chunk participates in rendering + collision queries.
  - `active=false`: chunk is unloaded from scene memory (kept only in cache if present).
- Switching chunk visibility must be deterministic and reversible without data loss.
- Chunk data authority is the Supabase `chunks` table; the client does not persist terrain tiles locally as source of truth.

### Province-ID Convention

- Province-ID **0** = outside the Roman Empire (barbarian territory, Parthia, Germania Magna, etc.)
- Province-IDs **1--41** = the 41 provinces (see PROVINCES.md)
- Province-IDs **42--255** = reserved for future use

Tiles with Province-ID 0 are rendered with desaturated colors and a fog overlay to visually distinguish imperial territory from barbarian lands.

### Height Map Encoding

Height values use the lower 7 bits of the uint8 range (0--127). Values 128--255 are reserved and must not be written by the pipeline. The terrain classification:

```
Sea level:       Height 32
Coast:           Height 33-35   (flat beach)
Flatlands:       Height 36-45
Hills:           Height 46-60
Mountains:       Height 61-90
High mountains:  Height 91-110  (Alps, Taurus)
Snow-covered:    Height 111-127 (Alpine peaks)
```

---

## 2. LOD System (4 Levels)

| LOD  | Detail                           | Quads per Chunk | Camera Height Threshold |
| ---- | -------------------------------- | --------------- | ----------------------- |
| LOD0 | Full voxel columns               | 200--300        | < 300                   |
| LOD1 | 2x2 tiles averaged               | 50--80          | 300--1,000              |
| LOD2 | 4x4 tiles averaged, top face only | 10--20          | 1,000--3,000            |
| LOD3 | 1 quad per chunk, flat colored   | 1--2            | > 3,000                 |

### LOD Transition Strategy

- **Alpha blending zones**: 200--500 units wide, never hard switches
- **Depth write**: `depthWrite = false` on the fading-out LOD to prevent z-fighting

---

## 3. Camera System

### Zoom Behavior

- **Zoom curve**: Logarithmic (produces a consistent perceptual sensation across the full zoom range)
- **Camera tilt by zoom**: Strategic view at 80 degrees (near top-down) transitioning to detail view at 45 degrees (perspective)
- **FOV by zoom**: 60° (strategic) to 40° (detail)
- **Near/Far clipping**: `near=0.5`, `far=12,000` (must be clamped down in Toaster profile if clipping artifacts appear)

### Zoom Level Behavior Table

| Camera Height | View       | Terrain Detail  | Cities           | Overlays                               |
| ------------- | ---------- | --------------- | ---------------- | -------------------------------------- |
| 3,000--5,000  | Strategic  | LOD3 (flat)     | Icons (dots)     | Province areas + borders + names       |
| 1,000--3,000  | Regional   | LOD2            | Icons (scaled)   | Province borders, resource icons       |
| 300--1,000    | Tactical   | LOD1            | Cluster meshes   | Trade routes, roads, resources         |
| 80--300       | Local      | LOD0            | Detail loading   | Trees, individual roads                |
| 15--80        | Detail     | LOD0 + City     | Full voxel city  | Smoke, flags, ships, people            |

---

## 4. Rendering Pipeline

### Greedy Meshing

- Reduces triangle count by approximately 90% (3,000 quads reduced to ~300 per chunk)
- **Binary greedy meshing**: Entire rows encoded as 32-bit integers, processed with bitwise operations
- Target performance: < 200 microseconds per chunk

### Batching Strategy

- **BatchedMesh**: All terrain chunks at the same LOD level batched into a single draw call (~4 total draw calls for terrain)
- **InstancedMesh**: Trees, icons, ships, and people each use a single draw call per type

### Material Approach

- Vertex colors only, no textures on terrain geometry
- Face shading factors baked directly into vertex colors:

| Face Direction | Shading Factor |
| -------------- | -------------- |
| Top            | 1.00           |
| Bottom         | 0.50           |
| North          | 0.80           |
| South          | 0.80           |
| East           | 0.88           |
| West           | 0.65           |

### Per-Vertex Ambient Occlusion

- Count adjacent solid voxels per vertex (range 0--3)
- AO factor = `1.0 - (neighbor_count * 0.15)`

---

## 5. Water Rendering (TSL Shader)

### Base Configuration

- Transparent plane positioned at sea level (height 32)
- Two overlapping normal maps scrolling in different directions
- Fresnel-based transparency calculation

### Depth-Dependent Color

| Depth Zone               | Distance from Coast | RGB Value           |
| ------------------------ | ------------------- | ------------------- |
| Coast                    | 0--2 tiles          | (100, 200, 210) turquoise |
| Shallow                  | 2--5 tiles          | (65, 155, 190) light blue |
| Medium                   | 5--15 tiles         | (40, 100, 160) medium blue |
| Deep                     | 15+ tiles           | (20, 50, 110) deep blue |

### Wave Parameters

| Parameter       | Wave 1              | Wave 2              |
| --------------- | ------------------- | ------------------- |
| Frequency       | 0.05                | 0.08                |
| Amplitude       | 0.3 voxels          | 0.15 voxels         |
| Direction       | 30 degrees          | 120 degrees         |
| Scroll speed    | 0.02 units/frame    | 0.02 units/frame    |

### Rivers

- Color: RGB(78, 145, 180)
- Width: 1--4 tiles
- Flow animation applied along river direction

### Voxel Shoreline Contract (Mandatory)

- Shorelines must remain visibly voxel-structured at all zoom levels (no smooth non-voxel coast mesh replacement).
- Beach transition zone is 2--6 tiles wide where geography allows:
  - `coast_water` (height 32)
  - `sand_beach` (height 33--35)
  - inland terrain (height >= 36)
- Wet-sand band is required at water contact edges (`shore_wet` tint blend).
- Cliff coasts are allowed as steep voxel steps but must not produce water-plane clipping artifacts.
- Foam/wash line is generated from coastline mask derived from tile neighbors, not random placement.

### Harbor Visual Contract (Mandatory)

- Harbor cities (`is_harbor=true`) must render explicit harbor geometry in local/detail zoom:
  - quay edge blocks
  - pier or jetty modules
  - dockside storage/warehouse cluster
  - moored ship slots
- Required harbor water behavior:
  - reduced wave amplitude inside basin/port area
  - wake trails amplified along active ship lanes
  - foam concentration at pier corners/breakwater edges
- Harbor assets and water behavior must be profile-scaled but never replaced by icon-only representation at detail zoom.

### Quality Levels

| Level  | Features                                    |
| ------ | ------------------------------------------- |
| High   | Full shader + displacement + foam           |
| Medium | Normal maps + color                         |
| Low    | Flat color only                             |

---

## 6. Web Worker Architecture

### Worker Pool

- **Pool size**: 4 Web Workers (2 in Toaster profile)
- **Data transfer**: Transferable ArrayBuffers (zero-copy ownership transfer)
- **Scheduling**: Free worker picks the next task from a shared queue

### Message Protocol

**Main thread to worker**:

```typescript
{
  type: 'meshChunk',
  chunkX: number,
  chunkY: number,
  heights: ArrayBuffer,   // Transferable
  biomes: ArrayBuffer,    // Transferable
  flags: ArrayBuffer,     // Transferable
  province: ArrayBuffer,  // Transferable
  lod: number
}
```

**Worker to main thread**:

```typescript
{
  type: 'chunkReady',
  chunkX: number,
  chunkY: number,
  lod: number,
  positions: ArrayBuffer,  // Transferable
  normals: ArrayBuffer,    // Transferable
  colors: ArrayBuffer,     // Transferable
  vertexCount: number
}
```

Workers receive raw TypedArrays extracted from ECS component stores (see `docs/ECS.md`). The `ChunkLoadSystem` reads `ChunkCoord` and `LODLevel` components, decodes binary chunk data, and transfers the resulting TypedArrays to the worker pool. On completion, the `ChunkMeshSystem` writes the returned geometry index into the entity's `MeshRef` component. Workers never access the ECS world directly.

---

## 7. Performance Strategy (10 Core Strategies)

1. **Frustum Culling**: `Mesh.frustumCulled = true` on all Three.js meshes
2. **Spiral Chunk Loading**: Load chunks outward from camera center, prioritize movement direction
3. **4 Web Workers**: Parallel mesh generation with Transferable ArrayBuffers
4. **Greedy Meshing**: 90% triangle reduction
5. **InstancedMesh**: Trees, icons rendered as 1 draw call per type
6. **BatchedMesh**: All terrain chunks at the same LOD level rendered as ~4 draw calls
7. **Adaptive Profiles**: If frame time budget is exceeded for 10 consecutive frames, step down profile (High → Medium → Low → Toaster)
8. **IndexedDB Caching**: Generated meshes serialized and cached via idb-keyval
9. **Deferred Loading**: LOD3 loads instantly, then progressively upgrades to higher detail
10. **Troika Text Cache**: One bundled font file ("Cinzel") + runtime glyph atlas for all labels
11. **SoA ECS Iteration**: bitECS SoA TypedArrays enable cache-friendly iteration over component data (~335K ops/s). Systems process contiguous memory blocks instead of scattered object graphs. Agent interpolation, visibility culling, and chunk LOD updates all benefit from sequential array access patterns.

---

## 8. Memory Budget

### Balanced Profile (Desktop Target)

| Component            | Budget | Strategy                              |
| -------------------- | ------ | ------------------------------------- |
| Terrain Chunks       | 100 MB | Max 150 chunks loaded, LRU eviction   |
| Water                | 10 MB  | Single plane + shader                 |
| City Detail Meshes   | 150 MB | LRU cache holding ~30 cities          |
| City Cluster Meshes  | 50 MB  | All 300+ clusters preloaded           |
| Font + Overlay       | 50 MB  | Troika glyph atlas + province texture |
| Overlay              | 30 MB  | Province mesh + text labels           |
| Headroom             | 122 MB | GC, Three.js internals, browser       |

**Total target**: ~512 MB

### Toaster Profile (Low-End Target)

| Component            | Budget | Strategy                              |
| -------------------- | ------ | ------------------------------------- |
| Terrain Chunks       | 36 MB  | Max 54 chunks loaded, aggressive LRU  |
| Water                | 4 MB   | Flat colored water                    |
| City Detail Meshes   | 40 MB  | LRU cache holding ~8 cities           |
| City Cluster Meshes  | 20 MB  | Preloaded compressed clusters         |
| Font + Overlay       | 20 MB  | Troika glyph atlas with tight cap     |
| Overlay              | 12 MB  | Province mesh + low label density     |
| Headroom             | 60 MB  | Browser + GC                          |

**Total target**: ~192 MB

### Texture Memory Budget

Texture VRAM is the primary bottleneck on integrated GPUs (Intel UHD 630). All texture atlases
and GPU-resident textures must stay within the following combined limits:

| Texture | Balanced | Toaster | Notes |
|---------|----------|---------|-------|
| Troika SDF glyph atlas | 8 MB | 4 MB | Single Cinzel font, runtime-generated |
| Parchment overlay | 1 MB | 1 MB | 512x512 seamless noise texture |
| Province JFA distance field | 16 MB | 8 MB | 2048x2048 RGBA (Balanced), 1024x1024 (Toaster) |
| City voxel model textures | 0 MB | 0 MB | Vertex colors only, no textures |
| Water normal maps | 4 MB | 0 MB | Two 512x512 normal maps (disabled on Toaster: flat water) |
| Cloud/shadow mask | 2 MB | 1 MB | 256x256 tiling cloud texture |
| Render targets (bloom, DOF) | 32 MB | 16 MB | Half-res intermediate buffers |
| **Total texture VRAM** | **~63 MB** | **~30 MB** | Hard cap: 64 MB (Balanced), 32 MB (Toaster) |

On Intel UHD 630 (shared VRAM), exceeding the Toaster texture budget causes immediate
frame rate collapse. The Toaster profile must enforce the 32 MB cap.

---

## 9. Frame Budgets

### Balanced Profile (16.6 ms at 60 fps)

| Phase                  | Budget  | Method                                    |
| ---------------------- | ------- | ----------------------------------------- |
| JS Logic + Updates     | 2 ms    | Object pooling, no per-frame allocation    |
| Chunk LOD Updates      | 1 ms    | Only process changed chunks                |
| Scene Graph Traversal  | 1 ms    | `Object3D.layers` for culling             |
| GPU Draw Calls         | 8 ms    | BatchedMesh, ~50--100 calls               |
| Water Shader           | 2 ms    | Single pass                                |
| Headroom               | 2.6 ms  | GC, browser overhead                      |

---

### Toaster Profile (33.3 ms at 30 fps)

| Phase                  | Budget  | Method                                    |
| ---------------------- | ------- | ----------------------------------------- |
| JS Logic + Updates     | 5 ms    | Strict pooling, minimal per-frame work     |
| Chunk LOD Updates      | 2 ms    | Smaller active chunk set                   |
| Scene Graph Traversal  | 2 ms    | Reduced visible object count               |
| GPU Draw Calls         | 18 ms   | Hard cap via Toaster profile               |
| Water Shader           | 1 ms    | Flat water only                            |
| Headroom               | 5.3 ms  | GC, browser overhead                       |

---

## 10. Draw Call Budget Per Zoom Level

### Balanced Profile

| Zoom Level         | Terrain | Cities | Water | Overlay | Ambient | Agents | Total |
| ------------------ | ------- | ------ | ----- | ------- | ------- | ------ | ----- |
| Strategic (5,000)  | 4       | 1      | 1     | 3       | 0       | 2      | ~11   |
| Regional (2,000)   | 4       | 1      | 1     | 4       | 1       | 3      | ~14   |
| Tactical (500)     | 4       | 5--10  | 1     | 5       | 3       | 4      | ~24   |
| Local (150)        | 4       | 3--5   | 1     | 3       | 5       | 5      | ~23   |
| Detail (30)        | 4       | 1--2   | 1     | 1       | 5       | 5      | ~19   |

Agent draw calls: 1 InstancedMesh per visible agent type (ships, traders, legions, citizens, fishing boats).
Toaster profile hard cap: **<= 14 total draw calls** at any zoom level.

### Toaster Profile

| Zoom Level         | Terrain | Cities | Water | Overlay | Ambient | Agents | Total |
| ------------------ | ------- | ------ | ----- | ------- | ------- | ------ | ----- |
| Strategic (5,000)  | 2       | 1      | 1     | 2       | 0       | 1      | ~7    |
| Regional (2,000)   | 2       | 1      | 1     | 2       | 0       | 1      | ~7    |
| Tactical (500)     | 2       | 2--3   | 1     | 2       | 1       | 2      | ~10--11 |
| Local (150)        | 2       | 2      | 1     | 2       | 1       | 2      | ~10   |
| Detail (30)        | 2       | 1      | 1     | 1       | 1       | 2      | ~8    |

---

## 11. Biome Color Palette

All values specified as RGB tuples in the range 0--255.

```
deep_sea:          (20,  50,  110)
shallow_sea:       (64,  115, 166)
coast_water:       (100, 200, 210)
river:             (78,  145, 180)
desert:            (217, 199, 140)
desert_dark:       (195, 175, 120)
arid_scrub:        (179, 166, 107)
arid_scrub_dark:   (160, 148, 95)
mediterranean:     (140, 173, 97)
med_dark:          (120, 150, 82)
grassland:         (97,  145, 79)
grassland_dark:    (82,  125, 65)
dense_forest:      (46,  92,  26)
forest_dark:       (35,  75,  20)
mountain:          (140, 133, 122)
mountain_dark:     (115, 108, 98)
snow:              (230, 235, 242)
snow_shadow:       (200, 210, 225)
marsh:             (89,  122, 77)
marsh_water:       (70,  110, 90)
fertile:           (122, 158, 71)
fertile_field:     (195, 180, 90)
sand_beach:        (230, 215, 170)
cliff:             (160, 140, 110)
```

---

## 12. Adaptive Quality System

| Setting        | High                          | Medium                   | Low               | Toaster            |
| -------------- | ----------------------------- | ------------------------ | ----------------- | ------------------ |
| Water          | Full shader + displacement + foam | Normal maps + color   | Flat colored      | Flat colored       |
| Trees          | 5,000 instances               | 1,000 instances          | 200 instances     | 0 instances        |
| City cache     | 30 cities                     | 15 cities                | 5 cities          | 2 cities           |
| LOD distances  | Full                          | Halved                   | Quartered         | One-eighth         |
| Ambient effects | Full set (smoke, birds, cloth, dust) | Reduced set       | Core set          | Core set           |
| Ambient FX pack | Full set + dense micro-events      | Full set + reduced density | Core set + sparse events | Core set + sparse events |
| Cloud layer    | 2 moving layers + soft ground tint | 1 moving layer      | Sparse layer      | Sparse layer       |
| Street life cap (detail zoom) | 220 agents/animals/vehicles | 140 total     | 80 total          | 40 total           |
| Harvest visuals | Full site state + workers + hauling | Full site state + reduced density | Full site state + sparse workers | Full site state + sparse workers |
| Workers        | 4                             | 4                        | 3                 | 2                  |
| Label cap      | 50                            | 40                       | 20                | 8                  |

---

## 13. Animation Specifications

### Smoke (Cities)

- **Columns**: 2--5 per city, gray cubes of 2x2x2 voxels
- **Movement**: Rise at 0.3 voxels/frame, wind drift 0.05 eastward
- **Lifetime**: 3--5 seconds with alpha fade-out
- **Scale**: 1.0 at spawn, expanding to 2.5 at end of life
- **Color shift**: (180, 180, 180) at spawn to (220, 220, 220) at fade
- **Visibility**: Camera zoom < 500

### Clouds (Strategic to Local)

- **Style**: Soft layered cloud cards inspired by grand strategy map atmospherics
- **Coverage target**: 12--18% of visible map area (animated drift, never static)
- **Motion**: West-to-east drift at 0.03--0.06 tiles/second, slight UV warping
- **Altitude**: Separate render layer above terrain/cities, below UI labels
- **Profile scaling**:
  - High: 2 cloud layers + subtle terrain tinting from cloud shadow mask
  - Medium: 1 cloud layer + lighter shadow mask
  - Low/Toaster: sparse layer with reduced particle count

### Ships

- **Count**: 30--50 ships on the Mediterranean Sea, rendered with InstancedMesh
- **Speed**: 0.5 tiles/second
- **Rocking motion**: Roll +/-3 degrees, pitch +/-1 degree
- **Wake effect**: 10 white particles per ship, 2-second fade-out
- **Routing**: Spawn at harbor locations, follow predefined trade routes

### Birds

- **Flocks**: 4--6 flocks of 8--12 birds each
- **Behavior**: Boids algorithm (separation, alignment, cohesion)
- **Altitude**: 15--25 voxels above terrain surface
- **Visibility**: Camera zoom < 300

### People

- **Voxel dimensions**: 2x2x4 voxels (body 2x2x3 + head 1x1x1)
- **Maximum count**: ~100 simultaneously, rendered with InstancedMesh
- **Speed**: 0.3--0.8 tiles/second
- **Visibility**: Camera zoom < 100
- **Facing**: agent yaw must follow movement vector (turn smoothing <= 120 ms)

### Street Transport (Horses and Ox Carts)

- **Horse riders**: 30--60 active at detail/local zoom, on road/street graph only
- **Ox carts**: 15--30 active at detail/local zoom, mostly market/harbor corridors
- **Speed**:
  - Horse riders: 0.5--0.9 tiles/second
  - Ox carts: 0.2--0.35 tiles/second
- **Facing**: horses, oxen, and carts must align to instantaneous movement heading
- **Stops**: periodic halt at gates/markets for 2--8 seconds to create believable flow
- **Rendering**: InstancedMesh pools per type to keep draw calls bounded

### Resource Harvesting Visuals (Mandatory)

- Resource extraction must be visible in-world as animated activity, not icon-only overlays.
- Every visible resource site cycles deterministic visual states:
  - `idle` (site present, no active workers)
  - `work` (workers/animals/tools moving)
  - `haul` (cart or porter carrying output toward nearest city storage/market node)
  - `recover` (short cooldown visual reset before next cycle)
- Site-specific visual cues:
  - Grain/Vine/Olive fields: worker rows, cut/uncut strips, bundled goods
  - Mines/Quarries: hammer/chisel loop, spoil growth, loaded cart departures
  - Lumber camps: chopping loop, falling logs, stacked timber growth
  - Salt/Fish/Papyrus: gather and basket/net transport loops at shoreline/river tiles
- Profile caps (visible simultaneously in frustum):
  - High: up to 120 active harvest loops
  - Medium: up to 80 active harvest loops
  - Low: up to 48 active harvest loops
  - Toaster: up to 24 active harvest loops
- Harvest loops remain enabled in all profiles; density scales, state readability does not.

### Ambient FX Pack (Mandatory)

- Target: Caesar-style city bustle without breaking draw-call/frame budgets.
- All effects must be deterministic, profile-scaled, and anchored to world simulation state.
- Required sub-effects:
  - **Street dust**: wheel/hoof dust puffs on dry roads and quarry approaches.
  - **Cloth motion**: market awnings, harbor banners, and laundry lines react to wind vector.
  - **Fire/forge sparks**: blacksmith and kiln nodes emit short-lived ember particles.
  - **Fountain mist**: major plazas with fountains emit low-height mist spray.
  - **Bird micro-fauna**: pigeons/gulls perch, scatter, and re-land near plazas/harbors.
  - **Market clutter motion**: sacks, baskets, and hanging goods use subtle idle sway.
- Detail/local density caps (simultaneously visible in frustum):
  - High: up to 260 ambient FX emitters
  - Medium: up to 170 ambient FX emitters
  - Low: up to 90 ambient FX emitters
  - Toaster: up to 45 ambient FX emitters
- Ambient FX pack remains enabled in all profiles; density and particle lifetime are scaled down per profile.

### Ambient Spawn Safety (Mandatory)

- Ambient emitters and microprops must obey no-spawn masks:
  - never spawn on `BUILDING` collision volume
  - never spawn inside walls/gates/bridges
  - never spawn in water unless effect type explicitly supports water context
- Occlusion/collision validation is required before spawn activation.
- On failed validation, the candidate spawn is discarded (no forced placement substitution).

### District Ambience Profiles (Mandatory)

- Every LOD0 city must classify walkable districts at minimum into:
  - `forum_market`
  - `residential`
  - `harbor` (if harbor city)
  - `workshop_industry`
- Ambient FX and prop weights must be driven by district profile, not uniform random city-wide distribution.
- Category coverage must remain visible per district under all quality profiles (density may scale down).

### Ambient FX Manifest Contract

- Manifest file path: `data/meta/ambient_fx_manifest.json`
- The manifest is the authoritative config for ambient spawn rules.
- Anchor source path: `data/processed/ambient_anchors.json`
- Client startup must validate manifest integrity before enabling ambient systems.
- Validation failure is release-blocking for ambient-enabled builds.

Required top-level fields:
- `version`: integer manifest version
- `seed`: deterministic world seed for ambient randomization
- `effects`: array of effect definitions

Required fields per effect entry:
- `id`: unique string identifier
- `type`: one of `dust|cloth|ember|mist|bird_ground|market_motion`
- `enabled`: boolean
- `priority`: integer, higher value survives budget pruning first
- `spawn_context`: object with allowed `biomes`, `near_tags`, `avoid_tags`, `district_profiles`, `zoom_min`, `zoom_max`
- `profile_caps`: object with keys `high|medium|low|toaster` (max active emitters)
- `timing`: object with `cooldown_ms` and `lifetime_ms` ranges
- `anchor_required`: boolean (effect may spawn only from validated anchors)

Spawn-rule contract:
- Rules are deterministic from (`seed`, chunk coordinates, simulation tick window).
- Spawn is allowed only when all context constraints match (biome + tag + zoom + profile budget).
- Spawn is rejected if `avoid_tags` intersects candidate location tags.
- When budget is exceeded, lower-priority effects are culled first.
- `enabled=false` disables the effect globally without deleting its definition.

Example manifest skeleton:

```json
{
  "version": 1,
  "seed": 75319,
  "effects": [
    {
      "id": "street_dust_primary",
      "type": "dust",
      "enabled": true,
      "priority": 80,
      "spawn_context": {
        "biomes": ["fertile", "grassland", "mediterranean"],
        "near_tags": ["road", "market", "quarry"],
        "avoid_tags": ["building", "wall", "gate", "bridge", "water"],
        "district_profiles": ["forum_market", "workshop_industry"],
        "zoom_min": 15,
        "zoom_max": 350
      },
      "anchor_required": true,
      "profile_caps": { "high": 80, "medium": 55, "low": 30, "toaster": 14 },
      "timing": {
        "cooldown_ms": [900, 2200],
        "lifetime_ms": [350, 900]
      }
    }
  ]
}
```

### Caesar-Style Detail Ambience Delta (Mandatory)

Detail view must satisfy the following Caesar-style liveliness constraints:

- Functional walkers:
  - At least 4 distinct functional walker roles visible in dense urban LOD0 scenes (High/Medium).
  - At least 3 roles visible in Low/Toaster.
- Economy chain readability:
  - At least one complete resource chain (`extraction -> transfer_in -> processing -> transfer_out -> consumption`) visible in major-city detail scenes.
- Building state readability:
  - Service/economy buildings must expose runtime state cues (`supplied`, `low_supply`, `unsupplied`, `needs_repair`, `upgrading`).
- District routine contrast:
  - Forum/market, residential, harbor, and workshop districts must exhibit distinct activity signatures (agent mix + props + FX).
- Micro-interaction presence:
  - Moving agents must produce short interaction pauses/handoffs in detail scenes; continuous non-stop flow is invalid.

### Street Crowd Quality Rules

- Citizens, traders, carts, horses, and oxen must remain on walkable street graph tiles only.
- Minimum personal-space separation target on streets: **>= 0.6 tile** between moving agents.
- Intersection behavior: agents must slow/yield to avoid visible overlap bursts.
- Building clipping is forbidden: agent transforms must never intersect `BUILDING` tiles.
- Toaster profile may reduce crowd density, but street-constrained movement rules remain mandatory.

---

## 14. Tech Stack

### Core Technologies

| Component      | Technology              | Version         |
| -------------- | ----------------------- | --------------- |
| Frontend       | TypeScript + Three.js   | r175+, TS 5.x strict |
| Bundler        | Vite                    | 6.x             |
| Backend        | Supabase                | PostgreSQL 15+, PostGIS 3.4+ |
| Realtime       | Supabase Realtime       | WebSocket subscriptions |
| Auth           | Supabase Auth           | Email + OAuth |
| Simulation Runtime | Rust (tokio, sqlx) | Dedicated tick worker |
| Storage        | Supabase Storage        | Static assets |
| Data Pipeline  | Python                  | 3.11+            |
| Chunk Gen      | Python + numpy          | (part of data pipeline) |
| Mesh Cache     | idb-keyval              | latest           |
| ECS            | bitECS                  | v0.4.0 (pinned)  |
| Renderer       | WebGPU                  | --              |

### Python Dependencies

| Package          | Minimum Version |
| ---------------- | --------------- |
| GDAL             | >= 3.6          |
| numpy            | >= 1.24         |
| geopandas        | >= 0.14         |
| rasterio         | >= 1.3          |
| shapely          | >= 2.0          |
| requests         | >= 2.28         |
| bmi-topography   | >= 0.8          |
| Pillow           | >= 10.0         |
| supabase         | >= 2.0          |

---

## 15. Coordinate Mapping

### Geographic bounds to tile grid

```
Map coverage: 10W to 50E longitude, 25N to 58N latitude
Tile grid: 2048 x 2048

tile_x = floor((longitude - (-10)) / (50 - (-10)) * 2048)
tile_y = floor((58 - latitude) / (58 - 25) * 2048)

// Inverse:
longitude = ((tile_x + 0.5) / 2048) * 60 - 10
latitude  = 58 - ((tile_y + 0.5) / 2048) * 33

// Clamp tile indices after conversion:
tile_x = clamp(tile_x, 0, 2047)
tile_y = clamp(tile_y, 0, 2047)
```

- X axis: West to East (tile 0 = 10W, tile 2047 = 50E)
- Y axis: North to South (tile 0 = 58N, tile 2047 = 25N)
- Effective gameplay resolution (equirectangular grid):
  - East-west: ~3.26 km/tile at equator (60 deg over 2048 tiles)
  - North-south: ~1.79 km/tile (33 deg over 2048 tiles)
- Projection: Equirectangular (simple, matches SRTM source)

---

## 16. Biome Classification Algorithm

Each tile gets a biome type (uint8, 0-15) based on height, latitude, distance to coast, and geographic region.

### Biome IDs

```
0  = deep_sea        (height < 20)
1  = shallow_sea     (height 20-31)
2  = coast_water     (height 32, within 2 tiles of land)
3  = sand_beach      (height 33-35)
4  = desert          (latitude < 32N AND height 36-50 AND not near river)
5  = arid_scrub      (latitude 32-36N AND height 36-50 AND low moisture)
6  = mediterranean   (latitude 36-44N AND height 36-50 AND near coast < 100 tiles)
7  = grassland       (latitude 44-52N AND height 36-50)
8  = dense_forest    (latitude > 46N AND height 36-55 AND moisture high)
9  = marsh           (height 33-36 AND near river AND low gradient)
10 = fertile         (near river < 10 tiles AND height 36-45)
11 = mountain        (height 61-90)
12 = snow            (height > 110 OR (height > 80 AND latitude > 46N))
13 = cliff           (height delta > 15 between adjacent tiles)
14 = river           (from Natural Earth river data, rasterized)
15 = fertile_field   (within 5 tiles of city AND flat AND not desert)
```

### Algorithm (Python pipeline)

```python
def classify_biome(height, lat, lon, coast_dist, river_dist, gradient):
    if height < 20: return DEEP_SEA
    if height < 32: return SHALLOW_SEA
    if height == 32 and coast_dist < 2: return COAST_WATER
    if height <= 35: return SAND_BEACH
    if is_river_tile: return RIVER
    if height > 110: return SNOW
    if height > 80 and lat > 46: return SNOW
    if gradient > 15: return CLIFF
    if height > 60: return MOUNTAIN
    if height <= 36 and river_dist < 3 and gradient < 2: return MARSH
    if river_dist < 10 and height < 46: return FERTILE
    if lat < 32: return DESERT
    if lat < 36: return ARID_SCRUB
    if lat < 44 and coast_dist < 100: return MEDITERRANEAN
    if lat > 46 and moisture > 0.6: return DENSE_FOREST
    return GRASSLAND
```

Moisture is derived from: `min(1.0, river_dist_inv * 0.5 + coast_dist_inv * 0.3 + lat_factor * 0.2)`

---

## 17. Procedural Building Generation

### Building template format

Each building type is defined as a procedural recipe, not a hand-modeled file.

```typescript
interface BuildingTemplate {
  type: string           // "insula", "domus", "temple", ...
  width: number          // X size in voxels
  depth: number          // Z size in voxels
  height: number         // Y size in voxels
  culture: string        // "roman", "greek", ...
  layers: LayerRule[]    // vertical construction rules
}

interface LayerRule {
  yStart: number         // start height
  yEnd: number           // end height
  fill: 'solid' | 'shell' | 'columns' | 'roof'
  color: string          // palette key: "wall", "roof", "column"
  inset: number          // shrink from edges (0 = full, 1 = 1 voxel in)
  openings?: Opening[]   // windows, doors, arches
}

interface Opening {
  face: 'north' | 'south' | 'east' | 'west'
  xStart: number
  xEnd: number
  yStart: number
  yEnd: number
  type: 'door' | 'window' | 'arch'
}
```

### Example: Roman Insula (12x10x16)

```
Layer 0-1:   solid fill, color=floor (foundation)
Layer 2-3:   shell, color=wall, doors on south face at x=5-6
Layer 4-5:   shell, color=wall, windows every 3 voxels (1x1)
Layer 6-7:   shell, color=wall, windows every 3 voxels
Layer 8-9:   shell, color=wall, windows every 3 voxels (balconies on south)
Layer 10-11: shell, color=wall, windows every 3 voxels
Layer 12-13: shell, color=wall, smaller windows
Layer 14:    solid fill, inset=1, color=wall (attic floor)
Layer 15-16: sloped fill, color=roof (peaked roof)
```

### Example: Greek Stoa (20x6x6)

```
Layer 0:     solid fill, color=floor (stylobate)
Layer 1-4:   columns every 2 voxels on south face, back wall solid, color=column/wall
Layer 5:     solid fill, color=roof (flat architrave)
Layer 6:     solid fill, inset=0, overhang 1 south, color=roof (cornice)
```

### Generation algorithm

```
1. Allocate 3D Uint8Array(width * depth * height)
2. For each LayerRule bottom to top:
   a. fill='solid': fill entire layer slice
   b. fill='shell': fill edges only (hollow inside)
   c. fill='columns': place 1x1 columns at interval
   d. fill='roof': triangular/flat fill
3. Carve openings (set voxels to 0)
4. Apply color palette by layer
5. Output: VoxelModel ready for greedy meshing
```

---

## 18. User Controls

### Mouse / Trackpad

| Action | Effect |
|--------|--------|
| Left drag | Pan camera (move map) |
| Scroll wheel | Zoom in/out (logarithmic) |
| Right drag | Rotate camera around look-at point |
| Left click | Select city/province/resource (shows info panel) |
| Hover | Highlight province border, show tooltip with name |
| Double click | Zoom to clicked location |

### Keyboard

| Key | Effect |
|-----|--------|
| WASD / Arrow keys | Pan camera |
| Q / E | Rotate camera left/right |
| + / - | Zoom in/out |
| Space | Reset camera to default position (center of Mediterranean) |
| Escape | Close info panel |

| P | Toggle province overlay |
| T | Toggle trade routes |
| R | Toggle resource icons |
| H | Toggle harvest activity overlay |
| F | Toggle ambient FX pack |
| G | Toggle chunk/tile grid overlay |
| X | Toggle terrain chunk layer visibility |
| 1-4 | Jump to zoom level (1=strategic, 4=detail) |

### Touch (mobile)

| Gesture | Effect |
|---------|--------|
| One finger drag | Pan |
| Pinch | Zoom |
| Two finger rotate | Rotate camera |
| Tap | Select |
| Double tap | Zoom in |

---

## 19. UI Overlay

### HUD Elements

```
┌────────────────────────────────────────────────┐
│                                      [Season] │
│                                      [Date]   │
│                                      [Players]│
│                                                │
│                                                │
│                                                │
│                    3D VIEWPORT                  │
│                                                │
│                                                │
│                                                │
│ [Compass]                       [Zoom slider] │
│ [Coords: 41.8N, 12.5E]         [Quality: Hi] │
└────────────────────────────────────────────────┘
```

### Info Panel (right side, slides in on selection)

```
┌──────────────────┐
│ ROMA              │
│ Province: Italia  │
│ Culture: Roman    │
│ Pop: ~350,000     │
│ ──────────────── │
│ Resources:        │
│  Grain ●●●       │
│  Wine  ●●        │
│  Marble ●        │
│ Harvest: Active   │
│ Incoming carts: 6 │
│ ──────────────── │
│ Trade routes: 12  │
│ Active traders: 8 │
│ ──────────────── │
│ Buildings:        │
│  Colosseum        │
│  Forum Romanum    │
│  Circus Maximus   │
│ [Close]           │
└──────────────────┘
```

### Notifications (bottom center)

- World events appear as floating text: "Trade completed: Grain from Alexandria to Roma"
- Fade in, stay 3s, fade out
- Max 3 visible simultaneously
- Queue additional notifications

---

## 20. Client Data Loading Sequence

### Startup

```
1. Initialize Supabase client (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
2. Auth: anonymous session (required for world read access)
3. Create ECS world (`createWorld({ maxEntities: 20_000 })`) and camera entity
4. Parallel metadata fetch:
   - SELECT id,name,ancient_name,culture,size,tile_x,tile_y,province_number,is_harbor,is_capital,accuracy_tier,confidence,source_refs,name_status FROM cities
   - SELECT id,number,name,culture,color,label_point,accuracy_tier,confidence,source_refs,name_status FROM provinces
   - SELECT game_date,season,tick_count,agent_count,player_count FROM world_state WHERE id=1
   - Hydrate city and province entities from metadata (UUID → EID mapping)
5. Subscribe to Realtime channels:
   - world_events (new events) -- low frequency, broadcast
   - players (other player positions) -- broadcast channel
   - world_state (season/tick changes) -- single row updates
   NOTE: Agent positions are NOT via Realtime (too high frequency).
   Instead, client polls agents in viewport every 2s via RPC.
6. Load LOD3 chunks for initial viewport:
   - SELECT data FROM chunks WHERE lod=3 AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?
   - Create chunk entities with ChunkCoord + LODLevel components
7. Render initial overview (LOD3 terrain + city icons + province overlay)
8. Progressive chunk upgrade (LOD2 → LOD1 → LOD0 as user zooms)
9. On-demand loads:
   - Roads: viewport bbox query + LIMIT/OFFSET pagination (when zoom < 1000)
   - Rivers: viewport bbox query + LIMIT/OFFSET pagination (when zoom < 1500)
   - Resources: viewport bbox query + LIMIT/OFFSET pagination (when zoom < 1200)
   - Trade routes: viewport bbox query + LIMIT/OFFSET pagination (when zoom < 1000)
   - Ambient anchors: viewport bbox query (when zoom < 350)
   - Building runtime states: city-scoped query (when zoom < 300)
```

### Chunk loading strategy

```typescript
// Rule: never issue unbounded SELECT * for runtime world reads.
// Supabase client fetches chunk binary data
const { data } = await supabase
  .from('chunks')
  .select('data')
  .eq('x', chunkX)
  .eq('y', chunkY)
  .eq('lod', lod)
  .single()

// data.data is base64-encoded bytea → decode to ArrayBuffer
const buffer = base64ToArrayBuffer(data.data)
const decoded = decodeChunkBuffer(buffer) // { heights, biomes, flags, province }
// Send typed tile layers to Web Worker for meshing
workerPool.postMessage({
  type: 'meshChunk',
  chunkX,
  chunkY,
  heights: decoded.heights.buffer,
  biomes: decoded.biomes.buffer,
  flags: decoded.flags.buffer,
  province: decoded.province.buffer,
  lod
})
```

### Batch loading (multiple chunks)

```typescript
const { data } = await supabase
  .from('chunks')
  .select('x, y, data')
  .eq('lod', lod)
  .gte('x', minX).lte('x', maxX)
  .gte('y', minY).lte('y', maxY)

// Process all chunks in parallel via worker pool
for (const chunk of data) {
  const buffer = base64ToArrayBuffer(chunk.data)
  const decoded = decodeChunkBuffer(buffer)
  workerPool.postMessage({
    type: 'meshChunk',
    chunkX: chunk.x,
    chunkY: chunk.y,
    heights: decoded.heights.buffer,
    biomes: decoded.biomes.buffer,
    flags: decoded.flags.buffer,
    province: decoded.province.buffer,
    lod
  })
}
```

### Client ECS Architecture

The client uses bitECS v0.4.x as an entity component system layer between Supabase (server-authoritative data) and Three.js (rendering). All game objects — chunks, cities, agents, trees, provinces, resources — are ECS entities with SoA TypedArray components.

**Data flow**: `Supabase (authoritative) → ECS entities (client cache) → Three.js (view)`

19 systems run each frame in fixed order, processing component data through stateless query functions. Components store only primitive numeric data; Three.js objects are referenced by integer indices (`MeshRef.geometryId` → `BatchedMesh`, `InstanceRef.instanceId` → `InstancedMesh`).

See `docs/ECS.md` for complete architecture specification including component definitions, entity archetypes, system execution order, server sync pipeline, and worker integration.

---

## 21. Post-Processing Pipeline (Imperator Rome + Urbek Visual Style)

The visual target is a hybrid of Imperator Rome's antique map aesthetic and Urbek's warm voxel city-builder look. This is achieved entirely through post-processing -- the terrain geometry remains pure vertex-colored voxels.

### EffectComposer Stack (render order)

| Pass | Effect | Performance Cost |
|------|--------|-----------------|
| 1 | Scene render (normal) | baseline |
| 2 | UnrealBloomPass | ~1ms |
| 3 | Tilt-shift DOF (BokehPass) | ~0.5ms |
| 4 | Color grading (custom ShaderPass) | ~0.2ms |
| 5 | Vignette (custom ShaderPass) | ~0.1ms |
| 6 | Parchment overlay (strategic zoom only) | ~0.2ms |

Total post-processing budget: ~2ms (fits within frame headroom).

### Bloom

- Three.js `UnrealBloomPass`
- Strength: 0.15 (subtle, not overblown)
- Radius: 0.4
- Threshold: 0.85 (only brightest surfaces: water specular, gold accents, white marble)
- At strategic zoom: bloom disabled (save performance)

### Tilt-Shift Depth of Field

- Active at camera height < 500 (tactical/local/detail zoom)
- Focus distance: camera look-at point
- Bokeh radius: 2.0 at detail zoom, 0.5 at tactical zoom, 0 at regional+
- Creates Urbek's signature miniature-world look
- Implemented as a custom `BokehPass`

### Color Grading

Custom shader applied as final full-screen pass:

```
Saturation:  0.85 (slightly desaturated for "historical" feel)
Warmth:      +0.08 (shift toward warm/amber)
Contrast:    1.05 (slightly lifted for depth)
Shadows:     tinted toward (30, 25, 50) -- cool purple shadows
Highlights:  tinted toward (255, 240, 210) -- warm golden highlights
```

### Detail-View Art Direction Contract (Urbek Target)

- At local/detail zoom, city view must feel dense and inhabited, not sparse or sterile.
- Mandatory visible layers in every loaded LOD0 city footprint:
  - landmark silhouettes
  - district props (market/forum/residential/harbor where applicable)
  - moving street life (people + carts + animals)
  - ambient FX (dust/cloth/embers/mist/birds)
  - resource work/haul cues when resource sites are nearby
- Hard prohibitions:
  - no large empty paved areas without props/activity in market/forum districts
  - no floating props/agents
  - no flat-color "dead blocks" without facade variation on long street frontages
- Profile scaling is allowed only in density; category coverage remains mandatory.

### Vignette

- Intensity: 0.25 (subtle darkening at screen edges)
- Smoothness: 0.8
- Always active

### Parchment Overlay (Strategic Zoom Only)

- Activated when camera height > 2000
- Screen-space multiply blend of a subtle paper/parchment noise texture
- Opacity: 0.0 at height 2000, fading to 0.15 at height 5000
- Gives the strategic overview an antique map feel (Imperator Rome)
- Single 512x512 seamless parchment noise texture

### Empire Border Fog

- Tiles with Province-ID = 0 (outside empire) receive modified vertex colors:
  - Saturation reduced by 40%
  - Brightness reduced by 25%
  - Slight blue-gray tint added
- Transition zone: 10 tiles wide at empire border (gradient from full color to desaturated)
- This is baked into vertex colors at mesh generation time (zero GPU cost)

### Map Edge Handling

- The last 50 tiles at each map edge fade to a dark parchment color RGB(60, 50, 40)
- Implemented as vertex color darkening (baked at mesh generation time)
- Creates a natural "edge of the known world" feeling
- No hard cutoff visible

---

## 22. Lighting

### Static Directional Light

- Direction: from southwest, 35 degrees elevation (warm afternoon Mediterranean sun)
- Color: RGB(255, 248, 235) -- warm white
- Intensity: 1.0
- No dynamic day/night cycle (matches Imperator Rome's static lighting)

### Ambient Light

- Color: RGB(140, 155, 180) -- cool sky blue ambient
- Intensity: 0.4
- Provides fill light for shadow-side faces

### Detail-Zoom Grounding (Characters and Props)

- At camera height < 300, visible persons/carts/animals must receive grounding shadows.
- High/Medium profiles: screen-space contact shadow pass under moving entities.
- Low/Toaster profiles: projected blob contact shadows per entity.
- Contact-shadow fade distance: full at detail zoom, fading out to zero by camera height 500.
- Goal: eliminate "floating" appearance in close view.

Note: The primary shading comes from baked face-direction factors and AO in vertex colors. Directional + ambient lights define the global mood.

---

## 23. Per-Vertex Color Noise

To prevent the "flat Minecraft look" and add visual richness:

- At mesh generation time (in Web Worker), each vertex color receives ±5% random RGB variation
- Noise is deterministic per tile position (seeded from tile\_x + tile\_y) for consistency
- This breaks up large same-biome areas into natural-looking variation
- Cost: zero GPU overhead (baked into vertex colors)

Implementation:
```
noise = hash(tile_x * 73856093 ^ tile_y * 19349663) / MAX_UINT
variation = (noise - 0.5) * 0.10  // ±5%
color.r = clamp(baseColor.r * (1.0 + variation), 0, 1)
color.g = clamp(baseColor.g * (1.0 + variation * 0.8), 0, 1)  // less green noise
color.b = clamp(baseColor.b * (1.0 + variation * 0.6), 0, 1)  // less blue noise
```

---

## 24. Text Labels (troika-three-text)

### Technology Choice

Use `troika-three-text` (npm package) instead of a custom SDF font atlas pipeline. Troika generates SDF glyphs on the fly from any .ttf/.otf font file, integrates natively with Three.js, and supports TSL.

### Font

- Primary: "Cinzel" (Google Fonts) -- Roman-style serif font
- Single font file bundled (~100KB)

### Label Types

| Label | Visible At | Size | Color |
|-------|-----------|------|-------|
| Province names | Camera height > 1000 | Scale with zoom | Province color, 70% opacity |
| City names (major) | Camera height 300--3000 | Scale with zoom | White with dark outline |
| City names (all) | Camera height < 300 | Scale with zoom | White with dark outline |
| Road names | Camera height < 300 | Fixed small | Light gray |

### Label Rendering

- Billboard mode: labels always face camera
- Depth test: off (labels render on top of geometry)
- Outline: dark stroke (width 0.05) for readability over any terrain
- Max visible labels: 50 simultaneously (LOD-culled by importance)
- Fade in/out with zoom transitions

---

## 25. Agent Pathfinding Architecture

### 2026 Hierarchical Navigation Stack (Mandatory)

Pathfinding is split into deterministic layers instead of single-stage walker routing.

Coverage requirement: all movable classes (`citizen` variants, traders, caravans, ox carts, horse riders, legions, ships, fishing boats) use this stack with domain-specific lane constraints.

1. **Global route planning (inter-city)**:
  - Hierarchical nav graph with trunk/regional/local edge classes.
  - Query algorithm: ALT+A* with precomputed landmarks on top of contracted hierarchy data.
  - **Landmark selection strategy**: 8 landmarks selected as major trade hubs at geographic extremes for optimal heuristic spread: Roma (center), Alexandria (SE), Londinium (NW), Byzantium (NE), Gades (SW), Antiochia (E), Carthago (S), Augusta Treverorum (N). This strategic placement at the empire's periphery and center maximizes ALT heuristic effectiveness across all possible origin-destination pairs.
  - Seasonal/route-state weights supported (`travel_time_by_season`, disruption flags).
2. **Corridor planning (intra-city / district)**:
  - Walkable corridor extraction on district graph (`STREET`, `PLAZA`, `GATE`, `HARBOR_WALK`).
  - Funnel/string-pulling smoothing over corridor waypoints.
3. **Local avoidance and flow**:
  - Velocity-obstacle style local avoidance (ORCA/RVO class) with deterministic fixed-step integration.
  - Intersection reservation windows to prevent crowd clumps and hard overlaps.
  - Priority lanes for carts/haulers on supply corridors.

### Movement Contract

1. Agent at origin requests global route to destination anchor.
2. Planner returns route segments by hierarchy level (`trunk -> regional -> local`).
3. For current segment, corridor planner returns short-horizon waypoints.
4. Local avoidance solver updates velocity/heading per tick with neighbor constraints.
5. Agents remain on valid walkable or route-authorized lanes; no `BUILDING` crossings.

### Replan Triggers

- Route disruption flag changes (blocked road/port condition).
- Congestion threshold exceeded on active segment.
- Destination state change (service node unavailable, market saturated, etc.).
- Agent fails progress test for configured timeout window.

### Performance Targets

- Global route query (hierarchical graph): p95 <= 0.30 ms.
- Corridor solve (single agent): p95 <= 0.20 ms.
- Local avoidance update (100 visible detail agents): <= 1.5 ms/frame client-side budget.
- Supports 10,000 active agents with stable path updates at simulation tick cadence (with deterministic culling fallback for distant agents).

---

## 26. Realtime Communication Strategy

### Problem

10,000 agents updating positions every 2s = 5,000 updates/second max. Supabase Realtime cannot handle this as individual row-change broadcasts to all clients.

### Solution: Hybrid Polling + Realtime

| Data | Method | Frequency | Reason |
|------|--------|-----------|--------|
| Agent positions | Client polls via RPC | Every 2s | High volume, viewport-filtered |
| World events | Supabase Realtime | On event | Low frequency (~1/min) |
| Player positions | Realtime Broadcast | Every 2s | Low count (<100 players) |
| World state | Realtime | On change | Single row, rare updates |
| Season changes | Realtime | Every ~5min | Single row |

### Agent Position Polling

```typescript
// Client polls only agents in current viewport
const { data: agents } = await supabase.rpc('agents_near_tile', {
  center_x: camera.tileX,
  center_y: camera.tileY,
  radius: viewportRadius  // depends on zoom level
})
// Returns max 200 agents, spatially indexed, <50ms
```

### Benefits

- Supabase Realtime handles only ~5 channels with low-frequency events
- Agent polling is spatially filtered (only agents in viewport)
- No broadcast storm from 10k agent updates
- Scales to any number of agents without Realtime pressure

---

## 27. Mobile & Responsive Requirements

### Viewport and Layout

- The 3D canvas must always fill the available viewport (`100vw x 100dvh`)
- UI must respect safe-area insets (`env(safe-area-inset-*)`) on iOS/Android
- The app must support both portrait and landscape orientation
- No horizontal page scrolling is allowed at any breakpoint

### Responsive Breakpoints

| Breakpoint | Width | Layout Rules |
| ---------- | ----- | ------------ |
| Desktop    | >= 1024px | Full HUD, right-side info panel |
| Tablet     | 768--1023px | Compact HUD, narrower info panel |
| Mobile     | <= 767px | HUD condensed, bottom sheet info panel |

### Mobile UI Rules

- Minimum touch target size: **44x44 CSS px**
- Info panel on mobile opens as bottom sheet (max 60% viewport height)

- Notification stack max: 2 on mobile (3 on tablet/desktop)
- Label density on mobile follows active quality profile (`Label cap` from Section 12)

### Mobile Rendering Rules

- Default profile on phones: **Toaster**
- Target frame rate on smartphones: **30 fps**
- Device pixel ratio cap:
  - High/Medium: `min(devicePixelRatio, 2.0)`
  - Low: `min(devicePixelRatio, 1.5)`
  - Toaster: `1.0`
- Dynamic resolution scaling is required in Toaster profile (`renderScale` 0.6--0.85)
- Mobile chunk cap: max 54 loaded chunks (same as Toaster profile)

### Mobile Compatibility Baseline

- Android: Chrome (current stable, WebGPU-capable devices)
- iOS: Safari (current stable, WebGPU-capable devices)
- If WebGPU is unavailable, the device is out of supported scope for this spec version

---

## 28. Operations & SLOs

### Runtime SLOs

- Balanced profile: 60 fps target, p95 frame time <= 16.6 ms
- Toaster/mobile profile: 30 fps target, p95 frame time <= 33.3 ms
- Chunk fetch latency: p95 <= 150 ms from client request to mesh-ready
- Agent polling RPC latency (`agents_near_tile`): p95 <= 80 ms

### Data Durability & Recovery SLOs

- Point-in-time recovery (PITR) must be enabled for the production database.
- Recovery point objective (RPO): <= 5 minutes of potential data loss.
- Recovery time objective (RTO): <= 60 minutes to restore core service.
- Daily full backup snapshots retained for >= 30 days.
- Monthly backup snapshots retained for >= 12 months.
- Restore drill cadence: at least 1 successful full restore test per month.
- Release blocking rule: schema migrations are not allowed in production without a tested rollback path.

### Security Baseline SLOs

- RLS coverage SLO: 100% of client-reachable `public` tables must have RLS enabled.
- Secrets SLO: zero service-role secrets in client code, repository, or browser-exposed config.
- Patch cadence SLO: critical security issues patched within 24h, high severity within 7 days.
- Abuse control SLO: rate-limited endpoints must maintain < 1% accepted abusive requests in rolling 24h.
- Agent privacy SLO: client-side agent position access is RPC-only (`agents_near_tile`), with zero direct `agents` table reads from client roles.

### Required Telemetry

- Client metrics: frame time, draw calls, loaded chunks, GPU memory estimate, active profile, first-detail-zoom hitch duration, shader prewarm completion ratio
- Worker metrics: queue depth, mesh generation time per chunk, transfer size
- Backend metrics: RPC latency, RPC error rate, Realtime reconnect count, tick-lock contention rate

### Alert Thresholds

- p95 frame time above profile budget for 5 consecutive minutes
- RPC error rate > 2% over 5 minutes
- Repeated profile downshift thrashing (>= 6 profile changes in 2 minutes)
- Tick lock contention > 10% of scheduled ticks over 5 minutes
- First-detail-zoom hitch exceeds profile frame budget for 3 consecutive attempts
- RLS coverage drops below 100% in schema audit
- Detection of service-role key exposure or invalid CORS wildcard policy in production

### Visual QA Gates (Release Blocking)

- Maintain golden scenes for regression checks:
  - Strategic empire overview (province overlay + labels)
  - Dense urban local view (crowds + landmarks + shadows)
  - Coastal harbor view (ships + water + trade activity)
- For each profile (High/Medium/Low/Toaster), capture fixed-camera screenshots and compare to golden baselines.
- Release fails if any of the following are violated:
  - Draw call budget exceeds profile cap.
  - Frame-time p95 exceeds profile budget in golden scenes.
  - Visible LOD popping without blend during scripted zoom sweep.
  - Missing required landmark mesh for tested city.
  - Street crowd rule violations (building clipping or severe overlap).
  - Security baseline violations (RLS coverage, secret exposure, unsafe CORS policy).
  - Detail beauty gate failure: missing mandatory layer categories in tested LOD0 city scenes.
  - Ambient anti-pattern failure in detail scenes:
    - visible prop/FX clipping through architecture
    - obvious spawn pop-in without fade/hysteresis near camera
    - district ambience mismatch (e.g., dead forum/market while nearby districts are active)
  - Caesar-style ambience delta failure:
    - functional walker role coverage below profile minimum
    - no complete visible resource chain in major-city detail scene
    - building runtime states not visually distinguishable

---

## 29. World Scale Contract

- Terrain tiles represent macro geography (regional relief and biome structure), not street-scale terrain fidelity.
- City detail is authored/generated as a local high-detail voxel layer (LOD0 city meshes) on top of macro terrain.
- Historical authenticity target:
  - Macro layer: correct relative geography and province placement
  - Micro layer: recognizable landmark silhouettes, culturally consistent architecture, street-constrained citizen movement

---

## 30. Historical Accuracy Policy

### Accuracy Targets

- Target is **high historical plausibility**, not mathematical certainty.
- Every city and province record must carry explicit provenance + confidence metadata.
- Boundaries, names, and landmark sets must be traceable to listed source datasets.

### Accuracy Tiers (Required)

| Tier | Definition | Typical Evidence |
| ---- | ---------- | ---------------- |
| A | Strongly attested with converging sources and low ambiguity | Primary atlas/GIS + corroborating historical references |
| B | Plausible reconstruction with moderate ambiguity | 1 strong source + inferred alignment from supplementary sources |
| C | Speculative reconstruction retained for gameplay completeness | Weak/fragmentary evidence or generalized placement |

### UI Disclosure Rules

- Info panels for cities/provinces must display:
  - `accuracy_tier` badge (`A`, `B`, `C`)
  - `confidence` value (0.0--1.0)
  - source count from `source_refs`
- If `name_status='reconstructed'`, the panel must show a reconstruction marker.

### Data Rules

- Required fields for `cities` and `provinces`:
  - `accuracy_tier` (`A|B|C`)
  - `confidence` (`0.0..1.0`)
  - `source_refs` (array of source identifiers/URLs)
  - `name_status` (`attested|reconstructed`)
- Pipeline output is invalid if these fields are missing for any seeded city/province.
