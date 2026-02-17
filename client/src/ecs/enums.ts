/**
 * ECS enum constants.
 *
 * All enums map to uint8 component fields. Values are stable —
 * append-only; never reorder existing entries.
 */

// ── Biome Types ──────────────────────────────────────────────────

export const BiomeType = {
  WATER: 0,
  GRASSLAND: 1,
  FOREST: 2,
  DESERT: 3,
  MOUNTAIN: 4,
  SNOW: 5,
  MARSH: 6,
  FARMLAND: 7,
  SCRUBLAND: 8,
  STEPPE: 9,
  COASTAL: 10,
} as const;
export type BiomeType = (typeof BiomeType)[keyof typeof BiomeType];

// ── Culture Types ────────────────────────────────────────────────

export const Culture = {
  ROMAN: 0,
  GREEK: 1,
  EGYPTIAN: 2,
  CELTIC: 3,
  GERMANIC: 4,
  IBERIAN: 5,
  NORTH_AFRICAN: 6,
  EASTERN: 7,
  BRITISH: 8,
} as const;
export type Culture = (typeof Culture)[keyof typeof Culture];

// ── Agent Types ──────────────────────────────────────────────────

export const AgentType = {
  TRADER: 0,
  SHIP: 1,
  LEGION: 2,
  CITIZEN: 3,
  CARAVAN: 4,
  MESSENGER: 5,
  PATROL: 6,
  FISHING_BOAT: 7,
} as const;
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

// ── Agent Roles (walker subtypes) ────────────────────────────────

export const AgentRoleType = {
  MARKET_WALKER: 0,
  SERVICE_WALKER: 1,
  LABORER: 2,
  PRIEST: 3,
  ENTERTAINER: 4,
} as const;
export type AgentRoleType = (typeof AgentRoleType)[keyof typeof AgentRoleType];

// ── Agent States ─────────────────────────────────────────────────

export const AgentState = {
  IDLE: 0,
  MOVING: 1,
  TRADING: 2,
  RESTING: 3,
  PATROLLING: 4,
  PLANNING: 5,
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];

// ── City Tiers ───────────────────────────────────────────────────

export const CityTier = {
  WORLD_WONDER: 1,
  MAJOR: 2,
  NOTABLE: 3,
  SMALL: 4,
} as const;
export type CityTier = (typeof CityTier)[keyof typeof CityTier];

// ── City Display LOD ─────────────────────────────────────────────

export const CityLODMode = {
  ICON: 0,
  CLUSTER: 1,
  DETAIL: 2,
} as const;
export type CityLODMode = (typeof CityLODMode)[keyof typeof CityLODMode];

// ── Tree Species ─────────────────────────────────────────────────

export const TreeSpecies = {
  CYPRESS: 0,
  OAK: 1,
  PALM: 2,
  OLIVE: 3,
  PINE: 4,
} as const;
export type TreeSpecies = (typeof TreeSpecies)[keyof typeof TreeSpecies];

// ── Resource Types (24 total) ────────────────────────────────────

export const ResourceType = {
  GRAIN: 0,
  FISH: 1,
  WINE: 2,
  OLIVES_OIL: 3,
  IRON: 4,
  GOLD: 5,
  SILVER: 6,
  COPPER: 7,
  TIN: 8,
  MARBLE: 9,
  WOOD: 10,
  SALT: 11,
  AMBER: 12,
  SILK: 13,
  SPICES: 14,
  INCENSE: 15,
  PAPYRUS: 16,
  DYES: 17,
  HORSES: 18,
  GLASS: 19,
  LINEN: 20,
  WOOL: 21,
  CERAMICS: 22,
  BRONZE: 23,
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

// ── Harvest States ───────────────────────────────────────────────

export const HarvestState = {
  IDLE: 0,
  WORK: 1,
  HAUL: 2,
  RECOVER: 3,
} as const;
export type HarvestState = (typeof HarvestState)[keyof typeof HarvestState];

// ── Instance Pool IDs ────────────────────────────────────────────

export const InstancePool = {
  TREE: 0,
  CITY_ICON: 1,
  AGENT_TRADER: 2,
  AGENT_SHIP: 3,
  AGENT_LEGION: 4,
  AGENT_CITIZEN: 5,
  AGENT_CARAVAN: 6,
  RESOURCE_ICON: 7,
} as const;
export type InstancePool = (typeof InstancePool)[keyof typeof InstancePool];
