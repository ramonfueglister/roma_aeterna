# Resources & Trade Routes

Complete reference for all resources, visual field representations, trade routes, ship animations, road networks, and color definitions used in the Roman Empire Voxel World Map.

---

## 1. Resource Types (24 Total)

| Resource | Main Provinces | Icon | Icon Color RGB |
|----------|---------------|------|----------------|
| Grain | Aegyptus, Africa, Sicilia | Wheat ear | (210, 185, 80) |
| Fish | Hispania (Garum), Pontus | Fish | (100, 160, 200) |
| Wine | Italia, Gallia, Graecia, Hispania | Grape | (130, 30, 50) |
| Olives/Oil | Hispania Baetica, Africa, Syria | Olive | (80, 110, 40) |
| Iron | Noricum, Hispania, Britannia | Anvil | (120, 120, 125) |
| Gold | Hispania (9t/year!), Dacia, Aegyptus | Gold bar | (220, 190, 50) |
| Silver | Hispania (main export), Britannia | Silver coin | (200, 200, 210) |
| Copper | Cyprus (name!), Hispania | Copper bar | (190, 110, 60) |
| Tin | Britannia, Hispania | Tin bar | (170, 170, 175) |
| Marble | Italia (Carrara), Graecia, Asia | Marble block | (240, 235, 225) |
| Wood | Germania, Dalmatia, Cilicia | Log | (120, 80, 45) |
| Salt | Italia (Via Salaria), Africa | Salt crystal | (245, 240, 235) |
| Amber | Baltic (trade route via Danube) | Amber | (210, 160, 40) |
| Silk | Import from China via Silk Road | Silk bale | (200, 50, 60) |
| Spices | Import from India/Arabia | Spice sack | (180, 100, 30) |
| Incense | Arabia Felix, import | Censer | (220, 200, 140) |
| Papyrus | Aegyptus (monopoly) | Papyrus roll | (210, 195, 150) |
| Dyes | Syria (Tyrian Purple), Aegyptus | Dye pot | (120, 30, 100) |
| Horses | Cappadocia, Hispania, Numidia | Horse | (140, 100, 60) |
| Glass | Aegyptus, Syria, Italia | Glass vase | (150, 210, 220) |
| Linen | Aegyptus, Hispania | Linen bale | (230, 225, 210) |
| Wool | Britannia, Hispania, Asia | Wool ball | (235, 230, 220) |
| Ceramics | Italia (Terra Sigillata), Gallia | Amphora | (185, 100, 55) |
| Bronze | Italia (Capua), Graecia | Bronze shield | (175, 135, 60) |

---

## 2. Visual Resource Fields on Map

| Resource Type | Visual Representation | Color/Texture RGB | Size (Tiles) |
|--------------|----------------------|-------------------|-------------|
| Grain fields | Rectangular golden parcels, row pattern | (210, 185, 80) golden, furrows (180, 155, 65) | 3x3 to 6x6 |
| Vineyards | Rows of small green bushes on brown earth | Vines (75, 110, 40), Earth (140, 110, 70) | 2x4 to 4x8 |
| Olive groves | Regularly distributed gnarled trees on dry earth | Trees (105, 130, 65), Ground (170, 155, 110) | 4x4 to 8x8 |
| Orchards | Rows of round trees (fig, citrus) | Trees (60, 120, 40), Fruit (200, 100, 30) | 3x3 to 5x5 |
| Fishing villages | Small huts + boats at water, nets | Huts (160, 130, 90), Boats (130, 90, 50) | 2x3 at coasts |
| Mines | Dark tunnel entrance in mountain + spoil heap + cart | Entrance (50, 40, 30), Heap (100, 90, 75) | 2x2 in mountains |
| Quarries | Stepped rock cut (terraces), light stone | Marble (235, 225, 210), Granite (150, 140, 130) | 3x3 to 5x5 |
| Lumber camps | Clearing in forest, stacked logs, sawbuck | Logs (140, 95, 50), Sawbuck (100, 70, 40) | 2x2 at forest edge |
| Salt pans | White flat basins at sea/lake (evaporation) | Salt (240, 235, 225), Water (180, 200, 210) | 3x3 to 4x4 at coasts |
| Pastures | Green areas with fences and herd (white dots) | Grass (100, 150, 75), Fence (120, 85, 50) | 4x4 to 8x8 |
| Papyrus fields | Tall green reeds on Nile banks | Papyrus (80, 140, 50), Water (90, 140, 120) | 2x4 at Nile |
| Spice plantations | Small bushes in rows (saffron, herbs) | Leaves (60, 100, 35), Blossoms (180, 60, 120) | 2x3 |
| Amber collecting | Small huts on Baltic coast, sieves | Amber (210, 160, 40) | 1x2 at coast |

### Harvest State Visualization (Mandatory)

Resource fields are not static decoration. Each active site must render a deterministic
work cycle so harvesting is visible directly on the map.

| State | Required Visual Signal | Typical Duration |
|------|-------------------------|------------------|
| idle | Site geometry present, no workers moving | 6-15s |
| work | Workers/tools/animals animated on site | 10-25s |
| haul | Output leaves site via cart/porter/boat | 5-12s |
| recover | Site resets (partial depletion/rebuild cues) | 4-10s |

### Resource Site Entity Archetype (ECS)

Each visible resource site is an ECS entity (see `docs/ECS.md` Section 4):

```
IsResource + Position + ResourceSite + InstanceRef + Visible + ServerSync
```

The `ResourceSite` component drives the harvest state machine:

| Component Field | Type | Maps From |
|----------------|------|-----------|
| `ResourceSite.resourceType` | uint8 (0-23) | `resources.type` enum |
| `ResourceSite.harvestState` | uint8 | 0=idle, 1=work, 2=haul, 3=recover |
| `ResourceSite.stateTimer` | f32 | Seconds remaining in current state |
| `ResourceSite.fieldSizeX/Y` | uint8 | `resources.field_size_x/y` |

The `ResourceStateSystem` advances `stateTimer` each frame and transitions between harvest states deterministically. `InstanceRef` maps to the resource icon InstancedMesh pool. Position comes from the `resources.tile_x/tile_y` columns.

### Site-Specific Harvest Cues

- Grain/Vine/Olive: moving workers, row-by-row cut/uncut pattern, visible bundles.
- Mine/Quarry: tool impact loop + spoil heap growth + loaded cart exit.
- Lumber: chopping loop, trunk fall animation, stack height progression.
- Salt/Fish/Papyrus: gather loops on shoreline/river edge + baskets/nets moving to storage.
- Pastures/Horses/Wool: herders and animals shift between pen/water/feed points.

### Runtime Visibility Caps (Per Camera Frustum)

- High: up to 120 simultaneous active harvest loops
- Medium: up to 80 simultaneous active harvest loops
- Low: up to 48 simultaneous active harvest loops
- Toaster: up to 24 simultaneous active harvest loops

Harvest visualization remains active in all quality profiles; only density is scaled.

### End-to-End Production Chain Visualization (Mandatory)

Resource ambience must show the full civic economy loop, not isolated site animations.

| Stage | Example Nodes | Required Visual Output |
|------|----------------|------------------------|
| extraction | field/mine/quarry/lumber/salt/fish site | workers + tools + output bundles |
| transfer_in | cart/porter/boat to storage | moving cargo entities on route |
| processing | kiln/workshop/mill/press | active processing props/effects |
| transfer_out | storage/workshop to market district | outbound cargo flow |
| consumption | market/residential/service destinations | unload/handoff interaction cues |

- At detail zoom in major cities, at least one complete chain must be simultaneously visible for one local key resource.
- Chain stages must use deterministic state transitions tied to simulation data.
- Broken chains (missing link stage) are allowed only when city state indicates disruption; visual state must communicate disruption explicitly.

---

## 3. Trade Routes

### Data Source: ORBIS Stanford

- URL: https://orbis.stanford.edu/
- 632 places, 85,000 km roads, 28,000 km navigable rivers, sea routes
- Cost/distance/time optimized routes, seasonal variation
- License: Free/Open Access

### Sea Trade Routes (Mediterranean)

1. Roma - Carthago - Alexandria (grain route)
2. Roma - Massilia - Gades (western route)
3. Athen - Antiochia - Tyrus (eastern route)
4. Alexandria - Caesarea - Antiochia (Levant route)
5. Roma - Korinth - Ephesus (Aegean route)
6. Gades - Tingis - Mauretania (Atlantic route)

### Major Land Routes

- **Via Appia**: Roma -> Brundisium (SE Italia)
- **Via Egnatia**: Dyrrachium -> Thessalonica -> Byzantium
- **Via Augusta**: Roma -> Massilia -> Hispania
- **Amber Road**: Aquileia -> Carnuntum -> Baltic
- **Silk Road (entry)**: Antioch -> Ctesiphon -> East

### River Trade Routes

| Ancient Name | Modern Name | Width (Tiles) | Trade Significance |
|-------------|-------------|--------------|-------------------|
| Nilus | Nile | 3-4 | Grain to Roma |
| Danuvius | Danube | 2-3 | Military frontier, amber trade |
| Rhenus | Rhine | 2 | Germanic frontier trade |
| Tigris | Tigris | 2 | Eastern goods |
| Euphrates | Euphrates | 2-3 | Silk Road connector |
| Padus | Po | 1-2 | Italia internal |
| Tiberis | Tiber | 1 | Roma supply |
| Rhodanus | Rhone | 1-2 | Gallia trade |
| Hiberus | Ebro | 1 | Hispania internal |
| Sequana | Seine | 1 | Northern Gallia |
| Tamesis | Thames | 1 | Britannia internal |
| Baetis | Guadalquivir | 1 | Olive oil export |

---

## 4. Ship Animations

### Parameters

- 30-50 ships simultaneously on Mediterranean
- Speed: 0.5 tiles/second
- Rocking: roll +/-3 degrees (sine 3s), pitch +/-1 degree (sine 4s)
- Sails: static geometry
- Wake: 10 white particles behind ship, 2s fade-out
- Spawn at harbor cities, follow predefined route, despawn at destination
- All ships as 1 draw call (InstancedMesh)

### Ship Model

- Size: 8x3x4 voxels (trade ship / trireme)
- Fishing boat: 4x2x2 voxels

### Harbor & Coast Visual Requirements

- Harbor cities must expose visible dock modules (quays, piers/jetties, warehouse edge) in local/detail zoom.
- Coastal beaches must show a wet-sand shoreline ring and deterministic foam line.
- Harbor basin water is calmer than open coast water; lane wakes remain clearly visible for active traffic.

---

## 5. Road Network

### Data Sources

- **Primary**: Itiner-e (~300,000 km, 2025, Nature Scientific Data)
- **Supplementary**: DARMC (7,154 segments, Barrington Atlas basis)
- **Supplementary**: OmnesViae (Tabula Peutingeriana digitized)

### Visual Rendering

- Road width: 1 tile (main roads), visible at tactical zoom (< 1000)
- Color: slightly lighter than terrain biome
- At detail zoom: individual paving stones pattern (voxel)
- Carts on roads: 20-30 total, speed 0.3 tiles/second
- Horse riders on roads: 30-50 total, speed 0.5-0.9 tiles/second
- Ox carts on roads: 12-24 total, speed 0.2-0.35 tiles/second
- People on roads: 40-60 travelers, speed 0.2 tiles/second

---

## 6. Effects Colors (RGBA)

```
smoke:     (180, 180, 180, 0.5)
fire:      (255, 160, 30, 0.8)
flag_red:  (180, 30, 20, 1.0)
flag_gold: (210, 180, 50, 1.0)
bird:      (60, 50, 40, 1.0)
wake:      (240, 245, 250, 0.4)
```

---

## 7. Water Colors

```
mediterranean_shallow: (100, 200, 210)
mediterranean_mid:     (65, 155, 190)
mediterranean_deep:    (40, 100, 160)
ocean_deep:            (20, 50, 110)
river:                 (78, 145, 180)
river_delta:           (85, 155, 160)
foam:                  (240, 245, 250)
shore_wet:             (160, 145, 110)
```
