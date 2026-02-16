# Cities Database & Generation

Complete city database, voxel model asset pipeline, and city generation specification.
Every landmark building is a real voxelized 3D model. No fallbacks, no procedural substitutes
for landmarks. Generic residential/commercial buildings use culture-specific procedural templates.

---

## 1. Voxel Model Asset Pipeline

Every landmark building is derived from a real 3D model, converted to .vox format,
and loaded at runtime. This is the same approach used by Teardown and Urbek (industry standard).

### Build-Time Pipeline

```
1. SOURCE: Download 3D model (.obj/.glb/.stl)
   - Sketchfab (CC0/CC-BY), Smithsonian 3D (CC0), CyArk
   - AI generation (Meshy.ai, Tripo3D) from historical reference photos
   - Hand-model in MagicaVoxel for unique structures

2. VOXELIZE: Convert mesh to voxel grid
   Tool: FileToVox (GitHub, supports .obj/.glb/.ply → .vox)
   Resolution per class (see table below)

3. REFINE: Open in MagicaVoxel, adjust colors to culture palette
   - Map materials to palette slots: wall, roof, column, door, accent
   - Add detail voxels (cracks, moss, wear) for character
   - Set material properties (roughness, emissiveness for gold/fire)

4. EXPORT: Save as .vox (MagicaVoxel format)
   Storage: client/public/models/{culture}/{building_name}.vox
   Naming: lowercase, underscores (e.g. colosseum.vox, library_of_celsus.vox)
```

### Runtime Pipeline

```
1. LOAD: Fetch .vox file (VOXLoader)
2. MESH: Greedy meshing in Web Worker → 99%+ vertex reduction
3. RENDER: BufferGeometry with vertex colors → BatchedMesh (1 draw call per city)
4. CACHE: Store meshed geometry in IndexedDB (idb-keyval)
5. Next visit: load from IndexedDB, skip steps 1-2
```

### Resolution Classes

| Class | Voxel Resolution | .vox Size | Examples |
|-------|-----------------|-----------|----------|
| World Wonder | 256-512 voxels wide | 50-200KB | Colosseum, Pyramids, Parthenon, Pharos |
| Major Landmark | 128-256 voxels | 20-80KB | Temples, theaters, large baths |
| Standard Landmark | 64-128 voxels | 5-30KB | Forums, basilicas, arches, aqueducts |
| Generic Building | 16-32 voxels | 1-5KB | Houses, shops, walls (procedural) |
| Decoration | 4-16 voxels | <1KB | Fountains, statues, columns (procedural) |

### 3D Model Sources (all open/free)

| Source | URL | Best For | License |
|--------|-----|----------|---------|
| Sketchfab | sketchfab.com | Individual buildings, downloadable | CC0 / CC-BY |
| CyArk | cyark.org | Laser scans (Pompeii, temples) | Various |
| Smithsonian 3D | 3d.si.edu | 1,700+ heritage models | CC0 |
| Google Open Heritage | artsandculture.google.com | 26 World Heritage sites | Various |
| Rome Reborn | romereborn.org | Complete ancient Rome | Research |
| Meshy.ai | meshy.ai | AI generation from text/image | Commercial |
| Tripo3D | tripo3d.ai | AI 3D from reference photos | Commercial |
| MagicaVoxel | ephtracy.github.io | Hand-craft voxel models directly | Free |

### Voxelization Tools

| Tool | Use Case | Input | Output |
|------|----------|-------|--------|
| VoxTool | Best quality, Teardown-proven | .obj + textures | .vox |
| FileToVox | Batch conversion, CLI | .obj/.glb/.ply/.png | .vox |
| trimesh (Python) | Scripted batch pipeline | any mesh format | numpy array → .vox |
| MagicaVoxel | Hand-crafting, refinement | manual / import | .vox |

---

## 2. Complete City Landmark Database

### Tier 1: World Wonders & Metropolis (10 cities, 256-512 voxel models)

| City | Province | Landmarks (each a distinct voxel model) |
|------|----------|----------------------------------------|
| **Roma** | Italia | Colosseum, Pantheon, Forum Romanum, Circus Maximus, Trajan's Column, Trajan's Forum, Trajan's Market, Trajan's Baths, Ara Pacis, Theater of Pompey, Aqua Claudia (aqueduct), Palatine Palace, Temple of Venus & Roma, Baths of Titus, Arch of Titus, Temple of Saturn, Basilica Ulpia, Basilica Aemilia, Curia Julia, Cloaca Maxima outlet, Horrea Galbae (warehouses), Tiber Island, Pons Aelius |
| **Alexandria** | Aegyptus | Pharos Lighthouse (wonder!), Great Library/Museion, Serapeum, Royal Palace, Heptastadion (causeway), Canopic Street (colonnade), Caesar's Temple, Gymnasium, Stadium, Necropolis, Harbor with breakwater |
| **Antiochia** | Syria | Colonnade Street (2 miles!), Hippodrome, Imperial Palace, Apollo Temple at Daphne, City Walls (5 gates), Forum, Theater, Baths, Aqueduct, Island Palace on Orontes |
| **Carthago** | Africa Proc. | Byrsa Hill acropolis, Roman Forum, Antoninus Baths (largest outside Roma), Theater, Circular Harbor (Cothon), Rectangular Harbor, Odeon, Amphitheater, Aqueduct from Zaghouan |
| **Athenae** | Achaea | Parthenon, Erechtheion, Propylaea, Temple of Athena Nike, Ancient Agora, Stoa of Attalos, Theater of Dionysus, Odeon of Herodes Atticus, Temple of Olympian Zeus, Hadrian's Arch, Hadrian's Library, Roman Agora, Tower of the Winds, Panathenaic Stadium, Hephaisteion |
| **Ephesus** | Asia | Library of Celsus, Temple of Artemis (wonder ruins), Great Theater (25,000), Arcadian Street, Temple of Hadrian, Terrace Houses, Baths of Scholastica, Prytaneion, Odeon, Stadium, Harbor monument, Gate of Augustus |
| **Memphis/Giza** | Aegyptus | Great Pyramid of Khufu, Pyramid of Khafre, Pyramid of Menkaure, Great Sphinx, Ptah Temple, Valley Temple, Causeway, Mastaba field |
| **Theben/Luxor** | Aegyptus | Karnak Temple Complex (Hypostyle Hall!), Luxor Temple, Avenue of Sphinxes, Colossi of Memnon, Mortuary Temple of Hatshepsut, Valley of Kings entrance |
| **Pergamon** | Asia | Acropolis, Steep Theater (10,000), Zeus Altar (massive staircase), Asklepieion (healing center), Library, Trajaneum, Red Basilica, Gymnasium (3 terraces) |
| **Leptis Magna** | Africa Proc. | Arch of Septimius Severus, Severan Forum, Theater, Market (macellum), Old Forum, Hadrian's Baths, Lighthouse, Harbor, Amphitheater, Circus |

### Tier 2: Major Cities (40 cities, 128-256 voxel landmarks)

| City | Province | Landmarks |
|------|----------|-----------|
| **Korinth** | Achaea | Temple of Apollo (7 standing columns), Lechaion Road, Peirene Fountain, Acrocorinth Fortress, Bema (judgment seat), North Market, South Stoa, Theater, Odeon, Baths of Eurykles |
| **Syrakus** | Sicilia | Greek Theater, Roman Amphitheater, Athena Temple (in cathedral), Ear of Dionysius (quarry cave), Altar of Hieron II, Fort Euryalus, Arethusa Fountain |
| **Baalbek** | Syria | Temple of Jupiter (tallest Roman columns ever!), Temple of Bacchus (best preserved large temple), Temple of Venus, Great Court, Hexagonal Court, Trilithon stones |
| **Petra** | Arabia | Treasury (Al-Khazneh), Monastery (Ad-Deir), Siq gorge, Theater, Royal Tombs, Great Temple, Qasr al-Bint, Colonnaded Street |
| **Palmyra** | Syria | Temple of Bel, Great Colonnade (1.1km), Theater, Agora, Camp of Diocletian, Tower Tombs, Temple of Baalshamin, Tariff Court |
| **Pompeii** | Italia | Forum, Apollo Temple, Amphitheater, Stabian Baths, Forum Baths, House of Faun, Villa dei Misteri, Large Theater, Lupanar, Bakery, Street fountains |
| **Timgad** | Africa Proc. | Trajan's Arch, Forum, Library (one of few surviving), Basilica, Theater, Baths (14 total!), perfect grid streets, City Gates |
| **Damascus** | Syria | Temple of Jupiter (largest in Syria), Via Recta (Straight Street), City Walls (7 gates), Agora, Theater |
| **Caesarea Maritima** | Syria | Herod's Artificial Harbor (engineering marvel), Amphitheater by sea, Hippodrome, Aqueduct (double), Palace on promontory, Temple of Augustus |
| **Augusta Treverorum** | Gallia Belg. | Porta Nigra (massive gate), Amphitheater, Imperial Baths (Kaiserthermen), Barbara Baths, Basilica (Aula Palatina), Roman Bridge over Moselle |
| **Emerita Augusta** | Lusitania | Theater (best preserved in Spain), Amphitheater, Circus, Aqueduct (Los Milagros), Temple of Diana, Arch of Trajan, Roman Bridge (longest), Forum |
| **Londinium** | Britannia | London Wall, Forum + Basilica (largest N of Alps), Amphitheater, Bridge over Thames, Temple of Mithras, Governor's Palace, Fort (Cripplegate) |
| **Tarraco** | Hispania Tarr. | Amphitheater by the sea, Provincial Forum (on hill), Colonial Forum, Circus (300m long), Aqueduct (Pont del Diable), City Walls (oldest Roman in Iberia) |
| **Nemausus (Nîmes)** | Gallia Narb. | Amphitheater (best preserved in world), Maison Carrée (perfect temple), Tour Magne, Temple of Diana, Castellum Divisorium (water distribution), City Gate (Porta Augusta) |
| **Arelate (Arles)** | Gallia Narb. | Amphitheater (20,000 seats), Theater, Cryptoporticus (underground gallery), Forum, Baths of Constantine, Alyscamps necropolis, Pont boat-bridge over Rhône |
| **Arausio (Orange)** | Gallia Narb. | Theater (best preserved scaenae frons in world!), Triumphal Arch, City Grid |
| **Lugdunum (Lyon)** | Gallia Lugd. | Twin theaters (large + odeon), Amphitheater of Three Gauls, Aqueducts (4 total), Forum on Fourvière hill |
| **Italica** | Baetica | Amphitheater (3rd largest in empire!), Trajaneum, House of Birds (mosaics), House of Neptune, City Streets with mosaics, Baths |
| **Corduba** | Baetica | Temple of Claudius Marcellus, Forum, Theater, Amphitheater, Mausoleum, Roman Bridge over Guadalquivir, City Walls |
| **Volubilis** | Mauret. Ting. | Triumphal Arch of Caracalla, Basilica, Capitol Temple, House of Orpheus, House of Venus, Olive Presses, Decumanus, Tangier Gate |
| **Djemila (Cuicul)** | Africa Proc. | Septimius Severus Temple, Old Forum, New Forum, Theater, Arch of Caracalla, Great Baths, Market, Christian Quarter (basilica) |
| **Thugga (Dougga)** | Africa Proc. | Capitol (Jupiter/Juno/Minerva temple), Theater (3,500 seats), Baths of Licinius, Temple of Caelestis, Arch of Alexander Severus, Libyo-Punic Mausoleum |
| **Sabratha** | Africa Proc. | Theater (extraordinary 3-story scaenae frons), Forum, Basilica, Temple of Isis, Baths, Amphitheater |
| **El Djem (Thysdrus)** | Africa Proc. | Amphitheater (3rd largest in world, 35,000 seats!), Small amphitheater, Villas with mosaics |
| **Aspendos** | Asia | Theater (nearly perfect preservation!), Aqueduct + pressure tower (unique), Basilica, Agora, Nymphaeum |
| **Side** | Asia | Theater (freestanding, 15,000), Monumental Fountain (nymphaeum), Temple of Apollo by sea, Temple of Athena, Agora, City Walls + Gate, Harbor |
| **Perge** | Asia | Hellenistic Gate, Roman Gate, Colonnaded Street (unique carved columns), Agora, Baths, Theater, Stadium (12,000), Nymphaeum |
| **Aphrodisias** | Asia | Stadium (30,000 seats, best preserved), Temple of Aphrodite, Tetrapylon, Sebasteion (imperial cult), Baths of Hadrian, Odeon, Theater, Agora |
| **Hierapolis** | Asia | Theater (12,000, elaborate reliefs), Plutonium (toxic gas cave), Necropolis (largest ancient, 1,200 tombs), Antique Pool, Apollo Temple, Frontinus Gate |
| **Miletus** | Asia | Theater (15,000, harbor view), Baths of Faustina, Bouleuterion, Agora (largest in Ionia), Harbor Monument, Sacred Gate, Nymphaeum |
| **Smyrna (Izmir)** | Asia | Agora (reconstructed columns), Theater, Stadium, Harbor, Roman Road, Baths |
| **Thessalonica** | Macedonia | Arch of Galerius, Rotunda, Palace Complex, Forum, Hippodrome, City Walls, Harbor, Octagonal Church foundations |
| **Byzantium** | Thracia | Hippodrome (future Constantinople), City Walls, Harbor, Forum, Temple of Artemis, Strategion |
| **Nicomedia** | Bithynia | Imperial Palace, Temple of Augustus, Forum, Theater, Amphitheater, Harbor, City Walls |
| **Ancyra** | Cappadocia | Temple of Augustus (Monumentum Ancyranum - Augustus' testament!), Roman Baths (largest in Anatolia), Theater, Stadium, Column of Julian |
| **Lutetia (Paris)** | Gallia Lugd. | Arena (amphitheater), Forum on hill, Baths (Cluny), Aqueduct, Pont connecting islands |
| **Massilia** | Gallia Narb. | Greek Harbor (Lacydon), Theater, Docks (horrea), City Walls, Temple, Horn of harbor |
| **Carnuntum** | Pannonia Sup. | Heidentor (triumphal arch), Amphitheater (military), Amphitheater (civilian), Palace, Forum, Baths |
| **Aquincum** | Pannonia Inf. | Amphitheater (military, largest in Pannonia), Civilian Amphitheater, Forum, Baths, Aqueduct, Mithraeum, Macellum |
| **Sarmizegetusa** | Dacia | Forum, Amphitheater, Temple of Isis, Procurator's Palace, Dacian sanctuary ruins nearby, City Grid |

### Tier 3: Notable Cities (60+ cities, 64-128 voxel landmarks)

| City | Province | Key Landmarks |
|------|----------|---------------|
| Ostia | Italia | Apartment blocks (insulae), Theater, Forum, Baths of Neptune, Horrea (warehouses), Synagogue, Piazzale delle Corporazioni |
| Capua | Italia | Amphitheater (2nd largest after Colosseum!), Mithraeum, Via Appia gate |
| Brundisium | Italia | Harbor (2 arms), Roman Columns (Via Appia end), Amphitheater |
| Puteoli (Pozzuoli) | Italia | Amphitheater (Flavian), Macellum (Serapeum), Harbor, Temple of Augustus |
| Verona | Italia | Arena (amphitheater, 30,000 seats), Theater, Ponte Pietra, Porta Borsari, Gavi Arch |
| Mediolanum (Milan) | Italia | Imperial Palace complex, Circus, Theater, Amphitheater, Baths (Herculean), City Walls |
| Ravenna | Italia | Harbor (Classis, main naval base), Augustus' Mausoleum reference |
| Aquileia | Italia | Forum, Basilica, Harbor (river port), City Walls, Amphitheater |
| Gades (Cadiz) | Baetica | Theater (one of largest in empire), Amphitheater, Temple of Melqart/Hercules, Harbor, Garum factories |
| Hispalis (Seville) | Baetica | Forum, Aqueduct, Temple, Harbor on Guadalquivir |
| Caesaraugusta (Zaragoza) | Hispania Tarr. | Forum, Theater, River Harbor, Baths, City Walls |
| Segovia | Hispania Tarr. | Aqueduct (167 arches, iconic double tier!) |
| Conimbriga | Lusitania | Forum, Baths (3 sets), Aqueduct, House of Fountains, House of Cantaber, City Wall |
| Burdigala (Bordeaux) | Gallia Aquit. | Amphitheater (Palais Gallien), Forum, Harbor, Aqueduct |
| Autun (Augustodunum) | Gallia Lugd. | City Gates (Porte d'Arroux, Porte St-André), Theater (largest in Gaul), Amphitheater, Temple of Janus |
| Pont du Gard (near Nemausus) | Gallia Narb. | Aqueduct bridge (3 tiers, 50m high, iconic!) |
| Vienna (Vienne) | Gallia Narb. | Temple of Augustus & Livia, Theater, Odeon, Circus, Pyramid (tomb) |
| Colonia Agrippina (Köln) | Germania Inf. | City Walls (longest N of Alps), Praetorium (Governor's Palace), Temple, Harbor, Aqueduct (Eifel) |
| Mogontiacum (Mainz) | Germania Sup. | Legionary fortress, Theater, Aqueduct, Drusus Monument (pillar), Harbor |
| Augusta Raurica | Germania Sup. | Theater (largest N of Alps), Forum + Temple, Amphitheater, Taberna |
| Vindobona (Wien) | Pannonia Sup. | Legionary fortress, Civilian town, Amphitheater |
| Salona (Split) | Dalmatia | Amphitheater, City Walls + Porta Caesarea, Aqueduct, Forum, Theater, Christian Basilica |
| Singidunum (Belgrade) | Moesia Sup. | Fortress on confluence, Legionary Camp |
| Tomis (Constanța) | Moesia Inf. | Harbor, Mosaic building, City Walls |
| Cyrene | Creta et Cyr. | Temple of Zeus (larger than Parthenon!), Agora, Theater, Baths of Trajan, Gymnasium, Necropolis, Apollo Sanctuary |
| Gortyna | Creta et Cyr. | Odeon (Law Code inscription), Praetorium, Temple of Apollo, Theater, Amphitheater |
| Paphos | Cilicia et Cyp. | House of Dionysus (mosaics), Odeon, Forum, Harbor, Saranda Kolones castle foundations |
| Tarsus | Cilicia et Cyp. | Cleopatra's Gate, Roman Road, Baths, Stadium |
| Tyrus (Tyre) | Syria | Hippodrome (one of largest), Triumphal Arch, Colonnaded Street, Harbor (island city), Necropolis |
| Sidon | Syria | Temple of Eshmun, Harbor, Sea Castle foundations |
| Berytus (Beirut) | Syria | Law School (famous), Forum, Baths, Theater, Hippodrome, Colonnaded Streets |
| Apamea | Syria | Great Colonnade (1.85km, longest in Roman world!), Agora, Theater, Citadel |
| Bostra | Arabia | Theater (perfectly preserved, 15,000), Nabataean Arch, Reservoir |
| Gerasa (Jerash) | Arabia | Oval Forum (unique!), Cardo with 500 columns, Temple of Artemis, Temple of Zeus, South Theater, North Theater, Nymphaeum, Hippodrome, Hadrian's Arch |
| Ctesiphon | Mesopotamia | Taq Kasra (great arch), Persian Palace (pre-Roman, just conquered) |
| Artaxata | Armenia | Hellenistic Palace, Temple ruins (just conquered, Eastern style) |
| Tingis (Tangier) | Mauret. Ting. | City Walls, Forum, Harbor |
| Caesarea (Mauretania) | Mauret. Caes. | Royal Mausoleum, Theater, Hippodrome, Harbor |
| Sufetula (Sbeitla) | Africa Proc. | Capitol (3 temples: Jupiter, Juno, Minerva - most intact forum in Africa!), Triumphal Arch, Baths, Theater |
| Lepcis Minor | Africa Proc. | Theater, Forum, Harbor |
| Bulla Regia | Africa Proc. | Underground villas (unique!), Forum, Baths, Theater |
| Thuburbo Majus | Africa Proc. | Capitol, Forum, Baths, Temple of Mercury, Palaestra |
| Sala (Chellah) | Mauret. Ting. | Forum, Triumphal Arch, Temple, Decumanus |
| Virunum | Noricum | Forum, Amphitheater, Capitol |
| Augusta Vindelicorum | Raetia | Forum, City Walls, Baths |
| Segusio | Alpes Cottiae | Arch of Augustus (well preserved), City Walls |

### Tier 4: Small Cities & Villages (200+ cities, procedural generation with culture templates)

These cities use the procedural generation system (Section 7) with culture-specific templates.
Each still gets at least ONE unique geographic feature:

| Feature Type | Examples |
|-------------|----------|
| Harbor | Coastal cities with pier, breakwater, lighthouse |
| River crossing | Bridge, ford, river quay |
| Hilltop | Elevated citadel, terraced buildings |
| Valley | Nestled between hills, defensive walls |
| Oasis | Palm grove, water source, irrigated fields (Egyptian/Eastern) |
| Mining town | Mineshaft entrance, ore carts, spoil heaps |
| Military camp | Castra layout (rectangular fort, via principalis) |
| Road junction | Mansio (road inn), milestone, crossroads |

---

## 3. Street-Aware Citizen Movement

Citizens MUST walk on streets, not random-walk through buildings.

### Street Grid System

At city generation time, tiles are classified:

```
STREET    = 1  (walkable, citizen path)
BUILDING  = 2  (not walkable)
PLAZA     = 3  (walkable, gathering point)
GATE      = 4  (walkable, entry/exit point)
GARDEN    = 5  (walkable, slow movement)
```

### Citizen Behavior (Updated)

```
1. Citizen spawns at a GATE or PLAZA tile
2. Pick random destination: another PLAZA, GATE, or STREET intersection
3. Walk along STREET tiles toward destination (simple grid walk, no A*)
   - At intersections: pick direction toward destination
   - Speed: 0.2-0.3 tiles/second
4. At destination: idle 10-30s (shopping, praying, socializing)
5. Pick new destination, repeat

Special behaviors:
- Morning (game time): citizens move from residential to forum/market
- Evening: citizens move from forum back to residential areas
- Festival event: all citizens converge on forum/temple plaza
```

Quality constraints:
- Citizens must keep minimum spacing of ~0.6 tile while moving.
- Citizens must not pass through `BUILDING` tiles at any time.
- At busy intersections, yielding/slowdown is required to prevent visible overlap clusters.

### Street Types and Width

| Street | Width | Description |
|--------|-------|-------------|
| Cardo Maximus | 3 tiles | Main N-S avenue, colonnaded |
| Decumanus Maximus | 3 tiles | Main E-W avenue, colonnaded |
| Side street | 2 tiles | Regular grid streets |
| Alley | 1 tile | Between insulae blocks |
| Via Sacra | 3 tiles | Processional route (Roma special) |

---

## 4. Historical Population Data

Sources: Wilson (2011) "City Sizes and Urbanization in the Roman Empire",
Scheidel (2007) "Roman Population Size". Values are estimates for relative city sizing.

| City | Region | Population |
|------|--------|-----------|
| Roma | Italia | 350,000 |
| Alexandria | Aegyptus | 216,000 |
| Antiochia | Syria | 90,000 |
| Smyrna | Asia | 90,000 |
| Cadiz | Hispania | 65,000 |
| Ephesus | Asia | 51,000 |
| Carthago | Africa | 50,000 |
| Korinth | Achaea | 50,000 |
| Apamea | Syria | 37,000 |
| Capua | Italia | 36,000 |
| Ancyra | Cappadocia | 34,000 |
| Nicomedia | Bithynia | 34,000 |
| Damascus | Syria | 31,000 |
| Athen | Achaea | 28,000 |
| Tarragona | Hispania | 27,000 |
| Pergamum | Asia | 24,000 |
| Cordoba | Hispania | 20,000 |
| Tyrus | Syria | 20,000 |

---

## 5. City LOD Representations

### LOD2 - Icon (strategic/regional zoom, height > 1000)

- InstancedMesh with quad geometry
- Size scaled by importance (Tier 1 = large, Tier 4 = small dot)
- Color by province or culture
- City name label (troika-three-text, major cities only)

### LOD1 - Cluster (tactical zoom, height 300-1000)

- Simplified 3D silhouette: city walls + top 3 landmark outlines
- 50-200 triangles per city
- All 300+ preloaded (~1KB each = ~300KB total)
- Key landmarks recognizable even at this distance (Colosseum oval, Pyramid triangle, etc.)

### LOD0 - Detail (local/detail zoom, height < 300)

- Full voxel city with all landmark .vox models
- .vox loaded via VOXLoader → greedy mesh in Web Worker
- Greedy-meshed geometry cached in IndexedDB after first visit
- LRU cache: max 30 detail cities in GPU memory
- Metropolis (Roma): up to 100,000 triangles
- Village: ~1,000 triangles

### LOD0 Microdetail Requirements (Mandatory)

- Every LOD0 city must include district-level prop layers:
  - Market/forum: stalls, baskets/amphorae, awnings, sign poles, crates
  - Residential: door props, small yard objects, laundry/cloth lines
  - Harbor (if `is_harbor=true`): dock cargo stacks, mooring posts, ropes/cranes
  - Service/industry: kiln/forge props where relevant to city profile
- Visual density targets in traversable city area (visible frustum at detail zoom):
  - High: >= 0.24 decorative props per walkable tile
  - Medium: >= 0.16 decorative props per walkable tile
  - Low: >= 0.10 decorative props per walkable tile
  - Toaster: >= 0.06 decorative props per walkable tile
- Facade repetition control:
  - No more than 3 adjacent identical facade modules on primary streets.
  - Long street runs (> 14 tiles) must include at least 2 facade color/material variants.
- Props and microdetails may be profile-thinned, but district category presence is mandatory.

### District Activity Profiles (Mandatory)

- City detail generation must assign each walkable tile to one district profile:
  - `forum_market`
  - `residential`
  - `harbor` (only if harbor city)
  - `workshop_industry`
- District profile drives:
  - ambient FX weights
  - prop mix selection
  - crowd/vehicle preference weights
  - harvest-haul visibility emphasis
- Uniform random ambience distribution across all city tiles is forbidden.

### Prop Placement Safety Rules

- Placement must test blocker masks before instancing:
  - no placement intersecting `BUILDING`, `WALL`, `GATE`, `BRIDGE`
  - no hanging props clipped into door/window openings
  - no props on invalid slope/water tiles unless type is water-compatible
- If a prop candidate fails validation, it is dropped and replaced by next deterministic candidate in sequence.

### Patina and Repetition Control

- LOD0 districts must include visible wear variation:
  - soot/dirt near workshops and high-traffic roads
  - moisture/wet tint near fountains, harbor edges, and canals
  - route wear on market/forum approaches
- Adjacent-block repetition rules are release-blocking:
  - max 3 identical prop modules in sequence on primary streets
  - max 2 identical stall facades in sequence inside forum/market zones

### Building Runtime State Visualization (Mandatory)

Each interactive/service building must expose a runtime visual state in detail view.

| State | Trigger | Required Visual Cues |
|------|---------|----------------------|
| supplied | Input stock above threshold | Active frontage props, normal traffic |
| low_supply | Input stock below threshold | Reduced activity, sparse frontage props |
| unsupplied | Input stock depleted | Shuttered frontage, waiting walkers |
| needs_repair | Condition below threshold | Scaffolding/repair markers, maintenance walkers |
| upgrading | Building currently improving | Build materials + active worker cluster |

- State transitions must be deterministic from simulation values.
- State cues remain visible in all quality profiles (density may be reduced).

### Street Interaction Nodes (Mandatory)

- Every district must define interaction nodes on walkable tiles:
  - market exchange nodes
  - service inspection nodes
  - maintenance target nodes
  - faith/procession pause nodes
- Node density target:
  - High/Medium: >= 1 interaction node per 18 walkable tiles
  - Low/Toaster: >= 1 interaction node per 30 walkable tiles
- Walkers with functional roles must prefer interaction-node routes over pure random waypoints.

### Person Counts per City Size

| Size | Persons | Behavior |
|------|---------|----------|
| Metropolis | 50-80 | Walk on streets, gather at forum, visit temples |
| Large | 30-50 | Walk on streets, market activity |
| Medium | 15-25 | Walk on streets, simpler patterns |
| Small | 5-10 | Walk between gate and forum |
| Village | 2-5 | Stand near buildings, occasional movement |

---

## 6. Culture Assignments

| Culture | Regions | Architecture Features |
|---------|---------|----------------------|
| Roman | Italia, Gallia, Hispania, Africa | Red tile roofs, stucco, columns, arches, insulae, forum |
| Greek | Achaea, Asia, Creta, Cyrenaica | White marble, column orders, agora, stoa |
| Egyptian | Aegyptus | Flat roofs, mud brick (ocher), obelisks, pylons, palms |
| Eastern/Syrian | Syria, Mesopotamia, Arabia | Dome roofs, courtyard houses, colonnaded streets |
| Celtic | Britannia, Gallia (rural) | Roundhouses, thatched roofs, wooden palisades |
| Germanic | Germania | Longhouses, half-timber, palisades |
| North African | Mauretania, Numidia | Mud buildings, flat roofs, walled kasbah |
| Dacian | Dacia | Wooden fortresses, tower sanctuaries |
| Nabataean | Arabia (Petra, Bostra) | Rock-cut facades, rose-red stone |

---

## 7. RGB Color Palettes Per Culture

### Roman

```
roof:      (178, 80, 50)    // Brick red
wall:      (235, 220, 195)  // Cream white
column:    (225, 215, 200)  // Light marble
door:      (100, 65, 40)    // Dark wood
window:    (60, 50, 40)     // Dark opening
accent:    (190, 160, 90)   // Gold/ocher
floor:     (200, 185, 160)  // Travertine
road:      (180, 170, 155)  // Cobblestone
```

### Greek

```
roof:      (195, 110, 70)   // Terracotta
wall:      (245, 240, 232)  // Marble white
column:    (240, 235, 225)  // Pure white marble
door:      (85, 65, 45)     // Olive wood
accent:    (85, 130, 175)   // Aegean blue
floor:     (230, 225, 215)  // Light marble
```

### Egyptian

```
roof:      (210, 185, 130)  // Sandstone
wall:      (180, 155, 110)  // Mud brick
column:    (200, 180, 140)  // Light sandstone
door:      (120, 85, 50)    // Dark wood
accent:    (200, 170, 60)   // Gold
accent2:   (45, 120, 140)   // Turquoise
hieroglyph:(180, 50, 30)    // Red-brown
```

### Eastern

```
roof:      (75, 150, 150)   // Turquoise tiles
wall:      (240, 235, 225)  // White plaster
column:    (210, 190, 150)  // Sandstone
door:      (90, 60, 35)     // Dark wood
accent:    (185, 155, 80)   // Gold/ocher
dome:      (65, 140, 160)   // Dome turquoise
```

### Celtic

```
roof:      (190, 175, 120)  // Straw
wall:      (130, 95, 60)    // Medium wood
frame:     (90, 65, 40)     // Dark wood
door:      (80, 55, 35)     // Dark wood
accent:    (80, 120, 60)    // Moss green
```

### Germanic

```
roof:      (185, 170, 115)  // Straw/thatch
wall:      (100, 70, 45)    // Dark wood
beam:      (70, 45, 25)     // Beams
accent:    (160, 60, 40)    // Red-brown
daub:      (200, 185, 150)  // Clay plaster
```

### North African

```
roof:      (210, 190, 140)  // Flat sandstone
wall:      (195, 175, 130)  // Clay/mud brick
gate:      (150, 120, 75)   // Dark sandstone
door:      (110, 75, 45)    // Dark wood
accent:    (170, 90, 40)    // Burnt orange
market:    (220, 200, 150)  // Light cloth awnings
```

### Dacian

```
roof:      (140, 110, 70)   // Dark wood shingles
wall:      (120, 90, 55)    // Timber logs
tower:     (100, 80, 50)    // Dark timber
stone:     (155, 145, 130)  // Local grey stone
accent:    (80, 110, 55)    // Forest green
hearth:    (170, 80, 40)    // Fire-red trim
```

### Nabataean

```
facade:    (195, 140, 110)  // Rose-red sandstone
column:    (210, 165, 130)  // Light sandstone
door:      (100, 65, 45)    // Dark cave opening
accent:    (180, 120, 80)   // Warm sandstone
cliff:     (170, 120, 90)   // Cliff face
```

---

## 8. Building Models Per Culture (LOD0 Voxel Sizes)

### Landmark Models (.vox files)

Real voxelized 3D models. Every landmark listed in Section 2 MUST have a .vox file.
No exceptions, no fallbacks.

### Landmark Asset Validation (Required)

- Maintain `data/meta/landmark_manifest.json` containing one entry per required landmark:
  - `city`
  - `landmark`
  - `culture`
  - `vox_path`
  - `sha256`
- CI validation must fail if any manifest entry is missing on disk or hash mismatches.
- City generation must fail hard if a required landmark `.vox` is absent.

| Building | Voxel Size | Tiles Footprint | Height | Pipeline |
|----------|-----------|-----------------|--------|----------|
| Colosseum | 48x40x20 | 16x12 | 12 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Parthenon | 32x48x14 | 10x16 | 8 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Great Pyramid | 64x64x40 | 20x20 | 25 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Sphinx | 32x16x12 | 10x5 | 7 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Pharos Lighthouse | 12x12x48 | 4x4 | 30 | MagicaVoxel (hand-crafted) |
| Library of Celsus | 24x16x16 | 8x5 | 10 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Petra Treasury | 24x12x32 | 8x4 | 20 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Pont du Gard | 64x8x24 | 20x3 | 15 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Segovia Aqueduct | 48x4x20 | 16x2 | 12 | MagicaVoxel (hand-crafted) |
| Maison Carrée | 16x24x12 | 5x8 | 7 | Sketchfab .obj → VoxTool → MagicaVoxel |
| Porta Nigra | 16x8x14 | 5x3 | 9 | MagicaVoxel (hand-crafted) |
| Aspendos Theater | 32x24x12 | 10x8 | 7 | MagicaVoxel (hand-crafted) |

### Procedural Building Templates (for generic buildings)

| Culture | Model | LOD0 Size | Description |
|---------|-------|-----------|-------------|
| Roman | Insula | 12x10x16 | Multi-story tenement, red roof |
| Roman | Domus | 16x14x6 | Villa with peristyle courtyard |
| Roman | Taberna | 6x5x5 | Shop with open front |
| Roman | Temple (generic) | 14x18x12 | Column facade, pediment |
| Roman | Baths (generic) | 20x16x8 | Large hall, vaulted roof |
| Roman | Amphitheater (generic) | 24x20x10 | Oval arena, tiered seating |
| Roman | Circus | 30x10x4 | Long racetrack |
| Roman | Basilica | 18x10x10 | Nave with apse |
| Roman | Triumphal Arch | 6x3x10 | Single arch with attic |
| Roman | Aqueduct section | 6x3x12 | Double-story arcade |
| Roman | City Wall | 2x2x8 | Wall section |
| Roman | Tower | 4x4x12 | Corner tower, crenellations |
| Roman | Gate | 6x3x10 | City gate with arch |
| Roman | Nymphaeum | 8x4x8 | Ornamental fountain facade |
| Roman | Macellum | 12x12x5 | Market hall, round/rectangular |
| Roman | Horrea | 16x8x5 | Warehouse, barrel roof |
| Greek | Stoa | 20x6x6 | Long open column hall |
| Greek | Parthenon-type | 16x24x12 | Colonnade, pediment |
| Greek | Theater | 20x16x8 | Semicircular seating |
| Greek | Gymnasium | 16x16x5 | Open courtyard |
| Greek | House | 10x10x5 | Courtyard, white walls |
| Egyptian | Pylon Temple | 18x24x10 | Sloped walls, massive entrance |
| Egyptian | Obelisk | 2x2x18 | Tall narrow needle |
| Egyptian | House | 8x8x4 | Flat roof, clay colors |
| Eastern | Domed | 10x10x8 | Round dome on square base |
| Eastern | Courtyard | 12x12x5 | Closed facade, open court |
| Celtic | Roundhouse | 8x8x6 | Round, conical thatch |
| Germanic | Longhouse | 16x8x6 | Long, half-timber, thatch |
| N. African | Kasbah | 14x14x8 | Walled, flat roofs |
| Dacian | Fortress | 16x16x8 | Wooden palisade, central tower |
| Dacian | Tower Sanctuary | 6x6x12 | Tall wooden tower, stone base |
| Nabataean | Rock-cut Tomb | 12x4x16 | Carved facade in cliff face |
| Military | Castra (fort) | 24x24x4 | Rectangular fort, via principalis, praetorium |

### Note on Trajan's Eastern Conquests (115-117 AD)

Cities in **Armenia**, **Assyria**, and **Mesopotamia** were conquered only 1-2 years
before our reference date. They should show:
- Minimal Roman infrastructure (basic garrison, no forum/baths)
- Pre-existing Eastern/local architecture as primary
- Roman military camp (castra) as the only Roman addition
- No Roman city walls or full urban grid

---

## 9. Layout Algorithms

### General Algorithm

```
Input: CityData { id, culture, size, features[], landmarks[], gridSize }
  1. Set city walls (if features.includes('walls'))
  2. Main streets (classified as STREET tiles):
     - Roman: Cardo (N-S) + Decumanus (E-W) cross grid
     - Greek: Hippodamian grid
     - Others: Organic winding streets
  3. Central square (classified as PLAZA):
     Forum (Roman), Agora (Greek), Temple complex (Egyptian)
  4. Place landmark .vox models from landmarks[] list (exact positions from city data)
  5. Fill remaining plots with procedural residential/commercial (culture templates)
  6. Classify all tiles: STREET, BUILDING, PLAZA, GATE, GARDEN
  7. Decoration: fountains, statues, trees, colonnades
Output: VoxelGrid + BuildingList + TileClassification (for citizen pathfinding)
```

### Roman City Layout (64x64 Grid, Step by Step)

**Step 1: City Walls**

- Rectangular wall ring, 2 tiles from edge
- Wall: 2 voxels wide, 6-8 voxels high
- 4 gates: N, S, E, W (each 4 tiles wide, classified as GATE)
- Towers at every corner + every 12 tiles
- Tower: 4x4 base, 10-12 voxels high, crenellations

**Step 2: Main Streets (Cardo + Decumanus)**

- Cardo Maximus: vertical N-S, 3 tiles wide (STREET)
- Decumanus Maximus: horizontal E-W, 3 tiles wide (STREET)
- Crossing = Forum square (PLAZA)
- Side streets: 2 tiles wide, every 8 tiles (STREET)

**Step 3: Forum (Center)**

- 12x12 tiles open square at intersection (PLAZA)
- Colonnades (1 tile wide, columns every 2 tiles)
- Basilica at north end (10x6 tiles, 8 voxels high)
- Temple at south end (6x8 tiles, column facade)
- Curia at west end (6x4 tiles)

**Step 4: Landmark Buildings**

- Load .vox models for all landmarks in city's landmarks[] list
- Position according to city-specific layout data
- Every listed landmark MUST have a .vox file. No fallbacks.

**Step 5: Residential (Insulae Grid Fill)**

- Plot sizes: 4x4 to 8x6 tiles
- Near forum (< 12 tiles): Tall insulae (4-6 stories = 8-12 voxels)
- Medium (12-24): Medium insulae (3-4 stories) + tabernae
- Far (> 24): Domus (1-2 stories) + gardens

**Step 6: Decoration**

- Fountains: 2x2 at intersections, every 16 tiles
- Statues: 1x1 at forum and temples
- Trees: cypresses every 4 tiles, 60% chance
- Colonnades along main streets

### Roma Special Layout (64x64)

```
     0    8   16   24   32   40   48   56   64
  0  +----+----+----+----+----+----+----+----+
     |WALL|WALL|WALLGWALL|WALL|WALL|WALL|WALL|
  8  |W   |    | Baths    |    |    |    |  W|
     |W   |    | 10x8     |    |    |    |  W|
 16  |W   |    |    +-----+----+    |    |  W|
     |W   |    |    |FORUM 12x12    |    |  W|
 24  GW---+----+    |  Basilica     |    |  W|
     |W   |    |    | Temple  Curia |    |  W|
 32  |W   |    |    +-----+---+----+    |  W|
     |W   |    |    Cardo |   |  COLOSS |  W|
 40  |W   |    |    (N-S) |   |  SEUM   |  W|
     |W   |    |    3wide |   |  12high |  W|
 48  GW---+----+----+-----+---+---------+--W|
     |W  Circus Maximus (20x6)              W|
 56  |W                                     W|
     |WALL|WALL|WALLGWALL|WALL|WALL|WALL|WALL|
 64  +----+----+----+----+----+----+----+----+

Tiber: River at west edge (x=2-4), flows N to S
Aqueduct: Arcade from southeast (diagonal)
Palatine: Elevated terrain (+3 height) SW of Forum
```

Roma geometry: ~400 buildings, ~30,000-80,000 visible faces, after greedy: ~8,000-15,000 quads = 1 draw call

### Greek City Differences

- More organic arrangement, no strict grid
- Agora (irregular square) instead of Forum
- Stoa instead of Basilica
- Theater in hillside (semicircular, embedded in terrain)
- Buildings lower (2-3 stories max)
- More colonnades, fewer arches
- White marble + terracotta colors

### Egyptian City Differences

- Flat roofs (no pediments, no tile roofs)
- Pylon temples: sloped walls, massive entrances
- Obelisks as landmarks (1x1x15 voxels)
- Palms instead of cypresses
- Mud brick colors: ocher/sand instead of white
- Wider, straighter streets (processional)
- Nile canal or harbor basin as water feature

---

## 10. Nature & Decoration Models

| Model | Size | Description |
|-------|------|-------------|
| Cypress | 2x2x10 | Slim dark tree (Mediterranean) |
| Oak | 4x4x6 | Broad crown (Northern Europe) |
| Palm | 2x2x8 | Thin trunk, leaf crown |
| Olive | 3x3x4 | Gnarled short tree |
| Pine | 3x3x7 | Conical crown (mountains) |
| Cedar | 3x3x9 | Tall, Lebanon/Syria |
| Fig | 3x3x4 | Round crown, orchards |
| Fountain | 3x3x2 | Stone basin with column |
| Statue | 1x1x3 | Figure on pedestal |
| Column | 1x1x4 | Single column |
| Colonnade | 1x20x4 | Row of columns (along streets) |
| Trade ship | 8x3x4 | Roman trireme |
| Fishing boat | 4x2x2 | Small boat |
| Cart | 4x2x2 | Ox cart |
| Sheep herd | 1x1x1 (x20) | White dots |
| Market stall | 3x2x3 | Awning + counter |
| Milestone | 1x1x2 | Road marker (along Via Appia etc.) |

### Nature Colors (RGB)

```
cypress_trunk:  (85, 60, 35)
cypress_leaves: (35, 75, 30)
oak_trunk:      (95, 65, 40)
oak_leaves:     (55, 100, 35)
palm_trunk:     (120, 85, 50)
palm_leaves:    (60, 130, 40)
olive_trunk:    (100, 80, 50)
olive_leaves:   (105, 130, 65)
pine_trunk:     (90, 60, 35)
pine_leaves:    (30, 70, 25)
cedar_trunk:    (85, 55, 30)
cedar_leaves:   (25, 65, 20)
fig_trunk:      (90, 70, 45)
fig_leaves:     (50, 95, 30)
```
