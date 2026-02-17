# Historical Data Sources

Complete reference of historical and geospatial data sources used to build the Roman Empire
Voxel World Map. Each section lists the primary source, download URLs, formats, licenses,
and the processing pipeline that transforms raw data into game-ready assets.

Coverage target: the Roman Empire at its territorial peak (117 AD, under Emperor Trajan),
spanning roughly 25N--58N latitude and 10W--50E longitude.

---

## 1. Terrain / Heightmap

### SRTM 30m (1 arc-second) DEM

| Field | Value |
|-------|-------|
| Provider | NASA / USGS |
| Download (tile picker) | <https://dwtkns.com/srtm30m/> |
| Download (portal) | OpenTopography Portal |
| REST API | <https://www.opentopodata.org/datasets/srtm/> (100 points per request) |
| Python package | `bmi-topography` (PyPI) -- automated download with bounding box |
| Format | GeoTIFF (`.tif`), WGS-84 (EPSG:4326) |
| Resolution | 30 m at the equator, 1-degree tiles (e.g. `n45e006.tif`) |
| Coverage needed | 25N--58N Lat, 10W--50E Lon = ~33 x 60 = ~2,000 tiles |
| License | **Public Domain (NASA)** |

**Processing:**
GDAL merge, reproject, resample to 2048x2048, quantize to uint8 (see pipeline below).

### Backup: ViewFinder Panoramas

| Field | Value |
|-------|-------|
| URL | <https://viewfinderpanoramas.org/dem3.html> |
| Format | 3" (90 m) Global DEM, 5x5 degree tiles |
| Advantage | Void-filled, cleaner than raw SRTM |

### Coastlines and Lakes: Natural Earth Data

| Field | Value |
|-------|-------|
| URL | <https://www.naturalearthdata.com/> |
| GitHub | <https://github.com/nvkelso/natural-earth-vector> |
| Resolutions | 1:10 m (detail), 1:50 m (medium), 1:110 m (overview) |
| Format | Shapefile (`.shp`), GeoJSON |
| Key layers | `ne_10m_coastline`, `ne_10m_rivers_lake_centerlines`, `ne_10m_lakes` |
| License | **Public Domain** |

### Terrain Processing Pipeline

```
SRTM tiles download (25N-58N, 10W-50E)
  -> GDAL merge (gdal_merge.py)
  -> Reproject to equirectangular
  -> Resample to 2048x2048 (gdal_translate)
  -> Output grid resolution: ~3.26km/tile (E-W at equator), ~1.79km/tile (N-S)
  -> Quantize to uint8 (0-127 height range)
  -> Sea level = 32, coast = 33-35
  -> Apply Natural Earth coastlines as mask
  -> Output: data/processed/heightmap_2048.raw (4 MB)
  -> Used by: Python chunk generator (tools/chunks/generate.py) -> INSERT INTO chunks table (Supabase)
```

---

## 2. Cities (300+)

### Pleiades Gazetteer of Ancient Places (Primary)

| Field | Value |
|-------|-------|
| URL | <https://pleiades.stoa.org/> |
| Download | <https://pleiades.stoa.org/downloads> |
| GIS data | <http://atlantides.org/downloads/pleiades/gis/> |
| GitHub | <https://github.com/isawnyu/pleiades.datasets> |
| Format | CSV, JSON, GeoJSON, KML, RDF |
| Key fields | `longitude`, `latitude` (WGS-84), `location_precision`, `timePeriods` |
| Filter | `timePeriods` contains `'R'` (AD 30--300) |
| License | **ODbL** |

### ORBIS Stanford (Supplementary)

| Field | Value |
|-------|-------|
| URL | <https://orbis.stanford.edu/> |
| API | <http://orbis.stanford.edu/api/> (JSON: `api-sites.json`) |
| GitHub | <https://github.com/sfsheath/gorbit>, <https://github.com/sfsheath/rorbium> |
| Scope | 632 places, 85,000 km roads, 28,000 km rivers, sea routes |
| License | **Free / Open Access** |

### DARE (Digital Atlas of the Roman Empire)

| Field | Value |
|-------|-------|
| URL | <https://dh.gu.se/dare/> |
| GitHub | <https://github.com/johaahlf/dare> |
| GeoJSON API | <http://imperium.ahlfeldt.se/api/geojson.php> |
| Tile server | `https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png` |
| License | **CC** |

### Population Data

| Field | Value |
|-------|-------|
| Primary | Wilson (2011) -- "City Sizes and Urbanization in the Roman Empire" |
| Secondary | Scheidel (2007) -- "Roman Population Size" |
| Tertiary | Brilliant Maps -- Roman Cities 117 AD (visual reference) |
| Purpose | City sizing: Metropolis (>100k), Large (30-100k), Medium (10-30k), Small (3-10k), Village (<3k) |
| Note | Ancient population figures are estimates with wide margins. Values used for relative sizing, not absolute accuracy. |

### City Processing Pipeline

```
pleiades-places-latest.csv.gz download
  -> Filter: timePeriods contains 'R' (Roman)
  -> Filter: featureTypes contains 'settlement', 'urban', 'temple'
  -> Lat/Lon -> Tile coordinates (2048x2048 grid)
  -> Cross-reference with ORBIS for trade connections
  -> Size classification from population data
  -> Culture assignment by province
  -> Output: data/processed/cities.json (300+ entries)
  -> Seed: INSERT INTO cities table (Supabase)
```

### Pipeline Output → ECS Component Mapping

At client startup, city rows are hydrated into ECS entities (see `docs/ECS.md` Section 6). The pipeline output fields map directly to ECS component fields:

| Pipeline Output / DB Column | ECS Component.Field | Type |
|----------------------------|--------------------|----|
| `tile_x`, `tile_y` | `Position.x`, `Position.y` | f32 |
| `size` (metropolis/large/medium/small/village) | `CityInfo.tier` (1-4) | ui8 |
| `population` | `CityInfo.population` | ui32 |
| `province_number` | `CityInfo.provinceNumber` | ui8 |
| `culture` | `CityInfo.culture` (enum) | ui8 |
| `is_harbor` | `CityInfo.isHarbor` | ui8 (0/1) |
| `is_capital` | `CityInfo.isCapital` | ui8 (0/1) |
| `id` (uuid) | UUID→EID map key | — |

String fields (`name`, `ancient_name`, `accuracy_tier`, `source_refs`, `features`, `buildings`) are not stored in ECS components (no strings in SoA TypedArrays). They remain accessible via the UUID→EID map when the UI info panel needs them.

---

## 3. Provinces (41)

### AWMC (Ancient World Mapping Center, UNC) -- Primary

| Field | Value |
|-------|-------|
| URL | <https://awmc.unc.edu/> |
| GIS data | <https://awmc.unc.edu/gis-data/> |
| GitHub | <https://github.com/AWMC/geodata> |
| Format | GeoJSON (GitHub), ESRI Shapefiles |
| Period | ~100 AD (closest available to 117 AD) |
| License | **ODbL** |

### Klokantech Roman Empire Project (Supplementary)

| Field | Value |
|-------|-------|
| GitHub | <https://github.com/siriusbontea/roman-empire> |
| Period | 500 BC to 117 AD |
| Format | TopoJSON (convertible to GeoJSON), WGS-84 |
| Advantage | Specifically optimized for 117 AD |

### Harvard DARMC (Supplementary)

| Field | Value |
|-------|-------|
| URL | <https://darmc.harvard.edu/data-availability> |
| Period | Political maps 60 BC to 200 AD |

### Province Processing Pipeline

```
AWMC GeoJSON download (GitHub)
  -> Simplify borders (reduce polygon complexity)
  -> Rasterize to 2048x2048 tile grid
  -> Each tile gets Province-ID (uint8, values 0-41)
  -> Extract border lines as polylines
  -> Output: data/processed/provinces.json (borders + metadata + colors)
  -> Seed: INSERT INTO provinces table (Supabase)
```

---

## 4. Roman Roads

### Itiner-e (2025, most comprehensive) -- Primary

| Field | Value |
|-------|-------|
| URL | <https://itiner-e.org/> / <https://itinere.iec.cat/> |
| Publication | Nature Scientific Data (2025) -- <https://www.nature.com/articles/s41597-025-06140-z> |
| Scope | ~300,000 km of Roman roads (double previous estimates) |
| Quality | Confidence ratings per road section |
| License | **Open Data** |

### McCormick / DARMC Road Network (Supplementary)

| Field | Value |
|-------|-------|
| Scope | 7,154 segments of ancient Roman roads (peak 117 AD) |
| Basis | Barrington Atlas of the Greek and Roman World (2000) |
| Format | Shapefiles / GeoJSON via DARMC |

### OmnesViae (Tabula Peutingeriana) (Supplementary)

| Field | Value |
|-------|-------|
| URL | <https://omnesviae.org/> / <https://www.omnesviae.org/viewer/> |
| Data | Places + connections + distances from the Tabula Peutingeriana |
| Bonus | River crossings, mountain passes |

### Road Processing Pipeline

```
Itiner-e GeoJSON download
  -> Filter by confidence level
  -> Simplify to tile grid resolution
  -> Rasterize road paths to 2048x2048
  -> Set road flags in chunk data
  -> Output: data/processed/roads.json (polyline segments)
  -> Seed: INSERT INTO roads table (Supabase)
```

---

## 5. Rivers

### Natural Earth Data (Primary)

| Field | Value |
|-------|-------|
| Layer | `ne_10m_rivers_lake_centerlines` (1:10 m resolution) |
| URL | <https://www.naturalearthdata.com/downloads/10m-physical-vectors/> |
| Format | Shapefile, GeoJSON |
| License | **Public Domain** |

### Historical Rivers (with map widths)

| Ancient Name | Modern Name | Width (Tiles) |
|-------------|-------------|--------------|
| Nilus | Nile | 3--4 |
| Danuvius | Danube | 2--3 |
| Rhenus | Rhine | 2 |
| Tigris | Tigris | 2 |
| Euphrates | Euphrates | 2--3 |
| Padus | Po | 1--2 |
| Tiberis | Tiber | 1 |
| Rhodanus | Rhone | 1--2 |
| Hiberus | Ebro | 1 |
| Sequana | Seine | 1 |
| Tamesis | Thames | 1 |
| Baetis | Guadalquivir | 1 |

---

## 6. Trade Routes

### ORBIS Stanford (Primary)

| Field | Value |
|-------|-------|
| URL | <https://orbis.stanford.edu/> |
| Scope | 632 places with full connection network |
| Features | Cost / distance / time optimized routes, seasonal variation data |
| API | JSON export (`api-sites.json`) |
| License | **Free / Open Access** |

### Sea Trade Routes (Mediterranean)

1. **Roma -- Carthago -- Alexandria** (grain route)
2. **Roma -- Massilia -- Gades** (western route)
3. **Athen -- Antiochia -- Tyrus** (eastern route)
4. **Alexandria -- Caesarea -- Antiochia** (Levant route)
5. **Roma -- Korinth -- Ephesus** (Aegean route)
6. **Gades -- Tingis -- Mauretania** (Atlantic route)

### Additional Sources

| Source | URL / Reference |
|--------|----------------|
| World History Encyclopedia | <https://www.worldhistory.org/article/638/trade-in-the-roman-world/> |
| Imperator Rome Wiki | Game reference for resource distribution |
| ArXiv paper | "Economic Complexity of the Roman Empire" (trade node analysis) |

---

## 7. 3D Model Sources (for Voxelization)

| Source | URL | Content | License |
|--------|-----|---------|---------|
| Sketchfab | <https://sketchfab.com> | Colosseum, Parthenon, Pyramids, Sphinx, Pharos, Library of Celsus, Trajan's Column | CC0 / CC-BY |
| CyArk | <https://cyark.org> | Laser scans of Pompeii, Thebes, Temple of Apollo | Various |
| Smithsonian 3D | <https://3d.si.edu> | 1,700+ heritage models | CC0 |
| Google Open Heritage | -- | 26 World Heritage sites in 3D | Various |
| Printables.com | <https://printables.com> | Petra Treasury, Pyramids, Pharos | Various |
| Rome Reborn | <https://romereborn.org> | Complete 3D ancient Rome (500+ structures) | Research |

### Voxelization Tools

| Tool | Description |
|------|-------------|
| **binvox** (CLI) | Mesh to voxel conversion |
| **FileToVox** (GitHub) | Various formats to `.vox` output |
| **Trimesh** (Python) | Scriptable mesh processing |
| **Meshy.ai** | AI-based 3D generation |
| **Shap-E** (OpenAI) | Text/image to 3D (MIT license) |
| **Tripo3D** | AI 3D generation |

---

## 8. License Summary

| Data Source | License | Commercial Use |
|-------------|---------|---------------|
| SRTM | Public Domain (NASA) | Yes |
| Natural Earth | Public Domain | Yes |
| Pleiades | ODbL | Yes (with attribution) |
| ORBIS | Free / Open Access | Yes |
| DARE | CC | Yes (with attribution) |
| AWMC | ODbL | Yes (with attribution) |
| Itiner-e | Open Data | Yes |
| Klokantech | Open Source | Yes |

**Attribution requirements.** Any dataset under ODbL or CC must include proper attribution
in the game's credits or an accompanying notice file. Public Domain sources require no
attribution but crediting NASA, Natural Earth, and similar providers is good practice.

---

## 9. Historical Accuracy Metadata Pipeline

All seeded `cities` and `provinces` records must be enriched with explicit accuracy metadata.

### Required output fields

- `accuracy_tier`: `A | B | C`
- `confidence`: float `0.0..1.0`
- `source_refs`: JSON array of source references
- `name_status`: `attested | reconstructed`

### Tiering rules

- **A**: converging evidence from multiple strong sources (low ambiguity)
- **B**: plausible reconstruction with moderate ambiguity
- **C**: speculative reconstruction for coverage completeness

### Pipeline step (mandatory)

```
Processed geometry/place records
  -> Source cross-check + ambiguity scoring
  -> Assign accuracy_tier + confidence + name_status
  -> Attach source_refs[]
  -> Validate no missing accuracy metadata
  -> Seed Supabase cities/provinces tables
```
