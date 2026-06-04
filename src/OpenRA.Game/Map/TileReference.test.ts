/**
 * TileReference.test.ts — TileReference migration unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TERRAIN_TILE,
  DEFAULT_RESOURCE_TILE,
  createTerrainTile,
  createResourceTile,
  terrainTileEquals,
  resourceTileEquals,
} from './TileReference'

// ---------------------------------------------------------------------------
// TerrainTile
// ---------------------------------------------------------------------------

describe('TerrainTile', () => {
  it('DEFAULT_TERRAIN_TILE has type 0 and index 0', () => {
    expect(DEFAULT_TERRAIN_TILE.type).toBe(0)
    expect(DEFAULT_TERRAIN_TILE.index).toBe(0)
  })

  it('createTerrainTile returns correct values', () => {
    const tile = createTerrainTile(42, 7)
    expect(tile.type).toBe(42)
    expect(tile.index).toBe(7)
  })

  it('terrainTileEquals returns true for identical tiles', () => {
    const a = createTerrainTile(1, 2)
    const b = createTerrainTile(1, 2)
    expect(terrainTileEquals(a, b)).toBe(true)
  })

  it('terrainTileEquals returns false for different type', () => {
    const a = createTerrainTile(1, 2)
    const b = createTerrainTile(2, 2)
    expect(terrainTileEquals(a, b)).toBe(false)
  })

  it('terrainTileEquals returns false for different index', () => {
    const a = createTerrainTile(1, 2)
    const b = createTerrainTile(1, 3)
    expect(terrainTileEquals(a, b)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ResourceTile
// ---------------------------------------------------------------------------

describe('ResourceTile', () => {
  it('DEFAULT_RESOURCE_TILE has type 0 and index 0', () => {
    expect(DEFAULT_RESOURCE_TILE.type).toBe(0)
    expect(DEFAULT_RESOURCE_TILE.index).toBe(0)
  })

  it('createResourceTile returns correct values', () => {
    const tile = createResourceTile(3, 100)
    expect(tile.type).toBe(3)
    expect(tile.index).toBe(100)
  })

  it('resourceTileEquals returns true for identical tiles', () => {
    const a = createResourceTile(1, 50)
    const b = createResourceTile(1, 50)
    expect(resourceTileEquals(a, b)).toBe(true)
  })

  it('resourceTileEquals returns false for different type', () => {
    const a = createResourceTile(1, 50)
    const b = createResourceTile(2, 50)
    expect(resourceTileEquals(a, b)).toBe(false)
  })

  it('resourceTileEquals returns false for different index', () => {
    const a = createResourceTile(1, 50)
    const b = createResourceTile(1, 60)
    expect(resourceTileEquals(a, b)).toBe(false)
  })
})
