# AI Agent System

Specification for autonomous AI NPCs living in the persistent Roman Empire world.
Agents move, trade, patrol, and interact without player input. The world is alive.

---

## 0. Canonical Simulation Contracts

### Time Model

- Agent tick interval is fixed at **2 seconds** (authoritative simulation step).
- Game time is normalized for spec use:
  - **1 game day = 75 seconds**
  - **1 season = 5 minutes = 4 game days**
  - **1 game year = 20 minutes = 16 game days**
- All rates written as "per day" or "per season" must use this model.
- Client-side rendering interpolation remains decoupled from tick frequency.

### Simulation Count Contract

- Active simulated agents are bounded by profile-dependent caps:
  - Ultra profile: 10_000
  - High profile: 8_000
  - Balanced profile: 5_500
  - Low profile: 3_000
  - Toaster profile: 1_500
- Global target is player-scaled before distribution:
  - `target_active = clamp(2500 + players * 100, 2500, profile_cap)`
- If seeded world demand exceeds `target_active`, apply deterministic scaling by the exact order:
  1. compute raw target per type per city/route
  2. scale each type by `scale = target_active / raw_total`
  3. round down deterministically
  4. add remaining slots using the same ordered type list by highest required proportion
- Type order for scaling: `citizens, traders, caravans, ships, legions, horse_riders, ox_carts, fishing_boats`
- This guarantees reproducible spawn results across rebuilds with same seed.
- All counts in section 1 are seed bands only; after scaling, type counts may exceed those bands.
- All stochastic branch points use deterministic seeded pseudo-randomness.
- Seed tuple: `(simulation_seed, active_tick_window, agent_type, city_or_route_id, agent_id)`.
- Deterministic output required for replay/rebalancing; same seed tuple must always produce the same output.

## 1. Agent Types

| Type | Count (seed band) | Behavior | Visibility |
|------|------------------|----------|------------|
| Trader | 100-200 | Follow trade routes between cities, buy/sell goods | Ship or caravan model, zoom < 1000 |
| Ship | 30-50 | Sail Mediterranean sea routes, carry cargo | 8x3x4 voxel trireme, zoom < 2000 |
| Legion | 20-40 | Patrol border provinces, march between forts | Formation of 4x4 voxel soldiers, zoom < 500 |
| Citizen | 200-500 | Walk within cities, visit forum/temple/market | 2x2x4 voxel person, zoom < 100 |
| Caravan | 30-60 | Travel land trade routes (Silk Road, Amber Road) | Cart + figures, zoom < 800 |
| Fishing Boat | 20-30 | Circle near coastal cities | 4x2x2 voxel boat, zoom < 500 |
| Horse Rider | 30-80 | Fast courier/patrol movement on roads and city arteries | Rider + horse voxel set, zoom < 400 |
| Ox Cart | 15-40 | Slow bulk transport between resource sites and markets | Cart + ox pair, zoom < 250 |

### Total: 445 seed-band base, scalable to profile-cap (up to 10,000) active agents

The row above is the final active world cap after deterministic scaling; seed-band counts are not hard constraints.

### Agent Entity Archetype (ECS)

Every agent on the client is an ECS entity with these components:

```
IsAgent + Position + Rotation + AgentRole + AgentMovement + InstanceRef + Visible + ServerSync
```

- `AgentRole.agentType` maps to the Type column (uint8 enum: 0=trader, 1=ship, 2=legion, 3=citizen, 4=caravan, 5=fishing_boat, 6=horse_rider, 7=ox_cart)
- `AgentRole.role` maps to citizen functional roles (uint8 enum: 0=market_walker, 1=service_walker, 2=faith_walker, 3=maintenance_walker, 4=idle_civilian)
- `InstanceRef.poolId` maps to the per-type InstancedMesh pool
- `ServerSync` tracks last server tick and missed poll count for despawn grace period

See `docs/ECS.md` Section 4 for full archetype definition.

### Functional Walker Roles (Citizen Subtypes, Mandatory)

Citizen instances are partitioned into deterministic functional roles for Caesar-style street life.

| Role | Typical Share of Citizens | Primary Loop | Visual Cue |
|------|---------------------------|--------------|------------|
| Market Walker | 20-30% | Warehouse -> market stalls -> residential blocks | Crate/basket carry variants |
| Service Walker | 15-25% | Service building -> district route -> return | Tool/ledger props |
| Faith Walker | 8-15% | Temple -> plaza loop -> temple | Procession clusters, banner/torch variants |
| Maintenance Walker | 10-18% | Workshop -> repair target -> workshop | Hammer/repair kit variants |
| Idle Civilian | Remaining share | Residential/forum short loops | No carry prop |

Role assignment is deterministic by city seed + district profile and must not collapse into a single dominant role.

---

## 2. Agent State Machine

```
        ┌──────────┐
        │  SPAWN   │
        └────┬─────┘
             │
             ▼
        ┌──────────┐     destination reached
        │   IDLE   │◄────────────────────────┐
        └────┬─────┘                         │
             │ goal assigned                  │
             ▼                               │
        ┌──────────┐                    ┌────┴─────┐
        │ PLANNING │───route found────►│  MOVING  │
        └────┬─────┘                    └────┬─────┘
             │ no route                      │ arrived at city
             ▼                               ▼
        ┌──────────┐                    ┌──────────┐
        │  STUCK   │                    │ TRADING  │
        └──────────┘                    │ RESTING  │
                                        │ PATROLLING│
                                        └──────────┘
```

### States

| State | Duration | Behavior |
|-------|----------|----------|
| idle | 5-30s | Stand at current location, wait for new goal |
| planning | 1 tick | Calculate route to destination |
| moving | varies | Interpolate position along route |
| trading | 10-30s | At city, exchange goods (update inventory) |
| resting | 15-60s | At city, idle animation |
| patrolling | ongoing | Loop between waypoints (legions) |
| docked | 10-20s | Ship at harbor |
| stuck | 30s then respawn | Cannot reach destination |

---

## 3. Movement System

### Pathfinding (State-of-the-Art 2026 Stack)

Agents do NOT use raw grid A* or simple walker routing. Movement uses a deterministic 3-layer navigation stack:

- **Global layer**: hierarchical route graph (`trunk/regional/local`) with ALT+A* queries over contracted topology.
- **Corridor layer**: district corridor extraction + funnel smoothing on walkable lane graph.
- **Local layer**: ORCA/RVO-style velocity obstacles + intersection reservation windows.
- Water tiles impassable for land agents, land tiles impassable for ships.
- Roads and supply corridors provide priority weighting by role (haulers, maintenance, service).
- Common long-haul routes (Roma→Alexandria, etc.) remain pre-cached at startup.
- Citizens stay on `STREET`/`PLAZA`/`GATE`/`HARBOR_WALK` lanes only.
- Street crowd quality target remains ~0.6 tile separation, enforced via local avoidance constraints.

### Coverage by Agent Type (Mandatory)

All movable agent classes must use the 2026 navigation stack; only lane domain differs.

| Type | Global Layer | Corridor Layer | Local Avoidance | Lane Domain |
|------|--------------|----------------|-----------------|------------|
| Citizen / role-based walkers | ALT+A* on hierarchical graph | District corridor + funnel | ORCA/RVO + reservation | STREET/PLAZA/GATE/HARBOR_WALK |
| Trader / Caravan / Ox Cart | ALT+A* on hierarchical graph | Supply corridor + funnel | ORCA/RVO + reservation | ROAD/SUPPLY lanes |
| Horse Rider | ALT+A* on hierarchical graph | Fast corridor smoothing | ORCA/RVO + reservation | ROAD/ARTERY lanes |
| Legion | ALT+A* on hierarchical graph | Formation corridor | ORCA/RVO + reservation | ROAD/MILITARY lanes |
| Ship / Fishing Boat | ALT+A* on hierarchical graph | Sea-lane corridor + channel smoothing | ORCA/RVO + reservation | SEA/HARBOR lanes |

No movable type may fall back to random waypoint drift or non-routed motion in runtime simulation.

### Movement interpolation

```typescript
// Client-side interpolation between server ticks
agent.tile_x += (agent.destination_x - agent.tile_x) * speed * deltaTime
agent.tile_y += (agent.destination_y - agent.tile_y) * speed * deltaTime
agent.heading = Math.atan2(dy, dx)
```

### Local Avoidance Contract

- Fixed-step avoidance solver tick: 10 Hz simulation-side; render interpolation client-side.
- Neighbor set uses spatial hashing (bounded neighbor count per agent).
- Intersection reservations assign short time slots to avoid cross-node pileups.
- Agent heading must follow solved velocity vector (not raw corridor tangent) for natural turns.

### Speed by type

| Type | Speed (tiles/sec) | On Road | On Sea |
|------|-------------------|---------|--------|
| Trader | 0.3 | 0.6 | - |
| Ship | - | - | 0.5 |
| Legion | 0.4 | 0.8 | - |
| Citizen | 0.2 | 0.3 | - |
| Caravan | 0.2 | 0.4 | - |
| Fishing Boat | - | - | 0.3 |
| Horse Rider | 0.5 | 0.9 | - |
| Ox Cart | 0.2 | 0.35 | - |

---

## 4. Agent Tick Loop (Rust Simulation Service)

Runs as a dedicated Rust service at fixed 2-second tick windows, not inside an Edge Function.

```rust
use std::time::Duration;
use tokio::time::{interval_at, Instant};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut ticker = interval_at(Instant::now() + Duration::from_secs(2), Duration::from_secs(2));
    let db = db_pool::connect().await?;

    loop {
        ticker.tick().await;

        if !acquire_tick_lock(&db, 1170001).await? {
            continue;
        }

        let tick_ctx = load_tick_context(&db).await?;
        let active_agents = query_active_agents(&db, tick_ctx.max_agents).await?;
        let mut updates = Vec::with_capacity(active_agents.len());
        let mut events = Vec::new();

        for mut agent in active_agents {
            let (update, event) = step_agent(agent, &tick_ctx).await?;
            updates.push(update);
            if let Some(world_event) = event {
                events.push(world_event);
            }
        }

        persist_tick_results(&db, tick_ctx.tick_count + 1, updates, events).await?;
        release_tick_lock(&db, 1170001).await?;
    }
}
```

### Tick budget

| Phase | Target | Notes |
|-------|--------|-------|
| Query agents | < 150ms | Single indexed query + deterministic partition |
| Process decisions | < 700ms | SIMD/scalar mix, no LLM in tick loop |
| Batch update | < 250ms | Single RPC call |
| Event generation | < 150ms | Only notable events |
| **Total** | **< 1.2s** | Every 2 seconds |

Tick integrity requirements:
- Only one tick writer is allowed at a time (advisory lock guard).
- Tick run must be idempotent for event emission (stable `event_key` per emitted event).

---

## 5. Agent Decision-Making

### Rule-Based (Default, every tick)

```
Trader (idle):
  1. Check inventory → if empty, pick goods from current city's resources
  2. Find best destination city that wants these goods (price differential)
  3. Plan route → set state = moving

Trader (arrived at city):
  1. Sell goods → update city resource supply
  2. Create world_event(trade_complete)
  3. Rest 10-30s → then go idle

Ship (idle):
  1. Evaluate weighted feasible sea routes from home harbor
  2. Resolve ties with deterministic seeded selector
  3. Load cargo from harbor city
  4. Set state = moving along sea route

Legion (idle):
  1. Pick next waypoint on patrol circuit
  2. March to waypoint
  3. At waypoint: rest 30s, then next

Citizen (idle):
  1. Pick weighted walkable destination near building entrances (forum, temple, market, domus)
  2. Resolve ties with deterministic seeded selector
  3. Walk there on STREET/PLAZA/GATE tiles only
  4. Idle 15-60s, then pick new destination

Service Walker (idle):
  1. Pick district service route based on assigned profile (forum_market/residential/harbor/workshop_industry)
  2. Visit 3-6 service nodes in route order
  3. Emit service_visit event at each node, then return to origin

Maintenance Walker (idle):
  1. Query nearest building with `needs_repair` or `needs_supply` state
  2. Walk to building frontage node
  3. Run short repair/supply interaction (3-8s), then continue route

Faith Walker (idle):
  1. Spawn as solo or small procession (2-6 units)
  2. Move temple -> plaza -> temple circuit
  3. Trigger crowd pause reactions at route crossings

Horse Rider (idle):
  1. Pick weighted road corridor between gate/market/harbor nodes
  2. Follow road polyline at rider speed
  3. Pause 2-6s at node, then continue

Ox Cart (idle):
  1. Bind to nearest active resource site (field/mine/quarry/lumber/salt/fish)
  2. Move empty to site, wait during load phase
  3. Haul goods to nearest city market/storage node
  4. Loop to keep resource harvesting visually readable
```

### Deterministic Policy (No LLM in Tick Loop)

- All agent decisions are deterministic rule-based logic.
- No LLM calls are made inside the simulation tick loop.
- Behavior variety comes from route data, city state, and weighted rule selection.

### Micro-Interaction Rules (Mandatory)

- At local/detail zoom, agents must perform short interactions rather than pure continuous motion:
  - greeting/brief stop at crossings
  - handoff animation at market/storage nodes
  - unload/reload pause for carts
  - inspection pause for service/maintenance walkers
- Interaction duration range: 1.2-6.0s depending on role.
- Consecutive identical interaction at same node is cooldown-limited (>= 25s).

---

## 6. Spawn and Lifecycle

### Initial spawn (world seed)

```
For each city:
  citizens = clamp(population / 1000, 2, 80)
  traders = clamp(2 + min(8, ceil(trade_routes.through_city * 0.8)), 2, 10)

For each harbor city:
  ships = clamp(trade_routes.sea.count * 2, 4, 12)

For each border province:
  legions = clamp(floor(frontier_segment_count / 2), 1, 3)

For each major land route:
  caravans = clamp(round(route.importance * 1.8), 2, 5)
  horse_riders = clamp(round(route.importance * 1.2), 3, 8)
  ox_carts = clamp(round(route.importance * 1.0), 2, 6)
```

### Respawn

- Agent reaches `stuck` state → despawn after 30s → respawn at home city
- Ship sinks (seeded event roll, 1% per active sea route per day) → respawn at harbor after 60s
- Citizen lifetime: infinite (recycle within city)
- Trader lifetime: infinite (loop between cities)
- Distant/very distant agent throttling is defined in `## 0. Canonical Simulation Contracts`.
- Distant agents (no player within 500 tiles) → reduce tick rate to 10s
- Very distant agents (no player within 2000 tiles) → pause, teleport to destination

### Client-Side Entity Lifecycle (ECS)

The `AgentSyncSystem` manages agent entity creation and destruction on the client:

1. **Poll**: Every 2s, calls `agents_near_tile` RPC with camera viewport center and radius.
2. **Create/Update**: For each row in the response:
   - If UUID not in entity map → `addEntity()` + add agent archetype components + populate from row data.
   - If UUID exists → shift current position to `AgentMovement.prevX/Y`, write new position to `AgentMovement.nextX/Y`, reset `interpT` to 0.
3. **Track**: Mark all received UUIDs. For agent entities NOT in the response, increment `ServerSync.missedPolls`.
4. **Despawn**: `ServerReconcileSystem` (every 5s) removes entities where `missedPolls >= 3` (grace period of ~6 seconds prevents viewport-boundary flicker).
5. **Cleanup**: `CleanupSystem` recycles `InstanceRef` slot, removes from UUID↔EID map, calls `removeEntity()`.

---

## 7. Client-Side Rendering

### Agent rendering strategy

Displayed cap is per-frame visible instances; active world simulation can exceed these caps via paging/culling and offscreen parking.

### ECS System Split

Agent rendering is split across three ECS systems (see `docs/ECS.md` Section 5):

| System | Frequency | Responsibility |
|--------|-----------|---------------|
| `AgentSyncSystem` | Every 2s | Polls `agents_near_tile` RPC, creates/updates/despawns agent entities, writes to AgentRole + AgentMovement + ServerSync |
| `AgentInterpolationSystem` | Every frame | Lerps Position between AgentMovement.prevX/Y and nextX/Y, advances interpT, updates Rotation.yaw from movement direction |
| `AgentRenderSystem` | Every frame | Reads Position + Rotation + InstanceRef, writes transform matrices to InstancedMesh pools |

```
Agents use InstancedMesh (1 draw call per agent type):
  - Ships: 1 InstancedMesh, max 50 instances
  - Traders/Caravans: 1 InstancedMesh, max 260 instances
  - Citizens: 1 InstancedMesh, max 500 instances
  - Legions: 1 InstancedMesh, max 40 instances (each = formation)
  - Fishing boats: 1 InstancedMesh, max 30 instances
  - Horse riders: 1 InstancedMesh, max 80 instances
  - Ox carts: 1 InstancedMesh, max 40 instances

Total: 7 additional draw calls (within 50 draw call budget)
```

### Client interpolation

- Client polls agent positions in viewport every 2s via `agents_near_tile` RPC (NOT via Realtime)
- Client interpolates smoothly between polled positions
- Heading calculated from movement direction
- If no update for 10s → agent fades out (connection issue)
- Realtime is used ONLY for world events and player positions (not agent positions)

### Visibility culling

- Only render agents within camera frustum
- Apply zoom-based visibility thresholds (see Agent Types table)
- Citizens only visible at street-level zoom (< 100)

---

## 8. World Events

Events are generated by agent actions and drive UI notifications + ambient effects.

| Event Type | Trigger | Visual Effect |
|------------|---------|---------------|
| trade_complete | Trader sells goods at city | Gold sparkle at city, floating text |
| ship_arrival | Ship docks at harbor | Horn sound cue, wake particles |
| legion_march | Legion enters province | Dust cloud, marching animation |
| harvest_cycle | Ox cart completes resource haul | Crate/bundle drop-off pulse at market/storage |
| market_peak | Market walkers exceed district threshold | Denser stall activity + crowd clustering |
| maintenance_round | Maintenance walker completes service route | Repair spark/hammer pulse at affected buildings |
| temple_procession | Faith walkers run procession circuit | Procession trail + plaza crowd pause reaction |
| festival | Seeded random, 1-2 events per game day | Colored flags at city, fireworks particles |
| construction | Seeded random at growing cities | Scaffolding model, hammer particles |
| disaster | Seeded random, rare (1% per province-city pair per day) | Fire/flood effect at location |

### Event lifetime

- Visual effects: 5-15 seconds
- Event log entry: 7 days in database
- Notable events (battles, festivals): permanent in history log

---

## 9. Seasonal Effects on Agents

| Season | Latin | Effect |
|--------|-------|--------|
| Spring (ver) | Mar-May | All trade active, fastest ship speed |
| Summer (aestas) | Jun-Aug | Mediterranean calm, +20% ship speed |
| Autumn (autumnus) | Sep-Nov | Harvest events at grain/wine provinces |
| Winter (hiems) | Dec-Feb | Sea routes dangerous (-50% ships), land trade slower |

Season changes every ~5 real minutes (1 game year = ~20 real minutes).

---

## 10. Performance Budget

| Metric | Target |
|--------|--------|
| Max concurrent agents | 10,000 |
| Agent tick interval | 2 seconds |
| Tick processing time | < 1.2s |
| Realtime broadcast latency | < 100ms |
| Client interpolation overhead | < 1ms/frame |
| Additional draw calls (agents) | 7 |
| GPU memory for agent meshes | ~10MB |
| Supabase Realtime connections | ~100 concurrent |
