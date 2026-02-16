# Imperium - Persistent Roman Empire Voxel World

## Overview

Persistent MMO voxel world map of the Roman Empire at its greatest extent (117 AD, under Trajan).
MagicaVoxel art style with cubic terrain, 300+ historically accurate cities, 41 provinces,
AI-driven NPCs (traders, legions, ships), trade routes, resources, and a living world.
NOT a smooth terrain game - everything is blocky voxels. The world runs 24/7 with autonomous AI agents.

## Tech Stack

- **Client**: TypeScript + Three.js r175+ (WebGPU preferred, WebGL2 fallback), Vite 6.x, TS 5.x strict
- **Backend**: Supabase (PostgreSQL + PostGIS + Realtime + Rust Simulation Service + Storage + Auth)
- **Data Pipeline**: Python (GDAL, numpy, GeoPandas, rasterio) -- including binary chunk generation
- **Mesh Caching**: idb-keyval (IndexedDB)
- **AI Agents**: Rust simulation worker (rule-based + optional LLM only outside tick loop)

## Architecture

### Persistent World (Supabase)
- ALL data in PostgreSQL (chunks, cities, agents, players, events)
- PostGIS spatial indexes for efficient viewport queries
- Realtime subscriptions for live agent/player updates
- Rust service for agent tick loop (every 2s)
- Row Level Security for multiplayer auth
- Supabase Storage for static assets

### Chunk System
- Map: 2048x2048 tiles, divided into 64x64 grid of 32x32 chunks (4,096 total)
- Binary format: 4KB per chunk (header + heights + biomes + flags + province IDs)
- Stored in PostgreSQL `chunks` table (bytea)
- 4 LOD levels: LOD0 (full voxel) through LOD3 (1 quad/chunk)

### AI Agents
- 10,000-capable autonomous NPCs (traders, ships, legions, citizens, caravans)
- Server-side tick loop processes decisions + movement every 2s
- Client interpolates positions smoothly between ticks
- Rule-based decisions (pathfinding, trading, patrolling)
- Optional LLM calls for notable events
- Agents rendered via InstancedMesh (7 additional type-specific calls)

### Rendering
- Greedy meshing reduces triangles ~90% (3000 -> 300 quads per chunk)
- BatchedMesh for terrain (all chunks of same LOD = 1 draw call)
- InstancedMesh for trees, icons, ships, people, agents
- Target: <50 draw calls at any zoom level
- TSL water shader (not GLSL)
- Vertex colors, NO textures on terrain (baked face shading)
- Per-vertex color noise (±5% RGB) to break up flat biome colors

### Visual Quality (Imperator Rome + Urbek Style)
- Post-processing pipeline: EffectComposer with bloom + vignette + color grading + tilt-shift DOF
- Warm golden-hour directional light from southwest (static, no day/night cycle)
- Tilt-shift depth-of-field at close zoom (Urbek's signature look)
- Parchment/antique map overlay at strategic zoom (Imperator Rome style)
- Province borders: JFA distance field with soft color gradient + glow
- Empire border fog: tiles outside empire (Province-ID=0) desaturated + darkened
- Bloom on water specular highlights and gold-colored accents
- Screen-space vignette (subtle darkening at edges)
- Color grading: warm, slightly desaturated, "historical Mediterranean" palette
- Map edge handling: last 50 tiles fade to dark parchment color

### Workers
- 4 Web Workers for mesh generation
- Transferable ArrayBuffers (zero-copy)
- Worker pool with task queue

### Performance Targets
- 60fps on Intel UHD 630 at 1080p
- 512MB GPU memory budget
- 256MB JS heap budget
- No memory leaks after 30min browsing
- Cross-browser: Chrome, Firefox, Safari, Edge
- Agent tick: <1.2s for up to 10,000 active agents

## Project Structure

```
the_game/
├── client/              # TypeScript + Three.js frontend
├── supabase/            # Supabase project config
│   ├── migrations/      # PostgreSQL schema migrations
│   ├── functions/       # Optional helpers / edge functions for APIs
│   └── seed.sql         # Initial world data seed
├── tools/               # Python data pipeline tools
│   ├── heightmap/       # SRTM processing
│   ├── cities/          # Pleiades/ORBIS processing
│   ├── provinces/       # AWMC province borders
│   ├── roads/           # Itiner-e road network
│   ├── rivers/          # Natural Earth rivers
│   ├── resources/       # Resource distribution
│   ├── trades/          # Trade route generation
│   └── chunks/          # Binary chunk generation (Python + numpy)
├── data/                # Generated data (gitignored)
└── docs/                # Specifications
```

## Naming Conventions

| Language   | Style        | Example                    |
|-----------|-------------|----------------------------|
| TypeScript | camelCase    | `chunkLoader.ts`, `getMeshData()` |
| Python     | snake_case   | `process_heightmap.py`, `merge_tiles()` |
| SQL        | snake_case   | `world_events`, `tile_x` |
| CSS        | kebab-case   | `map-overlay`, `zoom-control` |

## Build & Dev Commands

```bash
make dev              # Start Vite dev server
make build            # Production build
make supabase-start   # Start local Supabase (Docker)
make supabase-migrate # Run database migrations
make supabase-seed    # Seed world data
make functions        # Build simulation service artifacts
make sim-service      # Run Rust simulation service
make data             # Run full data pipeline
make chunks           # Generate binary chunks only
make clean            # Remove build artifacts
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/SPECS.md` | Full technical specification |
| `docs/DATABASE.md` | PostgreSQL schema + Supabase config |
| `docs/AGENTS.md` | AI agent system |
| `docs/MAP_DATA.md` | Historical data sources and pipelines |
| `docs/CITIES.md` | City database and generation |
| `docs/RENDERING.md` | Rendering pipeline details |
| `docs/RESOURCES.md` | Resources and trade routes |
| `docs/PROVINCES.md` | Province system |

## Rules

- All terrain is VOXEL (cubic, MagicaVoxel style) - never smooth
- Vertex colors only, no texture files on terrain geometry (parchment overlay is a screen-space effect)
- Face shading baked into vertex colors (top=1.0, east=0.88, north/south=0.80, west=0.65, bottom=0.50)
- Per-vertex ambient occlusion baked into colors
- Greedy meshing required for all chunk geometry
- Web Workers for all mesh generation (never block main thread)
- Transferable ArrayBuffers for worker communication
- Object pooling, no per-frame allocations
- IndexedDB caching for generated meshes
- Spiral chunk loading from camera center outward
- LOD transitions with alpha blending (200-500 unit zones)
- ALL game data in Supabase PostgreSQL - no local file serving
- Realtime subscriptions for world events + player updates; agent positions via viewport polling
- Historical accuracy: 117 AD Roman Empire under Trajan
- Province-ID 0 = outside empire (barbarian territory), IDs 1-41 = provinces
- Height values 0-127 valid, 128-255 reserved
- Agent pathfinding: pre-computed city-to-city navigation graph (not raw A* on 2048x2048)
- Text labels: troika-three-text (SDF rendering, no build-time atlas generation needed)
