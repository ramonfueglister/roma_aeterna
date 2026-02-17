/**
 * City database barrel — re-exports from split modules.
 *
 * The original monolithic file has been split into:
 *   - cityData.ts:     Static city data (312 cities, coordinate helpers)
 *   - cityRenderer.ts: CityRenderer class (LOD-aware InstancedMesh renderer)
 *
 * All existing imports from './cityDatabase' continue to work unchanged.
 */

export { CITY_DATABASE, lonToTile, latToTile } from './cityData';
export { CityRenderer } from './cityRenderer';
