/**
 * Entity archetype factory functions.
 *
 * Each archetype adds the required set of components to a new entity.
 * These functions are the canonical way to create game objects in the ECS.
 */

import type { World } from 'bitecs';
import { addEntity, addComponent } from 'bitecs';
import {
  Position, Velocity, Rotation,
  ChunkCoord, LODLevel, MeshRef, InstanceRef,
  CityInfo, CityDisplay,
  AgentRole, AgentMovement,
  TreeVariant, ProvinceTag, ResourceSite,
  ServerSync, Visible,
  IsChunk, IsCity, IsAgent, IsTree,
  IsProvince, IsResource, IsCamera, IsWater,
} from './components';

// ── Chunk ────────────────────────────────────────────────────────

export function addChunkArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsChunk);
  addComponent(world, eid, ChunkCoord);
  addComponent(world, eid, LODLevel);
  addComponent(world, eid, MeshRef);
  addComponent(world, eid, Visible);

  // Defaults
  MeshRef.geometryId[eid] = -1;
  MeshRef.instanceId[eid] = -1;
  Visible.value[eid] = 1;
}

/** Create a new chunk entity and return its eid. */
export function createChunkEntity(world: World): number {
  const eid = addEntity(world);
  addChunkArchetype(world, eid);
  return eid;
}

// ── City ─────────────────────────────────────────────────────────

export function addCityArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsCity);
  addComponent(world, eid, Position);
  addComponent(world, eid, CityInfo);
  addComponent(world, eid, CityDisplay);
  addComponent(world, eid, LODLevel);
  addComponent(world, eid, MeshRef);
  addComponent(world, eid, InstanceRef);
  addComponent(world, eid, Visible);
  addComponent(world, eid, ServerSync);

  // Defaults
  MeshRef.geometryId[eid] = -1;
  MeshRef.instanceId[eid] = -1;
  InstanceRef.instanceId[eid] = -1;
  Visible.value[eid] = 1;
}

export function createCityEntity(world: World): number {
  const eid = addEntity(world);
  addCityArchetype(world, eid);
  return eid;
}

// ── Agent ────────────────────────────────────────────────────────

export function addAgentArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsAgent);
  addComponent(world, eid, Position);
  addComponent(world, eid, Rotation);
  addComponent(world, eid, AgentRole);
  addComponent(world, eid, AgentMovement);
  addComponent(world, eid, InstanceRef);
  addComponent(world, eid, Visible);
  addComponent(world, eid, ServerSync);

  // Defaults
  InstanceRef.instanceId[eid] = -1;
  Visible.value[eid] = 1;
}

export function createAgentEntity(world: World): number {
  const eid = addEntity(world);
  addAgentArchetype(world, eid);
  return eid;
}

// ── Tree ─────────────────────────────────────────────────────────

export function addTreeArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsTree);
  addComponent(world, eid, Position);
  addComponent(world, eid, TreeVariant);
  addComponent(world, eid, InstanceRef);
  addComponent(world, eid, Visible);

  // Defaults
  InstanceRef.instanceId[eid] = -1;
  TreeVariant.scale[eid] = 1.0;
  Visible.value[eid] = 1;
}

export function createTreeEntity(world: World): number {
  const eid = addEntity(world);
  addTreeArchetype(world, eid);
  return eid;
}

// ── Province ─────────────────────────────────────────────────────

export function addProvinceArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsProvince);
  addComponent(world, eid, ProvinceTag);
  addComponent(world, eid, Position);
  addComponent(world, eid, Visible);

  Visible.value[eid] = 1;
}

export function createProvinceEntity(world: World): number {
  const eid = addEntity(world);
  addProvinceArchetype(world, eid);
  return eid;
}

// ── Resource Site ────────────────────────────────────────────────

export function addResourceArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsResource);
  addComponent(world, eid, Position);
  addComponent(world, eid, ResourceSite);
  addComponent(world, eid, InstanceRef);
  addComponent(world, eid, Visible);
  addComponent(world, eid, ServerSync);

  InstanceRef.instanceId[eid] = -1;
  Visible.value[eid] = 1;
}

export function createResourceEntity(world: World): number {
  const eid = addEntity(world);
  addResourceArchetype(world, eid);
  return eid;
}

// ── Camera (Singleton) ───────────────────────────────────────────

export function addCameraArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsCamera);
  addComponent(world, eid, Position);
  addComponent(world, eid, Rotation);
  addComponent(world, eid, Velocity);
}

export function createCameraEntity(world: World): number {
  const eid = addEntity(world);
  addCameraArchetype(world, eid);
  return eid;
}

// ── Water Plane (Singleton) ──────────────────────────────────────

export function addWaterArchetype(world: World, eid: number): void {
  addComponent(world, eid, IsWater);
  addComponent(world, eid, MeshRef);
  addComponent(world, eid, Visible);

  MeshRef.geometryId[eid] = -1;
  MeshRef.instanceId[eid] = -1;
  Visible.value[eid] = 1;
}

export function createWaterEntity(world: World): number {
  const eid = addEntity(world);
  addWaterArchetype(world, eid);
  return eid;
}
