/**
 * Procedural voxel building generator for culture-specific city clusters.
 *
 * Each building template is defined by LayerRules that describe how to fill
 * vertical slices of a 3D voxel volume. The volume is then greedy-meshed into
 * a BufferGeometry with baked vertex colors (face shading: top=1.0, east=0.88,
 * north/south=0.80, west=0.65, bottom=0.50) and rendered via InstancedMesh.
 *
 * 9 culture styles, 28 templates total.
 */

import * as THREE from 'three';
import type { CultureType, CityTier } from '../types';

// ── Color Palette ────────────────────────────────────────────────

type ColorKey =
  | 'terracotta' | 'cream' | 'roman_roof' | 'marble' | 'column'
  | 'floor_stone' | 'white' | 'blue_accent' | 'greek_roof'
  | 'sandstone' | 'dark_sand' | 'limestone' | 'gold'
  | 'ochre' | 'plaster' | 'dome_green'
  | 'wood' | 'dark_wood' | 'thatch' | 'wattle'
  | 'dacian_stone' | 'dacian_wood';

const PALETTE: Record<ColorKey, THREE.Color> = {
  terracotta:   new THREE.Color(0xB85C38),
  cream:        new THREE.Color(0xE8DCC8),
  roman_roof:   new THREE.Color(0x8B4513),
  marble:       new THREE.Color(0xF0E6D3),
  column:       new THREE.Color(0xD4C5A9),
  floor_stone:  new THREE.Color(0xA0998A),
  white:        new THREE.Color(0xF5F0E8),
  blue_accent:  new THREE.Color(0x4A6FA5),
  greek_roof:   new THREE.Color(0xC85A17),
  sandstone:    new THREE.Color(0xD4A055),
  dark_sand:    new THREE.Color(0xB8862D),
  limestone:    new THREE.Color(0xE8D8B8),
  gold:         new THREE.Color(0xDAA520),
  ochre:        new THREE.Color(0xCC9544),
  plaster:      new THREE.Color(0xE0D5C0),
  dome_green:   new THREE.Color(0x5B8A72),
  wood:         new THREE.Color(0x6B4226),
  dark_wood:    new THREE.Color(0x4A2F1A),
  thatch:       new THREE.Color(0xC4A35A),
  wattle:       new THREE.Color(0x8B7355),
  dacian_stone: new THREE.Color(0x6B6B6B),
  dacian_wood:  new THREE.Color(0x5A3E28),
};

const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[];
function colorIdx(key: ColorKey): number { return COLOR_KEYS.indexOf(key) + 1; }
function idxToColor(idx: number): THREE.Color { const k = COLOR_KEYS[idx - 1]; return k ? PALETTE[k] : PALETTE.white; }

// ── Interfaces ───────────────────────────────────────────────────

interface Opening {
  face: 'north' | 'south' | 'east' | 'west';
  xStart: number; xEnd: number;
  yStart: number; yEnd: number;
  type: 'door' | 'window' | 'arch';
}

interface LayerRule {
  yStart: number;
  yEnd: number;
  fill: 'solid' | 'shell' | 'columns' | 'roof';
  color: ColorKey;
  inset: number;
  columnSpacing?: number;
  openings?: Opening[];
}

interface BuildingTemplate {
  name: string;
  type: string;
  culture: string;
  width: number;
  depth: number;
  height: number;
  footprintW: number;
  footprintD: number;
  layers: LayerRule[];
}

// ── Face Shading (spec: baked into vertex colors) ────────────────

const FACE_SHADE = {
  top:    1.0,
  east:   0.88,
  north:  0.80,
  south:  0.80,
  west:   0.65,
  bottom: 0.50,
} as const;

// ── Voxel Volume Builder ─────────────────────────────────────────

function buildVoxelVolume(t: BuildingTemplate): Uint8Array {
  const { width: W, depth: D, height: H, layers } = t;
  const vol = new Uint8Array(W * D * H);
  const idx = (x: number, y: number, z: number) => y * W * D + z * W + x;

  for (const layer of layers) {
    const ci = colorIdx(layer.color);
    const ins = layer.inset;

    for (let y = layer.yStart; y <= Math.min(layer.yEnd, H - 1); y++) {
      const ly = y - layer.yStart;

      switch (layer.fill) {
        case 'solid':
          for (let z = ins; z < D - ins; z++)
            for (let x = ins; x < W - ins; x++)
              vol[idx(x, y, z)] = ci;
          break;

        case 'shell':
          for (let z = ins; z < D - ins; z++)
            for (let x = ins; x < W - ins; x++) {
              if (x === ins || x === W - ins - 1 || z === ins || z === D - ins - 1)
                vol[idx(x, y, z)] = ci;
            }
          break;

        case 'columns': {
          const sp = layer.columnSpacing ?? 3;
          for (let z = ins; z < D - ins; z++)
            for (let x = ins; x < W - ins; x++) {
              const onEdge = x === ins || x === W - ins - 1 || z === ins || z === D - ins - 1;
              if (!onEdge) continue;
              const atCorner = (x === ins || x === W - ins - 1) && (z === ins || z === D - ins - 1);
              if (atCorner) { vol[idx(x, y, z)] = ci; continue; }
              // Place columns at regular intervals along edges
              if (x === ins || x === W - ins - 1) {
                if ((z - ins) % sp === 0) vol[idx(x, y, z)] = ci;
              } else if (z === ins || z === D - ins - 1) {
                if ((x - ins) % sp === 0) vol[idx(x, y, z)] = ci;
              }
            }
          // Back wall (north face, z = D-ins-1) solid
          for (let x = ins; x < W - ins; x++) vol[idx(x, y, D - ins - 1)] = ci;
          break;
        }

        case 'roof': {
          // Stepped pyramid narrowing per layer
          const roofIns = ins + ly;
          for (let z = roofIns; z < D - roofIns; z++)
            for (let x = roofIns; x < W - roofIns; x++)
              if (roofIns < W / 2 && roofIns < D / 2)
                vol[idx(x, y, z)] = ci;
          break;
        }
      }

      // Carve openings
      if (layer.openings) {
        for (const op of layer.openings) {
          for (let oy = op.yStart; oy <= op.yEnd; oy++) {
            const absY = layer.yStart + oy;
            if (absY < 0 || absY >= H) continue;
            for (let ox = op.xStart; ox < op.xEnd; ox++) {
              switch (op.face) {
                case 'south': // z = ins
                  if (ox >= 0 && ox < W) vol[idx(ox, absY, ins)] = 0;
                  break;
                case 'north': // z = D-ins-1
                  if (ox >= 0 && ox < W) vol[idx(ox, absY, D - ins - 1)] = 0;
                  break;
                case 'east':  // x = W-ins-1
                  if (ox >= 0 && ox < D) vol[idx(W - ins - 1, absY, ox)] = 0;
                  break;
                case 'west':  // x = ins
                  if (ox >= 0 && ox < D) vol[idx(ins, absY, ox)] = 0;
                  break;
              }
            }
          }
        }
      }
    }
  }
  return vol;
}

// ── Greedy Mesher ────────────────────────────────────────────────

interface QuadData {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

function addQuad(
  data: QuadData,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  nx: number, ny: number, nz: number,
  shade: number, ci: number,
): void {
  const c = idxToColor(ci);
  const r = c.r * shade, g = c.g * shade, b = c.b * shade;
  const base = data.positions.length / 3;

  data.positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3);
  for (let i = 0; i < 4; i++) data.normals.push(nx, ny, nz);
  for (let i = 0; i < 4; i++) data.colors.push(r, g, b);
  data.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function greedyRect(
  mask: Int32Array, cols: number, rows: number,
  emit: (c0: number, r0: number, c1: number, r1: number, ci: number) => void,
): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = mask[r * cols + c]!;
      if (ci === 0) continue;
      // Find width
      let w = 1;
      while (c + w < cols && mask[r * cols + c + w] === ci) w++;
      // Find height
      let h = 1;
      outer: while (r + h < rows) {
        for (let dc = 0; dc < w; dc++) {
          if (mask[(r + h) * cols + c + dc] !== ci) break outer;
        }
        h++;
      }
      emit(c, r, c + w, r + h, ci);
      // Clear merged region
      for (let dr = 0; dr < h; dr++)
        for (let dc = 0; dc < w; dc++)
          mask[(r + dr) * cols + c + dc] = 0;
    }
  }
}

function greedyMesh(vol: Uint8Array, W: number, D: number, H: number): THREE.BufferGeometry {
  const data: QuadData = { positions: [], normals: [], colors: [], indices: [] };
  const at = (x: number, y: number, z: number): number => {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return 0;
    return vol[y * W * D + z * W + x]!;
  };

  // Sweep Y axis (top/bottom faces)
  for (let y = 0; y <= H; y++) {
    const topMask = new Int32Array(W * D);
    const botMask = new Int32Array(W * D);
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        const below = at(x, y - 1, z);
        const above = at(x, y, z);
        if (below !== 0 && above === 0) topMask[z * W + x] = below;
        if (above !== 0 && below === 0) botMask[z * W + x] = above;
      }
    greedyRect(topMask, W, D, (x0, z0, x1, z1, ci) => {
      addQuad(data, x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, 0, 1, 0, FACE_SHADE.top, ci);
    });
    greedyRect(botMask, W, D, (x0, z0, x1, z1, ci) => {
      addQuad(data, x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, 0, -1, 0, FACE_SHADE.bottom, ci);
    });
  }

  // Sweep X axis (east/west faces)
  for (let x = 0; x <= W; x++) {
    const eastMask = new Int32Array(D * H);
    const westMask = new Int32Array(D * H);
    for (let y = 0; y < H; y++)
      for (let z = 0; z < D; z++) {
        const left  = at(x - 1, y, z);
        const right = at(x, y, z);
        if (left !== 0 && right === 0) eastMask[y * D + z] = left;
        if (right !== 0 && left === 0) westMask[y * D + z] = right;
      }
    greedyRect(eastMask, D, H, (z0, y0, z1, y1, ci) => {
      addQuad(data, x, y0, z1, x, y1, z1, x, y1, z0, x, y0, z0, 1, 0, 0, FACE_SHADE.east, ci);
    });
    greedyRect(westMask, D, H, (z0, y0, z1, y1, ci) => {
      addQuad(data, x, y0, z0, x, y1, z0, x, y1, z1, x, y0, z1, -1, 0, 0, FACE_SHADE.west, ci);
    });
  }

  // Sweep Z axis (south/north faces)
  for (let z = 0; z <= D; z++) {
    const southMask = new Int32Array(W * H);
    const northMask = new Int32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const behind = at(x, y, z - 1);
        const front  = at(x, y, z);
        if (behind !== 0 && front === 0) southMask[y * W + x] = behind;
        if (front !== 0 && behind === 0) northMask[y * W + x] = front;
      }
    greedyRect(southMask, W, H, (x0, y0, x1, y1, ci) => {
      addQuad(data, x0, y0, z, x0, y1, z, x1, y1, z, x1, y0, z, 0, 0, 1, FACE_SHADE.south, ci);
    });
    greedyRect(northMask, W, H, (x0, y0, x1, y1, ci) => {
      addQuad(data, x1, y0, z, x1, y1, z, x0, y1, z, x0, y0, z, 0, 0, -1, FACE_SHADE.north, ci);
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  geo.setIndex(data.indices);
  return geo;
}

// ── Building Templates ──────────────────────────────────────────

// ── Roman ────────────────────────────────────────────────────────

const ROMAN_INSULA: BuildingTemplate = {
  name: 'roman_insula', type: 'insula', culture: 'roman',
  width: 12, depth: 10, height: 16, footprintW: 12, footprintD: 10,
  layers: [
    { yStart: 0, yEnd: 1,   fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 2, yEnd: 3,   fill: 'shell', color: 'terracotta',  inset: 0,
      openings: [{ face: 'south', xStart: 5, xEnd: 7, yStart: 0, yEnd: 1, type: 'door' }] },
    { yStart: 4, yEnd: 5,   fill: 'shell', color: 'cream',       inset: 0,
      openings: [
        { face: 'south', xStart: 2, xEnd: 3, yStart: 0, yEnd: 1, type: 'window' },
        { face: 'south', xStart: 5, xEnd: 6, yStart: 0, yEnd: 1, type: 'window' },
        { face: 'south', xStart: 9, xEnd: 10, yStart: 0, yEnd: 1, type: 'window' },
      ] },
    { yStart: 6, yEnd: 9,   fill: 'shell', color: 'terracotta',  inset: 0 },
    { yStart: 10, yEnd: 13, fill: 'shell', color: 'cream',       inset: 0 },
    { yStart: 14, yEnd: 14, fill: 'solid', color: 'terracotta',  inset: 1 },
    { yStart: 15, yEnd: 15, fill: 'roof',  color: 'roman_roof',  inset: 0 },
  ],
};

const ROMAN_DOMUS: BuildingTemplate = {
  name: 'roman_domus', type: 'domus', culture: 'roman',
  width: 10, depth: 8, height: 8, footprintW: 11, footprintD: 9,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 1, yEnd: 5, fill: 'shell', color: 'cream',       inset: 0,
      openings: [
        { face: 'south', xStart: 4, xEnd: 6, yStart: 0, yEnd: 1, type: 'door' },
        { face: 'south', xStart: 1, xEnd: 2, yStart: 1, yEnd: 2, type: 'window' },
        { face: 'south', xStart: 7, xEnd: 8, yStart: 1, yEnd: 2, type: 'window' },
      ] },
    { yStart: 6, yEnd: 6, fill: 'solid', color: 'terracotta',  inset: 1 },
    { yStart: 7, yEnd: 7, fill: 'roof',  color: 'roman_roof',  inset: 0 },
  ],
};

const ROMAN_TEMPLE: BuildingTemplate = {
  name: 'roman_temple', type: 'temple', culture: 'roman',
  width: 10, depth: 8, height: 12, footprintW: 11, footprintD: 9,
  layers: [
    { yStart: 0,  yEnd: 1,  fill: 'solid',   color: 'marble',     inset: 0 },
    { yStart: 2,  yEnd: 2,  fill: 'solid',   color: 'marble',     inset: 1 },
    { yStart: 3,  yEnd: 9,  fill: 'columns', color: 'column',     inset: 0, columnSpacing: 3 },
    { yStart: 3,  yEnd: 9,  fill: 'shell',   color: 'marble',     inset: 3 },
    { yStart: 10, yEnd: 10, fill: 'solid',   color: 'marble',     inset: 0 },
    { yStart: 11, yEnd: 11, fill: 'roof',    color: 'roman_roof', inset: 0 },
  ],
};

const ROMAN_FORUM: BuildingTemplate = {
  name: 'roman_forum', type: 'forum', culture: 'roman',
  width: 16, depth: 14, height: 8, footprintW: 18, footprintD: 16,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid',   color: 'marble',     inset: 0 },
    { yStart: 1, yEnd: 6, fill: 'columns', color: 'column',     inset: 0, columnSpacing: 2 },
    { yStart: 7, yEnd: 7, fill: 'solid',   color: 'marble',     inset: 0 },
  ],
};

const ROMAN_THERMAE: BuildingTemplate = {
  name: 'roman_thermae', type: 'thermae', culture: 'roman',
  width: 14, depth: 12, height: 10, footprintW: 15, footprintD: 13,
  layers: [
    { yStart: 0, yEnd: 0,  fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 1, yEnd: 7,  fill: 'shell', color: 'cream',       inset: 0,
      openings: [
        { face: 'south', xStart: 5,  xEnd: 9,  yStart: 0, yEnd: 2, type: 'arch' },
        { face: 'east',  xStart: 4,  xEnd: 7,  yStart: 1, yEnd: 2, type: 'arch' },
      ] },
    { yStart: 8, yEnd: 8,  fill: 'solid', color: 'cream',       inset: 1 },
    { yStart: 9, yEnd: 9,  fill: 'roof',  color: 'roman_roof',  inset: 0 },
  ],
};

const ROMAN_BASILICA: BuildingTemplate = {
  name: 'roman_basilica', type: 'basilica', culture: 'roman',
  width: 18, depth: 10, height: 12, footprintW: 20, footprintD: 12,
  layers: [
    { yStart: 0,  yEnd: 0,  fill: 'solid',   color: 'floor_stone', inset: 0 },
    { yStart: 1,  yEnd: 9,  fill: 'columns', color: 'column',      inset: 0, columnSpacing: 3 },
    { yStart: 1,  yEnd: 9,  fill: 'shell',   color: 'cream',       inset: 3 },
    { yStart: 10, yEnd: 10, fill: 'solid',   color: 'marble',      inset: 0 },
    { yStart: 11, yEnd: 11, fill: 'roof',    color: 'roman_roof',  inset: 0 },
  ],
};

// ── Greek ────────────────────────────────────────────────────────

const GREEK_STOA: BuildingTemplate = {
  name: 'greek_stoa', type: 'stoa', culture: 'greek',
  width: 20, depth: 6, height: 7, footprintW: 22, footprintD: 7,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid',   color: 'white',      inset: 0 },
    { yStart: 1, yEnd: 4, fill: 'columns', color: 'column',     inset: 0, columnSpacing: 2 },
    { yStart: 1, yEnd: 4, fill: 'shell',   color: 'white',      inset: 5 },
    { yStart: 5, yEnd: 5, fill: 'solid',   color: 'white',      inset: 0 },
    { yStart: 6, yEnd: 6, fill: 'solid',   color: 'greek_roof', inset: 0 },
  ],
};

const GREEK_TEMPLE: BuildingTemplate = {
  name: 'greek_temple', type: 'temple', culture: 'greek',
  width: 12, depth: 10, height: 12, footprintW: 13, footprintD: 11,
  layers: [
    { yStart: 0,  yEnd: 2,  fill: 'solid',   color: 'white',       inset: 0 },
    { yStart: 3,  yEnd: 9,  fill: 'columns', color: 'column',      inset: 0, columnSpacing: 2 },
    { yStart: 3,  yEnd: 9,  fill: 'shell',   color: 'white',       inset: 3 },
    { yStart: 10, yEnd: 10, fill: 'solid',   color: 'white',       inset: 0 },
    { yStart: 11, yEnd: 11, fill: 'roof',    color: 'blue_accent', inset: 0 },
  ],
};

const GREEK_AGORA: BuildingTemplate = {
  name: 'greek_agora', type: 'agora', culture: 'greek',
  width: 14, depth: 14, height: 5, footprintW: 16, footprintD: 16,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid',   color: 'white',  inset: 0 },
    { yStart: 1, yEnd: 4, fill: 'columns', color: 'column', inset: 0, columnSpacing: 2 },
  ],
};

const GREEK_THEATRE: BuildingTemplate = {
  name: 'greek_theatre', type: 'theatre', culture: 'greek',
  width: 16, depth: 16, height: 8, footprintW: 18, footprintD: 18,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid',  color: 'white',      inset: 0 },
    { yStart: 1, yEnd: 1, fill: 'shell',  color: 'white',      inset: 4 },
    { yStart: 2, yEnd: 2, fill: 'shell',  color: 'white',      inset: 3 },
    { yStart: 3, yEnd: 3, fill: 'shell',  color: 'white',      inset: 2 },
    { yStart: 4, yEnd: 4, fill: 'shell',  color: 'white',      inset: 1 },
    { yStart: 5, yEnd: 5, fill: 'solid',  color: 'white',      inset: 0 },
    { yStart: 6, yEnd: 6, fill: 'shell',  color: 'column',     inset: 6 },
    { yStart: 7, yEnd: 7, fill: 'roof',   color: 'greek_roof', inset: 4 },
  ],
};

// ── Egyptian ─────────────────────────────────────────────────────

const EGYPTIAN_MASTABA: BuildingTemplate = {
  name: 'egyptian_mastaba', type: 'mastaba', culture: 'egyptian',
  width: 10, depth: 7, height: 6, footprintW: 11, footprintD: 8,
  layers: [
    { yStart: 0, yEnd: 3, fill: 'solid', color: 'sandstone', inset: 0 },
    { yStart: 3, yEnd: 5, fill: 'solid', color: 'sandstone', inset: 1 },
    { yStart: 5, yEnd: 5, fill: 'solid', color: 'dark_sand', inset: 2 },
  ],
};

const EGYPTIAN_OBELISK: BuildingTemplate = {
  name: 'egyptian_obelisk', type: 'obelisk', culture: 'egyptian',
  width: 3, depth: 3, height: 16, footprintW: 4, footprintD: 4,
  layers: [
    { yStart: 0,  yEnd: 1,  fill: 'solid', color: 'sandstone', inset: 0 },
    { yStart: 2,  yEnd: 12, fill: 'solid', color: 'limestone', inset: 0 },
    { yStart: 13, yEnd: 14, fill: 'solid', color: 'limestone', inset: 1 },
    { yStart: 15, yEnd: 15, fill: 'solid', color: 'gold',      inset: 1 },
  ],
};

const EGYPTIAN_PYLON: BuildingTemplate = {
  name: 'egyptian_pylon', type: 'pylon', culture: 'egyptian',
  width: 14, depth: 6, height: 12, footprintW: 15, footprintD: 7,
  layers: [
    { yStart: 0,  yEnd: 11, fill: 'solid', color: 'sandstone', inset: 0,
      openings: [
        { face: 'south', xStart: 5, xEnd: 9, yStart: 0, yEnd: 5, type: 'arch' },
        { face: 'north', xStart: 5, xEnd: 9, yStart: 0, yEnd: 5, type: 'arch' },
      ] },
  ],
};

const EGYPTIAN_PYRAMID: BuildingTemplate = {
  name: 'egyptian_pyramid', type: 'pyramid', culture: 'egyptian',
  width: 14, depth: 14, height: 10, footprintW: 15, footprintD: 15,
  layers: [
    { yStart: 0,  yEnd: 9,  fill: 'roof',  color: 'sandstone', inset: 0 },
  ],
};

// ── Eastern ──────────────────────────────────────────────────────

const EASTERN_DOME: BuildingTemplate = {
  name: 'eastern_dome', type: 'dome', culture: 'eastern',
  width: 10, depth: 10, height: 13, footprintW: 11, footprintD: 11,
  layers: [
    { yStart: 0,  yEnd: 0,  fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 1,  yEnd: 6,  fill: 'shell', color: 'ochre',       inset: 0,
      openings: [
        { face: 'south', xStart: 4, xEnd: 6, yStart: 0, yEnd: 2, type: 'arch' },
        { face: 'east',  xStart: 4, xEnd: 6, yStart: 0, yEnd: 2, type: 'arch' },
      ] },
    { yStart: 7,  yEnd: 7,  fill: 'solid', color: 'plaster',    inset: 0 },
    { yStart: 8,  yEnd: 8,  fill: 'solid', color: 'dome_green', inset: 1 },
    { yStart: 9,  yEnd: 9,  fill: 'solid', color: 'dome_green', inset: 2 },
    { yStart: 10, yEnd: 10, fill: 'solid', color: 'dome_green', inset: 3 },
    { yStart: 11, yEnd: 12, fill: 'solid', color: 'gold',       inset: 4 },
  ],
};

const EASTERN_MARKET: BuildingTemplate = {
  name: 'eastern_market', type: 'market', culture: 'eastern',
  width: 12, depth: 12, height: 8, footprintW: 13, footprintD: 13,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 1, yEnd: 5, fill: 'shell', color: 'ochre',       inset: 0,
      openings: [
        { face: 'south', xStart: 2,  xEnd: 4,  yStart: 0, yEnd: 2, type: 'arch' },
        { face: 'south', xStart: 8,  xEnd: 10, yStart: 0, yEnd: 2, type: 'arch' },
      ] },
    { yStart: 6, yEnd: 6, fill: 'solid', color: 'plaster', inset: 1 },
    { yStart: 7, yEnd: 7, fill: 'solid', color: 'gold',    inset: 2 },
  ],
};

const EASTERN_PALACE: BuildingTemplate = {
  name: 'eastern_palace', type: 'palace', culture: 'eastern',
  width: 18, depth: 14, height: 14, footprintW: 20, footprintD: 16,
  layers: [
    { yStart: 0,  yEnd: 0,  fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 1,  yEnd: 8,  fill: 'shell', color: 'plaster',     inset: 0,
      openings: [
        { face: 'south', xStart: 7,  xEnd: 11, yStart: 0, yEnd: 3, type: 'arch' },
      ] },
    { yStart: 9,  yEnd: 9,  fill: 'solid', color: 'ochre',       inset: 1 },
    { yStart: 1,  yEnd: 10, fill: 'shell', color: 'ochre',       inset: 6 },
    { yStart: 10, yEnd: 11, fill: 'solid', color: 'dome_green',  inset: 7 },
    { yStart: 12, yEnd: 13, fill: 'solid', color: 'gold',        inset: 8 },
  ],
};

// ── Celtic ───────────────────────────────────────────────────────

const CELTIC_ROUNDHOUSE: BuildingTemplate = {
  name: 'celtic_roundhouse', type: 'roundhouse', culture: 'celtic',
  width: 7, depth: 7, height: 7, footprintW: 8, footprintD: 8,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'wattle', inset: 0 },
    { yStart: 1, yEnd: 3, fill: 'shell', color: 'wood',   inset: 1,
      openings: [{ face: 'south', xStart: 2, xEnd: 5, yStart: 0, yEnd: 1, type: 'door' }] },
    { yStart: 4, yEnd: 6, fill: 'roof',  color: 'thatch', inset: 1 },
  ],
};

const CELTIC_HALL: BuildingTemplate = {
  name: 'celtic_hall', type: 'hall', culture: 'celtic',
  width: 12, depth: 6, height: 8, footprintW: 13, footprintD: 7,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'wattle',    inset: 0 },
    { yStart: 1, yEnd: 4, fill: 'shell', color: 'dark_wood', inset: 0,
      openings: [{ face: 'south', xStart: 5, xEnd: 7, yStart: 0, yEnd: 1, type: 'door' }] },
    { yStart: 5, yEnd: 7, fill: 'roof',  color: 'thatch',    inset: 0 },
  ],
};

const CELTIC_HILLFORT: BuildingTemplate = {
  name: 'celtic_hillfort', type: 'hillfort', culture: 'celtic',
  width: 14, depth: 14, height: 5, footprintW: 16, footprintD: 16,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'wattle',    inset: 0 },
    { yStart: 1, yEnd: 4, fill: 'shell', color: 'dark_wood', inset: 0 },
  ],
};

// ── Germanic ─────────────────────────────────────────────────────

const GERMANIC_LONGHOUSE: BuildingTemplate = {
  name: 'germanic_longhouse', type: 'longhouse', culture: 'germanic',
  width: 14, depth: 6, height: 7, footprintW: 15, footprintD: 7,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'wattle', inset: 0 },
    { yStart: 1, yEnd: 3, fill: 'shell', color: 'wood',   inset: 0,
      openings: [{ face: 'south', xStart: 6, xEnd: 8, yStart: 0, yEnd: 1, type: 'door' }] },
    { yStart: 4, yEnd: 6, fill: 'roof',  color: 'thatch', inset: 0 },
  ],
};

const GERMANIC_MEAD_HALL: BuildingTemplate = {
  name: 'germanic_mead_hall', type: 'mead_hall', culture: 'germanic',
  width: 16, depth: 8, height: 9, footprintW: 18, footprintD: 10,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'wattle',    inset: 0 },
    { yStart: 1, yEnd: 5, fill: 'shell', color: 'dark_wood', inset: 0,
      openings: [
        { face: 'south', xStart: 6,  xEnd: 10, yStart: 0, yEnd: 2, type: 'door' },
      ] },
    { yStart: 6, yEnd: 8, fill: 'roof',  color: 'thatch',    inset: 0 },
  ],
};

// ── Dacian ───────────────────────────────────────────────────────

const DACIAN_FORTRESS: BuildingTemplate = {
  name: 'dacian_fortress', type: 'fortress', culture: 'dacian',
  width: 16, depth: 16, height: 8, footprintW: 18, footprintD: 18,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'dacian_stone', inset: 0 },
    { yStart: 1, yEnd: 6, fill: 'shell', color: 'dacian_stone', inset: 0 },
    { yStart: 7, yEnd: 7, fill: 'shell', color: 'dacian_wood',  inset: 0 },
  ],
};

const DACIAN_TOWER: BuildingTemplate = {
  name: 'dacian_tower', type: 'tower', culture: 'dacian',
  width: 5, depth: 5, height: 10, footprintW: 6, footprintD: 6,
  layers: [
    { yStart: 0, yEnd: 8,  fill: 'shell', color: 'dacian_stone', inset: 0 },
    { yStart: 9, yEnd: 9,  fill: 'solid', color: 'dacian_stone', inset: 0 },
  ],
};

// ── North African ────────────────────────────────────────────────

const NAFR_VILLA: BuildingTemplate = {
  name: 'nafr_villa', type: 'villa', culture: 'north_african',
  width: 12, depth: 10, height: 7, footprintW: 13, footprintD: 11,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 1, yEnd: 5, fill: 'shell', color: 'sandstone',   inset: 0,
      openings: [
        { face: 'south', xStart: 5, xEnd: 7, yStart: 0, yEnd: 2, type: 'arch' },
      ] },
    { yStart: 6, yEnd: 6, fill: 'solid', color: 'sandstone',   inset: 1 },
  ],
};

const NAFR_TEMPLE: BuildingTemplate = {
  name: 'nafr_temple', type: 'temple', culture: 'north_african',
  width: 10, depth: 8, height: 10, footprintW: 11, footprintD: 9,
  layers: [
    { yStart: 0, yEnd: 1,  fill: 'solid',   color: 'sandstone',  inset: 0 },
    { yStart: 2, yEnd: 7,  fill: 'columns', color: 'column',     inset: 0, columnSpacing: 2 },
    { yStart: 2, yEnd: 7,  fill: 'shell',   color: 'sandstone',  inset: 3 },
    { yStart: 8, yEnd: 8,  fill: 'solid',   color: 'sandstone',  inset: 0 },
    { yStart: 9, yEnd: 9,  fill: 'roof',    color: 'roman_roof', inset: 0 },
  ],
};

// ── Levantine ────────────────────────────────────────────────────

const LEV_TOWNHOUSE: BuildingTemplate = {
  name: 'lev_townhouse', type: 'townhouse', culture: 'levantine',
  width: 8, depth: 8, height: 9, footprintW: 9, footprintD: 9,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid', color: 'floor_stone', inset: 0 },
    { yStart: 1, yEnd: 6, fill: 'shell', color: 'plaster',     inset: 0,
      openings: [
        { face: 'south', xStart: 3, xEnd: 5, yStart: 0, yEnd: 1, type: 'door' },
        { face: 'south', xStart: 1, xEnd: 2, yStart: 2, yEnd: 3, type: 'window' },
      ] },
    { yStart: 7, yEnd: 7, fill: 'solid', color: 'plaster',    inset: 1 },
    { yStart: 8, yEnd: 8, fill: 'solid', color: 'dome_green', inset: 2 },
  ],
};

const LEV_COLONNADE: BuildingTemplate = {
  name: 'lev_colonnade', type: 'colonnade', culture: 'levantine',
  width: 16, depth: 5, height: 7, footprintW: 18, footprintD: 6,
  layers: [
    { yStart: 0, yEnd: 0, fill: 'solid',   color: 'marble',     inset: 0 },
    { yStart: 1, yEnd: 5, fill: 'columns', color: 'column',     inset: 0, columnSpacing: 2 },
    { yStart: 1, yEnd: 5, fill: 'shell',   color: 'plaster',    inset: 4 },
    { yStart: 6, yEnd: 6, fill: 'solid',   color: 'marble',     inset: 0 },
  ],
};

// ── Culture Template Registry ────────────────────────────────────

const ALL_TEMPLATES: BuildingTemplate[] = [
  ROMAN_INSULA, ROMAN_DOMUS, ROMAN_TEMPLE, ROMAN_FORUM, ROMAN_THERMAE, ROMAN_BASILICA,
  GREEK_STOA, GREEK_TEMPLE, GREEK_AGORA, GREEK_THEATRE,
  EGYPTIAN_MASTABA, EGYPTIAN_OBELISK, EGYPTIAN_PYLON, EGYPTIAN_PYRAMID,
  EASTERN_DOME, EASTERN_MARKET, EASTERN_PALACE,
  CELTIC_ROUNDHOUSE, CELTIC_HALL, CELTIC_HILLFORT,
  GERMANIC_LONGHOUSE, GERMANIC_MEAD_HALL,
  DACIAN_FORTRESS, DACIAN_TOWER,
  NAFR_VILLA, NAFR_TEMPLE,
  LEV_TOWNHOUSE, LEV_COLONNADE,
];

const CULTURE_TEMPLATES: Record<string, BuildingTemplate[]> = {
  roman:         [ROMAN_INSULA, ROMAN_DOMUS, ROMAN_TEMPLE, ROMAN_FORUM, ROMAN_THERMAE, ROMAN_BASILICA],
  greek:         [GREEK_STOA, GREEK_TEMPLE, GREEK_AGORA, GREEK_THEATRE],
  egyptian:      [EGYPTIAN_MASTABA, EGYPTIAN_OBELISK, EGYPTIAN_PYLON, EGYPTIAN_PYRAMID],
  eastern:       [EASTERN_DOME, EASTERN_MARKET, EASTERN_PALACE],
  celtic:        [CELTIC_ROUNDHOUSE, CELTIC_HALL, CELTIC_HILLFORT],
  germanic:      [GERMANIC_LONGHOUSE, GERMANIC_MEAD_HALL],
  dacian:        [DACIAN_FORTRESS, DACIAN_TOWER, CELTIC_HALL],
  north_african: [NAFR_VILLA, NAFR_TEMPLE, ROMAN_INSULA, EGYPTIAN_MASTABA],
  levantine:     [LEV_TOWNHOUSE, LEV_COLONNADE, EASTERN_DOME, GREEK_STOA],
};

function findTemplate(name: string): BuildingTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.name === name);
}

// ── Deterministic Hash ───────────────────────────────────────────

function cityHash(seed: number, offset: number): number {
  let h = ((seed + offset) * 374761393) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) | 0;
  return (h >>> 0) / 4294967296;
}

// ── Geometry Cache ───────────────────────────────────────────────

const geometryCache = new Map<string, THREE.BufferGeometry>();

function getTemplateGeometry(template: BuildingTemplate): THREE.BufferGeometry {
  const cached = geometryCache.get(template.name);
  if (cached) return cached;

  const vol = buildVoxelVolume(template);
  const geo = greedyMesh(vol, template.width, template.depth, template.height);
  geo.translate(-template.width / 2, 0, -template.depth / 2);

  geometryCache.set(template.name, geo);
  return geo;
}

// ── City Layout Generator ────────────────────────────────────────

export interface PlacedBuilding {
  templateName: string;
  worldX: number;
  worldY: number;
  worldZ: number;
  rotation: number;
  scale: number;
}

export function generateCityLayout(
  cityId: string,
  tier: CityTier,
  culture: CultureType,
  centerX: number,
  centerZ: number,
  terrainHeight: number,
): PlacedBuilding[] {
  let seed = 0;
  for (let i = 0; i < cityId.length; i++) {
    seed = (seed * 31 + cityId.charCodeAt(i)) | 0;
  }

  const templates = CULTURE_TEMPLATES[culture] ?? CULTURE_TEMPLATES['roman']!;
  const buildings: PlacedBuilding[] = [];

  const counts: Record<CityTier, [number, number]> = {
    1: [20, 32], 2: [12, 20], 3: [6, 12], 4: [3, 6],
  };
  const radius: Record<CityTier, number> = { 1: 35, 2: 22, 3: 14, 4: 7 };

  const [minCount, maxCount] = counts[tier];
  const count = Math.floor(minCount + cityHash(seed, 0) * (maxCount - minCount));
  const r = radius[tier];

  for (let i = 0; i < count; i++) {
    const baseIdx = i % templates.length;
    const shiftIdx = Math.floor(cityHash(seed, i * 7 + 6) * templates.length);
    const template = templates[(baseIdx + shiftIdx) % templates.length];
    if (!template) continue;

    const angle = cityHash(seed, i * 7 + 2) * Math.PI * 2;
    const dist = cityHash(seed, i * 7 + 3) * r;
    const scale = 0.7 + cityHash(seed, i * 7 + 5) * 0.6;
    const rotation = Math.floor(cityHash(seed, i * 7 + 4) * 4) * (Math.PI / 2);

    buildings.push({
      templateName: template.name,
      worldX: centerX + Math.cos(angle) * dist,
      worldY: terrainHeight,
      worldZ: centerZ + Math.sin(angle) * dist,
      rotation,
      scale,
    });
  }
  return buildings;
}

// ── Building Renderer ────────────────────────────────────────────

const BUILDING_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.9,
  metalness: 0.05,
  side: THREE.FrontSide,
});

export class BuildingRenderer {
  private readonly scene: THREE.Scene;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly group: THREE.Group;
  private visible = true;

  private readonly _mat4  = new THREE.Matrix4();
  private readonly _scale = new THREE.Vector3();
  private readonly _quat  = new THREE.Quaternion();
  private readonly _pos   = new THREE.Vector3();
  private readonly _euler = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'CityBuildings';
    this.scene.add(this.group);
  }

  rebuild(buildings: PlacedBuilding[]): void {
    this.clear();

    const byTemplate = new Map<string, PlacedBuilding[]>();
    for (const b of buildings) {
      const arr = byTemplate.get(b.templateName);
      if (arr) arr.push(b);
      else byTemplate.set(b.templateName, [b]);
    }

    for (const [templateName, instances] of byTemplate) {
      const template = findTemplate(templateName);
      if (!template) continue;

      const geo = getTemplateGeometry(template);
      const mesh = new THREE.InstancedMesh(geo, BUILDING_MATERIAL, instances.length);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

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
    for (const [, geo] of geometryCache) geo.dispose();
    geometryCache.clear();
  }
}
