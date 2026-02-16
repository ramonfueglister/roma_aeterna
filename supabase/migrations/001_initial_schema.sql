CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.chunks (
  x smallint NOT NULL CHECK (x BETWEEN 0 AND 63),
  y smallint NOT NULL CHECK (y BETWEEN 0 AND 63),
  lod smallint NOT NULL CHECK (lod BETWEEN 0 AND 3),
  data bytea NOT NULL,
  version smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (x, y, lod)
);
CREATE INDEX IF NOT EXISTS idx_chunks_lod ON public.chunks (lod);

CREATE TABLE IF NOT EXISTS public.provinces (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  number smallint NOT NULL UNIQUE CHECK (number BETWEEN 1 AND 41),
  culture text NOT NULL,
  color text NOT NULL,
  borders geometry(MultiPolygon, 4326),
  label_point geometry(Point, 4326),
  accuracy_tier text NOT NULL DEFAULT 'B' CHECK (accuracy_tier IN ('A', 'B', 'C')),
  confidence float NOT NULL DEFAULT 0.70 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_refs jsonb NOT NULL DEFAULT '[]',
  name_status text NOT NULL DEFAULT 'attested' CHECK (name_status IN ('attested', 'reconstructed')),
  area_km2 float,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provinces_borders ON public.provinces USING gist (borders);
CREATE INDEX IF NOT EXISTS idx_provinces_accuracy ON public.provinces (accuracy_tier);

CREATE TABLE IF NOT EXISTS public.cities (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  ancient_name text,
  culture text NOT NULL,
  size text NOT NULL,
  population int DEFAULT 0,
  tile_x smallint NOT NULL CHECK (tile_x BETWEEN 0 AND 2047),
  tile_y smallint NOT NULL CHECK (tile_y BETWEEN 0 AND 2047),
  position geometry(Point, 4326),
  province_number smallint NOT NULL REFERENCES public.provinces (number),
  accuracy_tier text NOT NULL DEFAULT 'B' CHECK (accuracy_tier IN ('A', 'B', 'C')),
  confidence float NOT NULL DEFAULT 0.70 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_refs jsonb NOT NULL DEFAULT '[]',
  name_status text NOT NULL DEFAULT 'attested' CHECK (name_status IN ('attested', 'reconstructed')),
  buildings jsonb NOT NULL DEFAULT '[]',
  features jsonb NOT NULL DEFAULT '[]',
  is_harbor boolean DEFAULT false,
  is_capital boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cities_tile ON public.cities (tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_cities_province ON public.cities (province_number);
CREATE INDEX IF NOT EXISTS idx_cities_position ON public.cities USING gist (position);
CREATE INDEX IF NOT EXISTS idx_cities_accuracy ON public.cities (accuracy_tier);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cities'::regclass
      AND conname = 'cities_name_unique'
  ) THEN
    ALTER TABLE public.cities ADD CONSTRAINT cities_name_unique UNIQUE (name);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.roads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text,
  road_type text NOT NULL,
  points geometry(LineString, 4326),
  confidence float DEFAULT 1.0,
  source text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_roads_points ON public.roads USING gist (points);

CREATE TABLE IF NOT EXISTS public.rivers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  ancient_name text,
  points geometry(LineString, 4326),
  width_tiles smallint DEFAULT 1,
  is_navigable boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rivers_points ON public.rivers USING gist (points);

CREATE TABLE IF NOT EXISTS public.resources (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type text NOT NULL,
  tile_x smallint NOT NULL,
  tile_y smallint NOT NULL,
  position geometry(Point, 4326),
  province_number smallint REFERENCES public.provinces (number),
  quantity float DEFAULT 1.0,
  field_type text,
  field_size_x smallint DEFAULT 3,
  field_size_y smallint DEFAULT 3,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resources_tile ON public.resources (tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_resources_type ON public.resources (type);
CREATE INDEX IF NOT EXISTS idx_resources_position ON public.resources USING gist (position);
CREATE INDEX IF NOT EXISTS idx_resources_province ON public.resources (province_number);

CREATE TABLE IF NOT EXISTS public.trade_routes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text,
  route_type text NOT NULL,
  from_city_id uuid REFERENCES public.cities (id),
  to_city_id uuid REFERENCES public.cities (id),
  waypoints geometry(LineString, 4326),
  goods jsonb DEFAULT '[]',
  distance_km float,
  travel_days float,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trade_routes_cities ON public.trade_routes (from_city_id, to_city_id);
CREATE INDEX IF NOT EXISTS idx_trade_routes_waypoints ON public.trade_routes USING gist (waypoints);

CREATE TABLE IF NOT EXISTS public.ambient_anchors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  city_id uuid REFERENCES public.cities (id),
  tile_x smallint NOT NULL,
  tile_y smallint NOT NULL,
  position geometry(Point, 4326),
  district text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  allow_types jsonb NOT NULL DEFAULT '[]',
  deny_types jsonb NOT NULL DEFAULT '[]',
  weight float NOT NULL DEFAULT 1.0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ambient_anchors_tile ON public.ambient_anchors (tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_ambient_anchors_city ON public.ambient_anchors (city_id);
CREATE INDEX IF NOT EXISTS idx_ambient_anchors_district ON public.ambient_anchors (district);
CREATE INDEX IF NOT EXISTS idx_ambient_anchors_position ON public.ambient_anchors USING gist (position);

CREATE TABLE IF NOT EXISTS public.agents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type text NOT NULL,
  role text,
  name text,
  tile_x float NOT NULL,
  tile_y float NOT NULL,
  position geometry(Point, 4326),
  heading float DEFAULT 0,
  speed float DEFAULT 0.5,
  state text DEFAULT 'idle',
  destination_x float,
  destination_y float,
  route_id uuid REFERENCES public.trade_routes (id),
  route_progress float DEFAULT 0,
  home_city_id uuid REFERENCES public.cities (id),
  culture text,
  inventory jsonb DEFAULT '{}',
  goals jsonb DEFAULT '[]',
  stats jsonb DEFAULT '{}',
  visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_tile ON public.agents (tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_agents_type ON public.agents (type);
CREATE INDEX IF NOT EXISTS idx_agents_state ON public.agents (state);
CREATE INDEX IF NOT EXISTS idx_agents_position ON public.agents USING gist (position);
CREATE INDEX IF NOT EXISTS idx_agents_updated ON public.agents (updated_at);

CREATE TABLE IF NOT EXISTS public.players (
  id uuid PRIMARY KEY REFERENCES auth.users (id),
  display_name text NOT NULL,
  tile_x float NOT NULL DEFAULT 1024,
  tile_y float NOT NULL DEFAULT 1024,
  position geometry(Point, 4326),
  faction text,
  resources jsonb DEFAULT '{}',
  reputation jsonb DEFAULT '{}',
  settings jsonb DEFAULT '{}',
  last_seen timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_players_tile ON public.players (tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_players_position ON public.players USING gist (position);

CREATE TABLE IF NOT EXISTS public.building_runtime (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  city_id uuid NOT NULL REFERENCES public.cities (id),
  building_key text NOT NULL,
  tile_x smallint NOT NULL,
  tile_y smallint NOT NULL,
  state text NOT NULL,
  supply_level float NOT NULL DEFAULT 1.0,
  condition_level float NOT NULL DEFAULT 1.0,
  service_level float NOT NULL DEFAULT 1.0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (city_id, building_key)
);
CREATE INDEX IF NOT EXISTS idx_building_runtime_city ON public.building_runtime (city_id);
CREATE INDEX IF NOT EXISTS idx_building_runtime_tile ON public.building_runtime (tile_x, tile_y);
CREATE INDEX IF NOT EXISTS idx_building_runtime_state ON public.building_runtime (state);

CREATE TABLE IF NOT EXISTS public.world_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type text NOT NULL,
  event_key text,
  tile_x float,
  tile_y float,
  position geometry(Point, 4326),
  agent_id uuid REFERENCES public.agents (id),
  city_id uuid REFERENCES public.cities (id),
  province_number smallint REFERENCES public.provinces (number),
  data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_type ON public.world_events (type);
CREATE INDEX IF NOT EXISTS idx_events_created ON public.world_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_position ON public.world_events USING gist (position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_key_unique ON public.world_events (event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.world_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  game_date text DEFAULT '117-01-01',
  season text DEFAULT 'ver',
  tick_count bigint DEFAULT 0,
  agent_count int DEFAULT 0,
  player_count int DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO public.world_state (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nav_graph (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  route_type text NOT NULL,
  hierarchy_level smallint NOT NULL DEFAULT 1,
  lane_class text NOT NULL DEFAULT 'standard',
  distance float NOT NULL,
  cost float NOT NULL,
  travel_time_by_season jsonb NOT NULL DEFAULT '{}',
  capacity int NOT NULL DEFAULT 64,
  blocked boolean NOT NULL DEFAULT false,
  polyline geometry(LineString, 4326),
  road_id uuid REFERENCES public.roads (id),
  route_id uuid REFERENCES public.trade_routes (id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nav_from ON public.nav_graph (from_node_id);
CREATE INDEX IF NOT EXISTS idx_nav_to ON public.nav_graph (to_node_id);
CREATE INDEX IF NOT EXISTS idx_nav_hierarchy ON public.nav_graph (hierarchy_level);
CREATE INDEX IF NOT EXISTS idx_nav_lane_class ON public.nav_graph (lane_class);
CREATE INDEX IF NOT EXISTS idx_nav_blocked ON public.nav_graph (blocked);

ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nav_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambient_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chunks_read ON public.chunks;
CREATE POLICY chunks_read ON public.chunks FOR SELECT USING (true);

DROP POLICY IF EXISTS cities_read ON public.cities;
CREATE POLICY cities_read ON public.cities FOR SELECT USING (true);

DROP POLICY IF EXISTS provinces_read ON public.provinces;
CREATE POLICY provinces_read ON public.provinces FOR SELECT USING (true);

DROP POLICY IF EXISTS roads_read ON public.roads;
CREATE POLICY roads_read ON public.roads FOR SELECT USING (true);

DROP POLICY IF EXISTS rivers_read ON public.rivers;
CREATE POLICY rivers_read ON public.rivers FOR SELECT USING (true);

DROP POLICY IF EXISTS resources_read ON public.resources;
CREATE POLICY resources_read ON public.resources FOR SELECT USING (true);

DROP POLICY IF EXISTS trade_routes_read ON public.trade_routes;
CREATE POLICY trade_routes_read ON public.trade_routes FOR SELECT USING (true);

DROP POLICY IF EXISTS nav_graph_read ON public.nav_graph;
CREATE POLICY nav_graph_read ON public.nav_graph FOR SELECT USING (true);

DROP POLICY IF EXISTS ambient_anchors_read ON public.ambient_anchors;
CREATE POLICY ambient_anchors_read ON public.ambient_anchors FOR SELECT USING (true);

DROP POLICY IF EXISTS agents_service_select ON public.agents;
CREATE POLICY agents_service_select ON public.agents FOR SELECT USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS agents_service_insert ON public.agents;
CREATE POLICY agents_service_insert ON public.agents FOR INSERT WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS agents_service_update ON public.agents;
CREATE POLICY agents_service_update ON public.agents FOR UPDATE USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS agents_service_delete ON public.agents;
CREATE POLICY agents_service_delete ON public.agents FOR DELETE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS building_runtime_read ON public.building_runtime;
CREATE POLICY building_runtime_read ON public.building_runtime FOR SELECT USING (true);
DROP POLICY IF EXISTS building_runtime_service_write ON public.building_runtime;
CREATE POLICY building_runtime_service_write ON public.building_runtime FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS world_state_read ON public.world_state;
CREATE POLICY world_state_read ON public.world_state FOR SELECT USING (true);

DROP POLICY IF EXISTS players_read_self ON public.players;
CREATE POLICY players_read_self ON public.players FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS players_write ON public.players;
CREATE POLICY players_write ON public.players FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS players_insert ON public.players;
CREATE POLICY players_insert ON public.players FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS players_delete ON public.players;
CREATE POLICY players_delete ON public.players FOR DELETE USING (auth.uid() = id);

DROP POLICY IF EXISTS events_read ON public.world_events;
CREATE POLICY events_read ON public.world_events FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.agents_near_tile(
  center_x float,
  center_y float,
  radius float
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
  FROM public.agents a
  CROSS JOIN bounded
  WHERE a.tile_x BETWEEN center_x - bounded.r AND center_x + bounded.r
    AND a.tile_y BETWEEN center_y - bounded.r AND center_y + bounded.r
    AND a.visible = true
  ORDER BY (a.tile_x - center_x)^2 + (a.tile_y - center_y)^2
  LIMIT 200;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.batch_move_agents(
  updates jsonb
) RETURNS void AS $$
  UPDATE public.agents SET
    tile_x = (u->>'tile_x')::float,
    tile_y = (u->>'tile_y')::float,
    heading = (u->>'heading')::float,
    state = u->>'state',
    updated_at = now()
  FROM jsonb_array_elements(updates) AS u
  WHERE public.agents.id = (u->>'id')::uuid;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION public.acquire_tick_lock(lock_key bigint)
RETURNS boolean AS $$
  SELECT pg_try_advisory_lock(lock_key);
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION public.release_tick_lock(lock_key bigint)
RETURNS boolean AS $$
  SELECT pg_advisory_unlock(lock_key);
$$ LANGUAGE sql;

REVOKE ALL ON public.agents FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agents_near_tile(float, float, float) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.batch_move_agents(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_tick_lock(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_tick_lock(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.agents_near_tile(float, float, float) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_move_agents(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_tick_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_tick_lock(bigint) TO service_role;

INSERT INTO public.provinces (name, number, culture, color, accuracy_tier, confidence, source_refs, name_status)
VALUES
  ('Italia', 27, 'roman', '#d3b37d', 'A', 0.98, '[{\"source\":\"bootstrap\"}]', 'attested'),
  ('Aegyptus', 2, 'egyptian', '#d29a58', 'A', 0.95, '[{\"source\":\"bootstrap\"}]', 'attested'),
  ('Africa Proconsularis', 3, 'roman', '#d9ad62', 'B', 0.88, '[{\"source\":\"bootstrap\"}]', 'attested'),
  ('Achaea', 1, 'greek', '#8f8be3', 'B', 0.9, '[{\"source\":\"bootstrap\"}]', 'attested'),
  ('Sicilia', 39, 'roman', '#e2b96d', 'B', 0.85, '[{\"source\":\"bootstrap\"}]', 'attested')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.cities (
  name, culture, size, tile_x, tile_y, province_number,
  ancient_name, population, buildings, features, is_harbor, is_capital
)
VALUES
  ('Roma', 'roman', 'metropolis', 1024, 1020, 27, 'Urbs Roma', 300000, '[{\"type\":\"forum\"}]', '[\"colosseum\",\"forum\"]', true, true),
  ('Alexandria', 'egyptian', 'metropolis', 1260, 1230, 2, 'Alexandria', 500000, '[{\"type\":\"lighthouse\"}]', '[\"library\",\"harbor\"]', true, true),
  ('Carthago', 'roman', 'metropolis', 835, 1180, 3, 'Carthago', 120000, '[{\"type\":\"harbor\"}]', '[\"harbor\",\"bath\" ]', true, false)
ON CONFLICT (name) DO NOTHING;
