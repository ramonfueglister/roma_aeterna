# Imperium - Persistent Roman Empire Voxel World

Persistent MMO voxel world map of the Roman Empire at its greatest extent (117 AD, under Emperor Trajan). Explore 300+ historically accurate cities, 41 provinces, trade routes, and resources in a living MagicaVoxel art world with autonomous AI NPCs.

## Features

- 2048x2048 tile world map with 4 LOD levels
- 300+ cities with procedural voxel architecture (Roman, Greek, Egyptian, Eastern, Celtic, Germanic)
- Landmark cities with individually modeled iconic buildings (.vox assets, no procedural landmark substitutions)
- 41 historically accurate provinces with distance-field borders
- 24 resource types with visual fields (grain, mines, vineyards, etc.)
- Trade routes based on Stanford ORBIS data
- 10,000-capable autonomous AI NPCs (traders, ships, legions, citizens, caravans)
- Persistent world powered by Supabase (PostgreSQL + Realtime)
- Multiplayer with live player presence
- Animated ships, caravans, birds, and city life
- Water rendering with depth-based colors and wave simulation
- Seamless zoom from strategic overview to street-level detail
- Responsive UI for desktop, tablet, and smartphone (touch-first controls on mobile)

## Tech Stack

| Component | Technology |
|-----------|-----------:|
| Frontend | TypeScript + Three.js r175+ (WebGPU) |
| Bundler | Vite 6.x |
| Backend | Supabase (PostgreSQL + PostGIS + Realtime + Rust simulation service) |
| Auth | Supabase Auth |
| Data Pipeline | Python (GDAL, GeoPandas, rasterio, numpy) |
| Chunk Generation | Python + numpy (tools/chunks) |
| Mesh Cache | IndexedDB (idb-keyval) |

## Prerequisites

- Node.js 20+
- Python 3.11+ with GDAL
- Supabase CLI
- Docker (for local Supabase)
- Make

## Setup

```bash
# Clone
git clone <repo-url> the_game
cd the_game

# Client dependencies
cd client && npm install && cd ..

# Python pipeline dependencies
pip install -r tools/requirements.txt

# Supabase local setup
supabase init
supabase start
supabase db push

# Environment
cp .env.example .env
# Edit .env with your Supabase keys (from supabase status)
```

## Development

```bash
make dev              # Start Vite dev server
make supabase-start   # Start local Supabase (Docker)
make supabase-migrate # Run database migrations
make supabase-seed    # Seed world data
make functions        # Build and package simulation helper services
make sim-service      # Run Rust simulation service (implement in Rust crate)
make data             # Run full data pipeline
make chunks           # Generate binary chunks only
make build            # Production build
make clean            # Remove build artifacts
```

### Quick start

```bash
cd client && npm install
cd ..
make data            # runs lightweight placeholder pipeline scripts
supabase start       # optional local backend
make dev             # client at http://localhost:5173
```

- `make data` now creates seed artifacts in `data/processed` and chunk binaries in `data/chunks`.
- `make sim-service` runs a minimal Rust simulation loop (placeholder).
- Replace pipeline scripts with full GDAL/GeoPandas implementations when you switch to production-grade generation.

## Project Structure

```
client/              TypeScript + Three.js frontend
supabase/            Supabase config + migrations
  migrations/        PostgreSQL schema migrations
  functions/         Optional RPC helpers
  seed.sql           Initial world data
tools/               Python data pipeline
  heightmap/         SRTM terrain processing
  cities/            Pleiades/ORBIS city data
  provinces/         AWMC province borders
  roads/             Itiner-e road network
  rivers/            Natural Earth rivers
  resources/         Resource distribution
  trades/            Trade route generation
  chunks/            Binary chunk generation (Python + numpy)
data/                Generated data (gitignored)
docs/                Technical specifications
```

## Documentation

- [Technical Specification](docs/SPECS.md)
- [Database Schema](docs/DATABASE.md)
- [AI Agent System](docs/AGENTS.md)
- [Historical Data Sources](docs/MAP_DATA.md)
- [Cities Database](docs/CITIES.md)
- [Rendering Pipeline](docs/RENDERING.md)
- [Resources & Trade](docs/RESOURCES.md)
- [Provinces](docs/PROVINCES.md)

## Data Sources

All historical data is from open/public domain sources:

- **Terrain**: NASA SRTM 30m (Public Domain)
- **Cities**: Pleiades Gazetteer (ODbL)
- **Routes**: ORBIS Stanford (Open Access)
- **Roads**: Itiner-e 2025 (Open Data)
- **Provinces**: AWMC UNC (ODbL)
- **Coastlines/Rivers**: Natural Earth (Public Domain)

## License

No open-source license is granted yet for this repository content.
Code/data release terms must be defined in a root `LICENSE` file before distribution.
