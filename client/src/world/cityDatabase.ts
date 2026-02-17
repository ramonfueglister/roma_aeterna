/**
 * City database and 3D renderer for the Roman Empire at 117 AD.
 *
 * Contains 312 historically accurate cities mapped to a 2048x2048 tile grid
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

  // ────────────────────── TIER 3 (80 new cities) ─────────────────────

  // Britannia
  city('eboracum',        'Eboracum',         'Eboracum',           -1.08,53.96, 3, 'celtic',           15000, 13, false, false),
  city('camulodunum',     'Camulodunum',      'Camulodunum',         0.9, 51.89, 3, 'celtic',           15000, 13, false, false),
  city('verulamium',      'Verulamium',        'Verulamium',         -0.34,51.75, 3, 'celtic',           12000, 13, false, false),
  city('glevum',          'Glevum',           'Glevum',             -2.24,51.87, 3, 'celtic',           10000, 13, false, false),
  city('isca_silurum',    'Isca Silurum',     'Isca Silurum',       -2.97,51.59, 3, 'celtic',            8000, 13, false, false),
  city('deva_victrix',    'Deva Victrix',     'Deva Victrix',       -2.89,53.19, 3, 'celtic',           10000, 13, false, false),
  city('lindum',          'Lindum',           'Lindum Colonia',     -0.54,53.23, 3, 'celtic',           10000, 13, false, false),
  city('aquae_sulis',     'Aquae Sulis',      'Aquae Sulis',        -2.36,51.38, 3, 'celtic',            8000, 13, false, false),

  // Hispania
  city('carthago_nova',   'Carthago Nova',    'Carthago Nova',      -0.99,37.6,  3, 'roman',            30000, 26, true,  false),
  city('asturica_aug',    'Asturica Augusta', 'Asturica Augusta',   -6.06,42.46, 3, 'celtic',           12000, 26, false, false),
  city('bracara_aug',     'Bracara Augusta',  'Bracara Augusta',    -8.43,41.55, 3, 'celtic',           20000, 26, false, false),
  city('toletum',         'Toletum',          'Toletum',            -4.02,39.86, 3, 'celtic',           15000, 26, false, false),
  city('valentia',        'Valentia',         'Valentia Edetanorum',-0.38,39.47, 3, 'roman',            15000, 26, true,  false),
  city('lucus_augusti',   'Lucus Augusti',    'Lucus Augusti',      -7.55,43.01, 3, 'celtic',           10000, 26, false, false),
  city('pax_julia',       'Pax Julia',        'Pax Julia',          -7.86,38.02, 3, 'roman',             8000, 28, false, false),
  city('olisipo',         'Olisipo',          'Olisipo Felicitas Julia', -9.14, 38.72, 3, 'roman',      20000, 28, true,  false),

  // Gaul
  city('augustonemetum',  'Augustonemetum',   'Augustonemetum',      3.08,45.78, 3, 'celtic',           15000, 20, false, true),
  city('avaricum',        'Avaricum',         'Avaricum',            2.4, 47.08, 3, 'celtic',           15000, 20, false, false),
  city('cenabum',         'Cenabum',          'Cenabum',             1.9, 47.9,  3, 'celtic',           10000, 22, false, false),
  city('durocortorum',    'Durocortorum',     'Durocortorum',        3.93,49.25, 3, 'celtic',           20000, 21, false, true),
  city('samarobriva',     'Samarobriva',      'Samarobriva',         2.3, 49.89, 3, 'celtic',           15000, 21, false, false),
  city('gesoriacum',      'Gesoriacum',       'Gesoriacum',          1.61,50.73, 3, 'celtic',           10000, 21, true,  false),
  city('vesontio',        'Vesontio',         'Vesontio',            6.02,47.24, 3, 'celtic',           15000, 25, false, false),
  city('augustodunum_b',  'Augustobona',      'Augustobona Tricassium', 4.07, 48.3, 3, 'celtic',        8000, 22, false, false),
  city('mediolanum_sant', 'Mediolanum Santonum','Mediolanum Santonum',-0.63,45.75, 3, 'celtic',         12000, 20, false, false),

  // Africa
  city('hadrumetum',      'Hadrumetum',       'Hadrumetum',         10.6, 35.83, 3, 'north_african',    30000,  3, true,  false),
  city('hippo_regius',    'Hippo Regius',     'Hippo Regius',        7.77,36.88, 3, 'north_african',    20000,  3, true,  false),
  city('lambaesis',       'Lambaesis',        'Lambaesis',           6.26,35.49, 3, 'north_african',    20000,  3, false, false),
  city('cirta',           'Cirta',            'Cirta',               6.61,36.37, 3, 'north_african',    25000, 30, false, false),
  city('sitifis',         'Sitifis',          'Sitifis',             5.41,36.19, 3, 'north_african',    15000, 30, false, false),
  city('theveste',        'Theveste',         'Theveste',            8.12,35.4,  3, 'north_african',    12000,  3, false, false),
  city('madauros',        'Madauros',         'Madauros',            7.62,36.28, 3, 'north_african',    10000,  3, false, false),
  city('iol_caesarea',    'Iol Caesarea',     'Iol Caesarea',        2.44,36.52, 3, 'north_african',    20000, 30, true,  false),
  city('icosium',         'Icosium',          'Icosium',             3.06,36.77, 3, 'north_african',    12000, 30, true,  false),
  city('tipasa',          'Tipasa',           'Tipasa',              2.45,36.59, 3, 'north_african',    10000, 30, true,  false),

  // Asia Minor
  city('sardis',          'Sardis',           'Sardis',             28.04,38.48, 3, 'greek',            25000,  9, false, false),
  city('antiocheia_pis',  'Antiocheia Pisidiae','Antiocheia Pisidiae',31.2,38.3, 3, 'greek',            15000, 14, false, false),
  city('iconium',         'Iconium',          'Iconium',            32.49,37.87, 3, 'eastern',          20000, 14, false, false),
  city('laodicea_phryg',  'Laodicea ad Lycum','Laodicea ad Lycum', 29.11,37.84, 3, 'greek',            20000,  9, false, false),
  city('attalia',         'Attalia',          'Attalia',            30.69,36.89, 3, 'greek',            20000, 15, true,  false),
  city('sinope',          'Sinope',           'Sinope',             35.15,42.03, 3, 'greek',            20000, 12, true,  false),
  city('amaseia',         'Amaseia',          'Amaseia',            35.83,40.65, 3, 'eastern',          15000, 12, false, false),
  city('cyzicus',         'Cyzicus',          'Cyzicus',            27.88,40.39, 3, 'greek',            25000,  9, true,  false),
  city('halicarnassus',   'Halicarnassus',    'Halicarnassus',      27.42,37.04, 3, 'greek',            15000,  9, true,  false),
  city('prusa',           'Prusa ad Olympum', 'Prusa ad Olympum',   29.06,40.18, 3, 'greek',            15000, 12, false, false),

  // Danube provinces
  city('mursa',           'Mursa',            'Mursa',              18.69,45.56, 3, 'celtic',           15000, 36, false, false),
  city('poetovio',        'Poetovio',         'Poetovio',           15.87,46.4,  3, 'celtic',           15000, 37, false, false),
  city('naissus',         'Naissus',          'Naissus',            21.9, 43.32, 3, 'dacian',           15000, 34, false, false),
  city('apulum',          'Apulum',           'Apulum',             23.57,46.07, 3, 'dacian',           15000, 18, false, false),
  city('napoca',          'Napoca',           'Napoca',             23.6, 46.77, 3, 'dacian',           10000, 18, false, false),
  city('oescus',          'Oescus',           'Oescus',             24.47,43.7,  3, 'dacian',           12000, 33, false, false),
  city('durostorum',      'Durostorum',       'Durostorum',         27.28,44.12, 3, 'dacian',           12000, 33, false, false),
  city('ratiaria',        'Ratiaria',         'Ratiaria',           22.63,43.82, 3, 'dacian',           10000, 34, false, false),
  city('siscia',          'Siscia',           'Siscia',             16.37,45.49, 3, 'celtic',           15000, 37, false, false),

  // Egypt
  city('ptolemais_theb',  'Ptolemais Thebaid','Ptolemais Hermiou', 31.8, 26.47, 3, 'egyptian',         20000,  2, false, false),
  city('oxyrhynchus',     'Oxyrhynchus',      'Oxyrhynchus',       30.66,28.54, 3, 'egyptian',         15000,  2, false, false),
  city('arsinoe_fayum',   'Arsinoe',          'Arsinoe',           30.84,29.31, 3, 'egyptian',         20000,  2, false, false),

  // Syria / Levant
  city('emesa',           'Emesa',            'Emesa',              36.72,34.73, 3, 'eastern',          30000, 40, false, false),
  city('laodicea_syr',    'Laodicea ad Mare', 'Laodicea ad Mare',   35.78,35.52, 3, 'eastern',          20000, 40, true,  false),
  city('aradus',          'Aradus',           'Aradus',             35.85,34.85, 3, 'levantine',        12000, 40, true,  false),
  city('byblos',          'Byblos',           'Byblos',             35.65,34.12, 3, 'levantine',        15000, 40, true,  false),
  city('tripolis_syr',    'Tripolis',         'Tripolis',           35.84,34.44, 3, 'levantine',        15000, 40, true,  false),

  // Arabia / Mesopotamia
  city('philadelphia_am', 'Philadelphia',     'Philadelphia',       35.93,31.95, 3, 'eastern',          15000,  7, false, false),
  city('hatra',           'Hatra',            'Hatra',              42.72,35.59, 3, 'eastern',          20000, 32, false, false),
  city('dura_europos',    'Dura-Europos',     'Dura-Europos',       40.73,34.75, 3, 'eastern',          15000, 32, false, false),
  city('singara',         'Singara',          'Singara',            41.85,36.32, 3, 'eastern',          10000, 32, false, false),

  // Greece / Macedonia
  city('patrae',          'Patrae',           'Patrae',             21.73,38.25, 3, 'greek',            15000,  1, true,  false),
  city('sparta',          'Sparta',           'Sparta',             22.43,37.08, 3, 'greek',            10000,  1, false, false),
  city('larissa',         'Larissa',          'Larissa',            22.42,39.64, 3, 'greek',            12000,  1, false, false),
  city('stobi',           'Stobi',            'Stobi',              21.97,41.55, 3, 'greek',            12000, 29, false, false),

  // Italia
  city('beneventum',      'Beneventum',       'Beneventum',         14.78,41.13, 3, 'roman',            20000, 27, false, false),
  city('tarentum',        'Tarentum',         'Tarentum',           17.23,40.47, 3, 'roman',            20000, 27, true,  false),
  city('bononia',         'Bononia',          'Bononia',            11.34,44.49, 3, 'roman',            20000, 27, false, false),
  city('patavium',        'Patavium',         'Patavium',           11.88,45.41, 3, 'roman',            25000, 27, false, false),
  city('genua',           'Genua',            'Genua',               8.93,44.41, 3, 'roman',            15000, 27, true,  false),

  // Creta
  city('knossos',         'Knossos',          'Knossos',            25.16,35.3,  3, 'greek',            12000, 17, false, false),

  // ────────────────────── TIER 4 (120 new cities) ────────────────────

  // Britannia
  city('calleva',         'Calleva',          'Calleva Atrebatum',  -1.09,51.35, 4, 'celtic',            5000, 13, false, false),
  city('durovernum',      'Durovernum',       'Durovernum Cantiacorum', 1.08, 51.28, 4, 'celtic',        5000, 13, false, false),
  city('venta_belgarum',  'Venta Belgarum',   'Venta Belgarum',     -1.31,51.06, 4, 'celtic',            4000, 13, false, false),
  city('corinium',        'Corinium',         'Corinium Dobunnorum',-1.97,51.71, 4, 'celtic',            5000, 13, false, false),
  city('ratae',           'Ratae',            'Ratae Corieltauvorum', -1.13, 52.63, 4, 'celtic',         3000, 13, false, false),
  city('viroconium',      'Viroconium',       'Viroconium Cornoviorum', -2.66, 52.67, 4, 'celtic',       5000, 13, false, false),
  city('isurium',         'Isurium',          'Isurium Brigantum',  -1.4, 54.1,  4, 'celtic',            3000, 13, false, false),
  city('luguvallium',     'Luguvallium',      'Luguvallium',        -2.94,54.89, 4, 'celtic',            3000, 13, false, false),

  // Hispania
  city('barcino',         'Barcino',          'Barcino',             2.17,41.38, 4, 'roman',            10000, 26, true,  false),
  city('saguntum',        'Saguntum',         'Saguntum',           -0.27,39.68, 4, 'roman',             6000, 26, false, false),
  city('clunia',          'Clunia',           'Clunia',             -3.37,41.78, 4, 'celtic',            5000, 26, false, false),
  city('numantia',        'Numantia',         'Numantia',           -2.44,41.81, 4, 'celtic',            3000, 26, false, false),
  city('complutum',       'Complutum',        'Complutum',          -3.38,40.48, 4, 'celtic',            5000, 26, false, false),
  city('salmantica',      'Salmantica',       'Salmantica',         -5.66,40.97, 4, 'celtic',            5000, 28, false, false),
  city('norba_caesarina', 'Norba Caesarina',  'Norba Caesarina',    -6.37,39.47, 4, 'roman',             5000, 28, false, false),
  city('myrtilis',        'Myrtilis',         'Myrtilis',           -7.66,37.64, 4, 'roman',             4000, 28, false, false),
  city('ebora',           'Ebora',            'Ebora Liberalitas Julia', -7.91, 38.57, 4, 'roman',       5000, 28, false, false),
  city('munigua',         'Munigua',          'Munigua',            -5.72,37.68, 4, 'roman',             4000, 11, false, false),
  city('baelo_claudia',   'Baelo Claudia',    'Baelo Claudia',      -5.77,36.09, 4, 'roman',             5000, 11, true,  false),
  city('astigis',         'Astigis',          'Astigis',            -5.08,37.54, 4, 'roman',             8000, 11, false, false),

  // Gaul
  city('rotomagus',       'Rotomagus',        'Rotomagus',           1.1, 49.44, 4, 'celtic',            8000, 22, false, false),
  city('juliomagus',      'Juliomagus',       'Juliomagus',         -0.55,47.47, 4, 'celtic',            6000, 22, false, false),
  city('condate_ren',     'Condate',          'Condate Redonum',    -1.68,48.11, 4, 'celtic',            5000, 22, false, false),
  city('darioritum',      'Darioritum',       'Darioritum',         -2.76,47.65, 4, 'celtic',            4000, 22, false, false),
  city('divona',          'Divona',           'Divona Cadurcorum',   1.44,44.45, 4, 'celtic',            5000, 20, false, false),
  city('elusa',           'Elusa',            'Elusa',               0.09,43.7,  4, 'celtic',            5000, 20, false, false),
  city('tolosa',          'Tolosa',           'Tolosa',              1.44,43.6,  4, 'celtic',           15000, 23, false, false),
  city('narbo_martius',   'Narbo Martius',    'Narbo Martius',       3.0, 43.18, 4, 'roman',            20000, 23, true,  true),
  city('carcaso',         'Carcaso',          'Carcaso',             2.35,43.21, 4, 'celtic',            5000, 23, false, false),
  city('antipolis',       'Antipolis',        'Antipolis',           7.12,43.58, 4, 'celtic',            5000,  6, true,  false),
  city('forum_julii',     'Forum Julii',      'Forum Julii',        6.74,43.43, 4, 'roman',             8000, 23, true,  false),
  city('aquae_sextiae',   'Aquae Sextiae',    'Aquae Sextiae',      5.45,43.53, 4, 'celtic',            8000, 23, false, false),
  city('aventicum',       'Aventicum',        'Aventicum',           7.04,46.88, 4, 'celtic',            8000, 25, false, false),
  city('bagacum',         'Bagacum',          'Bagacum Nerviorum',   3.79,50.35, 4, 'celtic',            5000, 21, false, false),
  city('divodurum',       'Divodurum',        'Divodurum',           6.18,49.12, 4, 'celtic',            8000, 21, false, false),
  city('argentorate',     'Argentorate',      'Argentorate',         7.75,48.58, 4, 'germanic',         10000, 25, false, false),

  // Germania
  city('castra_vetera',   'Castra Vetera',    'Castra Vetera',       6.46,51.65, 4, 'germanic',          5000, 24, false, false),
  city('novaesium',       'Novaesium',        'Novaesium',           6.69,51.2,  4, 'germanic',          5000, 24, false, false),
  city('bonna',           'Bonna',            'Bonna',               7.1, 50.73, 4, 'germanic',          5000, 24, false, false),
  city('confluentes',     'Confluentes',      'Confluentes',         7.6, 50.36, 4, 'germanic',          4000, 25, false, false),

  // Italia (additional)
  city('ariminum',        'Ariminum',         'Ariminum',           12.57,44.06, 4, 'roman',            12000, 27, true,  false),
  city('florentia',       'Florentia',        'Florentia',          11.25,43.77, 4, 'roman',            10000, 27, false, false),
  city('pisae',           'Pisae',            'Pisae',              10.4, 43.72, 4, 'roman',             8000, 27, true,  false),
  city('perusia',         'Perusia',          'Perusia',            12.39,43.11, 4, 'roman',             8000, 27, false, false),
  city('spoletium',       'Spoletium',        'Spoletium',          12.74,42.73, 4, 'roman',             5000, 27, false, false),
  city('ancona',          'Ancona',           'Ancona',             13.52,43.62, 4, 'roman',             8000, 27, true,  false),
  city('luceria',         'Luceria',          'Luceria',            15.34,41.51, 4, 'roman',             5000, 27, false, false),
  city('rhegium',         'Rhegium',          'Rhegium',            15.65,38.11, 4, 'roman',             8000, 27, true,  false),
  city('croton',          'Croton',           'Croton',             17.13,39.08, 4, 'greek',             5000, 27, true,  false),
  city('paestum',         'Paestum',          'Paestum',            15.0, 40.42, 4, 'roman',             5000, 27, false, false),
  city('misenum',         'Misenum',          'Misenum',            14.08,40.79, 4, 'roman',             6000, 27, true,  false),
  city('comum',           'Comum',            'Comum',               9.09,45.81, 4, 'roman',             8000, 27, false, false),
  city('ticinum',         'Ticinum',          'Ticinum',             9.16,45.19, 4, 'roman',             8000, 27, false, false),

  // Sicilia
  city('catana',          'Catana',           'Catana',             15.09,37.5,  4, 'greek',             8000, 39, true,  false),
  city('tauromenium',     'Tauromenium',      'Tauromenium',        15.28,37.85, 4, 'greek',             5000, 39, true,  false),
  city('agrigentum',      'Agrigentum',       'Agrigentum',         13.58,37.31, 4, 'greek',             8000, 39, true,  false),
  city('lilybaeum',       'Lilybaeum',        'Lilybaeum',          12.43,37.8,  4, 'greek',             6000, 39, true,  false),

  // Corsica-Sardinia
  city('caralis',         'Caralis',          'Caralis',             9.12,39.22, 4, 'roman',            10000, 16, true,  true),
  city('turris_libisonis','Turris Libisonis', 'Turris Libisonis',    8.56,40.84, 4, 'roman',             5000, 16, true,  false),
  city('aleria',          'Aleria',           'Aleria',              9.51,42.1,  4, 'roman',             4000, 16, true,  false),

  // Dalmatia
  city('iader',           'Iader',            'Iader',              15.23,44.12, 4, 'roman',            10000, 19, true,  false),
  city('narona',          'Narona',           'Narona',             17.62,43.05, 4, 'roman',             8000, 19, true,  false),
  city('epidaurum',       'Epidaurum',        'Epidaurum',          18.22,42.62, 4, 'roman',             5000, 19, true,  false),

  // Danube / Balkans
  city('sirmium',         'Sirmium',          'Sirmium',            19.61,44.97, 4, 'celtic',           15000, 36, false, false),
  city('scupi',           'Scupi',            'Scupi',              21.43,42.0,  4, 'dacian',            8000, 34, false, false),
  city('viminacium',      'Viminacium',       'Viminacium',         21.22,44.74, 4, 'dacian',           10000, 34, false, false),
  city('novae',           'Novae',            'Novae',              25.37,43.62, 4, 'dacian',            8000, 33, false, false),
  city('marcianopolis',   'Marcianopolis',    'Marcianopolis',      27.33,43.28, 4, 'greek',             8000, 33, false, false),
  city('tropaeum_traiani','Tropaeum Traiani', 'Tropaeum Traiani',   28.17,44.1,  4, 'dacian',            5000, 33, false, false),
  city('drobeta',         'Drobeta',          'Drobeta',            22.66,44.63, 4, 'dacian',            8000, 18, false, false),
  city('porolissum',      'Porolissum',       'Porolissum',         23.07,47.2,  4, 'dacian',            5000, 18, false, false),
  city('emona',           'Emona',            'Emona',              14.51,46.05, 4, 'celtic',           10000, 37, false, false),
  city('celeia',          'Celeia',           'Celeia',             15.27,46.23, 4, 'celtic',            6000, 35, false, false),
  city('savaria',         'Savaria',          'Savaria',            16.63,47.23, 4, 'celtic',            8000, 37, false, false),
  city('scarbantia',      'Scarbantia',       'Scarbantia',         16.59,47.69, 4, 'celtic',            5000, 37, false, false),
  city('iuvavum',         'Iuvavum',          'Iuvavum',            13.04,47.8,  4, 'celtic',            5000, 35, false, false),
  city('ovilava',         'Ovilava',          'Ovilava',            14.02,48.09, 4, 'celtic',            5000, 35, false, false),
  city('lauriacum',       'Lauriacum',        'Lauriacum',          14.47,48.23, 4, 'celtic',            5000, 35, false, false),

  // Greece
  city('delphi',          'Delphi',           'Delphi',             22.5, 38.48, 4, 'greek',             5000,  1, false, false),
  city('olympia',         'Olympia',          'Olympia',            21.63,37.64, 4, 'greek',             3000,  1, false, false),
  city('argos',           'Argos',            'Argos',              22.72,37.63, 4, 'greek',             5000,  1, false, false),
  city('chalcis',         'Chalcis',          'Chalcis',            23.6, 38.46, 4, 'greek',             6000,  1, true,  false),

  // Thracia / Macedonia (additional)
  city('hadrianopolis',   'Hadrianopolis',    'Hadrianopolis',      26.56,41.68, 4, 'greek',             8000, 41, false, false),
  city('perinthus',       'Perinthus',        'Perinthus',          27.96,41.03, 4, 'greek',            10000, 41, true,  false),
  city('amphipolis',      'Amphipolis',       'Amphipolis',         23.85,40.82, 4, 'greek',             5000, 29, false, false),
  city('beroia_mac',      'Beroia',           'Beroia',             22.2, 40.52, 4, 'greek',             8000, 29, false, false),
  city('traianopolis',    'Traianopolis',     'Traianopolis',       26.16,41.22, 4, 'greek',             5000, 41, false, false),

  // Creta-Cyrenaica
  city('apollonia_cyr',   'Apollonia',        'Apollonia',          21.97,32.9,  4, 'greek',             8000, 17, true,  false),
  city('berenice_cyr',    'Berenice',         'Berenice',           20.07,32.12, 4, 'greek',            10000, 17, true,  false),

  // Asia Minor (additional)
  city('thyatira',        'Thyatira',         'Thyatira',           27.84,38.92, 4, 'greek',             8000,  9, false, false),
  city('magnesia_meander','Magnesia ad Maeandrum','Magnesia ad Maeandrum',27.53,37.86, 4, 'greek',       8000,  9, false, false),
  city('tralles',         'Tralles',          'Tralles',            27.85,37.86, 4, 'greek',             8000,  9, false, false),
  city('philadelphia_ly', 'Philadelphia',     'Philadelphia',       28.52,38.35, 4, 'greek',             6000,  9, false, false),
  city('myra',            'Myra',             'Myra',               29.98,36.26, 4, 'greek',             6000, 15, true,  false),
  city('patara',          'Patara',           'Patara',             29.32,36.26, 4, 'greek',             6000, 15, true,  false),
  city('comana_pont',     'Comana Pontica',   'Comana Pontica',     36.28,40.36, 4, 'eastern',           5000, 12, false, false),
  city('sebasteia',       'Sebasteia',        'Sebasteia',          36.99,39.75, 4, 'eastern',           8000, 14, false, false),
  city('melitene',        'Melitene',         'Melitene',           38.35,38.35, 4, 'eastern',           8000, 14, false, false),
  city('germanicia',      'Germanicia',       'Germanicia',         36.92,37.6,  4, 'eastern',           5000, 14, false, false),
  city('seleucia_pier',   'Seleucia Pieria',  'Seleucia Pieria',    35.92,36.12, 4, 'greek',             8000, 40, true,  false),

  // Syria / Levant (additional)
  city('cyrrhus',         'Cyrrhus',          'Cyrrhus',            36.73,36.73, 4, 'eastern',           8000, 40, false, false),
  city('zeugma',          'Zeugma',           'Zeugma',             37.87,37.04, 4, 'eastern',          10000, 40, false, false),
  city('resaina',         'Resaina',          'Resaina',            40.09,36.85, 4, 'eastern',           5000, 32, false, false),
  city('scythopolis',     'Scythopolis',      'Scythopolis',        35.5, 32.5,  4, 'levantine',         8000, 40, false, false),
  city('neapolis_sam',    'Neapolis Samariae','Neapolis',           35.26,32.22, 4, 'levantine',         5000, 40, false, false),
  city('ascalon',         'Ascalon',          'Ascalon',            34.55,31.67, 4, 'levantine',         8000, 40, true,  false),

  // Arabia (additional)
  city('madaba',          'Madaba',           'Madaba',             35.8, 31.72, 4, 'eastern',           5000,  7, false, false),
  city('adraa',           'Adraa',            'Adraa',              36.1, 32.62, 4, 'eastern',           5000,  7, false, false),
  city('aila',            'Aila',             'Aila',               35.0, 29.52, 4, 'eastern',           5000,  7, true,  false),

  // Egypt (additional)
  city('canopus',         'Canopus',          'Canopus',            30.08,31.31, 4, 'egyptian',          8000,  2, true,  false),
  city('hermopolis_magna','Hermopolis Magna', 'Hermopolis Magna',   30.8, 27.78, 4, 'egyptian',          8000,  2, false, false),
  city('syene',           'Syene',            'Syene',              32.9, 24.09, 4, 'egyptian',          6000,  2, false, false),
  city('berenice_eg',     'Berenice',         'Berenice Troglodytica', 35.47, 23.91, 4, 'egyptian',      3000,  2, true,  false),

  // Africa (additional)
  city('utica',           'Utica',            'Utica',              10.06,37.06, 4, 'north_african',    10000,  3, true,  false),
  city('thaenae',         'Thaenae',          'Thaenae',            10.71,34.74, 4, 'north_african',     5000,  3, true,  false),
  city('rusaddir',        'Rusaddir',         'Rusaddir',           -2.95,35.29, 4, 'north_african',     5000, 30, true,  false),
  city('igilgili',        'Igilgili',         'Igilgili',            5.77,36.82, 4, 'north_african',     5000, 30, true,  false),
  city('saldae',          'Saldae',           'Saldae',              5.08,36.75, 4, 'north_african',     6000, 30, true,  false),
  city('lixus',           'Lixus',            'Lixus',              -6.11,35.2,  4, 'north_african',     6000, 31, true,  false),
  city('banasa',          'Banasa',           'Banasa',             -6.09,34.6,  4, 'north_african',     4000, 31, false, false),

  // Armenia / eastern frontier
  city('tigranocerta',    'Tigranocerta',     'Tigranocerta',       41.21,37.92, 4, 'eastern',           8000,  8, false, false),
  city('satala',          'Satala',           'Satala',             39.55,40.07, 4, 'eastern',           5000,  8, false, false),

  // Alpes
  city('augusta_praet',   'Augusta Praetoria','Augusta Praetoria',   7.32,45.74, 4, 'celtic',            5000,  5, false, false),
  city('cemenelum',       'Cemenelum',        'Cemenelum',           7.28,43.74, 4, 'celtic',            3000,  6, false, true),
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
