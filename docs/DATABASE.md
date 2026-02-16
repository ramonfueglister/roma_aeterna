# Database Schema (Supabase / PostgreSQL + PostGIS)

Complete database specification for the persistent Roman Empire world.
All world data lives in Supabase PostgreSQL. No local file serving.

---

## 1. Extensions

```sql
CREATE EXTENSION IF NOT EXISTS postgis;           -- spatial queries
CREATE EXTENSION IF NOT EXISTS pg_trgm;           -- text search (city names)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";       -- uuid generation
```

---

## 2. Static World Tables

### chunks

Binary terrain data. Uploaded once by the data pipeline, read-only at runtime.
Each row is one authoritative terrain chunk tile stored in Supabase (`x,y,lod`).
Clients may switch chunk visibility on/off at runtime, but never rewrite chunk source data.

```sql
CREATE TABLE chunks (
  x         smallint NOT NULL,        -- 0-63
  y         smallint NOT NULL,        -- 0-63
  lod       smallint NOT NULL,        -- 0-3
  data      bytea NOT NULL,           -- 4,104-byte binary chunk (header+heights+biomes+flags+province)
  version   smallint DEFAULT 1,
  PRIMARY KEY (x, y, lod)
);

CREATE INDEX idx_chunks_lod ON chunks (lod);
```

Runtime contract:
- Voxel landscape source of truth: `public.chunks` in Supabase.
- Client-side chunk toggles only affect rendering/streaming state (`active`/`inactive`), not persisted world data.
- Chunk reactivation must always rehydrate from Supabase row or verified local cache entry with matching `version`.

### cities

```sql
CREATE TABLE cities (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL,
  ancient_name  text,                     -- Latin/Greek name
  culture       text NOT NULL,            -- roman, greek, egyptian, eastern, celtic, germanic, north_african, dacian
  size          text NOT NULL,            -- metropolis, large, medium, small, village
  population    int DEFAULT 0,
  tile_x        smallint NOT NULL,        -- 0-2047
  tile_y        smallint NOT NULL,        -- 0-2047
  position      geometry(Point, 4326),    -- PostGIS lat/lon
  province_number smallint NOT NULL REFERENCES provinces(number), -- canonical Province-ID (1-41)
  accuracy_tier text NOT NULL DEFAULT 'B' CHECK (accuracy_tier IN ('A','B','C')),
  confidence    float NOT NULL DEFAULT 0.70 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_refs   jsonb NOT NULL DEFAULT '[]', -- [{"source":"awmc","ref":"..."}]
  name_status   text NOT NULL DEFAULT 'attested' CHECK (name_status IN ('attested','reconstructed')),
  buildings     jsonb DEFAULT '[]',       -- array of {type, x, y, rotation}
  features      jsonb DEFAULT '[]',       -- iconic buildings list ["colosseum", "forum", ...]
  is_harbor     boolean DEFAULT false,
  is_capital    boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_cities_tile ON cities (tile_x, tile_y);
CREATE INDEX idx_cities_province ON cities (province_number);
CREATE INDEX idx_cities_culture ON cities (culture);
CREATE INDEX idx_cities_accuracy ON cities (accuracy_tier);
CREATE INDEX idx_cities_position ON cities USING gist (position);
```

### provinces

```sql
CREATE TABLE provinces (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL UNIQUE,
  number        smallint NOT NULL UNIQUE,  -- 1-41
  culture       text NOT NULL,
  color         text NOT NULL,             -- hex color "#RRGGBB"
  borders       geometry(MultiPolygon, 4326),
  label_point   geometry(Point, 4326),     -- center for province name label
  accuracy_tier text NOT NULL DEFAULT 'B' CHECK (accuracy_tier IN ('A','B','C')),
  confidence    float NOT NULL DEFAULT 0.70 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_refs   jsonb NOT NULL DEFAULT '[]', -- [{"source":"awmc","ref":"..."}]
  name_status   text NOT NULL DEFAULT 'attested' CHECK (name_status IN ('attested','reconstructed')),
  area_km2      float,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_provinces_borders ON provinces USING gist (borders);
CREATE INDEX idx_provinces_accuracy ON provinces (accuracy_tier);
```

### roads

```sql
CREATE TABLE roads (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text,                      -- "Via Appia", "Via Egnatia", etc.
  road_type     text NOT NULL,             -- major, minor, path
  points        geometry(LineString, 4326),
  confidence    float DEFAULT 1.0,         -- from Itiner-e data
  source        text,                      -- itinere, darmc, omnesviae
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_roads_points ON roads USING gist (points);
```

### rivers

```sql
CREATE TABLE rivers (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL,
  ancient_name  text,                      -- "Danuvius", "Rhenus", etc.
  points        geometry(LineString, 4326),
  width_tiles   smallint DEFAULT 1,        -- 1-4
  is_navigable  boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_rivers_points ON rivers USING gist (points);
```

### resources

```sql
CREATE TABLE resources (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          text NOT NULL,             -- grain, iron, gold, wine, ... (24 types)
  tile_x        smallint NOT NULL,
  tile_y        smallint NOT NULL,
  position      geometry(Point, 4326),
  province_number smallint REFERENCES provinces(number), -- canonical Province-ID (1-41)
  quantity       float DEFAULT 1.0,         -- production rate multiplier
  field_type    text,                      -- grain_field, vineyard, mine, quarry, ...
  field_size_x  smallint DEFAULT 3,
  field_size_y  smallint DEFAULT 3,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_resources_tile ON resources (tile_x, tile_y);
CREATE INDEX idx_resources_type ON resources (type);
CREATE INDEX idx_resources_province ON resources (province_number);
CREATE INDEX idx_resources_position ON resources USING gist (position);
```

### trade_routes

```sql
CREATE TABLE trade_routes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text,
  route_type    text NOT NULL,             -- sea, land, river
  from_city_id  uuid REFERENCES cities(id),
  to_city_id    uuid REFERENCES cities(id),
  waypoints     geometry(LineString, 4326),
  goods         jsonb DEFAULT '[]',        -- ["grain", "wine", "silk"]
  distance_km   float,
  travel_days   float,                     -- ORBIS travel time
  active        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_trade_routes_cities ON trade_routes (from_city_id, to_city_id);
CREATE INDEX idx_trade_routes_waypoints ON trade_routes USING gist (waypoints);
```

### ambient_anchors

Deterministic spawn anchors for ambient FX and microdetail props.

```sql
CREATE TABLE ambient_anchors (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  city_id       uuid REFERENCES cities(id),
  tile_x        smallint NOT NULL,
  tile_y        smallint NOT NULL,
  position      geometry(Point, 4326),
  district      text NOT NULL,             -- forum_market, residential, harbor, workshop_industry
  tags          jsonb NOT NULL DEFAULT '[]', -- ["market","road_edge","fountain","dock",...]
  allow_types   jsonb NOT NULL DEFAULT '[]', -- ambient effect type allowlist
  deny_types    jsonb NOT NULL DEFAULT '[]', -- ambient effect type denylist
  weight        float NOT NULL DEFAULT 1.0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_ambient_anchors_tile ON ambient_anchors (tile_x, tile_y);
CREATE INDEX idx_ambient_anchors_city ON ambient_anchors (city_id);
CREATE INDEX idx_ambient_anchors_district ON ambient_anchors (district);
CREATE INDEX idx_ambient_anchors_position ON ambient_anchors USING gist (position);
```

---

## 3. Dynamic World Tables

### agents

AI-controlled NPCs: traders, legions, citizens, ships.

```sql
CREATE TABLE agents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          text NOT NULL,             -- trader, legion, citizen, ship, caravan
  role          text,                      -- market_walker, service_walker, faith_walker, maintenance_walker, idle_civilian
  name          text,
  tile_x        float NOT NULL,            -- current position (float for smooth movement)
  tile_y        float NOT NULL,
  position      geometry(Point, 4326),
  heading       float DEFAULT 0,           -- direction in degrees
  speed         float DEFAULT 0.5,         -- tiles per second
  state         text DEFAULT 'idle',       -- idle, moving, trading, patrolling, docked
  destination_x float,
  destination_y float,
  route_id      uuid REFERENCES trade_routes(id),
  route_progress float DEFAULT 0,          -- 0.0 to 1.0 along route
  home_city_id  uuid REFERENCES cities(id),
  culture       text,
  inventory     jsonb DEFAULT '{}',        -- {grain: 50, wine: 20}
  goals         jsonb DEFAULT '[]',        -- AI goal stack
  stats         jsonb DEFAULT '{}',        -- health, morale, etc.
  visible       boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_agents_tile ON agents (tile_x, tile_y);
CREATE INDEX idx_agents_type ON agents (type);
CREATE INDEX idx_agents_role ON agents (role);
CREATE INDEX idx_agents_state ON agents (state);
CREATE INDEX idx_agents_position ON agents USING gist (position);
CREATE INDEX idx_agents_updated ON agents (updated_at);
```

### players

```sql
CREATE TABLE players (
  id            uuid PRIMARY KEY REFERENCES auth.users(id),
  display_name  text NOT NULL,
  tile_x        float NOT NULL DEFAULT 1024,  -- start at map center
  tile_y        float NOT NULL DEFAULT 1024,
  position      geometry(Point, 4326),
  faction       text,                      -- rome, greece, egypt, ...
  resources     jsonb DEFAULT '{}',        -- personal resources
  reputation    jsonb DEFAULT '{}',        -- {rome: 50, egypt: 30}
  settings      jsonb DEFAULT '{}',        -- UI preferences
  last_seen     timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_players_tile ON players (tile_x, tile_y);
CREATE INDEX idx_players_position ON players USING gist (position);
```

### world_events

Persistent log of world happenings. Drives ambient animations and history.

```sql
CREATE TABLE world_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          text NOT NULL,             -- trade_complete, battle, festival, construction, disaster, arrival
  event_key     text,                      -- deterministic idempotency key (optional, unique when present)
  tile_x        float,
  tile_y        float,
  position      geometry(Point, 4326),
  agent_id      uuid REFERENCES agents(id),
  city_id       uuid REFERENCES cities(id),
  province_number smallint REFERENCES provinces(number), -- canonical Province-ID (1-41)
  data          jsonb DEFAULT '{}',        -- event-specific payload
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_events_type ON world_events (type);
CREATE INDEX idx_events_created ON world_events (created_at DESC);
CREATE INDEX idx_events_position ON world_events USING gist (position);
CREATE UNIQUE INDEX idx_events_event_key_unique ON world_events (event_key) WHERE event_key IS NOT NULL;

-- Auto-cleanup: keep last 7 days
CREATE OR REPLACE FUNCTION cleanup_old_events() RETURNS void AS $$
  DELETE FROM world_events WHERE created_at < now() - interval '7 days';
$$ LANGUAGE sql;
```

### world_state

Global singleton for world-wide state (time, season, etc.).

```sql
CREATE TABLE world_state (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  game_date     text DEFAULT '117-01-01',    -- in-game date (Roman calendar)
  season        text DEFAULT 'ver',          -- ver, aestas, autumnus, hiems
  tick_count    bigint DEFAULT 0,
  agent_count   int DEFAULT 0,
  player_count  int DEFAULT 0,
  updated_at    timestamptz DEFAULT now()
);
```

### building_runtime

Runtime state for service/economy buildings in detail view.

```sql
CREATE TABLE building_runtime (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  city_id         uuid NOT NULL REFERENCES cities(id),
  building_key    text NOT NULL,            -- stable local building identifier
  tile_x          smallint NOT NULL,
  tile_y          smallint NOT NULL,
  state           text NOT NULL,            -- supplied, low_supply, unsupplied, needs_repair, upgrading
  supply_level    float NOT NULL DEFAULT 1.0,
  condition_level float NOT NULL DEFAULT 1.0,
  service_level   float NOT NULL DEFAULT 1.0,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(city_id, building_key)
);

CREATE INDEX idx_building_runtime_city ON building_runtime (city_id);
CREATE INDEX idx_building_runtime_tile ON building_runtime (tile_x, tile_y);
CREATE INDEX idx_building_runtime_state ON building_runtime (state);
```

---

## 4. Navigation Graph

Pre-computed city-to-city navigation graph for agent pathfinding.

```sql
CREATE TABLE nav_graph (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_node_id  uuid NOT NULL,              -- city or waypoint ID
  to_node_id    uuid NOT NULL,
  route_type    text NOT NULL,              -- road, sea, river
  hierarchy_level smallint NOT NULL DEFAULT 1, -- 0=trunk,1=regional,2=local
  lane_class    text NOT NULL DEFAULT 'standard', -- standard,supply_priority,harbor_lane
  distance      float NOT NULL,             -- in tiles
  cost          float NOT NULL,             -- weighted (road=0.5x, sea=0.7x)
  travel_time_by_season jsonb NOT NULL DEFAULT '{}', -- {"ver":x,"aestas":x,"autumnus":x,"hiems":x}
  capacity      int NOT NULL DEFAULT 64,    -- soft flow capacity for congestion weighting
  blocked       boolean NOT NULL DEFAULT false,
  polyline      geometry(LineString, 4326), -- actual path to follow
  road_id       uuid REFERENCES roads(id),
  route_id      uuid REFERENCES trade_routes(id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_nav_from ON nav_graph (from_node_id);
CREATE INDEX idx_nav_to ON nav_graph (to_node_id);
CREATE INDEX idx_nav_hierarchy ON nav_graph (hierarchy_level);
CREATE INDEX idx_nav_lane_class ON nav_graph (lane_class);
CREATE INDEX idx_nav_blocked ON nav_graph (blocked);
```

---

## 5. Realtime Channels

Supabase Realtime subscriptions for live updates. Agent positions are polled via RPC, NOT broadcast via Realtime.

| Channel | Method | Purpose |
|---------|--------|---------|
| `world_events` | Realtime (postgres_changes INSERT) | World events feed (low frequency) |
| `players` | Realtime (broadcast) | Other player positions |
| `world_state` | Realtime (postgres_changes UPDATE) | Global tick / season changes |
| Agent positions | **REST polling** via `agents_near_tile` RPC | Every 2s, viewport-filtered |

### Client subscription example

```typescript
// Realtime: world events + players (low frequency)
const channel = supabase.channel('world')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'world_events'
  }, (payload) => {
    showWorldEvent(payload.new)
  })
  .on('broadcast', { event: 'player_move' }, (payload) => {
    updatePlayerPosition(payload)
  })
  .subscribe()

// Polling: agent positions (every 2s, viewport-filtered)
setInterval(async () => {
  const { data: agents } = await supabase.rpc('agents_near_tile', {
    center_x: camera.tileX,
    center_y: camera.tileY,
    radius: getViewportRadius(camera.height)
  })
  agentManager.updatePositions(agents)
}, 2000)
```

---

## 6. Row Level Security (RLS)

```sql
-- Chunks: public read, no write via API
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chunks_read" ON chunks FOR SELECT USING (true);

-- Cities: public read
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cities_read" ON cities FOR SELECT USING (true);

-- Provinces: public read
ALTER TABLE provinces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "provinces_read" ON provinces FOR SELECT USING (true);

-- Roads/Rivers/Resources/Trade routes/Nav graph: public read
ALTER TABLE roads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roads_read" ON roads FOR SELECT USING (true);

ALTER TABLE rivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rivers_read" ON rivers FOR SELECT USING (true);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "resources_read" ON resources FOR SELECT USING (true);

ALTER TABLE trade_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trade_routes_read" ON trade_routes FOR SELECT USING (true);

ALTER TABLE nav_graph ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nav_graph_read" ON nav_graph FOR SELECT USING (true);

ALTER TABLE ambient_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ambient_anchors_read" ON ambient_anchors FOR SELECT USING (true);

-- Agents: NO direct client read; access only via controlled RPC
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents_service_select" ON agents FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "agents_service_insert" ON agents FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "agents_service_update" ON agents FOR UPDATE USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "agents_service_delete" ON agents FOR DELETE USING (auth.role() = 'service_role');

ALTER TABLE building_runtime ENABLE ROW LEVEL SECURITY;
CREATE POLICY "building_runtime_read" ON building_runtime FOR SELECT USING (true);
CREATE POLICY "building_runtime_service_write" ON building_runtime FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- World state: public read
ALTER TABLE world_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "world_state_read" ON world_state FOR SELECT USING (true);

-- Players: least-privilege (self-read + self-write only)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "players_read_self" ON players FOR SELECT USING (auth.uid() = id);
CREATE POLICY "players_write" ON players FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "players_insert" ON players FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "players_delete" ON players FOR DELETE USING (auth.uid() = id);

-- World events: public read
ALTER TABLE world_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_read" ON world_events FOR SELECT USING (true);
```

---

## 7. Supabase Storage Buckets

| Bucket | Content | Access |
|--------|---------|--------|
| `terrain` | Binary chunk files | public read |
| `assets` | City models, text fonts, UI sprites | public read |

---

## 8. Database Functions

### Spatial query: agents near tile

```sql
CREATE OR REPLACE FUNCTION agents_near_tile(
  center_x float, center_y float, radius float
) RETURNS TABLE (
  id uuid,
  type text,
  role text,
  tile_x float,
  tile_y float,
  heading float,
  speed float,
  state text,
  visible boolean,
  updated_at timestamptz
) AS $$
  WITH bounded AS (
    SELECT GREATEST(1.0, LEAST(radius, 900.0)) AS r
  )
  SELECT
    a.id,
    a.type,
    a.role,
    a.tile_x,
    a.tile_y,
    a.heading,
    a.speed,
    a.state,
    a.visible,
    a.updated_at
  FROM agents a
  CROSS JOIN bounded
  WHERE a.tile_x BETWEEN center_x - bounded.r AND center_x + bounded.r
    AND a.tile_y BETWEEN center_y - bounded.r AND center_y + bounded.r
    AND a.visible = true
  ORDER BY (a.tile_x - center_x)^2 + (a.tile_y - center_y)^2
  LIMIT 200;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;
```

### Batch agent position update (called by agent tick)

```sql
CREATE OR REPLACE FUNCTION batch_move_agents(
  updates jsonb  -- [{id, tile_x, tile_y, heading, state}]
) RETURNS void AS $$
  UPDATE agents SET
    tile_x = (u->>'tile_x')::float,
    tile_y = (u->>'tile_y')::float,
    heading = (u->>'heading')::float,
    state = u->>'state',
    updated_at = now()
  FROM jsonb_array_elements(updates) AS u
  WHERE agents.id = (u->>'id')::uuid;
$$ LANGUAGE sql;
```

### Tick lock functions (single-writer guard)

```sql
CREATE OR REPLACE FUNCTION acquire_tick_lock(lock_key bigint)
RETURNS boolean AS $$
  SELECT pg_try_advisory_lock(lock_key);
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION release_tick_lock(lock_key bigint)
RETURNS boolean AS $$
  SELECT pg_advisory_unlock(lock_key);
$$ LANGUAGE sql;
```

### Function execution policy

```sql
-- Default deny for RPC execute
REVOKE EXECUTE ON FUNCTION agents_near_tile(float, float, float) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION batch_move_agents(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION acquire_tick_lock(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_tick_lock(bigint) FROM PUBLIC;

-- Agents table is never directly exposed to client roles
REVOKE ALL ON TABLE agents FROM anon, authenticated;

-- Read RPC allowed to client roles
GRANT EXECUTE ON FUNCTION agents_near_tile(float, float, float) TO anon, authenticated;

-- Write RPC reserved for simulation service role only
GRANT EXECUTE ON FUNCTION batch_move_agents(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION acquire_tick_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION release_tick_lock(bigint) TO service_role;
```

- `agents_near_tile` must be rate-limited at the API edge (per-client + per-IP).
- `batch_move_agents` is never exposed to client code and is callable only by server-side jobs.
- Client code must never call `.from('agents')` directly; agent position reads are RPC-only.
- `agents_near_tile` returns a reduced public-safe projection (no inventory/goals/internal metadata).

Recommended API edge limits:
- `agents_near_tile`: max 1 request/second/client, burst <= 3, radius hard-cap = 900 tiles.
- Auth/session endpoints: IP-based burst limiting + bot score filtering.
- Repeated 4xx/5xx abuse patterns must trigger temporary IP cooldown.

---

## 9. Seed Data Flow

```
Python pipeline (tools/)
  -> Generate heightmap, cities, provinces, roads, rivers, resources, trades
  -> Generate ambient anchors by district + tags
  -> Output: JSON files in data/processed/
  -> Seed script: tools/seed.py
  -> INSERT INTO cities, provinces, roads, rivers, resources, trade_routes, ambient_anchors
  -> Initialize building_runtime rows for detail-capable city buildings
  -> Python chunk generator (tools/chunks/generate.py, numpy)
  -> INSERT INTO chunks (binary data)
```

---

## 10. Performance Considerations

- **Chunk reads**: Cached at Supabase CDN edge, 4,104 bytes per chunk, immutable
- **Agent updates**: Batch UPDATE every tick (1-5 seconds), up to 10,000 agents
- **Realtime**: Supabase handles broadcasting, client filters by viewport
- **Spatial indexes**: PostGIS GIST indexes on all position columns
- **Connection pooling**: Supabase uses PgBouncer, ~100 concurrent connections
- **Event cleanup**: Cron job deletes events older than 7 days

---

## 11. Operational Safety (Mandatory)

### Tick Idempotency and Concurrency

- Agent tick job must run as single writer using advisory lock (for example key `1170001`).
- If lock acquisition fails, the tick run exits without writes (no concurrent tick overlap).
- Tick writes (`batch_move_agents`, `world_state.tick_count`, event inserts) must execute in one transaction boundary.
- Every generated world event should carry deterministic `event_key`; inserts use `ON CONFLICT DO NOTHING` semantics via `idx_events_event_key_unique`.

### Backup, Restore, and Rollback

- Production database must run with PITR enabled.
- Backup policy:
  - Daily full snapshot retention: >= 30 days
  - Monthly snapshot retention: >= 12 months
- Recovery targets:
  - RPO <= 5 minutes
  - RTO <= 60 minutes
- Restore drill:
  - At least monthly full restore rehearsal into a staging project
  - Drill must verify schema + core tables (`chunks`, `cities`, `provinces`, `resources`, `agents`, `world_state`)
- Migration safety:
  - Every migration requires matching rollback script before production apply.
  - Destructive schema changes must use two-step rollout (deprecate -> migrate data -> drop later release).

---

## 12. Security Baseline (Mandatory)

### Access and Privilege Model

- RLS must be enabled on every client-reachable table in `public`.
- Default stance: no write access from `anon`/`authenticated` unless explicitly required.
- Service-role keys are server-only and never embedded in client bundles.
- RPC execute rights remain explicit deny-by-default (`REVOKE ... FROM PUBLIC`, then selective `GRANT`).

### API and Input Hardening

- All simulation service payloads require strict schema validation (type, range, enum checks).
- Numeric inputs for spatial queries must be clamped server-side (never trust client bounds).
- CORS must use explicit origin allowlist (no wildcard in production).
- Authentication-bearing endpoints must reject requests without valid JWT claims.

### Secrets and Operational Security

- Secrets (Supabase service role, webhook keys) must be managed via environment secrets, not repo files.
- Secret rotation cadence: at least every 90 days or immediately after suspected exposure.
- Security-sensitive actions (migration apply, policy changes, service-role RPC calls) must be audit-logged.

### Data Exposure Rules

- `players` table is treated as private profile/state data; public player location sharing uses broadcast payloads, not broad table reads.
- Storage buckets that contain non-public assets must use signed URLs with short TTL.
