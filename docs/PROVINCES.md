# Provinces (117 AD under Trajan)

This document describes all 41 provinces of the Roman Empire at its maximum territorial
extent under Emperor Trajan in 117 AD. It covers the canonical province list, data
sources for historical GIS boundaries, rendering techniques for province overlays,
SDF text labels, the processing pipeline, and culture mapping.

---

## 1. Complete Province List (41 Provinces)

0. *(no province)* -- barbarian territory, outside the Roman Empire (Province-ID 0)
1. Achaea
2. Aegyptus
3. Africa Proconsularis
4. Alpes Cottiae
5. Alpes Graiae et Poeninae
6. Alpes Maritimae
7. Arabia
8. Armenia
9. Asia
10. Assyria
11. Baetica
12. Bithynia et Pontus
13. Britannia
14. Cappadocia et Galatia
15. Cilicia et Cyprus
16. Corsica et Sardinia
17. Creta et Cyrenaica
18. Dacia
19. Dalmatia
20. Gallia Aquitania
21. Gallia Belgica
22. Gallia Lugdunensis
23. Gallia Narbonensis
24. Germania Inferior
25. Germania Superior
26. Hispania Tarraconensis
27. Italia
28. Lusitania
29. Macedonia
30. Mauretania Caesariensis
31. Mauretania Tingitana
32. Mesopotamia
33. Moesia Inferior
34. Moesia Superior
35. Noricum
36. Pannonia Inferior
37. Pannonia Superior
38. Raetia
39. Sicilia
40. Syria
41. Thracia

---

## 2. Data Sources

### AWMC (Ancient World Mapping Center, UNC) -- Primary

- **URL:** <https://awmc.unc.edu/>
- **GIS data:** <https://awmc.unc.edu/gis-data/>
- **GitHub:** <https://github.com/AWMC/geodata>
- **Format:** GeoJSON (GitHub), ESRI Shapefiles
- **Period:** ~100 AD (closest available to 117 AD)
- **License:** ODbL

The AWMC dataset is the primary boundary source. It provides peer-reviewed polygon
data for Roman provinces. Because the dataset targets approximately 100 AD, a small
number of provinces that Trajan acquired between 100 and 117 AD (Armenia, Assyria,
Mesopotamia) require supplementary data or manual delineation.

### Klokantech Roman Empire Project -- Supplementary

- **GitHub:** <https://github.com/siriusbontea/roman-empire>
- **Period:** 500 BC to 117 AD
- **Format:** TopoJSON (convertible to GeoJSON), WGS-84
- **Advantage:** Specifically optimized for the 117 AD extent

This dataset fills the gap for Trajan's eastern conquests and provides TopoJSON
boundaries that can be converted to GeoJSON with standard tools such as `topojson-client`.

### Harvard DARMC -- Supplementary

- **URL:** <https://darmc.harvard.edu/data-availability>
- **Period:** Political maps 60 BC to 200 AD

The Harvard Digital Atlas of Roman and Medieval Civilizations offers additional
cross-reference material for boundary verification.

---

## 3. Province Rendering

### Jump Flooding Algorithm (JFA) for Distance Fields

The province overlay system uses a Jump Flooding Algorithm to generate distance field
textures from province border polygons. This approach produces soft color gradients at
borders instead of hard lines and is fully GPU-friendly.

Key properties:

- Creates a distance field texture from province border polygons.
- Soft color gradients at borders (not hard lines).
- Province fill colors are semi-transparent at strategic zoom.
- GPU-friendly: computed once, stored as a texture.
- Similar technique used in Imperator Rome (Paradox Interactive).

### Implementation Steps

1. **Rasterize** province polygons to a 2048x2048 grid. Each tile receives a
   Province-ID (uint8, values 0--41).
2. **Run JFA** on the rasterized grid to generate a distance-to-border value for
   every tile.
3. **In the fragment shader**, use the distance value to interpolate between the
   province fill color and transparent.
4. **Border line rendering**: where the distance falls below a configurable threshold,
   render a colored border line.

### Province Fill Rendering (Strategic Zoom)

- Semi-transparent colored overlay per province.
- Alpha decreases toward the province center (gradient effect).
- Only visible at strategic zoom (camera height > 1000).
- Implemented as a single mesh with vertex colors per province.

### ECS Dual Storage

Province data lives in two complementary locations:

1. **Per-tile Province-ID**: Baked into each chunk's binary data (1,024 bytes per chunk). Used by the mesh generation worker for vertex color desaturation (empire border fog) and by the JFA distance field pipeline. This is raw tile-level data, not ECS.

2. **Province metadata entities**: Each of the 42 provinces (41 + barbarian) is an ECS entity (see `docs/ECS.md` Section 4):

```
IsProvince + ProvinceTag + Position + Visible
```

- `ProvinceTag.number` (1-41) matches the uint8 Province-ID in chunk binary data.
- `Position` stores the `label_point` from the `provinces` table (used for name label placement).
- `Visible` is toggled by the `ProvinceOverlaySystem` based on camera height thresholds.

The `ProvinceOverlaySystem` reads `ProvinceTag` and camera height to toggle province fill/border/name rendering. Province entities are hydrated once at startup from the `provinces` table and never reconciled (static metadata).

---

## 4. SDF Text Labels

### Signed Distance Field (SDF) Rendering

Province and city labels use Signed Distance Field font rendering to remain sharp at
every zoom level without blurring when scaled.

Properties:

- Sharp text labels at any zoom level (no blurring at scale).
- Troika-generated glyph atlas from the bundled Cinzel font.
- Fragment shader produces smooth edges via SDF threshold.
- Labels scale with zoom.
- Province names visible from regional zoom onward (camera height > 1000).

### Label Behavior

- **Province names:** centered within the province area polygon.
- **City names:** offset below the city icon or mesh.
- **Font size:** scales inversely with camera height (larger text at higher zoom).
- **Transitions:** fade in and out with zoom level changes.

---

## 5. Processing Pipeline

```
AWMC GeoJSON download (GitHub)
  -> Filter for 117 AD provinces
  -> Simplify borders (reduce polygon complexity for performance)
  -> Merge with Klokantech data for 117 AD accuracy
  -> Rasterize to 2048x2048 tile grid
  -> Each tile gets Province-ID (uint8, 0-41)
  -> Extract border lines as polylines for rendering
  -> Generate JFA distance field texture
  -> Assign colors per province
  -> Output: provinces.json (borders + metadata + colors)
```

**Step-by-step detail:**

1. **Download** the AWMC GeoJSON files from the GitHub repository.
2. **Filter** polygons to retain only the 41 provinces listed above for the 117 AD
   extent.
3. **Simplify** border geometry using Douglas-Peucker or Visvalingam-Whyatt to reduce
   vertex count for real-time performance.
4. **Merge** with Klokantech TopoJSON data (converted to GeoJSON) to fill gaps for
   Armenia, Assyria, and Mesopotamia.
5. **Rasterize** the merged polygons onto a 2048x2048 grid. Each cell stores a
   Province-ID as a uint8 value (0 through 41).
6. **Extract** border lines from the rasterized grid as polylines for direct border
   rendering.
7. **Generate** the JFA distance field texture from the rasterized Province-ID grid.
8. **Assign** a unique color to each province for the fill overlay.
9. **Output** the final `data/processed/provinces.json` file containing border polylines,
   province metadata, and color assignments.
10. **Seed** the Supabase `provinces` table with `INSERT INTO provinces` (borders as
    PostGIS geometry, culture mapping, colors).

---

## 6. Province Culture Mapping

| Province | Culture | Major Cities |
|---|---|---|
| Italia | Roman | Roma, Capua, Pompeii |
| Achaea | Greek | Athenae, Korinth, Sparta |
| Asia | Greek | Ephesus, Pergamon, Smyrna |
| Aegyptus | Egyptian | Alexandria, Memphis, Theben |
| Syria | Eastern | Antiochia, Damascus, Palmyra |
| Britannia | Celtic/Roman | Londinium, Aquae Sulis |
| Germania Inferior | Germanic/Roman | Colonia Agrippina |
| Germania Superior | Germanic/Roman | Mogontiacum |
| Gallia Narbonensis | Roman | Massilia, Narbo |
| Gallia Lugdunensis | Celtic/Roman | Lugdunum, Lutetia |
| Gallia Aquitania | Celtic/Roman | Burdigala |
| Gallia Belgica | Celtic/Roman | Augusta Treverorum |
| Hispania Tarraconensis | Roman | Tarraco, Caesaraugusta |
| Baetica | Roman | Corduba, Hispalis |
| Lusitania | Roman | Emerita Augusta |
| Africa Proconsularis | Roman/N.African | Carthago, Leptis Magna |
| Mauretania Caesariensis | North African | Caesarea |
| Mauretania Tingitana | North African | Tingis, Volubilis |
| Dacia | Dacian/Roman | Sarmizegetusa |
| Arabia | Eastern | Petra, Bostra |
| Mesopotamia | Eastern | Ctesiphon |
| Armenia | Eastern | Artaxata |
| Creta et Cyrenaica | Greek | Gortyna, Cyrene |
| Sicilia | Roman/Greek | Syrakus, Panormus |
| Corsica et Sardinia | Roman | Caralis |
| Macedonia | Greek/Roman | Thessalonica |
| Thracia | Greek/Roman | Byzantium |
| Bithynia et Pontus | Greek | Nicomedia, Sinope |
| Cappadocia et Galatia | Eastern/Roman | Ancyra, Caesarea |
| Cilicia et Cyprus | Greek/Eastern | Tarsus, Paphos |
| Dalmatia | Roman | Salona |
| Noricum | Roman/Celtic | Virunum |
| Pannonia Superior | Roman/Celtic | Carnuntum |
| Pannonia Inferior | Roman/Celtic | Aquincum |
| Moesia Superior | Roman | Singidunum |
| Moesia Inferior | Roman/Greek | Tomis |
| Raetia | Roman/Celtic | Augusta Vindelicorum |
| Alpes Cottiae | Roman | Segusio |
| Alpes Graiae et Poeninae | Roman | - |
| Alpes Maritimae | Roman | Cemenelum |
| Assyria | Eastern | Nineveh ruins |

---

## 7. Province Overlay Visibility

Province rendering detail is tied to camera height to avoid visual clutter at close
range and to provide strategic context at high altitude.

| Camera Height | Province Rendering |
|---|---|
| > 3000 (Strategic) | Full fill + borders + names |
| 1000--3000 (Regional) | Borders + names, no fill |
| 300--1000 (Tactical) | Thin border lines only |
| < 300 (Local/Detail) | No province overlay |

### Barbarian Territory (Province-ID 0)

Tiles outside the Roman Empire (Province-ID 0) receive special visual treatment:

- Vertex colors desaturated by 40% and darkened by 25% (baked at mesh generation time)
- Slight blue-gray tint applied
- 10-tile transition zone at empire borders (gradient from full color to desaturated)
- At strategic zoom: these areas appear as "fog of war" -- muted and mysterious
- No province name labels shown for barbarian territory
