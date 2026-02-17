/**
 * City database and 3D renderer for the Roman Empire at 117 AD.
 *
 * Contains ~110 historically accurate cities mapped to a 2048x2048 tile grid
 * and a LOD-aware CityRenderer using InstancedMesh per culture group.
 *
 * Coordinate system:
 *   Longitude 10W..50E  -> tileX 0..2048
 *   Latitude  55N..25N  -> tileY 0..2048
 *   Roma ~(1024, 1000), Alexandria ~(1280, 1245), Londinium ~(870, 580)
 */

import * as THREE from 'three';
import { MAP_SIZE } from '../config';
import type { CityData, CityTier, CultureType } from '../types';
import { BuildingRenderer, generateCityLayout } from './buildingGenerator';
import type { PlacedBuilding } from './buildingGenerator';

// ── Coordinate helpers ──────────────────────────────────────────

/** Convert longitude (-10..50) to tileX (0..2048). */
function lonToTile(lon: number): number {
  return Math.round(((lon + 10) / 60) * MAP_SIZE);
}

/** Convert latitude (55..25, north=top=low tileY) to tileY (0..2048). */
function latToTile(lat: number): number {
  return Math.round(((55 - lat) / 30) * MAP_SIZE);
}

// ── City factory ────────────────────────────────────────────────

function city(
  id: string,
  name: string,
  latinName: string,
  lon: number,
  lat: number,
  tier: CityTier,
  culture: CultureType,
  population: number,
  provinceId: number,
  isPort: boolean,
  isCapital: boolean,
): CityData {
  return {
    id,
    name,
    latinName,
    tileX: lonToTile(lon),
    tileY: latToTile(lat),
    tier,
    culture,
    population,
    provinceId,
    isPort,
    isCapital,
  };
}

// ── CITY DATABASE ───────────────────────────────────────────────

export const CITY_DATABASE: readonly CityData[] = [
  // ────────────────────── TIER 1 (10 cities) ──────────────────────
  city('roma',            'Roma',             'Roma',              12.5,  41.9,  1, 'roman',         1000000, 27, false, true),
  city('alexandria',      'Alexandria',       'Alexandria',        29.9,  31.2,  1, 'egyptian',       500000,  2, true,  true),
  city('antiochia',       'Antiochia',        'Antiochia ad Orontem', 36.2, 36.2, 1, 'eastern',       300000, 40, false, true),
  city('carthago',        'Carthago',         'Carthago',           10.3, 36.85, 1, 'north_african',  300000,  3, true,  true),
  city('athenae',         'Athenae',          'Athenae',            23.7, 37.97, 1, 'greek',          250000,  1, true,  true),
  city('ephesus',         'Ephesus',          'Ephesus',            27.35,37.94, 1, 'greek',          250000,  9, true,  true),
  city('memphis',         'Memphis',          'Memphis',            31.25,29.85, 1, 'egyptian',       200000,  2, false, false),
  city('thebae',          'Thebae',           'Thebae',             32.6, 25.7,  1, 'egyptian',       150000,  2, false, false),
  city('pergamon',        'Pergamon',         'Pergamum',           27.18,39.12, 1, 'greek',          200000,  9, false, false),
  city('leptis_magna',    'Leptis Magna',     'Lepcis Magna',       14.3, 32.64, 1, 'north_african',  150000,  3, true,  false),

  // ────────────────────── TIER 2 (40 cities) ──────────────────────
  city('corinthus',       'Korinth',          'Corinthus',          22.88,37.91, 2, 'greek',          100000,  1, true,  false),
  city('syracusae',       'Syrakus',          'Syracusae',          15.29,37.07, 2, 'greek',          100000, 39, true,  false),
  city('heliopolis',      'Baalbek',          'Heliopolis',         36.2, 34.0,  2, 'levantine',       80000, 40, false, false),
  city('petra',           'Petra',            'Petra',              35.45,30.33, 2, 'eastern',         30000,  7, false, true),
  city('palmyra',         'Palmyra',          'Palmyra',            38.27,34.55, 2, 'eastern',        100000, 40, false, false),
  city('pompeii',         'Pompeii',          'Pompeii',            14.49,40.75, 2, 'roman',           20000, 27, false, false),
  city('timgad',          'Timgad',           'Thamugadi',           6.47,35.48, 2, 'north_african',   30000,  3, false, false),
  city('damascus',        'Damascus',         'Damascus',           36.3, 33.51, 2, 'eastern',        150000, 40, false, false),
  city('caesarea_m',      'Caesarea Maritima', 'Caesarea Maritima', 34.89,32.5,  2, 'levantine',       50000, 40, true,  false),
  city('augusta_trev',    'Augusta Treverorum','Augusta Treverorum', 6.64,49.75, 2, 'celtic',          80000, 21, false, true),
  city('emerita_aug',     'Emerita Augusta',  'Emerita Augusta',    -6.34,38.92, 2, 'roman',           50000, 28, false, true),
  city('londinium',       'Londinium',        'Londinium',           -0.08,51.51,2, 'celtic',           60000, 13, true,  true),
  city('tarraco',         'Tarraco',          'Tarraco',             1.25,41.12, 2, 'roman',            40000, 26, true,  true),
  city('nemausus',        'Nemausus',         'Nemausus',            4.36,43.84, 2, 'celtic',           40000, 23, false, false),
  city('arelate',         'Arelate',          'Arelate',             4.63,43.68, 2, 'celtic',           40000, 23, true,  false),
  city('arausio',         'Arausio',          'Arausio',             4.81,44.14, 2, 'celtic',           30000, 23, false, false),
  city('lugdunum',        'Lugdunum',         'Lugdunum',            4.83,45.76, 2, 'celtic',           60000, 22, false, true),
  city('italica',         'Italica',          'Italica',            -5.98,37.44, 2, 'roman',            10000, 11, false, false),
  city('corduba',         'Corduba',          'Corduba',            -4.78,37.88, 2, 'roman',            50000, 11, false, true),
  city('volubilis',       'Volubilis',        'Volubilis',          -5.55,34.07, 2, 'north_african',    20000, 31, false, false),
  city('djemila',         'Djemila',          'Cuicul',              5.73,36.32, 2, 'north_african',    20000, 30, false, false),
  city('thugga',          'Thugga',           'Thugga',              9.22,36.42, 2, 'north_african',    25000,  3, false, false),
  city('sabratha',        'Sabratha',         'Sabratha',           12.49,32.79, 2, 'north_african',    30000,  3, true,  false),
  city('el_djem',         'El Djem',          'Thysdrus',            10.71,35.3, 2, 'north_african',    30000,  3, false, false),
  city('aspendos',        'Aspendos',         'Aspendos',           31.17,36.94, 2, 'greek',            20000, 15, false, false),
  city('side',            'Side',             'Side',               31.39,36.77, 2, 'greek',            25000, 15, true,  false),
  city('perge',           'Perge',            'Perge',              30.85,36.96, 2, 'greek',            20000, 15, false, false),
  city('aphrodisias',     'Aphrodisias',      'Aphrodisias',        28.72,37.71, 2, 'greek',            15000,  9, false, false),
  city('hierapolis',      'Hierapolis',       'Hierapolis',         29.13,37.93, 2, 'greek',            15000,  9, false, false),
  city('miletus',         'Miletus',          'Miletus',            27.28,37.53, 2, 'greek',            30000,  9, true,  false),
  city('smyrna',          'Smyrna',           'Smyrna',             27.14,38.42, 2, 'greek',            75000,  9, true,  false),
  city('thessalonica',    'Thessalonica',     'Thessalonica',       22.95,40.63, 2, 'greek',            65000, 29, true,  true),
  city('byzantium',       'Byzantium',        'Byzantium',          28.98,41.01, 2, 'greek',            50000, 41, true,  false),
  city('nicomedia',       'Nicomedia',        'Nicomedia',          29.97,40.76, 2, 'greek',            60000, 12, true,  true),
  city('ancyra',          'Ancyra',           'Ancyra',             32.86,39.93, 2, 'eastern',          50000, 14, false, true),
  city('lutetia',         'Lutetia',          'Lutetia',             2.35,48.86, 2, 'celtic',           10000, 22, false, false),
  city('massilia',        'Massilia',         'Massilia',            5.37,43.3,  2, 'greek',            40000, 23, true,  false),
  city('carnuntum',       'Carnuntum',        'Carnuntum',          16.86,48.11, 2, 'celtic',           50000, 37, false, false),
  city('aquincum',        'Aquincum',         'Aquincum',           19.05,47.56, 2, 'celtic',           40000, 36, false, true),
  city('sarmizegetusa',   'Sarmizegetusa',    'Ulpia Traiana Sarmizegetusa', 22.79, 45.52, 2, 'dacian', 30000, 18, false, true),

  // ────────────────────── TIER 3 (60+ cities) ─────────────────────
  city('ostia',           'Ostia',            'Ostia',              12.29,41.76, 3, 'roman',            50000, 27, true,  false),
  city('capua',           'Capua',            'Capua',              14.25,41.1,  3, 'roman',            40000, 27, false, false),
  city('brundisium',      'Brundisium',       'Brundisium',         17.94,40.64, 3, 'roman',            25000, 27, true,  false),
  city('puteoli',         'Puteoli',          'Puteoli',            14.12,40.82, 3, 'roman',            30000, 27, true,  false),
  city('verona',          'Verona',           'Verona',             10.99,45.44, 3, 'roman',            25000, 27, false, false),
  city('mediolanum',      'Mediolanum',       'Mediolanum',          9.19,45.46, 3, 'roman',            40000, 27, false, false),
  city('ravenna',         'Ravenna',          'Ravenna',            12.2, 44.42, 3, 'roman',            25000, 27, true,  false),
  city('aquileia',        'Aquileia',         'Aquileia',           13.37,45.77, 3, 'roman',            30000, 27, true,  false),
  city('gades',           'Gades',            'Gades',              -6.29,36.53, 3, 'roman',            65000, 11, true,  false),
  city('hispalis',        'Hispalis',         'Hispalis',           -5.99,37.39, 3, 'roman',            25000, 11, true,  false),
  city('caesaraugusta',   'Caesaraugusta',    'Caesaraugusta',      -0.88,41.65, 3, 'roman',            25000, 26, false, false),
  city('segovia',         'Segovia',          'Segovia',            -4.12,40.95, 3, 'celtic',           10000, 26, false, false),
  city('conimbriga',      'Conimbriga',       'Conimbriga',         -8.49,40.1,  3, 'celtic',           10000, 28, false, false),
  city('burdigala',       'Burdigala',        'Burdigala',          -0.58,44.84, 3, 'celtic',           25000, 20, true,  false),
  city('augustodunum',    'Autun',            'Augustodunum',        4.3, 46.95, 3, 'celtic',           15000, 22, false, false),
  city('pons_gardi',      'Pont du Gard',     'Pons Gardi',         4.54,43.95, 3, 'roman',             5000, 23, false, false),
  city('vienna',          'Vienna',           'Vienna',              4.87,45.52, 3, 'celtic',           30000, 23, false, false),
  city('colonia_agrip',   'Colonia Agrippina','Colonia Agrippina',   6.96,50.94, 3, 'germanic',         30000, 24, false, true),
  city('mogontiacum',     'Mogontiacum',      'Mogontiacum',         8.27,50.0,  3, 'germanic',         30000, 25, false, true),
  city('augusta_raurica', 'Augusta Raurica',  'Augusta Raurica',     7.72,47.53, 3, 'celtic',           20000, 25, false, false),
  city('vindobona',       'Vindobona',        'Vindobona',          16.37,48.21, 3, 'celtic',           15000, 37, false, false),
  city('salona',          'Salona',           'Salona',             16.48,43.54, 3, 'roman',            60000, 19, true,  true),
  city('singidunum',      'Singidunum',       'Singidunum',         20.46,44.82, 3, 'dacian',           20000, 34, false, false),
  city('tomis',           'Tomis',            'Tomis',              28.65,44.18, 3, 'greek',            30000, 33, true,  false),
  city('cyrene',          'Cyrene',           'Cyrene',             21.86,32.82, 3, 'greek',            25000, 17, false, true),
  city('gortyna',         'Gortyna',          'Gortyna',            24.95,35.06, 3, 'greek',            20000, 17, false, false),
  city('paphos',          'Paphos',           'Paphos',             32.42,34.76, 3, 'greek',            15000, 15, true,  false),
  city('tarsus',          'Tarsus',           'Tarsus',             34.9, 36.92, 3, 'eastern',          30000, 15, false, true),
  city('tyrus',           'Tyrus',            'Tyrus',              35.2, 33.27, 3, 'levantine',        40000, 40, true,  false),
  city('sidon',           'Sidon',            'Sidon',              35.37,33.56, 3, 'levantine',        30000, 40, true,  false),
  city('berytus',         'Berytus',          'Berytus',            35.5, 33.9,  3, 'levantine',        25000, 40, true,  false),
  city('apamea',          'Apamea',           'Apamea',             36.4, 35.42, 3, 'eastern',          20000, 40, false, false),
  city('bostra',          'Bostra',           'Bostra',             36.48,32.52, 3, 'eastern',          20000,  7, false, true),
  city('gerasa',          'Gerasa',           'Gerasa',             35.89,32.28, 3, 'eastern',          20000,  7, false, false),
  city('ctesiphon',       'Ctesiphon',        'Ctesiphon',          44.58,33.1,  3, 'eastern',         250000, 32, false, true),
  city('artaxata',        'Artaxata',         'Artaxata',           44.6, 39.88, 3, 'eastern',          50000,  8, false, true),
  city('tingis',          'Tingis',           'Tingis',             -5.81,35.78, 3, 'north_african',    15000, 31, true,  true),
  city('caesarea_maur',   'Caesarea Mauretaniae','Caesarea Mauretaniae', 2.19, 36.6, 3, 'north_african', 25000, 30, true,  true),
  city('sufetula',        'Sufetula',         'Sufetula',            8.11,35.23, 3, 'north_african',    10000,  3, false, false),
  city('bulla_regia',     'Bulla Regia',      'Bulla Regia',         8.76,36.56, 3, 'north_african',    10000,  3, false, false),
  city('thuburbo_majus',  'Thuburbo Majus',   'Thuburbo Majus',      9.91,36.4,  3, 'north_african',    10000,  3, false, false),
  city('sala',            'Sala',             'Sala Colonia',       -6.8, 34.04, 3, 'north_african',    10000, 31, true,  false),
  city('virunum',         'Virunum',          'Virunum',            14.37,46.72, 3, 'celtic',           15000, 35, false, true),
  city('aug_vindelicorum','Augusta Vindelicorum','Augusta Vindelicorum',10.9,48.37,3,'celtic',           15000, 38, false, true),
  city('segusio',         'Segusio',          'Segusio',             6.96,45.13, 3, 'celtic',            5000,  4, false, false),

  // ─── Additional Tier 3 for geographic density ───────────────────
  city('neapolis',        'Neapolis',         'Neapolis',           14.25,40.85, 3, 'roman',           100000, 27, true,  false),
  city('panormus',        'Panormus',         'Panormus',           13.36,38.12, 3, 'roman',            30000, 39, true,  false),
  city('nicaea',          'Nicaea',           'Nicaea',             29.72,40.43, 3, 'greek',            25000, 12, false, false),
  city('trapezus',        'Trapezus',         'Trapezus',           39.72,41.0,  3, 'greek',            20000, 14, true,  false),
  city('caesarea_capp',   'Caesarea Cappadociae','Caesarea Cappadociae',35.48,38.73,3,'eastern',         30000, 14, false, true),
  city('samosata',        'Samosata',         'Samosata',           38.48,37.48, 3, 'eastern',          15000, 40, false, false),
  city('nisibis',         'Nisibis',          'Nisibis',            41.22,37.07, 3, 'eastern',          20000, 32, false, false),
  city('edessa',          'Edessa',           'Edessa',             38.79,37.15, 3, 'eastern',          25000, 32, false, false),
  city('hierusalem',      'Hierusalem',       'Aelia Capitolina',   35.23,31.77, 3, 'levantine',        30000, 40, false, false),
  city('joppa',           'Joppa',            'Joppa',              34.75,32.05, 3, 'levantine',        10000, 40, true,  false),
  city('gaza',            'Gaza',             'Gaza',               34.47,31.5,  3, 'levantine',        15000, 40, true,  false),
  city('pelusium',        'Pelusium',         'Pelusium',           32.55,31.03, 3, 'egyptian',         20000,  2, true,  false),
  city('philae',          'Philae',           'Philae',             32.88,24.02, 3, 'egyptian',         10000,  2, false, false),
  city('dyrrachium',      'Dyrrachium',       'Dyrrachium',         19.45,41.32, 3, 'roman',            25000, 29, true,  false),
  city('nicopolis',       'Nicopolis',        'Nicopolis ad Istrum', 25.61, 43.22, 3, 'greek',          15000, 33, false, false),
  city('philippopolis',   'Philippopolis',    'Philippopolis',      24.75,42.15, 3, 'greek',            20000, 41, false, true),
  city('serdica',         'Serdica',          'Serdica',            23.32,42.7,  3, 'dacian',           15000, 41, false, false),
] as const;

// ── Culture color map ───────────────────────────────────────────

const CULTURE_COLORS: Readonly<Record<CultureType, number>> = {
  roman:          0xC2A255,
  greek:          0x6F8BBF,
  egyptian:       0xD4A855,
  eastern:        0x55A5A5,
  celtic:         0x5A8A3C,
  germanic:       0x8A6A4A,
  north_african:  0xD49A61,
  dacian:         0x6A5A4A,
  levantine:      0x7A9AAA,
};

// ── Tier marker sizes (world units) ─────────────────────────────

const TIER_SIZES: Readonly<Record<CityTier, number>> = {
  1: 30,
  2: 20,
  3: 14,
  4: 8,
};

// ── LOD zone thresholds ─────────────────────────────────────────

const STRATEGIC_HEIGHT = 1500;
const TACTICAL_HEIGHT = 300;
const TACTICAL_RANGE = 2000;
const DETAIL_RANGE = 500;
const MARKER_Y = 72;
const HALF_MAP = MAP_SIZE / 2;

// ── View zone enum ──────────────────────────────────────────────

const enum ViewZone {
  Strategic = 0,
  Tactical = 1,
  Detail = 2,
}

// ── Shared geometry builders ────────────────────────────────────

function createDiamondGeometry(size: number): THREE.BufferGeometry {
  const hs = size / 2;
  const verts = new Float32Array([
    0,  hs, 0,    // top
    -hs, 0, 0,    // left
    0,  0,  hs,   // front
    hs,  0, 0,    // right
    0,  0, -hs,   // back
    0, -hs, 0,    // bottom
  ]);
  const indices = new Uint16Array([
    0, 1, 2,   0, 2, 3,   0, 3, 4,   0, 4, 1,
    5, 2, 1,   5, 3, 2,   5, 4, 3,   5, 1, 4,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

function createOctahedronGeometry(size: number): THREE.BufferGeometry {
  return new THREE.OctahedronGeometry(size / 2, 0);
}

// ── Per-culture instanced mesh set ──────────────────────────────

interface CultureMeshSet {
  readonly culture: CultureType;
  readonly color: THREE.Color;
  readonly cities: readonly CityData[];
  strategicMesh: THREE.InstancedMesh | null;
  tacticalMesh: THREE.InstancedMesh | null;
  glowLines: THREE.InstancedMesh | null;
}

// ── CityRenderer ────────────────────────────────────────────────

export class CityRenderer {
  private readonly group: THREE.Group;
  private readonly scene: THREE.Scene;
  private readonly cultureSets: ReadonlyMap<CultureType, CultureMeshSet>;
  private readonly cityWorldPositions: ReadonlyMap<string, THREE.Vector3>;
  private readonly allCities: readonly CityData[];

  /** Building renderer for detail view. */
  private readonly buildingRenderer: BuildingRenderer;
  /** Cached building layouts per city (generated once). */
  private readonly buildingLayouts: Map<string, PlacedBuilding[]> = new Map();
  /** Whether buildings are currently shown. */
  private buildingsVisible = false;

  /** Reusable objects to avoid per-frame allocation. */
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _vec3 = new THREE.Vector3();

  /** Tracks which view zone we last built meshes for. */
  private currentZone: ViewZone | null = null;
  private lastCameraX = Number.NaN;
  private lastCameraZ = Number.NaN;

  /** Shared geometries (created once, reused). */
  private readonly diamondGeos: ReadonlyMap<CityTier, THREE.BufferGeometry>;
  private readonly octaGeos: ReadonlyMap<CityTier, THREE.BufferGeometry>;
  private readonly glowGeo: THREE.BufferGeometry;
  private readonly strategicMaterial: THREE.MeshBasicMaterial;
  private readonly tacticalMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'CityMarkers';
    this.scene.add(this.group);

    this.allCities = CITY_DATABASE;
    this.buildingRenderer = new BuildingRenderer(scene);

    // Pre-compute world positions
    const positions = new Map<string, THREE.Vector3>();
    for (const c of this.allCities) {
      positions.set(c.id, new THREE.Vector3(
        c.tileX - HALF_MAP,
        MARKER_Y,
        c.tileY - HALF_MAP,
      ));
    }
    this.cityWorldPositions = positions;

    // Build per-culture city groupings
    const cultureMap = new Map<CultureType, CityData[]>();
    for (const c of this.allCities) {
      const arr = cultureMap.get(c.culture);
      if (arr) {
        arr.push(c);
      } else {
        cultureMap.set(c.culture, [c]);
      }
    }

    const sets = new Map<CultureType, CultureMeshSet>();
    for (const [culture, cities] of cultureMap) {
      const colorHex = CULTURE_COLORS[culture];
      sets.set(culture, {
        culture,
        color: new THREE.Color(colorHex),
        cities,
        strategicMesh: null,
        tacticalMesh: null,
        glowLines: null,
      });
    }
    this.cultureSets = sets;

    // Create shared geometries per tier
    const dGeos = new Map<CityTier, THREE.BufferGeometry>();
    const oGeos = new Map<CityTier, THREE.BufferGeometry>();
    const tiers: readonly CityTier[] = [1, 2, 3, 4];
    for (const t of tiers) {
      const size = TIER_SIZES[t];
      dGeos.set(t, createDiamondGeometry(size));
      oGeos.set(t, createOctahedronGeometry(size));
    }
    this.diamondGeos = dGeos;
    this.octaGeos = oGeos;

    // Glow line geometry (thin tall cylinder)
    this.glowGeo = new THREE.CylinderGeometry(0.8, 0.8, 60, 4);

    // Materials
    this.strategicMaterial = new THREE.MeshBasicMaterial({
      vertexColors: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: true,
    });

    this.tacticalMaterial = new THREE.MeshStandardMaterial({
      vertexColors: false,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    });

    this.glowMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  // ── Public API ──────────────────────────────────────────────

  update(cameraHeight: number, cameraX: number, cameraZ: number): void {
    const zone = cameraHeight > STRATEGIC_HEIGHT
      ? ViewZone.Strategic
      : cameraHeight > TACTICAL_HEIGHT
        ? ViewZone.Tactical
        : ViewZone.Detail;

    const cameraMoved = Math.abs(cameraX - this.lastCameraX) > 50
      || Math.abs(cameraZ - this.lastCameraZ) > 50;

    if (zone !== this.currentZone) {
      this.rebuildMeshes(zone, cameraX, cameraZ);
      this.updateBuildings(zone, cameraX, cameraZ);
      this.currentZone = zone;
      this.lastCameraX = cameraX;
      this.lastCameraZ = cameraZ;
    } else if (zone !== ViewZone.Strategic && cameraMoved) {
      this.updateInstanceVisibility(zone, cameraX, cameraZ);
      if (zone === ViewZone.Detail) {
        this.updateBuildings(zone, cameraX, cameraZ);
      }
      this.lastCameraX = cameraX;
      this.lastCameraZ = cameraZ;
    }
  }

  /**
   * Show/hide building clusters based on zoom level and camera position.
   */
  private updateBuildings(zone: ViewZone, cameraX: number, cameraZ: number): void {
    if (zone !== ViewZone.Detail) {
      if (this.buildingsVisible) {
        this.buildingRenderer.setVisible(false);
        this.buildingsVisible = false;
      }
      return;
    }

    // Collect buildings for nearby cities
    const allBuildings: PlacedBuilding[] = [];
    const rangeSq = DETAIL_RANGE * DETAIL_RANGE;

    for (const c of this.allCities) {
      const pos = this.cityWorldPositions.get(c.id);
      if (!pos) continue;
      const dx = pos.x - cameraX;
      const dz = pos.z - cameraZ;
      if (dx * dx + dz * dz > rangeSq) continue;

      // Get or generate layout
      let layout = this.buildingLayouts.get(c.id);
      if (!layout) {
        layout = generateCityLayout(
          c.id, c.tier, c.culture,
          pos.x, pos.z, MARKER_Y,
        );
        this.buildingLayouts.set(c.id, layout);
      }

      allBuildings.push(...layout);
    }

    this.buildingRenderer.rebuild(allBuildings);
    this.buildingRenderer.setVisible(true);
    this.buildingsVisible = true;
  }

  raycast(raycaster: THREE.Raycaster): CityData | null {
    const intersections: THREE.Intersection[] = [];
    this.group.raycast(raycaster, intersections);

    if (intersections.length === 0) {
      return null;
    }

    // Find closest intersection
    let closest: THREE.Intersection | undefined;
    for (const hit of intersections) {
      if (!closest || hit.distance < closest.distance) {
        closest = hit;
      }
    }

    if (!closest) {
      return null;
    }

    // Walk up to find the InstancedMesh and get instance ID
    const mesh = closest.object;
    if (mesh instanceof THREE.InstancedMesh && closest.instanceId !== undefined) {
      const cityData = mesh.userData['cityMap'] as Record<number, CityData> | undefined;
      if (cityData) {
        const city = cityData[closest.instanceId];
        return city ?? null;
      }
    }

    return null;
  }

  dispose(): void {
    this.clearAllMeshes();
    this.buildingRenderer.dispose();

    // Dispose shared geometries
    for (const [, geo] of this.diamondGeos) {
      geo.dispose();
    }
    for (const [, geo] of this.octaGeos) {
      geo.dispose();
    }
    this.glowGeo.dispose();

    // Dispose shared materials
    this.strategicMaterial.dispose();
    this.tacticalMaterial.dispose();
    this.glowMaterial.dispose();

    this.scene.remove(this.group);
  }

  // ── Internal mesh management ────────────────────────────────

  private clearAllMeshes(): void {
    for (const [, set] of this.cultureSets) {
      this.disposeInstancedMesh(set.strategicMesh);
      this.disposeInstancedMesh(set.tacticalMesh);
      this.disposeInstancedMesh(set.glowLines);
      (set as { strategicMesh: THREE.InstancedMesh | null }).strategicMesh = null;
      (set as { tacticalMesh: THREE.InstancedMesh | null }).tacticalMesh = null;
      (set as { glowLines: THREE.InstancedMesh | null }).glowLines = null;
    }
    // Remove all children from group
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      if (child) {
        this.group.remove(child);
      }
    }
  }

  private disposeInstancedMesh(mesh: THREE.InstancedMesh | null): void {
    if (mesh) {
      // Geometry is shared, don't dispose it here
      // Material is shared, don't dispose it here
      if (mesh.parent) {
        mesh.parent.remove(mesh);
      }
    }
  }

  private rebuildMeshes(zone: ViewZone, cameraX: number, cameraZ: number): void {
    this.clearAllMeshes();

    for (const [, set] of this.cultureSets) {
      const filteredCities = this.filterCitiesByZone(set.cities, zone, cameraX, cameraZ);
      if (filteredCities.length === 0) continue;

      switch (zone) {
        case ViewZone.Strategic:
          this.buildStrategicMeshes(set, filteredCities);
          break;
        case ViewZone.Tactical:
          this.buildTacticalMeshes(set, filteredCities);
          break;
        case ViewZone.Detail:
          this.buildDetailMeshes(set, filteredCities);
          break;
      }
    }
  }

  private filterCitiesByZone(
    cities: readonly CityData[],
    zone: ViewZone,
    cameraX: number,
    cameraZ: number,
  ): CityData[] {
    if (zone === ViewZone.Strategic) {
      // Show all cities at strategic zoom
      return [...cities];
    }

    const range = zone === ViewZone.Tactical ? TACTICAL_RANGE : DETAIL_RANGE;
    const rangeSq = range * range;

    const result: CityData[] = [];
    for (const c of cities) {
      const pos = this.cityWorldPositions.get(c.id);
      if (!pos) continue;
      const dx = pos.x - cameraX;
      const dz = pos.z - cameraZ;
      if (dx * dx + dz * dz <= rangeSq) {
        result.push(c);
      }
    }
    return result;
  }

  private buildStrategicMeshes(set: CultureMeshSet, cities: readonly CityData[]): void {
    // Group cities by tier for correct geometry sizing
    const byTier = this.groupByTier(cities);

    for (const [tier, tierCities] of byTier) {
      if (tierCities.length === 0) continue;

      const geo = this.diamondGeos.get(tier);
      if (!geo) continue;

      const mat = this.strategicMaterial.clone();
      mat.color.copy(set.color);

      const mesh = new THREE.InstancedMesh(geo, mat, tierCities.length);
      mesh.frustumCulled = false;

      const cityMap: Record<number, CityData> = {};

      for (let i = 0; i < tierCities.length; i++) {
        const c = tierCities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        mesh.setMatrixAt(i, this._mat4);
        cityMap[i] = c;
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData['cityMap'] = cityMap;
      mesh.userData['culture'] = set.culture;

      this.group.add(mesh);

      // Store only the last tier mesh reference (the renderer mainly
      // needs the group for raycasting; individual references are
      // for potential future optimisations).
      (set as { strategicMesh: THREE.InstancedMesh | null }).strategicMesh = mesh;
    }
  }

  private buildTacticalMeshes(set: CultureMeshSet, cities: readonly CityData[]): void {
    const byTier = this.groupByTier(cities);

    for (const [tier, tierCities] of byTier) {
      if (tierCities.length === 0) continue;

      const geo = this.octaGeos.get(tier);
      if (!geo) continue;

      // Octahedron marker mesh
      const markerMat = this.tacticalMaterial.clone();
      markerMat.color.copy(set.color);

      const mesh = new THREE.InstancedMesh(geo, markerMat, tierCities.length);
      mesh.frustumCulled = false;

      const cityMap: Record<number, CityData> = {};

      for (let i = 0; i < tierCities.length; i++) {
        const c = tierCities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        mesh.setMatrixAt(i, this._mat4);
        cityMap[i] = c;
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData['cityMap'] = cityMap;
      mesh.userData['culture'] = set.culture;

      this.group.add(mesh);
      (set as { tacticalMesh: THREE.InstancedMesh | null }).tacticalMesh = mesh;
    }

    // Glow lines for all cities in this culture set
    if (cities.length > 0) {
      const glowMat = this.glowMaterial.clone();
      glowMat.color.copy(set.color);

      const glowMesh = new THREE.InstancedMesh(this.glowGeo, glowMat, cities.length);
      glowMesh.frustumCulled = false;
      glowMesh.raycast = () => { /* glow lines are not pickable */ };

      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y + 30, pos.z);
        glowMesh.setMatrixAt(i, this._mat4);
      }

      glowMesh.instanceMatrix.needsUpdate = true;
      this.group.add(glowMesh);
      (set as { glowLines: THREE.InstancedMesh | null }).glowLines = glowMesh;
    }
  }

  private buildDetailMeshes(set: CultureMeshSet, cities: readonly CityData[]): void {
    // In detail view use the octahedron geometry scaled up slightly
    const byTier = this.groupByTier(cities);

    for (const [tier, tierCities] of byTier) {
      if (tierCities.length === 0) continue;

      const geo = this.octaGeos.get(tier);
      if (!geo) continue;

      const mat = this.tacticalMaterial.clone();
      mat.color.copy(set.color);
      mat.opacity = 1.0;

      const mesh = new THREE.InstancedMesh(geo, mat, tierCities.length);
      mesh.frustumCulled = false;

      const cityMap: Record<number, CityData> = {};
      const scaleFactor = 1.5;

      for (let i = 0; i < tierCities.length; i++) {
        const c = tierCities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        this._mat4.scale(this._vec3.set(scaleFactor, scaleFactor, scaleFactor));
        mesh.setMatrixAt(i, this._mat4);
        cityMap[i] = c;
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData['cityMap'] = cityMap;
      mesh.userData['culture'] = set.culture;

      this.group.add(mesh);
      (set as { tacticalMesh: THREE.InstancedMesh | null }).tacticalMesh = mesh;
    }

    // Glow lines in detail view too
    if (cities.length > 0) {
      const glowMat = this.glowMaterial.clone();
      glowMat.color.copy(set.color);
      glowMat.opacity = 0.6;

      const glowMesh = new THREE.InstancedMesh(this.glowGeo, glowMat, cities.length);
      glowMesh.frustumCulled = false;
      glowMesh.raycast = () => { /* not pickable */ };

      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y + 30, pos.z);
        glowMesh.setMatrixAt(i, this._mat4);
      }

      glowMesh.instanceMatrix.needsUpdate = true;
      this.group.add(glowMesh);
      (set as { glowLines: THREE.InstancedMesh | null }).glowLines = glowMesh;
    }
  }

  private updateInstanceVisibility(
    zone: ViewZone,
    cameraX: number,
    cameraZ: number,
  ): void {
    // Rebuild meshes with new camera position for range filtering
    this.rebuildMeshes(zone, cameraX, cameraZ);
  }

  // ── Utilities ───────────────────────────────────────────────

  private groupByTier(cities: readonly CityData[]): Map<CityTier, CityData[]> {
    const map = new Map<CityTier, CityData[]>();
    for (const c of cities) {
      const arr = map.get(c.tier);
      if (arr) {
        arr.push(c);
      } else {
        map.set(c.tier, [c]);
      }
    }
    return map;
  }
}
