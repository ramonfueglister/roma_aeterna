# Rendering Pipeline

Complete rendering pipeline documentation for the Roman Empire Voxel World Map.
This document covers every stage from raw voxel data to final pixels on screen,
including meshing algorithms, GPU batching strategies, worker communication,
memory management, and adaptive quality controls.

---

## 1. Greedy Meshing Algorithm

### Problem

Naive approach: 2 triangles per visible voxel face. A 32x32 chunk with height 10
produces approximately 10,000 visible faces, which equals 20,000 triangles. Greedy
meshing reduces this to approximately 400-600 triangles.

### Triangle Reduction

| Method | Quads/Chunk | Triangles/Chunk | Draw Calls |
|--------|-------------|-----------------|------------|
| Naive (1 face/voxel) | ~3,000 | ~6,000 | 1 per chunk |
| Greedy Meshing | ~200-300 | ~400-600 | 1 per chunk |
| Greedy + BatchedMesh | ~200-300 | ~400-600 | 1 per LOD level |

### Algorithm Steps

For each face direction (top, bottom, north, south, east, west):

1. Create a 2D slice of visible faces for that direction.
2. For each row, find runs of same-color, same-height faces.
3. Extend runs vertically to form maximal rectangles.
4. Each rectangle becomes 1 quad (2 triangles) instead of N quads.

### Binary Greedy Meshing Optimization

- Whole rows encoded as 32-bit integers.
- Bitwise AND/OR for fast neighbor comparisons.
- Result: less than 200 microseconds per 32x32 chunk (vs ~2ms standard).
- Reference: github.com/cgerikj/binary-greedy-meshing

---

## 2. Voxel-to-Mesh Pipeline

### VoxelModel Data Structure

```typescript
class VoxelModel {
  width: number;   // X
  depth: number;   // Z
  height: number;  // Y
  voxels: Uint8Array;  // palette index per voxel (0 = empty)
  palette: Uint32Array; // RGB colors (max 255 entries)
}
```

### BufferGeometry Construction

- Vertex attributes: positions (Float32Array), normals (Float32Array), colors (Float32Array).
- Vertex colors only, NO textures.
- MagicaVoxel-style directional shading baked into vertex colors.
- All buildings of a city batched into a single BufferGeometry.

### Face Shading (Baked into Vertex Colors)

```
Top:    1.00  (full brightness)
Bottom: 0.50  (darkest)
North:  0.80  (slightly shadowed)
South:  0.80  (slightly shadowed)
East:   0.88  (light side)
West:   0.65  (shadow side)
```

### Per-Vertex Ambient Occlusion

```
For each vertex of a face:
  Count adjacent solid voxels (0-3 neighbors)
  AO value = 1.0 - (neighbors * 0.15)
  Color *= AO value
```

Cost: 0 GPU overhead. AO is baked into the vertex color at mesh generation time.

---

## 3. Web Worker Communication

### Architecture

- 4 Web Workers in a pool (2 in Toaster profile).
- Task queue: free worker picks next task.
- Transferable ArrayBuffers (zero-copy ownership transfer).

### Message Protocol

Main thread to Worker:

```json
{
  "type": "meshChunk",
  "chunkX": 32,
  "chunkY": 45,
  "heights": "ArrayBuffer",
  "biomes": "ArrayBuffer",
  "flags": "ArrayBuffer",
  "province": "ArrayBuffer",
  "lod": 0
}
```

Worker to Main thread:

```json
{
  "type": "chunkReady",
  "chunkX": 32,
  "chunkY": 45,
  "lod": 0,
  "positions": "ArrayBuffer",
  "normals": "ArrayBuffer",
  "colors": "ArrayBuffer",
  "vertexCount": 1824
}
```

### Transferable Objects

- ArrayBuffers are transferred (not copied) between threads.
- Ownership moves: the sender can no longer access the buffer.
- Zero-copy: no memory duplication, no GC pressure.
- Critical for 60fps: copying 100KB per chunk would cause frame drops.

---

## 4. Chunk Border Handling

- Database stores 32x32 core tiles per chunk (4,104-byte binary format).
- At load time, ChunkManager assembles 34x34 working region from core + neighboring chunk edges.
- Border data is needed for:
  - Correct greedy meshing at edges (adjacent faces).
  - Correct AO calculation at borders.
  - Seamless terrain across chunk boundaries.
- If neighbor not loaded yet: border defaults to sea level (height 32, biome=shallow\_sea).
- Worker receives 34x34 data, outputs 32x32 geometry only.

---

## 5. BatchedMesh vs InstancedMesh

### BatchedMesh (Terrain)

- All terrain chunks of same LOD level in ONE draw call.
- Different geometries packed into one large vertex/index buffer.
- Three.js manages with `addGeometry()` and `setGeometryAt()`.
- Result: approximately 4 draw calls for entire terrain (one per LOD level).
- Use for: terrain chunks, city detail meshes.

### InstancedMesh (Repeated Objects)

- Same geometry, different position/size/color.
- Only Transform-Matrix per instance (16 floats = 64 bytes).
- Result: 1 draw call for 10,000 trees.
- Use for: trees, resource icons, city icons, ships, people, sheep.

### Draw Call Budget Per Zoom Level

#### Balanced Profile

| Zoom | Terrain | Cities | Water | Overlay | Ambient | Agents | TOTAL |
|------|---------|--------|-------|---------|---------|--------|-------|
| Strategic (5000) | 4 | 1 | 1 | 3 | 1 | 2 | ~12 |
| Regional (2000) | 4 | 1 | 1 | 4 | 1 | 3 | ~14 |
| Tactical (500) | 4 | 5-10 | 1 | 5 | 3 | 4 | ~24 |
| Local (150) | 4 | 3-5 | 1 | 3 | 5 | 5 | ~23 |
| Detail (30) | 4 | 1-2 | 1 | 1 | 5 | 5 | ~19 |

Agent draw calls: 1 per InstancedMesh type (ships, traders, legions, citizens, fishing boats, horse riders, ox carts).
Only visible types counted per zoom level. Always under 50 total.
Toaster profile hard cap: **<= 14 total draw calls** at any zoom level.

#### Toaster Profile

| Zoom | Terrain | Cities | Water | Overlay | Ambient | Agents | TOTAL |
|------|---------|--------|-------|---------|---------|--------|-------|
| Strategic (5000) | 2 | 1 | 1 | 2 | 1 | 1 | ~8 |
| Regional (2000) | 2 | 1 | 1 | 2 | 1 | 1 | ~8 |
| Tactical (500) | 2 | 2-3 | 1 | 2 | 1 | 2 | ~10-11 |
| Local (150) | 2 | 2 | 1 | 2 | 1 | 2 | ~10 |
| Detail (30) | 2 | 1 | 1 | 1 | 1 | 2 | ~8 |

---

## 6. Adaptive Quality System

Triggered when the active frame-time budget is exceeded for 10 consecutive frames.

| Setting | High | Medium | Low | Toaster |
|---------|------|--------|-----|---------|
| Water Shader | Full + displacement + foam | Normal maps + color | Flat colored | Flat colored |
| Tree Instances | 5,000 | 1,000 | 200 | 0 |
| City Detail Cache | 30 cities | 15 cities | 5 cities | 2 cities |
| LOD Distances | Full | Halved | Quartered | One-eighth |
| Ambient Effects | Full set (smoke, birds, cloth, dust) | Reduced set | Core set | Core set |
| Ambient FX Pack | Full set + dense micro-events | Full set + reduced density | Core set + sparse events | Core set + sparse events |
| Cloud Layer | 2 moving layers + soft ground tint | 1 moving layer | Sparse layer | Sparse layer |
| Street Life Cap (detail zoom) | 220 entities | 140 entities | 80 entities | 40 entities |
| Harvest Loops (frustum) | 120 active loops | 80 active loops | 48 active loops | 24 active loops |
| Ambient FX Emitters (frustum) | 260 emitters | 170 emitters | 90 emitters | 45 emitters |
| Contact Shadows | Screen-space | Screen-space | Blob shadows | Blob shadows |
| Workers | 4 | 4 | 3 | 2 |
| Label Cap | 50 | 40 | 20 | 8 |
| Target Hardware | RTX 3060+ | GTX 1060 | Intel UHD 630 | Intel HD 4000 / low-end iGPU |

---

## 7. GC Avoidance Strategies

- Object pooling for all per-frame operations.
- No per-frame allocations (pre-allocate vectors, matrices).
- Reuse ArrayBuffers across worker messages where possible.
- Pre-allocate geometry buffers at known max sizes.
- Use TypedArrays exclusively (no regular arrays for numerical data).
- Avoid string concatenation in hot paths.
- No closures in render loop.

---

## 8. IndexedDB Caching (idb-keyval)

### What Gets Cached

- Generated chunk meshes (positions, normals, colors buffers).
- City detail meshes after first generation.
- Voxelized building models.

### Cache Key Schema

```
chunk_{x}_{y}_{lod}_{version}
city_{id}_{lod}_{version}
building_{culture}_{type}_{lod}
```

### Cache Strategy

- LRU eviction when storage exceeds limit (~200MB).
- Version field invalidates cache on data updates.
- On load: check IndexedDB first, generate only if cache miss.
- Async: cache writes happen after render, never block frame.

---

## 9. GPU Memory Management

### Balanced Profile: 512MB GPU Total

| Component | Budget | Strategy |
|-----------|--------|----------|
| Terrain Chunks (loaded) | 100MB | Max 150 chunks, LRU by distance |
| Water | 10MB | Single plane + shader |
| City Detail Meshes | 150MB | LRU cache ~30 cities |
| City Cluster Meshes | 50MB | All 300+ preloaded (~1KB each) |
| Font + Overlay | 50MB | Troika glyph atlas + province distance field texture |
| Overlay | 30MB | Province mesh + text labels |
| Headroom | 122MB | GC, Three.js internal |

### Toaster Profile: 192MB GPU Total

| Component | Budget | Strategy |
|-----------|--------|----------|
| Terrain Chunks (loaded) | 36MB | Max 54 chunks, aggressive LRU |
| Water | 4MB | Flat colored surface |
| City Detail Meshes | 40MB | LRU cache ~8 cities |
| City Cluster Meshes | 20MB | Compressed clusters |
| Font + Overlay | 20MB | Troika glyph atlas with strict cap |
| Overlay | 12MB | Province mesh + sparse labels |
| Headroom | 60MB | GC, browser internal |

### Geometry Disposal

- When chunk leaves view: `geometry.dispose()`, `material.dispose()`.
- Remove from BatchedMesh with `removeGeometry()`.
- Explicit BufferAttribute disposal.
- Monitor with `renderer.info.memory`.

### Spiral Loading

- Chunks loaded from camera center spiraling outward.
- Movement direction prioritized (load ahead of movement).
- Balanced: max 150 chunks loaded simultaneously.
- Toaster: max 54 chunks loaded simultaneously.
- Beyond cap: LRU eviction of furthest chunks.

---

## 10. LOD Transition Blending

### Alpha Blending Zones

- Wide transition zones: 200-500 units between LOD levels.
- Incoming LOD fades in (alpha 0 to 1).
- Outgoing LOD fades out (alpha 1 to 0).
- `depthWrite=false` on fading-out LOD to prevent z-fighting.

### LOD Distance Thresholds

| LOD | Full Detail At | Fade Start | Fade End | Next LOD At |
|-----|----------------|------------|----------|-------------|
| LOD0 | < 300 | 300 | 500 | 400 |
| LOD1 | 400-1000 | 1000 | 1400 | 1200 |
| LOD2 | 1200-3000 | 3000 | 3600 | 3200 |
| LOD3 | > 3200 | - | - | - |

---

## 11. Water Rendering (TSL Shader)

### Implementation

- TSL (Three Shading Language) in TypeScript, not GLSL.
- Single transparent plane at sea level (height 32).

### Shader Features

- 2 overlapping normal maps (different scroll directions).
- Fresnel-based transparency (flat angle = more reflection).
- Depth-dependent color.

### Water Colors

```
Coast (0-2 tiles deep):   RGB(100, 200, 210) - turquoise
Shallow (2-5 tiles):      RGB(65, 155, 190)  - light blue
Medium (5-15 tiles):      RGB(40, 100, 160)  - medium blue
Deep (15+ tiles):         RGB(20, 50, 110)   - deep blue
River:                    RGB(78, 145, 180)   - slightly greener
```

### Wave Parameters

```
Wave 1: Frequency 0.05, Amplitude 0.3 voxels, Direction 30 deg
Wave 2: Frequency 0.08, Amplitude 0.15 voxels, Direction 120 deg
Scroll speed: 0.02 units/frame
```

### Coastal Effects

- Foam line: white semi-transparent dots at land/water edge.
- Surf: slight height oscillation at coast (0.2 voxels).
- Rock spray: white particles at cliff coasts.
- Wet-sand tint strip (`shore_wet`) applied on beach-contact terrain ring.
- Coastline mask is generated from water/land tile adjacency to keep foam and wet-sand placement deterministic.

### Harbor Water Behavior

- Harbor basins use local wave damping (reduced displacement amplitude).
- Pier and quay edges increase localized foam intensity.
- Ship wake intensity is boosted on active harbor lane segments to improve readability of port traffic.

### Transparency

- Fresnel: flat angle = reflection, steep angle = transparency.
- Alpha: 0.7 (coast) to 0.95 (deep sea).

### 3 Quality Levels

- **High**: Full shader + displacement + foam.
- **Medium**: Normal maps + color, no displacement.
- **Low**: Flat colored surface.

---

## 12. 10 Core Optimization Strategies

1. **Frustum Culling**: Three.js `Mesh.frustumCulled = true` (automatic).
2. **Spiral Chunk Loading**: Camera center outward, movement-aware.
3. **Worker Scaling**: 4 workers (2 in Toaster profile) with Transferable ArrayBuffers.
4. **Greedy Meshing**: 90% triangle reduction.
5. **InstancedMesh**: 1 draw call per object type (trees, ships, etc.).
6. **BatchedMesh**: 1 draw call per terrain LOD level.
7. **Adaptive Profiles**: Auto-step High → Medium → Low → Toaster on frame drops.
8. **IndexedDB Caching**: Skip regeneration on revisit.
9. **Deferred Loading**: LOD3 instant, progressive upgrade.
10. **Troika Text Cache**: one bundled font file + runtime glyph atlas for all text labels.

### Shader and Asset Prewarm (Stutter Prevention)

- Before interactive camera control is enabled, prewarm:
  - terrain materials (all LOD variants)
  - water shader permutations (profile-dependent)
  - city/agent/ambient instanced materials
  - post-processing passes used by current profile
- First-detail-zoom hitch budget:
  - Balanced profiles: <= 16.6 ms extra frame cost
  - Toaster/mobile: <= 33.3 ms extra frame cost
- GPU upload throttle during streaming:
  - High/Medium: <= 8 MB uploads per frame
  - Low: <= 5 MB uploads per frame
  - Toaster: <= 3 MB uploads per frame
- If prewarm is incomplete, detail-level effects may be delayed, but camera movement must stay within profile frame budget.

---

## 13. Post-Processing & Visual Style

See SPECS.md sections 21--23 for full specification. Summary:

### Render Pipeline Order

```
1. Scene render (terrain, water, cities, agents, overlays)
2. UnrealBloomPass (subtle, threshold 0.85)
3. Tilt-shift DOF (active at zoom < 500, Urbek style)
4. Color grading (warm, slightly desaturated, Mediterranean)
5. Vignette (0.25 intensity)
6. Parchment overlay (strategic zoom > 2000 only)
```

### Key Visual Features

- **Empire border fog**: Province-ID=0 tiles desaturated + darkened (baked in vertex colors)
- **Per-vertex color noise**: ±5% RGB variation baked at mesh time (breaks flat look)
- **Map edge fade**: Last 50 tiles fade to dark parchment RGB(60, 50, 40)
- **Static lighting**: Warm directional from SW + cool ambient (no day/night)
- **Character/prop grounding**: contact shadows in detail/local views
- **Text labels**: troika-three-text with "Cinzel" font (Roman serif)
- **Ambient FX pack**: street dust, cloth motion, forge sparks, fountain mist, bird micro-fauna

### Ambient FX Pack Implementation

- All ambient FX emitters are grouped in instanced pools by category to preserve draw-call budgets.
- Required categories:
  - `DustEmitterPool` (roads, quarries, markets)
  - `ClothMotionInstances` (awnings, banners, laundry)
  - `EmberEmitterPool` (forge/kiln points)
  - `MistEmitterPool` (fountains/cisterns)
  - `BirdGroundFlocks` (pigeons/gulls with scatter behavior)
- Budget contract: ambient FX draw calls are included in the existing `Ambient` column limits in Section 5 tables.
- Toaster profile keeps category coverage but reduces emitter count and particle lifetime.

### Ambient Anchor and Spawn Validation

- Primary spawn points come from `ambient_anchors` data (district + tag aware).
- For each spawn candidate, runtime validation must pass:
  - no collision with building/wall/gate/bridge blockers
  - no forbidden context tag match (`avoid_tags`)
  - effect type allowed by anchor `allow_types/deny_types`
- Invalid candidates are discarded; they are not force-snapped into nearby blocked geometry.

### Ambient FX Manifest Loading

- Manifest source: `data/meta/ambient_fx_manifest.json`
- Load phase: after world metadata, before ambient subsystem initialization.
- Required checks:
  - JSON schema validity (required keys/types)
  - unique effect `id`
  - valid `type` enum
  - complete `profile_caps` (`high`, `medium`, `low`, `toaster`)
- On validation error: ambient subsystem stays disabled and startup reports blocking config error.
- Spawn scheduling uses deterministic hash `(seed, chunkX, chunkY, tickWindow, effectId)`.

### Microdetail LOD Fade and Hysteresis

- Small props and ambient emitters must use fade bands and hysteresis to prevent visible pop-in/out while moving camera.
- Required transition behavior:
  - fade-in duration: 120-220 ms
  - fade-out duration: 90-180 ms
  - activation hysteresis: 12% zoom-distance buffer before state switch
- Camera-near sudden enable/disable of full prop groups is forbidden.

### Patina and Wear Layer

- Detail streets/buildings must include low-cost material variation layers:
  - edge darkening
  - dirt accumulation at ground contact
  - moisture/wet tint near fountains/shoreline
  - wheel/foot traffic wear on major routes
- Patina layer is vertex-color/decal based and must remain within existing profile budgets.

---

## 14. Client TypeScript Architecture

### File Structure

```
client/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   └── favicon.ico
└── src/
    ├── main.ts                    # Entry point: init Three.js, Supabase, start loop
    ├── config.ts                  # Constants (MAP_SIZE, CHUNK_SIZE, SEA_LEVEL, etc.)
    ├── supabase.ts                # Supabase client init + Realtime subscriptions
    │
    ├── core/
    │   ├── Engine.ts              # Three.js renderer, scene, camera setup
    │   ├── CameraController.ts    # Zoom, pan, rotate, tilt (logarithmic zoom)
    │   ├── InputHandler.ts        # Mouse, keyboard, touch event routing
    │   └── GameLoop.ts            # requestAnimationFrame loop, delta time
    │
    ├── world/
    │   ├── ChunkManager.ts        # Load/unload chunks, spiral loading, LOD selection
    │   ├── ChunkMesh.ts           # Chunk geometry management, BatchedMesh integration
    │   ├── TerrainRenderer.ts     # 4 BatchedMesh instances (1 per LOD)
    │   ├── WaterRenderer.ts       # TSL water shader, wave animation
    │   └── BiomeColors.ts         # Biome color palette lookup
    │
    ├── cities/
    │   ├── CityManager.ts         # City LOD switching (icon → cluster → detail)
    │   ├── CityGenerator.ts       # Procedural voxel city generation
    │   ├── BuildingTemplates.ts   # Building recipes per culture
    │   ├── BuildingRuntimeState.ts # Runtime state cues (supply/repair/upgrade)
    │   └── CityIcons.ts           # InstancedMesh for city icons (LOD2)
    │
    ├── agents/
    │   ├── AgentManager.ts        # Subscribe to Realtime, interpolate positions
    │   ├── AgentRenderer.ts       # InstancedMesh per agent type
    │   └── AgentInterpolator.ts   # Smooth movement between server ticks
    │
    ├── overlays/
    │   ├── ProvinceOverlay.ts     # JFA distance field, province fill + borders
    │   ├── TradeRouteLines.ts     # Polyline rendering for trade routes
    │   ├── RoadRenderer.ts        # Road network rendering
    │   ├── ResourceIcons.ts       # InstancedMesh for resource field icons
    │   └── TextLabels.ts          # Troika text labels for provinces + cities
    │
    ├── ambient/
    │   ├── AmbientFxManifest.ts   # Manifest parsing + validation + lookup
    │   ├── AmbientAnchorIndex.ts  # Anchor loading + spatial lookup
    │   ├── TreeInstances.ts       # InstancedMesh for trees (5 species)
    │   ├── SmokeParticles.ts      # City smoke effect
    │   ├── BirdFlocks.ts          # Boids algorithm flocks
    │   ├── DustEmitterPool.ts     # Street/quarry dust puffs
    │   ├── ClothMotion.ts         # Awnings, banners, laundry sway
    │   ├── EmberEmitterPool.ts    # Forge/kiln spark particles
    │   ├── FountainMist.ts        # Plaza fountain mist
    │   ├── MicrodetailFader.ts    # Pop-in/pop-out fade + hysteresis control
    │   └── SeasonEffects.ts       # Seasonal color shifts, winter snow
    │
    ├── postfx/
    │   ├── PostProcessing.ts      # EffectComposer setup + pass management
    │   ├── ColorGradingPass.ts    # Warm Mediterranean color grading
    │   ├── VignettePass.ts        # Screen-edge darkening
    │   ├── ParchmentPass.ts       # Antique map overlay (strategic zoom)
    │   └── TiltShiftPass.ts       # Depth-of-field (Urbek style)
    │
    ├── ui/
    │   ├── HUD.ts                 # Top-level HUD container
    │   ├── Minimap.ts             # 200x200 minimap overlay
    │   ├── InfoPanel.ts           # Right-side city/province info panel
    │   ├── Notifications.ts       # Bottom-center world event notifications
    │   ├── Compass.ts             # Compass indicator
    │   └── ZoomSlider.ts          # Zoom level indicator
    │
    ├── workers/
    │   ├── WorkerPool.ts          # 4-worker pool with task queue
    │   ├── meshWorker.ts          # Worker entry: greedy meshing
    │   └── cityWorker.ts          # Worker entry: city generation
    │
    └── utils/
        ├── ObjectPool.ts          # Generic typed object pool
        ├── SpiralIterator.ts      # Spiral coordinate generator
        ├── CoordMapper.ts         # lat/lon <-> tile coordinate conversion
        └── MeshCache.ts           # IndexedDB read/write via idb-keyval
```

### Module dependencies (simplified)

```
main.ts
  ├── Engine (Three.js setup)
  ├── CameraController (input → camera)
  ├── ChunkManager (Supabase → chunks → workers → TerrainRenderer)
  ├── CityManager (Supabase → CityGenerator → workers)
  ├── AgentManager (Supabase Realtime → AgentRenderer)
  ├── ProvinceOverlay (Supabase → JFA texture)
  ├── HUD (DOM overlay)
  └── GameLoop (orchestrates frame updates)
```

---

## 15. IndexedDB Serialization Format

### Stored value structure

Each cached entry is a single ArrayBuffer with a header followed by payload.

```
[2 bytes: uint16 version]
[2 bytes: uint16 type]          // 0=chunk, 1=city, 2=building
[4 bytes: uint32 vertexCount]
[4 bytes: uint32 positionsBytes]
[4 bytes: uint32 normalsBytes]
[4 bytes: uint32 colorsBytes]
[positionsBytes: Float32Array]   // x,y,z per vertex
[normalsBytes:   Float32Array]   // nx,ny,nz per vertex
[colorsBytes:    Float32Array]   // r,g,b per vertex
```

### Read/write example

```typescript
// Write to cache
async function cacheMesh(key: string, mesh: MeshData): Promise<void> {
  const totalSize = 20 + mesh.positions.byteLength
    + mesh.normals.byteLength + mesh.colors.byteLength
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  let offset = 0
  view.setUint16(offset, 1, true); offset += 2          // version
  view.setUint16(offset, 0, true); offset += 2          // type
  view.setUint32(offset, mesh.vertexCount, true); offset += 4
  view.setUint32(offset, mesh.positions.byteLength, true); offset += 4
  view.setUint32(offset, mesh.normals.byteLength, true); offset += 4
  view.setUint32(offset, mesh.colors.byteLength, true); offset += 4
  new Uint8Array(buffer, offset).set(new Uint8Array(mesh.positions.buffer))
  offset += mesh.positions.byteLength
  new Uint8Array(buffer, offset).set(new Uint8Array(mesh.normals.buffer))
  offset += mesh.normals.byteLength
  new Uint8Array(buffer, offset).set(new Uint8Array(mesh.colors.buffer))
  await idbSet(key, buffer)
}

// Read from cache
async function loadCachedMesh(key: string): Promise<MeshData | null> {
  const buffer = await idbGet<ArrayBuffer>(key)
  if (!buffer) return null
  const view = new DataView(buffer)
  let offset = 0
  const version = view.getUint16(offset, true); offset += 2
  const type = view.getUint16(offset, true); offset += 2
  const vertexCount = view.getUint32(offset, true); offset += 4
  const posBytes = view.getUint32(offset, true); offset += 4
  const norBytes = view.getUint32(offset, true); offset += 4
  const colBytes = view.getUint32(offset, true); offset += 4
  return {
    vertexCount,
    positions: new Float32Array(buffer, offset, posBytes / 4),
    normals: new Float32Array(buffer, offset + posBytes, norBytes / 4),
    colors: new Float32Array(buffer, offset + posBytes + norBytes, colBytes / 4)
  }
}
```

### Cache eviction

- Max total size: ~200MB (check with `navigator.storage.estimate()`)
- LRU tracking: separate IndexedDB store with `{key, lastAccess, size}` entries
- Eviction runs when total exceeds 80% of limit
- Evicts least-recently-accessed entries until under 60%

---

## 16. Mobile Rendering & Responsive UI Constraints

### Smartphone Defaults

- Default quality profile on phones: **Toaster**
- Target framerate on smartphones: **30 fps**
- Worker pool on phones: **2 workers**
- Max loaded chunks on phones: **54**

### Resolution Scaling

- Renderer must cap effective DPR by profile:
  - High/Medium: `<= 2.0`
  - Low: `<= 1.5`
  - Toaster: `1.0`
- Toaster profile must enable dynamic render scale in range **0.6--0.85**

### UI/Canvas Integration

- WebGPU canvas must use `100dvh` to avoid mobile browser bar jumps
- HUD overlays must avoid notch/home-indicator zones via safe-area CSS insets
- Mobile info panel must render as bottom sheet, not desktop side panel
- Touch targets for all controls must be at least **44x44 CSS px**

---

## 17. Visual QA Gates

### Golden Scenes (Required)

- Strategic overview: province fills/borders/labels visible
- Dense urban local: landmarks, crowd movement, contact shadows
- Harbor/coastline: water, ships, resource/trade overlays

### Test Protocol

- Run scripted camera path (zoom in/out + pan + rotate) on each golden scene.
- Execute per profile: High, Medium, Low, Toaster.
- Capture fixed-frame screenshots and compare against baselines.

### Pass/Fail Criteria

- No hard LOD popping during zoom sweep (blended transitions only).
- Frame-time p95 within profile budget.
- Draw calls within profile cap (including Toaster <= 14).
- No building clipping by moving agents in local/detail view.
- Contact-shadow grounding present for moving entities at local/detail zoom.

### Detail Beauty Gates (Urbek-Style)

- In LOD0 golden scenes, the following categories must be simultaneously visible:
  - landmarks
  - street life entities
  - district props
  - ambient FX
  - (where applicable) harvest/haul activity
- Decorative prop density in visible walkable city tiles must meet profile floor:
  - High >= 0.24 props/tile
  - Medium >= 0.16 props/tile
  - Low >= 0.10 props/tile
  - Toaster >= 0.06 props/tile
- Fail if any tested detail scene looks functionally sparse due to missing category layers despite meeting FPS budget.
- Fail on anti-patterns:
  - abrupt prop/FX pop-in near camera path
  - repeated long facades with no visible patina/wear variation
  - FX/props intersecting architecture blockers
  - district activity mismatch (forum/market or harbor zones missing profile-appropriate ambience)

### Caesar-Style Activity Gates

- Functional walker role visibility in dense LOD0 scenes:
  - High/Medium: >= 4 concurrent role categories
  - Low/Toaster: >= 3 concurrent role categories
- Economy-chain gate:
  - At least one full chain (`extraction -> transfer_in -> processing -> transfer_out -> consumption`) visibly active in major-city scene.
- Interaction cadence gate:
  - Minimum micro-interaction cadence in camera frustum:
    - High/Medium: >= 18 interaction events/minute
    - Low: >= 10 events/minute
    - Toaster: >= 6 events/minute
- Building state gate:
  - Runtime state cues for service/economy buildings must be visually distinguishable (`supplied`, `low_supply`, `unsupplied`, `needs_repair`, `upgrading`).
