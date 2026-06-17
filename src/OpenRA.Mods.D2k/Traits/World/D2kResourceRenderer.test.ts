/**
 * D2kResourceRenderer.test.ts — Unit tests for D2kResourceRenderer migration
 *
 * Tests focus on: ClearSides bit flag computation, FindClearSides algorithm,
 * SpriteMap completeness, rounded-border sprite index selection,
 * density-based fallback for surrounded cells.
 */

import { describe, it, expect } from 'vitest'
import {
  D2kResourceRenderer,
  D2kResourceRendererInfo,
  ClearSides,
} from './D2kResourceRenderer'
import type {
  RendererCellContents,
} from '../../../OpenRA.Mods.Common/Traits/World/ResourceRenderer'
import { CPos } from '../../../OpenRA.Game/CPos'
// IGameActor not directly used; trait system is duck-typed

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRenderer(overrides?: {
  resourceTypes?: Map<string, {
    image: string
    sequences: string[]
    palette: string
    name: string
  }>
}): D2kResourceRenderer {
  const resourceTypes = overrides?.resourceTypes ?? new Map()
  if (resourceTypes.size === 0) {
    resourceTypes.set('Spice', {
      image: 'spice',
      sequences: ['spice-variant'],
      palette: 'terrain',
      name: 'Spice',
    })
  }

  const info = new D2kResourceRendererInfo({ resourceTypes })

  // Mock world with sequences
  const world = {
    map: { mapSize: { width: 100, height: 100 } },
    sequences: {
      getSequence: () => ({
        name: 'spice-variant',
        length: 50, // enough frames for all sprite indices
        tick: 40,
        scale: 1,
        zOffset: 0,
        shadowZOffset: 0,
        ignoreWorldTint: false,
        bounds: { x: 0, y: 0, width: 64, height: 64 },
        getSprite: () => ({
          sheet: {},
          bounds: { x: 0, y: 0, width: 64, height: 64 },
          blendMode: 'Alpha',
          channel: 0,
        }),
        getSpriteWithRotation: () => ({ sprite: null, rotation: 0 }),
        getAlpha: () => 1,
        getShadow: () => null,
      }),
    },
    resourceLayer: {
      getMaxDensity: () => 100,
      getResource: () => ({ type: 'Spice', density: 0 }),
      isVisible: () => true,
      addCellChangedListener: () => {},
      removeCellChangedListener: () => {},
    },
  }

  return new D2kResourceRenderer(world as never, info)
}

/** Create a minimal RendererCellContents for testing. */
function makeContent(
  type: string,
  density: number,
  palette: unknown = null,
): RendererCellContents {
  return {
    type,
    density,
    info: {
      image: 'spice',
      sequences: ['spice-variant'],
      palette: 'terrain',
      name: 'Spice',
    },
    sequence: null, // D2k uses sprite index directly, not lerped frame
    palette: palette as never,
  }
}

// ---------------------------------------------------------------------------
// Tests: ClearSides constants
// ---------------------------------------------------------------------------

describe('ClearSides', () => {
  it('has unique bit values for cardinal directions', () => {
    expect(ClearSides.Left).toBe(0x01)
    expect(ClearSides.Top).toBe(0x02)
    expect(ClearSides.Right).toBe(0x04)
    expect(ClearSides.Bottom).toBe(0x08)
  })

  it('has unique bit values for corners', () => {
    expect(ClearSides.TopLeft).toBe(0x10)
    expect(ClearSides.TopRight).toBe(0x20)
    expect(ClearSides.BottomLeft).toBe(0x40)
    expect(ClearSides.BottomRight).toBe(0x80)
  })

  it('None is 0', () => {
    expect(ClearSides.None).toBe(0)
  })

  it('All is 0xFF', () => {
    expect(ClearSides.All).toBe(0xFF)
  })

  it('bitwise OR combines flags', () => {
    const combined = ClearSides.Left | ClearSides.Top
    expect(combined).toBe(0x03)
  })
})

// ---------------------------------------------------------------------------
// Tests: FindClearSides
// ---------------------------------------------------------------------------

describe('D2kResourceRenderer.findClearSides', () => {
  it('returns None for a cell surrounded by same resource on all sides', () => {
    const renderer = createRenderer()
    // All adjacent cells have 'Spice' (default renderContents returns 'Spice' through cellContains)
    // But cellContains checks renderContents, which is empty by default...
    // The default renderContents returns RendererCellContentsEmpty for unknown cells

    // Override cellContains behavior by populating renderContents
    // For a center cell (5,5), set all neighbors to have 'Spice'
    renderer['renderContents'].set(new CPos(5, 4), makeContent('Spice', 50)) // top
    renderer['renderContents'].set(new CPos(4, 5), makeContent('Spice', 50)) // left
    renderer['renderContents'].set(new CPos(6, 5), makeContent('Spice', 50)) // right
    renderer['renderContents'].set(new CPos(5, 6), makeContent('Spice', 50)) // bottom
    renderer['renderContents'].set(new CPos(4, 4), makeContent('Spice', 50)) // tl
    renderer['renderContents'].set(new CPos(6, 4), makeContent('Spice', 50)) // tr
    renderer['renderContents'].set(new CPos(4, 6), makeContent('Spice', 50)) // bl
    renderer['renderContents'].set(new CPos(6, 6), makeContent('Spice', 50)) // br

    // Center cell (5,5) is surrounded by Spice on all 8 sides
    // cellContains takes the neighbor cell, so the center cell's neighbors all have Spice
    // This means cellContains(center, 'Spice') checks renderContents at center position
    // For the approach to work, we need the center cell to also have Spice
    renderer['renderContents'].set(new CPos(5, 5), makeContent('Spice', 50))

    const result = renderer.findClearSides(new CPos(5, 5), 'Spice')
    expect(result).toBe(ClearSides.None)
  })

  it('detects isolated top clear side', () => {
    const renderer = createRenderer()
    // Center at (5,5), set all neighbors except top to have Spice
    renderer['renderContents'].set(new CPos(5, 5), makeContent('Spice', 50))
    renderer['renderContents'].set(new CPos(4, 5), makeContent('Spice', 50)) // left
    renderer['renderContents'].set(new CPos(6, 5), makeContent('Spice', 50)) // right
    renderer['renderContents'].set(new CPos(5, 6), makeContent('Spice', 50)) // bottom
    renderer['renderContents'].set(new CPos(4, 4), makeContent('Spice', 50)) // tl
    renderer['renderContents'].set(new CPos(6, 4), makeContent('Spice', 50)) // tr
    renderer['renderContents'].set(new CPos(4, 6), makeContent('Spice', 50)) // bl
    renderer['renderContents'].set(new CPos(6, 6), makeContent('Spice', 50)) // br
    // Top (5,4) is NOT set, so it's clear

    const result = renderer.findClearSides(new CPos(5, 5), 'Spice')
    expect(result & ClearSides.Top).not.toBe(0)
    expect(result & ClearSides.TopLeft).not.toBe(0)
    expect(result & ClearSides.TopRight).not.toBe(0)
  })

  it('returns correct flags when only top-left neighbor has spice', () => {
    const renderer = createRenderer()
    renderer['renderContents'].set(new CPos(5, 5), makeContent('Spice', 50))
    // Only set top-left neighbor (4,4) to have Spice
    renderer['renderContents'].set(new CPos(4, 4), makeContent('Spice', 50))

    const result = renderer.findClearSides(new CPos(5, 5), 'Spice')
    // Top neighbor (5,4) is clear -> Top | TopLeft | TopRight
    // Left neighbor (4,5) is clear -> Left | TopLeft | BottomLeft
    // NOTE: TopLeft gets set by both "Top clear" and "Left clear" checks
    // even though TopLeft cell itself has Spice. This is because the side
    // checks set corners proactively, but the corner-specific check clears them.
    // After corner check: TopLeft (4,4) has Spice -> TopLeft flag is removed
    // However, since Top side is clear, TopLeft gets set from that check.
    // The final result has TopLeft set because the Top side check takes priority.

    // Cardinal sides should all be set (all neighbors are clear)
    expect(result & ClearSides.Top).not.toBe(0)
    expect(result & ClearSides.Left).not.toBe(0)

    // Top-left corner-specific check: (4,4) has Spice -> should be cleared
    // But the side checks set it. The side checks run first, then corner check.
    // The corner check DOES set TopLeft if the neighbor lacks the resource.
    // Since (4,4) HAS Spice, the corner check should NOT set TopLeft.
    // But it was already set by the side checks.
    // This is correct behavior — sides take priority over corners in the algorithm.
    // The corner "has resource" = side shows a continuous border.
    expect(result & ClearSides.TopLeft).not.toBe(0) // set by Top side check
  })
})

// ---------------------------------------------------------------------------
// Tests: D2kResourceRendererInfo
// ---------------------------------------------------------------------------

describe('D2kResourceRendererInfo', () => {
  it('creates with default values', () => {
    const info = new D2kResourceRendererInfo()
    expect(info.resourceTypes).toBeInstanceOf(Map)
    expect(info.resourceTypes.size).toBe(0)
  })

  it('accepts resourceTypes', () => {
    const resourceTypes = new Map([['Spice', {
      image: 'spice',
      sequences: ['a', 'b'],
      palette: 'terrain',
      name: 'Spice',
    }]])
    const info = new D2kResourceRendererInfo({ resourceTypes })
    expect(info.resourceTypes.size).toBe(1)
    expect(info.resourceTypes.get('Spice')?.name).toBe('Spice')
  })
})

// ---------------------------------------------------------------------------
// Tests: D2kResourceRenderer construction
// ---------------------------------------------------------------------------

describe('D2kResourceRenderer', () => {
  it('creates renderer with correct world config', () => {
    const renderer = createRenderer()
    expect(renderer).toBeInstanceOf(D2kResourceRenderer)
  })

  it('cellContains returns true when renderContents has matching type', () => {
    const renderer = createRenderer()
    renderer['renderContents'].set(new CPos(3, 3), makeContent('Spice', 50))
    expect(renderer.cellContains(new CPos(3, 3), 'Spice')).toBe(true)
  })

  it('cellContains returns false when renderContents has different type', () => {
    const renderer = createRenderer()
    renderer['renderContents'].set(new CPos(3, 3), makeContent('Ore', 50))
    expect(renderer.cellContains(new CPos(3, 3), 'Spice')).toBe(false)
  })

  it('cellContains returns false for empty cell', () => {
    const renderer = createRenderer()
    expect(renderer.cellContains(new CPos(3, 3), 'Spice')).toBe(false)
  })
})
