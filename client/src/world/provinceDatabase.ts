import type { ProvinceLabelData } from './textLabels';
import { MAP_SIZE } from '../config';

/** Convert geographic longitude to world X coordinate. */
function lonToWorld(lon: number): number {
  const tileX = ((lon + 10) / 60) * MAP_SIZE;
  return tileX - MAP_SIZE / 2;
}

/** Convert geographic latitude to world Z coordinate. */
function latToWorld(lat: number): number {
  const tileY = ((55 - lat) / 30) * MAP_SIZE;
  return tileY - MAP_SIZE / 2;
}

/** Shorthand factory for province label data. */
function prov(id: number, name: string, lon: number, lat: number, color: number): ProvinceLabelData {
  return { id, name, labelX: lonToWorld(lon), labelZ: latToWorld(lat), color };
}

/**
 * All 41 provinces of the Roman Empire at its greatest extent (117 AD).
 * Coordinates are approximate geographic centers converted to world space.
 */
export const PROVINCE_DATABASE: readonly ProvinceLabelData[] = Object.freeze([
  prov(1,  'Achaea',                    22.5,  38.0,  0x8f8be3),
  prov(2,  'Aegyptus',                  30.5,  28.5,  0xd29a58),
  prov(3,  'Africa Proconsularis',       9.5,  35.5,  0xd9ad62),
  prov(4,  'Alpes Cottiae',              7.0,  45.0,  0xb8a888),
  prov(5,  'Alpes Graiae et Poeninae',   7.5,  46.0,  0xa8b898),
  prov(6,  'Alpes Maritimae',            7.0,  44.0,  0xb0a070),
  prov(7,  'Arabia',                    36.5,  30.5,  0xc49868),
  prov(8,  'Armenia',                   43.0,  39.5,  0xb87878),
  prov(9,  'Asia',                      28.5,  38.5,  0x9898d0),
  prov(10, 'Assyria',                   44.0,  36.0,  0xc08870),
  prov(11, 'Baetica',                   -4.5,  37.5,  0xc8b858),
  prov(12, 'Bithynia et Pontus',        33.0,  41.0,  0x88a8c8),
  prov(13, 'Britannia',                 -1.5,  52.0,  0x78a878),
  prov(14, 'Cappadocia et Galatia',     35.0,  39.0,  0xa890a8),
  prov(15, 'Cilicia et Cyprus',         34.0,  36.5,  0xb89878),
  prov(16, 'Corsica et Sardinia',        9.5,  41.0,  0x98b088),
  prov(17, 'Creta et Cyrenaica',        24.5,  33.0,  0xb0a0c0),
  prov(18, 'Dacia',                     24.0,  46.0,  0x90b070),
  prov(19, 'Dalmatia',                  17.0,  43.5,  0xa0c0b0),
  prov(20, 'Gallia Aquitania',           0.5,  45.0,  0xc0a870),
  prov(21, 'Gallia Belgica',             4.0,  50.0,  0x88b0a0),
  prov(22, 'Gallia Lugdunensis',         2.0,  47.5,  0xa8b878),
  prov(23, 'Gallia Narbonensis',         3.5,  43.5,  0xd0b080),
  prov(24, 'Germania Inferior',          5.5,  51.5,  0x80a890),
  prov(25, 'Germania Superior',          8.0,  49.0,  0x98a0b8),
  prov(26, 'Hispania Tarraconensis',    -2.0,  41.0,  0xc8a860),
  prov(27, 'Italia',                    12.5,  42.5,  0xd3b37d),
  prov(28, 'Lusitania',                 -7.5,  39.5,  0xb8c070),
  prov(29, 'Macedonia',                 22.5,  41.0,  0x9898b8),
  prov(30, 'Mauretania Caesariensis',    2.0,  35.5,  0xc09870),
  prov(31, 'Mauretania Tingitana',      -5.5,  34.5,  0xb89060),
  prov(32, 'Mesopotamia',              42.0,  35.5,  0xb88880),
  prov(33, 'Moesia Inferior',           26.5,  44.0,  0x98b898),
  prov(34, 'Moesia Superior',           21.5,  43.5,  0xa8a890),
  prov(35, 'Noricum',                   14.0,  47.5,  0x90a890),
  prov(36, 'Pannonia Inferior',         19.5,  46.5,  0xa0b080),
  prov(37, 'Pannonia Superior',         17.0,  47.5,  0x98a880),
  prov(38, 'Raetia',                    11.0,  48.0,  0xa0a098),
  prov(39, 'Sicilia',                   14.5,  37.5,  0xc0a880),
  prov(40, 'Syria',                     37.0,  34.5,  0xc89870),
  prov(41, 'Thracia',                   26.0,  42.0,  0xa098b0),
]);
