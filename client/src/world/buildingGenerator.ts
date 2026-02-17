/**
 * Procedural voxel building generator for culture-specific city clusters.
 *
 * Generates building layouts from city data (tier, culture, seed) using
 * deterministic placement. Each building is a composition of BoxGeometry
 * primitives with baked vertex colors.
 *
 * 5 culture styles: Roman, Greek, Egyptian, Eastern, Celtic.
 * Buildings are rendered via InstancedMesh for minimal draw calls.
 */

import * as THREE from 'three';
import type { CultureType, CityTier } from '../types';

// ── Colors ──────────────────────────────────────────────────────

const COLORS = {
  // Roman
  terracotta: new THREE.Color(0xB85C38),
  cream: new THREE.Color(0xE8DCC8),
  romanRoof: new THREE.Color(0x8B4513),
  marble: new THREE.Color(0xF0E6D3),
  romanColumn: new THREE.Color(0xD4C5A9),

  // Greek
  white: new THREE.Color(0xF5F0E8),
  blueAccent: new THREE.Color(0x4A6FA5),
  greekRoof: new THREE.Color(0xC85A17),

  // Egyptian
  sandstone: new THREE.Color(0xD4A055),
  darkSandstone: new THREE.Color(0xB8862D),
  limestone: new THREE.Color(0xE8D8B8),

  // Eastern
  ochre: new THREE.Color(0xCC9544),
  gold: new THREE.Color(0xDAA520),
  easternDome: new THREE.Color(0x5B8A72),

  // Celtic
  wood: new THREE.Color(0x6B4226),
  thatch: new THREE.Color(0xC4A35A),
  darkWood: new THREE.Color(0x4A2F1A),
} as const;

// ── Building Template Definition ────────────────────────────────

interface BoxDef {
  /** Width, Height, Depth */
  w: number; h: number; d: number;
  /** Offset from building origin */
  ox: number; oy: number; oz: number;
  /** Color */
  color: THREE.Color;
}

interface BuildingTemplate {
  name: string;
  boxes: BoxDef[];
  /** Footprint size for placement grid */
  footprintW: number;
  footprintD: number;
}

// ── Roman Buildings ─────────────────────────────────────────────

const ROMAN_INSULA: BuildingTemplate = {
  name: 'roman_insula',
  footprintW: 4, footprintD: 4,
  boxes: [
    { w: 4, h: 5, d: 4, ox: 0, oy: 2.5, oz: 0, color: COLORS.terracotta },
    { w: 4.2, h: 0.5, d: 4.2, ox: 0, oy: 5.25, oz: 0, color: COLORS.romanRoof },
  ],
};

const ROMAN_DOMUS: BuildingTemplate = {
  name: 'roman_domus',
  footprintW: 6, footprintD: 5,
  boxes: [
    { w: 6, h: 3, d: 5, ox: 0, oy: 1.5, oz: 0, color: COLORS.cream },
    { w: 4, h: 1, d: 3, ox: 0, oy: 3.5, oz: 0, color: COLORS.cream },
    { w: 6.2, h: 0.4, d: 5.2, ox: 0, oy: 3.2, oz: 0, color: COLORS.romanRoof },
  ],
};

const ROMAN_TEMPLE: BuildingTemplate = {
  name: 'roman_temple',
  footprintW: 5, footprintD: 4,
  boxes: [
    // Platform
    { w: 5, h: 1, d: 4, ox: 0, oy: 0.5, oz: 0, color: COLORS.marble },
    // Columns (simplified as thin boxes)
    { w: 0.4, h: 5, d: 0.4, ox: -2, oy: 3.5, oz: -1.5, color: COLORS.romanColumn },
    { w: 0.4, h: 5, d: 0.4, ox: 2, oy: 3.5, oz: -1.5, color: COLORS.romanColumn },
    { w: 0.4, h: 5, d: 0.4, ox: -2, oy: 3.5, oz: 1.5, color: COLORS.romanColumn },
    { w: 0.4, h: 5, d: 0.4, ox: 2, oy: 3.5, oz: 1.5, color: COLORS.romanColumn },
    // Roof
    { w: 5.5, h: 1.5, d: 4.5, ox: 0, oy: 6.75, oz: 0, color: COLORS.romanRoof },
  ],
};

const ROMAN_FORUM: BuildingTemplate = {
  name: 'roman_forum',
  footprintW: 8, footprintD: 8,
  boxes: [
    // Open plaza
    { w: 8, h: 0.3, d: 8, ox: 0, oy: 0.15, oz: 0, color: COLORS.marble },
    // Surrounding colonnade (4 walls)
    { w: 8, h: 2.5, d: 0.5, ox: 0, oy: 1.25, oz: -3.75, color: COLORS.romanColumn },
    { w: 8, h: 2.5, d: 0.5, ox: 0, oy: 1.25, oz: 3.75, color: COLORS.romanColumn },
    { w: 0.5, h: 2.5, d: 8, ox: -3.75, oy: 1.25, oz: 0, color: COLORS.romanColumn },
    { w: 0.5, h: 2.5, d: 8, ox: 3.75, oy: 1.25, oz: 0, color: COLORS.romanColumn },
  ],
};

// ── Greek Buildings ─────────────────────────────────────────────

const GREEK_STOA: BuildingTemplate = {
  name: 'greek_stoa',
  footprintW: 8, footprintD: 2,
  boxes: [
    { w: 8, h: 3, d: 2, ox: 0, oy: 1.5, oz: 0, color: COLORS.white },
    { w: 8.2, h: 0.5, d: 2.2, ox: 0, oy: 3.25, oz: 0, color: COLORS.greekRoof },
  ],
};

const GREEK_TEMPLE: BuildingTemplate = {
  name: 'greek_temple',
  footprintW: 6, footprintD: 5,
  boxes: [
    // Stylobate
    { w: 6, h: 0.8, d: 5, ox: 0, oy: 0.4, oz: 0, color: COLORS.white },
    // Cella
    { w: 4, h: 4, d: 3.5, ox: 0, oy: 2.8, oz: 0, color: COLORS.white },
    // Pediment (triangular approximated as box)
    { w: 6.5, h: 1.5, d: 5.5, ox: 0, oy: 5.55, oz: 0, color: COLORS.blueAccent },
  ],
};

const GREEK_AGORA: BuildingTemplate = {
  name: 'greek_agora',
  footprintW: 6, footprintD: 6,
  boxes: [
    { w: 6, h: 0.2, d: 6, ox: 0, oy: 0.1, oz: 0, color: COLORS.white },
    { w: 0.3, h: 3, d: 0.3, ox: -2.5, oy: 1.5, oz: -2.5, color: COLORS.white },
    { w: 0.3, h: 3, d: 0.3, ox: 2.5, oy: 1.5, oz: -2.5, color: COLORS.white },
    { w: 0.3, h: 3, d: 0.3, ox: -2.5, oy: 1.5, oz: 2.5, color: COLORS.white },
    { w: 0.3, h: 3, d: 0.3, ox: 2.5, oy: 1.5, oz: 2.5, color: COLORS.white },
  ],
};

// ── Egyptian Buildings ──────────────────────────────────────────

const EGYPTIAN_MASTABA: BuildingTemplate = {
  name: 'egyptian_mastaba',
  footprintW: 6, footprintD: 4,
  boxes: [
    { w: 6, h: 3, d: 4, ox: 0, oy: 1.5, oz: 0, color: COLORS.sandstone },
    { w: 6.2, h: 0.3, d: 4.2, ox: 0, oy: 3.15, oz: 0, color: COLORS.darkSandstone },
  ],
};

const EGYPTIAN_OBELISK: BuildingTemplate = {
  name: 'egyptian_obelisk',
  footprintW: 1, footprintD: 1,
  boxes: [
    { w: 1.5, h: 0.5, d: 1.5, ox: 0, oy: 0.25, oz: 0, color: COLORS.sandstone },
    { w: 1, h: 8, d: 1, ox: 0, oy: 4.5, oz: 0, color: COLORS.limestone },
    { w: 0.5, h: 1, d: 0.5, ox: 0, oy: 9, oz: 0, color: COLORS.gold },
  ],
};

const EGYPTIAN_PYLON: BuildingTemplate = {
  name: 'egyptian_pylon',
  footprintW: 6, footprintD: 2,
  boxes: [
    { w: 2.5, h: 6, d: 2, ox: -1.75, oy: 3, oz: 0, color: COLORS.sandstone },
    { w: 2.5, h: 6, d: 2, ox: 1.75, oy: 3, oz: 0, color: COLORS.sandstone },
    { w: 1, h: 4, d: 1.5, ox: 0, oy: 2, oz: 0, color: COLORS.darkSandstone },
  ],
};

// ── Eastern Buildings ───────────────────────────────────────────

const EASTERN_DOME: BuildingTemplate = {
  name: 'eastern_dome',
  footprintW: 4, footprintD: 4,
  boxes: [
    { w: 4, h: 3, d: 4, ox: 0, oy: 1.5, oz: 0, color: COLORS.ochre },
    // Dome approximated as smaller box on top
    { w: 3, h: 2, d: 3, ox: 0, oy: 4, oz: 0, color: COLORS.easternDome },
    { w: 2, h: 1, d: 2, ox: 0, oy: 5.5, oz: 0, color: COLORS.easternDome },
  ],
};

const EASTERN_MARKET: BuildingTemplate = {
  name: 'eastern_market',
  footprintW: 6, footprintD: 6,
  boxes: [
    { w: 6, h: 3, d: 6, ox: 0, oy: 1.5, oz: 0, color: COLORS.ochre },
    { w: 4, h: 1.5, d: 4, ox: 0, oy: 3.75, oz: 0, color: COLORS.gold },
  ],
};

// ── Celtic Buildings ────────────────────────────────────────────

const CELTIC_ROUNDHOUSE: BuildingTemplate = {
  name: 'celtic_roundhouse',
  footprintW: 3, footprintD: 3,
  boxes: [
    { w: 3, h: 2, d: 3, ox: 0, oy: 1, oz: 0, color: COLORS.wood },
    { w: 3.5, h: 1.5, d: 3.5, ox: 0, oy: 2.75, oz: 0, color: COLORS.thatch },
  ],
};

const CELTIC_HALL: BuildingTemplate = {
  name: 'celtic_hall',
  footprintW: 5, footprintD: 3,
  boxes: [
    { w: 5, h: 2.5, d: 3, ox: 0, oy: 1.25, oz: 0, color: COLORS.darkWood },
    { w: 5.5, h: 1.5, d: 3.5, ox: 0, oy: 3.25, oz: 0, color: COLORS.thatch },
  ],
};

// ── Culture Template Map ────────────────────────────────────────

const CULTURE_TEMPLATES: Record<string, BuildingTemplate[]> = {
  roman: [ROMAN_INSULA, ROMAN_DOMUS, ROMAN_TEMPLE, ROMAN_FORUM],
  greek: [GREEK_STOA, GREEK_TEMPLE, GREEK_AGORA],
  egyptian: [EGYPTIAN_MASTABA, EGYPTIAN_OBELISK, EGYPTIAN_PYLON],
  eastern: [EASTERN_DOME, EASTERN_MARKET],
  celtic: [CELTIC_ROUNDHOUSE, CELTIC_HALL],
  germanic: [CELTIC_ROUNDHOUSE, CELTIC_HALL], // Similar to Celtic
  dacian: [CELTIC_ROUNDHOUSE, CELTIC_HALL],
  north_african: [ROMAN_INSULA, EGYPTIAN_MASTABA, ROMAN_TEMPLE],
  levantine: [EASTERN_DOME, EASTERN_MARKET, GREEK_STOA],
};

// ── Deterministic hash ──────────────────────────────────────────

function cityHash(seed: number, offset: number): number {
  let h = ((seed + offset) * 374761393) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) | 0;
  return (h >>> 0) / 4294967296;
}

// ── Building Geometry Cache ─────────────────────────────────────

const geometryCache = new Map<string, THREE.BufferGeometry>();

/**
 * Build a merged geometry for a building template with baked vertex colors.
 */
function getTemplateGeometry(template: BuildingTemplate): THREE.BufferGeometry {
  const cached = geometryCache.get(template.name);
  if (cached) return cached;

  const geometries: THREE.BufferGeometry[] = [];

  for (const box of template.boxes) {
    const geo = new THREE.BoxGeometry(box.w, box.h, box.d);
    geo.translate(box.ox, box.oy, box.oz);

    // Bake vertex colors
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

  // Merge all boxes into one geometry
  const merged = mergeGeometries(geometries);

  // Dispose intermediate geometries
  for (const g of geometries) g.dispose();

  geometryCache.set(template.name, merged);
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
    if (col) {
      colors.set(new Float32Array(col.array), offset * 3);
    }
    offset += pos.count;
  }

  // Dispose intermediate non-indexed copies
  for (let i = 0; i < geos.length; i++) {
    if (nonIndexed[i] !== geos[i]) nonIndexed[i]?.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

// ── City Layout Generator ───────────────────────────────────────

export interface PlacedBuilding {
  templateName: string;
  worldX: number;
  worldY: number;
  worldZ: number;
  rotation: number;
  scale: number;
}

/**
 * Generate a deterministic building layout for a city.
 */
export function generateCityLayout(
  cityId: string,
  tier: CityTier,
  culture: CultureType,
  centerX: number,
  centerZ: number,
  terrainHeight: number,
): PlacedBuilding[] {
  // Seed from city ID
  let seed = 0;
  for (let i = 0; i < cityId.length; i++) {
    seed = (seed * 31 + cityId.charCodeAt(i)) | 0;
  }

  const templates = CULTURE_TEMPLATES[culture] ?? CULTURE_TEMPLATES['roman']!;
  const buildings: PlacedBuilding[] = [];

  // Building count by tier
  const counts: Record<CityTier, [number, number]> = {
    1: [15, 25],
    2: [8, 15],
    3: [4, 8],
    4: [2, 4],
  };

  const [minCount, maxCount] = counts[tier];
  const count = Math.floor(minCount + cityHash(seed, 0) * (maxCount - minCount));

  // Placement radius by tier
  const radius: Record<CityTier, number> = {
    1: 30,
    2: 20,
    3: 12,
    4: 6,
  };
  const r = radius[tier];

  for (let i = 0; i < count; i++) {
    const templateIdx = Math.floor(cityHash(seed, i * 7 + 1) * templates.length);
    const template = templates[templateIdx];
    if (!template) continue;

    // Jittered grid placement around city center
    const angle = cityHash(seed, i * 7 + 2) * Math.PI * 2;
    const dist = cityHash(seed, i * 7 + 3) * r;
    const offsetX = Math.cos(angle) * dist;
    const offsetZ = Math.sin(angle) * dist;

    const rotation = Math.floor(cityHash(seed, i * 7 + 4) * 4) * (Math.PI / 2);
    const scale = 0.7 + cityHash(seed, i * 7 + 5) * 0.6;

    buildings.push({
      templateName: template.name,
      worldX: centerX + offsetX,
      worldY: terrainHeight,
      worldZ: centerZ + offsetZ,
      rotation,
      scale,
    });
  }

  return buildings;
}

// ── Building Renderer ───────────────────────────────────────────

const BUILDING_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.9,
  metalness: 0.05,
  side: THREE.FrontSide,
});

/**
 * Renders city buildings as InstancedMesh groups.
 * One InstancedMesh per building template type for minimal draw calls.
 */
export class BuildingRenderer {
  private readonly scene: THREE.Scene;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly group: THREE.Group;
  private visible = true;

  private readonly _mat4 = new THREE.Matrix4();
  private readonly _scale = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _pos = new THREE.Vector3();
  private readonly _euler = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'CityBuildings';
    this.scene.add(this.group);
  }

  /**
   * Rebuild building instances from a flat list of placed buildings.
   */
  rebuild(buildings: PlacedBuilding[]): void {
    this.clear();

    // Group buildings by template name
    const byTemplate = new Map<string, PlacedBuilding[]>();
    for (const b of buildings) {
      const arr = byTemplate.get(b.templateName);
      if (arr) arr.push(b);
      else byTemplate.set(b.templateName, [b]);
    }

    // Create one InstancedMesh per template
    for (const [templateName, instances] of byTemplate) {
      const template = findTemplate(templateName);
      if (!template) continue;

      const geo = getTemplateGeometry(template);
      const mesh = new THREE.InstancedMesh(geo, BUILDING_MATERIAL, instances.length);
      mesh.frustumCulled = false;

      for (let i = 0; i < instances.length; i++) {
        const b = instances[i]!;
        this._euler.set(0, b.rotation, 0);
        this._quat.setFromEuler(this._euler);
        this._pos.set(b.worldX, b.worldY, b.worldZ);
        this._scale.set(b.scale, b.scale, b.scale);
        this._mat4.compose(this._pos, this._quat, this._scale);
        mesh.setMatrixAt(i, this._mat4);
      }

      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
  }

  isVisible(): boolean {
    return this.visible;
  }

  clear(): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    this.meshes.length = 0;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);

    // Dispose cached geometries
    for (const [, geo] of geometryCache) {
      geo.dispose();
    }
    geometryCache.clear();
  }
}

// ── Template Lookup ─────────────────────────────────────────────

const ALL_TEMPLATES: BuildingTemplate[] = [
  ROMAN_INSULA, ROMAN_DOMUS, ROMAN_TEMPLE, ROMAN_FORUM,
  GREEK_STOA, GREEK_TEMPLE, GREEK_AGORA,
  EGYPTIAN_MASTABA, EGYPTIAN_OBELISK, EGYPTIAN_PYLON,
  EASTERN_DOME, EASTERN_MARKET,
  CELTIC_ROUNDHOUSE, CELTIC_HALL,
];

function findTemplate(name: string): BuildingTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.name === name);
}
