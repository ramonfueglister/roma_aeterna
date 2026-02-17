# Entity Component System (bitECS v0.4.x)

Client-side ECS architecture for the Roman Empire Voxel World.
bitECS provides the data layer between Supabase (authoritative server) and Three.js (view).

---

## 1. Library Choice

### Why bitECS

| Criterion | bitECS v0.4.x | becsy | miniplex | tick-knock |
|-----------|---------------|-------|----------|------------|
| Storage model | SoA TypedArrays | SoA + AoS hybrid | AoS (Map-based) | AoS (class-based) |
| Iteration speed | ~335K ops/s | ~280K ops/s | ~120K ops/s | ~90K ops/s |
| Bundle size | ~5 KB | ~25 KB | ~8 KB | ~12 KB |
| TypeScript native | Yes (100%) | Yes | Yes | Yes |
| Worker transfer | Zero-copy (TypedArrays) | Requires serialization | Requires serialization | Requires serialization |
| Entity relations | Yes (v0.4.x) | Yes | No | No |
| Framework endorsement | Phaser 4 | None major | None major | None major |

**Key reasons:**

1. **SoA TypedArrays** — Component data stored as `Float32Array`/`Uint8Array`. Cache-friendly iteration, maps directly to `InstancedMesh.instanceMatrix` and worker `Transferable` buffers.
2. **~5 KB, zero deps** — Minimal footprint in a project already budget-constrained (512 MB GPU, 256 MB heap).
3. **Worker-friendly** — The project uses 4 Web Workers with `Transferable ArrayBuffers`. bitECS component stores are already TypedArrays — extract a slice, transfer it, zero-copy.
4. **Functional API** — No classes. `defineComponent()`, `defineQuery()`, `defineSystem()` are pure functions. Matches the project's existing functional patterns.
5. **Entity relations (v0.4.x)** — Parent-child (city → buildings), targeting (agent → destination city). Eliminates manual ID lookups.

### npm

```bash
npm install bitecs@^0.4
```

---

## 2. World Setup

A single ECS world is created at client startup. It holds all component stores and entity metadata.

```typescript
// client/src/ecs/world.ts
import { createWorld, IWorld } from 'bitecs'

export const world: IWorld = createWorld({
  maxEntities: 20_000  // chunks + cities + agents + trees + provinces + resources + misc
})
```

**Sizing rationale:**

| Entity type | Max count | Notes |
|-------------|-----------|-------|
| Chunks (loaded) | 150 | Balanced profile cap |
| Cities | 350 | 300+ cities + villages |
| Agents (visible) | 1,000 | Viewport-filtered subset of 10K server-side |
| Trees | 5,000 | High profile instance cap |
| Provinces | 42 | 41 + barbarian territory entity |
| Resource sites | 500 | Visible resource fields |
| Camera | 1 | Singleton |
| Water plane | 1 | Singleton |
| Labels | 50 | Text label pool |
| Misc | ~1,900 | Headroom |
| **Total** | **~20,000** | |

---

## 3. Component Definitions

All components are SoA (Struct of Arrays). Each field is a separate TypedArray indexed by entity ID (eid).

### Spatial Components

```typescript
// client/src/ecs/components.ts
import { defineComponent, Types } from 'bitecs'

// World-space position (tile coordinates for game objects, world units for camera)
export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32
})

// Movement velocity (tiles/second for agents, units/second for camera)
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32
})

// Rotation (radians)
export const Rotation = defineComponent({
  yaw: Types.f32,
  pitch: Types.f32
})
```

### Chunk Components

```typescript
// Grid coordinates (0-63) for chunks
export const ChunkCoord = defineComponent({
  cx: Types.ui8,
  cy: Types.ui8
})

// Current LOD level (0-3) and target LOD for transitions
export const LODLevel = defineComponent({
  current: Types.ui8,
  target: Types.ui8,
  blendAlpha: Types.f32  // 0.0-1.0 for LOD transition blending
})
```

### Mesh Reference Components

These store indices into Three.js container objects, NOT Three.js objects themselves.

```typescript
// Index into a BatchedMesh (terrain chunks, city detail meshes)
export const MeshRef = defineComponent({
  batchId: Types.ui16,     // which BatchedMesh (0=LOD0, 1=LOD1, 2=LOD2, 3=LOD3)
  geometryId: Types.i32    // index returned by BatchedMesh.addGeometry(), -1 = none
})

// Index into an InstancedMesh (trees, agents, icons, ships)
export const InstanceRef = defineComponent({
  poolId: Types.ui8,       // which InstancedMesh pool (see InstancePool enum)
  instanceId: Types.i32    // index in the InstancedMesh, -1 = none
})
```

### City Components

```typescript
// City metadata (maps from cities table)
export const CityInfo = defineComponent({
  tier: Types.ui8,           // 1=world wonder, 2=major, 3=notable, 4=small/village
  population: Types.ui32,
  provinceNumber: Types.ui8, // 1-41
  culture: Types.ui8,        // enum: 0=roman,1=greek,2=egyptian,...
  isHarbor: Types.ui8,       // boolean as uint8
  isCapital: Types.ui8       // boolean as uint8
})

// LOD-specific city display state
export const CityDisplay = defineComponent({
  lodMode: Types.ui8         // 0=icon, 1=cluster, 2=detail
})
```

### Agent Components

```typescript
// Agent type and role (maps from agents table)
export const AgentRole = defineComponent({
  agentType: Types.ui8,      // enum: 0=trader,1=ship,2=legion,3=citizen,...
  role: Types.ui8,            // enum: 0=market_walker,1=service_walker,...
  state: Types.ui8            // enum: 0=idle,1=moving,2=trading,...
})

// Agent movement interpolation
export const AgentMovement = defineComponent({
  prevX: Types.f32,          // position at last server tick
  prevY: Types.f32,
  nextX: Types.f32,          // target position (from server)
  nextY: Types.f32,
  interpT: Types.f32,        // 0.0-1.0 interpolation factor
  speed: Types.f32,          // tiles/second
  heading: Types.f32         // radians
})
```

### Environment Components

```typescript
// Tree species variant
export const TreeVariant = defineComponent({
  species: Types.ui8,        // 0=cypress,1=oak,2=palm,3=olive,4=pine
  scale: Types.f32           // size variation multiplier
})

// Province entity (metadata, not per-tile)
export const ProvinceTag = defineComponent({
  number: Types.ui8,         // 1-41 (0 = barbarian)
  culture: Types.ui8         // enum matching CityInfo.culture
})

// Resource site
export const ResourceSite = defineComponent({
  resourceType: Types.ui8,   // 0-23 (24 resource types)
  harvestState: Types.ui8,   // 0=idle, 1=work, 2=haul, 3=recover
  stateTimer: Types.f32,     // seconds remaining in current state
  fieldSizeX: Types.ui8,
  fieldSizeY: Types.ui8
})
```

### Sync and Lifecycle Components

```typescript
// Server synchronization tracking
export const ServerSync = defineComponent({
  lastTick: Types.ui32,      // last server tick this entity was updated from
  missedPolls: Types.ui8,    // consecutive polls without server data (despawn after 3)
  dirty: Types.ui8           // 1 = needs reconciliation
})

// Visibility flag (frustum culled, zoom filtered, or explicitly hidden)
export const Visible = defineComponent({
  value: Types.ui8           // 0 = hidden, 1 = visible
})
```

### Tag Components

Tag components have no data fields. They act as markers for query filtering.

```typescript
export const IsChunk = defineComponent()
export const IsCity = defineComponent()
export const IsAgent = defineComponent()
export const IsTree = defineComponent()
export const IsProvince = defineComponent()
export const IsResource = defineComponent()
export const IsCamera = defineComponent()
export const IsWater = defineComponent()
export const IsLabel = defineComponent()
```

---

## 4. Entity Archetypes

An archetype is the set of components added to an entity at creation time. These define the "shape" of each game object.

### Chunk Entity

```typescript
addComponent(world, IsChunk, eid)
addComponent(world, ChunkCoord, eid)
addComponent(world, LODLevel, eid)
addComponent(world, MeshRef, eid)
addComponent(world, Visible, eid)
```

### City Entity

```typescript
addComponent(world, IsCity, eid)
addComponent(world, Position, eid)
addComponent(world, CityInfo, eid)
addComponent(world, CityDisplay, eid)
addComponent(world, LODLevel, eid)
addComponent(world, MeshRef, eid)       // for LOD0 detail / LOD1 cluster
addComponent(world, InstanceRef, eid)   // for LOD2 icon
addComponent(world, Visible, eid)
addComponent(world, ServerSync, eid)
```

### Agent Entity

```typescript
addComponent(world, IsAgent, eid)
addComponent(world, Position, eid)
addComponent(world, Rotation, eid)
addComponent(world, AgentRole, eid)
addComponent(world, AgentMovement, eid)
addComponent(world, InstanceRef, eid)
addComponent(world, Visible, eid)
addComponent(world, ServerSync, eid)
```

### Tree Entity

```typescript
addComponent(world, IsTree, eid)
addComponent(world, Position, eid)
addComponent(world, TreeVariant, eid)
addComponent(world, InstanceRef, eid)
addComponent(world, Visible, eid)
```

### Province Entity

```typescript
addComponent(world, IsProvince, eid)
addComponent(world, ProvinceTag, eid)
addComponent(world, Position, eid)       // label_point for name rendering
addComponent(world, Visible, eid)
```

### Resource Site Entity

```typescript
addComponent(world, IsResource, eid)
addComponent(world, Position, eid)
addComponent(world, ResourceSite, eid)
addComponent(world, InstanceRef, eid)
addComponent(world, Visible, eid)
addComponent(world, ServerSync, eid)
```

### Camera Entity (Singleton)

```typescript
addComponent(world, IsCamera, eid)
addComponent(world, Position, eid)
addComponent(world, Rotation, eid)
addComponent(world, Velocity, eid)
```

### Water Plane Entity (Singleton)

```typescript
addComponent(world, IsWater, eid)
addComponent(world, MeshRef, eid)
addComponent(world, Visible, eid)
```

---

## 5. System Definitions

Systems are stateless functions that query component compositions and execute logic each frame (or at reduced frequency). They run in a fixed order on the main thread.

### System Execution Order

| # | System | Frequency | Input Components | Output / Side Effect |
|---|--------|-----------|------------------|---------------------|
| 1 | **CameraInputSystem** | Every frame | IsCamera + Position + Rotation + Velocity | Reads input state, updates camera Position/Rotation/Velocity |
| 2 | **CameraMovementSystem** | Every frame | IsCamera + Position + Velocity + Rotation | Applies velocity to position, clamps bounds |
| 3 | **ViewportSystem** | Every frame | IsCamera + Position | Computes visible chunk range, frustum planes, zoom level |
| 4 | **ChunkLODSystem** | Every frame | IsChunk + ChunkCoord + LODLevel + Visible | Sets target LOD based on camera distance, manages blend alpha |
| 5 | **ChunkLoadSystem** | Every frame | IsChunk + ChunkCoord + LODLevel + MeshRef | Triggers Supabase fetch for missing chunks, dispatches to workers |
| 6 | **ChunkMeshSystem** | On worker callback | IsChunk + MeshRef | Receives worker results, populates MeshRef with BatchedMesh geometry ID |
| 7 | **ChunkUnloadSystem** | Every 500ms | IsChunk + ChunkCoord + MeshRef + Visible | Removes chunks outside viewport, disposes geometry, recycles entity |
| 8 | **CityLODSystem** | Every frame | IsCity + CityInfo + CityDisplay + LODLevel + Position | Switches city display mode (icon/cluster/detail) based on camera distance |
| 9 | **CityMeshSystem** | On demand | IsCity + CityDisplay + MeshRef + InstanceRef | Loads/generates city meshes, manages icon InstancedMesh slots |
| 10 | **AgentSyncSystem** | Every 2s | IsAgent + AgentRole + AgentMovement + ServerSync | Polls `agents_near_tile` RPC, creates/updates/despawns agent entities |
| 11 | **AgentInterpolationSystem** | Every frame | IsAgent + Position + AgentMovement + Rotation | Interpolates position between prev/next server positions |
| 12 | **AgentRenderSystem** | Every frame | IsAgent + Position + Rotation + InstanceRef + Visible | Updates InstancedMesh transform matrices from ECS position data |
| 13 | **TreeRenderSystem** | Every frame | IsTree + Position + TreeVariant + InstanceRef + Visible | Updates tree InstancedMesh transforms, handles frustum/zoom culling |
| 14 | **ResourceStateSystem** | Every frame | IsResource + ResourceSite + Visible | Advances harvest state machine timers (idle → work → haul → recover) |
| 15 | **VisibilitySystem** | Every frame | Position + Visible (all visible entities) | Frustum culling + zoom-based visibility filtering |
| 16 | **LabelSystem** | Every 200ms | IsCity + IsProvince + Position + Visible + IsLabel | Manages troika-three-text label pool, assigns labels to visible entities |
| 17 | **ProvinceOverlaySystem** | On zoom change | IsProvince + ProvinceTag + Visible | Toggles province fill/border/name rendering based on camera height |
| 18 | **ServerReconcileSystem** | Every 5s | ServerSync (all synced entities) | Checks for stale entities (missedPolls >= 3), marks for despawn |
| 19 | **CleanupSystem** | Every frame | (entities marked for removal) | Removes dead entities, recycles InstancedMesh slots, disposes geometry |

### System Implementation Pattern

```typescript
// client/src/ecs/systems/agentInterpolationSystem.ts
import { defineQuery, defineSystem } from 'bitecs'
import { IsAgent, Position, AgentMovement, Rotation } from '../components'

const agentQuery = defineQuery([IsAgent, Position, AgentMovement, Rotation])

export const agentInterpolationSystem = defineSystem((world) => {
  const eids = agentQuery(world)
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]
    const t = AgentMovement.interpT[eid]

    // Lerp between previous and next server positions
    Position.x[eid] = AgentMovement.prevX[eid] + (AgentMovement.nextX[eid] - AgentMovement.prevX[eid]) * t
    Position.y[eid] = AgentMovement.prevY[eid] + (AgentMovement.nextY[eid] - AgentMovement.prevY[eid]) * t

    // Advance interpolation factor
    AgentMovement.interpT[eid] = Math.min(1.0, t + AgentMovement.speed[eid] * world.delta * 0.5)

    // Update heading from movement direction
    const dx = AgentMovement.nextX[eid] - AgentMovement.prevX[eid]
    const dy = AgentMovement.nextY[eid] - AgentMovement.prevY[eid]
    if (dx !== 0 || dy !== 0) {
      Rotation.yaw[eid] = Math.atan2(dy, dx)
    }
  }
  return world
})
```

---

## 6. Server Sync Pipeline

### Data Flow

```
Supabase (authoritative)
    ↓ REST/RPC queries
Client fetch layer
    ↓ row data
Entity hydration (UUID → EID mapping)
    ↓ component writes
ECS world (client cache)
    ↓ system queries
Three.js scene (view)
```

### UUID-to-EID Mapping

Server entities have UUIDs. ECS entities have numeric EIDs. A bidirectional map bridges them.

```typescript
// client/src/ecs/serverEntityMap.ts
const uuidToEid = new Map<string, number>()
const eidToUuid = new Map<number, string>()

export function getOrCreateEntity(world: IWorld, uuid: string, archetype: (w: IWorld, eid: number) => void): number {
  let eid = uuidToEid.get(uuid)
  if (eid === undefined) {
    eid = addEntity(world)
    archetype(world, eid)
    uuidToEid.set(uuid, eid)
    eidToUuid.set(eid, uuid)
  }
  return eid
}

export function removeServerEntity(world: IWorld, uuid: string): void {
  const eid = uuidToEid.get(uuid)
  if (eid !== undefined) {
    removeEntity(world, eid)
    uuidToEid.delete(uuid)
    eidToUuid.delete(eid)
  }
}
```

### Hydration Examples

**Cities (at startup, one-time):**

```typescript
async function hydrateCities(world: IWorld) {
  const { data: rows } = await supabase
    .from('cities')
    .select('id,name,ancient_name,culture,size,tile_x,tile_y,province_number,is_harbor,is_capital,population')

  for (const row of rows) {
    const eid = getOrCreateEntity(world, row.id, addCityArchetype)
    Position.x[eid] = row.tile_x
    Position.y[eid] = row.tile_y
    CityInfo.tier[eid] = sizeTierMap[row.size]
    CityInfo.population[eid] = row.population
    CityInfo.provinceNumber[eid] = row.province_number
    CityInfo.culture[eid] = cultureEnumMap[row.culture]
    CityInfo.isHarbor[eid] = row.is_harbor ? 1 : 0
    CityInfo.isCapital[eid] = row.is_capital ? 1 : 0
    ServerSync.lastTick[eid] = 0
    ServerSync.dirty[eid] = 0
    Visible.value[eid] = 1
  }
}
```

**Agents (every 2s, viewport-filtered):**

```typescript
async function syncAgents(world: IWorld, cameraX: number, cameraY: number, radius: number) {
  const { data: rows } = await supabase.rpc('agents_near_tile', {
    center_x: cameraX, center_y: cameraY, radius
  })

  const seenUuids = new Set<string>()

  for (const row of rows) {
    seenUuids.add(row.id)
    const eid = getOrCreateEntity(world, row.id, addAgentArchetype)

    // Shift current → prev, server → next
    AgentMovement.prevX[eid] = Position.x[eid]
    AgentMovement.prevY[eid] = Position.y[eid]
    AgentMovement.nextX[eid] = row.tile_x
    AgentMovement.nextY[eid] = row.tile_y
    AgentMovement.interpT[eid] = 0
    AgentMovement.speed[eid] = row.speed
    AgentMovement.heading[eid] = row.heading

    AgentRole.agentType[eid] = agentTypeEnumMap[row.type]
    AgentRole.role[eid] = roleEnumMap[row.role] ?? 0
    AgentRole.state[eid] = stateEnumMap[row.state]

    ServerSync.lastTick[eid] = world.tick
    ServerSync.missedPolls[eid] = 0
    ServerSync.dirty[eid] = 0
  }

  // Increment missedPolls for agents not in this poll
  const agentEids = agentQuery(world)
  for (let i = 0; i < agentEids.length; i++) {
    const eid = agentEids[i]
    const uuid = eidToUuid.get(eid)
    if (uuid && !seenUuids.has(uuid)) {
      ServerSync.missedPolls[eid]++
    }
  }
}
```

### Reconciliation Cycle

The `ServerReconcileSystem` runs every 5 seconds:

1. Query all entities with `ServerSync` component.
2. If `missedPolls >= 3` → mark entity for removal (agent left viewport or despawned server-side).
3. `CleanupSystem` processes removals: recycle InstancedMesh slot, remove from UUID map, `removeEntity()`.

Grace period of 3 polls (6 seconds) prevents flicker when agents briefly leave/re-enter the viewport boundary.

---

## 7. Worker Integration

### Current Flow (Pre-ECS)

```
ChunkManager → decode binary → post ArrayBuffers to worker → receive mesh → create geometry
```

### ECS Flow

```
ChunkLoadSystem
  → read ChunkCoord + LODLevel from entity
  → decode binary chunk data
  → extract TypedArray slices (heights, biomes, flags, province)
  → transfer to worker pool

Worker
  → greedy meshing on received TypedArrays
  → return positions/normals/colors as Transferable ArrayBuffers

ChunkMeshSystem (on worker callback)
  → create BufferGeometry from returned arrays
  → add to BatchedMesh → store geometry index in MeshRef.geometryId[eid]
```

### TypedArray Extraction Example

```typescript
// In ChunkLoadSystem: extract component data for worker
function dispatchChunkToWorker(eid: number, chunkData: DecodedChunk) {
  const cx = ChunkCoord.cx[eid]
  const cy = ChunkCoord.cy[eid]
  const lod = LODLevel.current[eid]

  workerPool.postMessage({
    type: 'meshChunk',
    eid,  // passed through for callback routing
    chunkX: cx,
    chunkY: cy,
    heights: chunkData.heights.buffer,
    biomes: chunkData.biomes.buffer,
    flags: chunkData.flags.buffer,
    province: chunkData.province.buffer,
    lod
  }, [
    chunkData.heights.buffer,
    chunkData.biomes.buffer,
    chunkData.flags.buffer,
    chunkData.province.buffer
  ])
}
```

Workers remain unchanged internally — they receive ArrayBuffers and return mesh data. The only difference is that the callback now writes to ECS components instead of a ChunkMesh class.

---

## 8. Event Bus Coexistence

The project currently uses an `EventBus` for cross-system communication. ECS observers handle entity lifecycle events (chunk loaded/unloaded, agent spawned/despawned). The EventBus is retained for UI events that don't map to ECS entities.

### Replaced by ECS Observers

| Old Event | ECS Replacement |
|-----------|----------------|
| `chunk_loaded` | `enterQuery` on IsChunk + MeshRef (geometry populated) |
| `chunk_unloaded` | `exitQuery` on IsChunk + Visible |
| `agent_spawned` | `enterQuery` on IsAgent |
| `agent_despawned` | `exitQuery` on IsAgent |
| `city_lod_changed` | `CityLODSystem` directly manages transitions |

### Retained on EventBus

| Event | Reason |
|-------|--------|
| `ui_city_selected` | DOM info panel, not an ECS concern |
| `ui_province_hovered` | DOM tooltip, not an ECS concern |
| `world_event_received` | Supabase Realtime → notification UI |
| `quality_profile_changed` | Affects system parameters but not entity data |
| `keyboard_shortcut` | Input routing to UI toggles |

---

## 9. Migration Path

The existing codebase uses a `GameSystem` class pattern. Migration to ECS is incremental — both patterns coexist during transition.

### Phase 1: Foundation

1. Install bitECS, create `client/src/ecs/` directory.
2. Define `world.ts`, `components.ts`, `archetypes.ts`.
3. Create `serverEntityMap.ts` for UUID ↔ EID bridging.
4. Add ECS world creation to startup sequence (after Supabase init, before render loop).

### Phase 2: Data Layer

5. Implement `hydrateCities()` and `hydrateProvinces()` — populate ECS from Supabase metadata fetches.
6. Implement `AgentSyncSystem` — replace `AgentManager.updatePositions()` with ECS entity creation/update.
7. Implement `AgentInterpolationSystem` — replace `AgentInterpolator` class.

### Phase 3: Chunk Pipeline

8. Implement chunk entity creation in `ChunkManager` — each loaded chunk gets an ECS entity.
9. Implement `ChunkLODSystem` — replace LOD distance checks currently in `ChunkManager`.
10. Implement `ChunkMeshSystem` — worker callbacks write to `MeshRef` components.
11. Implement `ChunkUnloadSystem` — replace manual dispose calls.

### Phase 4: Rendering Bridge

12. Implement `AgentRenderSystem` — InstancedMesh updates from ECS Position/Rotation.
13. Implement `TreeRenderSystem` — replace direct InstancedMesh management.
14. Implement `VisibilitySystem` — centralized frustum culling via ECS queries.
15. Implement `LabelSystem` — replace TextLabels direct management.

### Phase 5: Cleanup

16. Remove `GameSystem` base class once all systems are ported.
17. Remove direct Three.js references from data management code.
18. Consolidate EventBus usage (remove events replaced by ECS observers).

### Coexistence Rule

During migration, existing `GameSystem` classes may read ECS component data but must not write to it. ECS systems are the sole writers. This prevents data races and ensures a clean one-way data flow.

---

## 10. Constraints and Rules

### Data-Only Components

- Components contain ONLY serializable primitive data (numbers, booleans as uint8).
- No Three.js objects (`Mesh`, `Material`, `BufferGeometry`) stored in components.
- No strings in components. Use enum-to-uint8 mappings for types, cultures, states.
- No reference types (objects, arrays, Maps) in component fields.

### Index-Based Mesh References

- `MeshRef.geometryId` stores the integer index returned by `BatchedMesh.addGeometry()`.
- `InstanceRef.instanceId` stores the integer index in an `InstancedMesh`.
- A separate `MeshRegistry` (outside ECS) maps `batchId` → `BatchedMesh` and `poolId` → `InstancedMesh`.
- Systems read indices from components and use the registry to access Three.js objects.

### Stateless Systems

- Systems must not hold mutable state between frames. All state lives in components.
- Frame-to-frame data (timers, accumulators) must be stored in component fields.
- Systems receive `world` as input and return `world` as output. Side effects (Three.js calls) are permitted but must be idempotent.

### Server Authoritative

- Supabase PostgreSQL is the single source of truth for all game data.
- ECS entities are a **client-side cache** — they reflect server state, not define it.
- Entity creation/destruction on the client is always driven by server data (RPC responses, Realtime events, initial metadata fetch).
- The client never invents entities that don't exist server-side (except transient view-only entities like the camera).

### All Game Objects Are Entities

- Every chunk, city, agent, tree, province, resource site, the camera, and the water plane are ECS entities.
- No game objects exist as standalone class instances outside the ECS world.
- UI elements (HUD, info panel, minimap) are NOT entities — they remain DOM/canvas overlays.

### System Execution Contract

- All systems run on the main thread in the defined order (Section 5).
- Workers do NOT run ECS systems. Workers receive raw TypedArrays and return mesh data.
- The render loop calls `pipeline(world)` once per frame. `pipeline` is a composed function of all systems.
- Systems that run at reduced frequency (e.g., every 2s) use internal tick counters stored on the world object.

---

## 11. File Structure

```
client/src/ecs/
├── world.ts              # createWorld(), world config
├── components.ts         # All defineComponent() calls
├── archetypes.ts         # addChunkArchetype(), addCityArchetype(), etc.
├── serverEntityMap.ts    # UUID ↔ EID bidirectional map
├── pipeline.ts           # System composition and execution order
├── enums.ts              # AgentType, Culture, HarvestState, etc.
└── systems/
    ├── cameraInputSystem.ts
    ├── cameraMovementSystem.ts
    ├── viewportSystem.ts
    ├── chunkLODSystem.ts
    ├── chunkLoadSystem.ts
    ├── chunkMeshSystem.ts
    ├── chunkUnloadSystem.ts
    ├── cityLODSystem.ts
    ├── cityMeshSystem.ts
    ├── agentSyncSystem.ts
    ├── agentInterpolationSystem.ts
    ├── agentRenderSystem.ts
    ├── treeRenderSystem.ts
    ├── resourceStateSystem.ts
    ├── visibilitySystem.ts
    ├── labelSystem.ts
    ├── provinceOverlaySystem.ts
    ├── serverReconcileSystem.ts
    └── cleanupSystem.ts
```
