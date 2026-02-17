/**
 * Agent model geometry definitions.
 *
 * Defines voxel-style models for ships, people, legions, and caravans
 * as compositions of BoxGeometry primitives with baked vertex colors.
 * All geometries are built once and cached as singletons.
 */

import * as THREE from 'three';

// ── Colors ──────────────────────────────────────────────────────

const C = {
  // Ship colors
  hullBrown: new THREE.Color(0x6B3A2A),
  hullDark: new THREE.Color(0x4A2818),
  sailWhite: new THREE.Color(0xE8DDD0),
  sailRed: new THREE.Color(0xA83030),
  mast: new THREE.Color(0x5A3A1A),

  // People colors
  tunicWhite: new THREE.Color(0xE0D8C8),
  tunicRed: new THREE.Color(0x8B2020),
  tunicGreen: new THREE.Color(0x4A6B3A),
  skin: new THREE.Color(0xC89A70),
  hair: new THREE.Color(0x3A2A1A),

  // Legion colors
  armorMetal: new THREE.Color(0x888888),
  shieldRed: new THREE.Color(0xA02020),
  helmGold: new THREE.Color(0xC8A840),
  capeRed: new THREE.Color(0x8B1A1A),

  // Caravan colors
  oxBrown: new THREE.Color(0x7A5A3A),
  cartWood: new THREE.Color(0x6B4226),
  cargo: new THREE.Color(0xC4A35A),
  cloth: new THREE.Color(0x8A6A4A),
} as const;

// ── Box Definition ──────────────────────────────────────────────

interface BoxDef {
  w: number; h: number; d: number;
  ox: number; oy: number; oz: number;
  color: THREE.Color;
}

// ── Geometry Builder ────────────────────────────────────────────

function buildModelGeometry(boxes: BoxDef[]): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  for (const box of boxes) {
    const geo = new THREE.BoxGeometry(box.w, box.h, box.d);
    geo.translate(box.ox, box.oy, box.oz);

    const posAttr = geo.getAttribute('position');
    if (posAttr) {
      const colors = new Float32Array(posAttr.count * 3);
      for (let i = 0; i < posAttr.count; i++) {
        colors[i * 3] = box.color.r;
        colors[i * 3 + 1] = box.color.g;
        colors[i * 3 + 2] = box.color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geometries.push(geo);
  }

  const merged = mergeGeometries(geometries);
  for (const g of geometries) g.dispose();
  return merged;
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  const nonIndexed: THREE.BufferGeometry[] = [];

  for (const g of geos) {
    const ni = g.index ? g.toNonIndexed() : g;
    nonIndexed.push(ni);
    const pos = ni.getAttribute('position');
    if (pos) totalVerts += pos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  let offset = 0;

  for (const ni of nonIndexed) {
    const pos = ni.getAttribute('position') as THREE.BufferAttribute;
    const nrm = ni.getAttribute('normal') as THREE.BufferAttribute;
    const col = ni.getAttribute('color') as THREE.BufferAttribute;
    positions.set(new Float32Array(pos.array), offset * 3);
    normals.set(new Float32Array(nrm.array), offset * 3);
    if (col) colors.set(new Float32Array(col.array), offset * 3);
    offset += pos.count;
  }

  for (let i = 0; i < geos.length; i++) {
    if (nonIndexed[i] !== geos[i]) nonIndexed[i]?.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

// ── Model Definitions ───────────────────────────────────────────

const TRADE_SHIP_BOXES: BoxDef[] = [
  // Hull
  { w: 4, h: 1, d: 2, ox: 0, oy: 0.5, oz: 0, color: C.hullBrown },
  // Bow
  { w: 1, h: 0.8, d: 1.5, ox: 2.2, oy: 0.4, oz: 0, color: C.hullDark },
  // Mast
  { w: 0.2, h: 3, d: 0.2, ox: 0, oy: 2.5, oz: 0, color: C.mast },
  // Sail
  { w: 2, h: 2, d: 0.1, ox: 0, oy: 2.5, oz: 0.2, color: C.sailWhite },
];

const FISHING_BOAT_BOXES: BoxDef[] = [
  // Small hull
  { w: 2, h: 0.5, d: 1, ox: 0, oy: 0.25, oz: 0, color: C.hullBrown },
  // Small mast
  { w: 0.15, h: 1.5, d: 0.15, ox: 0, oy: 1.25, oz: 0, color: C.mast },
  // Small sail
  { w: 1, h: 1, d: 0.08, ox: 0, oy: 1.3, oz: 0.15, color: C.sailWhite },
];

const CITIZEN_BOXES: BoxDef[] = [
  // Body/tunic
  { w: 0.8, h: 1.4, d: 0.6, ox: 0, oy: 0.7, oz: 0, color: C.tunicWhite },
  // Head
  { w: 0.5, h: 0.5, d: 0.5, ox: 0, oy: 1.65, oz: 0, color: C.skin },
  // Hair
  { w: 0.55, h: 0.2, d: 0.55, ox: 0, oy: 1.95, oz: 0, color: C.hair },
];

const LEGION_BOXES: BoxDef[] = [
  // Body/armor
  { w: 0.9, h: 1.4, d: 0.7, ox: 0, oy: 0.7, oz: 0, color: C.armorMetal },
  // Cape
  { w: 0.3, h: 1.2, d: 0.8, ox: 0, oy: 0.8, oz: -0.4, color: C.capeRed },
  // Head/helmet
  { w: 0.55, h: 0.5, d: 0.55, ox: 0, oy: 1.65, oz: 0, color: C.helmGold },
  // Helmet crest
  { w: 0.15, h: 0.4, d: 0.6, ox: 0, oy: 2.0, oz: 0, color: C.capeRed },
  // Shield
  { w: 0.1, h: 1.0, d: 0.6, ox: -0.55, oy: 0.9, oz: 0, color: C.shieldRed },
];

const CARAVAN_BOXES: BoxDef[] = [
  // Ox body
  { w: 1.5, h: 1.0, d: 0.8, ox: -1, oy: 0.5, oz: 0, color: C.oxBrown },
  // Ox head
  { w: 0.5, h: 0.5, d: 0.5, ox: -2, oy: 0.8, oz: 0, color: C.oxBrown },
  // Cart
  { w: 2, h: 0.3, d: 1.2, ox: 0.8, oy: 0.6, oz: 0, color: C.cartWood },
  // Cargo
  { w: 1.5, h: 0.8, d: 1.0, ox: 0.8, oy: 1.15, oz: 0, color: C.cargo },
  // Cargo cloth
  { w: 1.6, h: 0.2, d: 1.1, ox: 0.8, oy: 1.65, oz: 0, color: C.cloth },
];

// ── Cached Geometries ───────────────────────────────────────────

let _tradeShipGeo: THREE.BufferGeometry | null = null;
let _fishingBoatGeo: THREE.BufferGeometry | null = null;
let _citizenGeo: THREE.BufferGeometry | null = null;
let _legionGeo: THREE.BufferGeometry | null = null;
let _caravanGeo: THREE.BufferGeometry | null = null;

export function getTradeShipGeometry(): THREE.BufferGeometry {
  if (!_tradeShipGeo) _tradeShipGeo = buildModelGeometry(TRADE_SHIP_BOXES);
  return _tradeShipGeo;
}

export function getFishingBoatGeometry(): THREE.BufferGeometry {
  if (!_fishingBoatGeo) _fishingBoatGeo = buildModelGeometry(FISHING_BOAT_BOXES);
  return _fishingBoatGeo;
}

export function getCitizenGeometry(): THREE.BufferGeometry {
  if (!_citizenGeo) _citizenGeo = buildModelGeometry(CITIZEN_BOXES);
  return _citizenGeo;
}

export function getLegionGeometry(): THREE.BufferGeometry {
  if (!_legionGeo) _legionGeo = buildModelGeometry(LEGION_BOXES);
  return _legionGeo;
}

export function getCaravanGeometry(): THREE.BufferGeometry {
  if (!_caravanGeo) _caravanGeo = buildModelGeometry(CARAVAN_BOXES);
  return _caravanGeo;
}

/** Dispose all cached agent model geometries. */
export function disposeAgentModels(): void {
  if (_tradeShipGeo) { _tradeShipGeo.dispose(); _tradeShipGeo = null; }
  if (_fishingBoatGeo) { _fishingBoatGeo.dispose(); _fishingBoatGeo = null; }
  if (_citizenGeo) { _citizenGeo.dispose(); _citizenGeo = null; }
  if (_legionGeo) { _legionGeo.dispose(); _legionGeo = null; }
  if (_caravanGeo) { _caravanGeo.dispose(); _caravanGeo = null; }
}
