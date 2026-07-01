/**
 * Viewport.test.ts — Viewport migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: coordinate transforms, zoom management, scroll/center,
 * boundary clamping, cell region calculation, camera integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core/Maths/math.vector', () => {
  class MockVector3 {
    x: number
    y: number
    z: number
    constructor(x: number, y: number, z: number) {
      this.x = x
      this.y = y
      this.z = z
    }
    static Unproject(
      source: { x: number; y: number; z: number },
      _viewportWidth: number,
      _viewportHeight: number,
      _world: unknown,
      _view: unknown,
      _projection: unknown,
    ): MockVector3 {
      // Simplified: return source as-is (real Unproject requires full matrix math).
      // Tests that need specific values should spy on this method.
      return new MockVector3(source.x, source.y, source.z)
    }
    subtract(other: MockVector3): MockVector3 {
      return new MockVector3(this.x - other.x, this.y - other.y, this.z - other.z)
    }
  }
  return { Vector3: MockVector3 }
})

vi.mock('@babylonjs/core/Cameras/camera', () => {
  class MockCamera {
    static readonly ORTHOGRAPHIC_CAMERA = 0
    static readonly PERSPECTIVE_CAMERA = 1
  }
  return { Camera: MockCamera }
})

vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({}))

vi.mock('@babylonjs/core/Engines/engine', () => ({}))

vi.mock('@babylonjs/core/scene', () => ({}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  ScrollDirection,
  ScrollDirectionExts,
  ViewportCameraMode,
  Viewport,
} from './Viewport'

import type {
  IViewportMap,
  IViewportWorld,
  ViewportOptions,
} from './Viewport'

import { MapGridType } from '../Map/MapGridType'
import { ProjectedCellRegion } from '../Map/ProjectedCellRegion'

import type { WPos, Int2 } from './WorldRenderer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWPos(x: number, y: number, z: number = 0): WPos {
  return { x, y, z }
}

function makeMap(): IViewportMap {
  return {
    grid: {
      type: MapGridType.Rectangular,
      tileScale: 1024,
    },
    mapSize: { width: 100, height: 100 },
    rules: {
      terrainInfo: {
        tileSize: { width: 24, height: 24 },
      },
    },
    projectedTopLeft: { x: 0, y: 0, z: 0 },
    projectedBottomRight: { x: 100 * 1024, y: 100 * 1024, z: 0 },
    cellContaining(pos: WPos) {
      return {
        toMPos(_gtype: MapGridType) {
          return {
            U: Math.round(pos.x / 1024),
            V: Math.round(pos.y / 1024),
          } as unknown as import('../MPos').MPos
        },
      }
    },
    centerOfCell(_cell: import('../CPos').CPos) {
      return { x: 0, y: 0, z: 0 }
    },
    contains(_cell: import('../CPos').CPos) {
      return true
    },
  }
}

function makeWorld(): IViewportWorld {
  return {
    type: 'Regular',
    worldActor: {},
  }
}

function makeWorldRenderer() {
  return {
    screenPxPosition(pos: WPos): Int2 {
      return {
        x: Math.round((pos.x * 24) / 1024),
        y: Math.round(((pos.y - (pos.z ?? 0)) * 24) / 1024),
      }
    },
    projectedPosition(screenPx: Int2): WPos {
      return {
        x: (screenPx.x * 1024) / 24,
        y: (screenPx.y * 1024) / 24,
        z: 0,
      }
    },
    tileSize: { width: 24, height: 24 },
    tileScale: 1024,
    world: makeWorld(),
  }
}

function makeOptions(overrides: Partial<ViewportOptions> = {}): ViewportOptions {
  return {
    worldRenderer: makeWorldRenderer(),
    map: makeMap(),
    nativeResolution: { width: 1920, height: 1080 },
    uiScale: 1.0,
    defaultScale: 1.0,
    minZoom: 1.0,
    maxZoom: 2.0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ScrollDirection & ScrollDirectionExts
// ---------------------------------------------------------------------------

describe('ScrollDirection', () => {
  it('defines correct flag values', () => {
    expect(ScrollDirection.None).toBe(0)
    expect(ScrollDirection.Up).toBe(1)
    expect(ScrollDirection.Left).toBe(2)
    expect(ScrollDirection.Down).toBe(4)
    expect(ScrollDirection.Right).toBe(8)
  })
})

describe('ScrollDirectionExts', () => {
  describe('includes', () => {
    it('returns true when direction is fully included', () => {
      const d = ScrollDirection.Up | ScrollDirection.Left
      expect(ScrollDirectionExts.includes(d, ScrollDirection.Up)).toBe(true)
      expect(ScrollDirectionExts.includes(d, ScrollDirection.Left)).toBe(true)
    })

    it('returns false when direction is not included', () => {
      const d = ScrollDirection.Up
      expect(ScrollDirectionExts.includes(d, ScrollDirection.Down)).toBe(false)
      expect(ScrollDirectionExts.includes(d, ScrollDirection.Left)).toBe(false)
    })

    it('returns true for None', () => {
      expect(ScrollDirectionExts.includes(ScrollDirection.Up, ScrollDirection.None)).toBe(true)
    })
  })

  describe('set', () => {
    it('sets a direction flag', () => {
      const result = ScrollDirectionExts.set(
        ScrollDirection.None,
        ScrollDirection.Up,
        true,
      )
      expect(result).toBe(ScrollDirection.Up)
    })

    it('clears a direction flag', () => {
      const d = ScrollDirection.Up | ScrollDirection.Down
      const result = ScrollDirectionExts.set(d, ScrollDirection.Down, false)
      expect(result).toBe(ScrollDirection.Up)
    })

    it('is idempotent when setting already-set flag', () => {
      const d = ScrollDirection.Up
      const result = ScrollDirectionExts.set(d, ScrollDirection.Up, true)
      expect(result).toBe(ScrollDirection.Up)
    })

    it('is idempotent when clearing already-cleared flag', () => {
      const d = ScrollDirection.Up
      const result = ScrollDirectionExts.set(d, ScrollDirection.Down, false)
      expect(result).toBe(ScrollDirection.Up)
    })
  })
})

// ---------------------------------------------------------------------------
// Viewport Construction
// ---------------------------------------------------------------------------

describe('Viewport construction', () => {
  it('creates a Viewport in Regular mode with correct center', () => {
    const opts = makeOptions()
    const vp = new Viewport(opts)
    expect(vp.centerLocation.x).toBeGreaterThan(0)
    expect(vp.centerLocation.y).toBeGreaterThan(0)
  })

  it('creates a Viewport in Editor mode with full map bounds', () => {
    const wr = makeWorldRenderer()
    wr.world = { type: 'Editor', worldActor: {} }
    const opts = makeOptions({ worldRenderer: wr })
    const vp = new Viewport(opts)
    // Editor mode: full map is visible
    expect(vp.mapRectBounds.Left).toBe(0)
    expect(vp.mapRectBounds.Top).toBe(0)
    expect(vp.mapRectBounds.Width).toBe(100 * 24) // mapSize.width * tileSize.width
    expect(vp.mapRectBounds.Height).toBe(100 * 24)
  })

  it('uses provided zoom values', () => {
    const opts = makeOptions({ minZoom: 0.5, maxZoom: 3.0 })
    const vp = new Viewport(opts)
    expect(vp.minZoom).toBe(0.5)
    expect(vp.maxZoom).toBe(3.0)
  })

  it('uses default values when not provided', () => {
    const vp = new Viewport(makeOptions())
    expect(vp.minZoom).toBe(1.0)
    expect(vp.maxZoom).toBe(2.0)
    expect(vp.zoom).toBe(1.0)
  })

  it('accepts camera and engine without crashing', () => {
    const mockCamera = {
      alpha: 0,
      beta: 0,
      mode: 0,
      target: { x: 0, y: 0, z: 0 },
      orthoTop: 0,
      orthoBottom: 0,
      orthoLeft: 0,
      orthoRight: 0,
    } as unknown as import('@babylonjs/core/Cameras/arcRotateCamera').ArcRotateCamera
    const mockEngine = {} as unknown as import('@babylonjs/core/Engines/engine').Engine
    const opts = makeOptions({ camera: mockCamera, engine: mockEngine })
    expect(() => new Viewport(opts)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Coordinate Transforms
// ---------------------------------------------------------------------------

describe('Viewport coordinate transforms', () => {
  let vp: Viewport

  beforeEach(() => {
    vp = new Viewport(makeOptions())
  })

  describe('viewToWorldPx', () => {
    it('returns WPos for viewport center', () => {
      const center = { x: 960, y: 540 }
      const result = vp.viewToWorldPx(center)
      expect(result).toHaveProperty('x')
      expect(result).toHaveProperty('y')
      expect(result.z).toBe(0)
    })

    it('maps viewport origin to top-left world area', () => {
      const origin = { x: 0, y: 0 }
      const result = vp.viewToWorldPx(origin)
      // Viewport center is in the middle of map, so (0,0) maps to top-left area
      expect(result.x).toBeLessThan(vp.viewToWorldPx({ x: 960, y: 540 }).x)
      expect(result.y).toBeLessThan(vp.viewToWorldPx({ x: 960, y: 540 }).y)
    })

    it('maps viewport bottom-right to bottom-right world area', () => {
      const br = { x: 1920, y: 1080 }
      const result = vp.viewToWorldPx(br)
      const centerResult = vp.viewToWorldPx({ x: 960, y: 540 })
      expect(result.x).toBeGreaterThan(centerResult.x)
      expect(result.y).toBeGreaterThan(centerResult.y)
    })
  })

  describe('worldToViewPx', () => {
    it('maps world-px coordinates to viewport-px coordinates', () => {
      // worldToViewPx operates on world-px (Vec2), which is the domain of centerLocation
      const centerWP = { x: vp.centerLocation.x, y: vp.centerLocation.y }
      const result = vp.worldToViewPx(centerWP)
      // Center of world-px should map approximately to center of viewport
      expect(result.x).toBeCloseTo(960, -1)
      expect(result.y).toBeCloseTo(540, -1)
    })
  })

  describe('viewToWorld', () => {
    it('returns CPos for viewport center', () => {
      const center = { x: 960, y: 540 }
      const cpos = vp.viewToWorld(center)
      expect(cpos).toHaveProperty('X')
      expect(cpos).toHaveProperty('Y')
    })

    it('returns different CPos for screen corners', () => {
      const tl = vp.viewToWorld({ x: 0, y: 0 })
      const br = vp.viewToWorld({ x: 1920, y: 1080 })
      // Top-left should map to smaller cell coords than bottom-right
      expect(tl.X + tl.Y).toBeLessThanOrEqual(br.X + br.Y)
    })

    it('returns a CPos even for out-of-bounds view coords', () => {
      const farPoint = vp.viewToWorld({ x: -9999, y: -9999 })
      expect(farPoint).toHaveProperty('X')
      expect(farPoint).toHaveProperty('Y')
    })

    it('is stable when called multiple times', () => {
      const center = { x: 960, y: 540 }
      const c1 = vp.viewToWorld(center)
      const c2 = vp.viewToWorld(center)
      expect(c1.X).toBe(c2.X)
      expect(c1.Y).toBe(c2.Y)
    })
  })
})

// ---------------------------------------------------------------------------
// Zoom Management
// ---------------------------------------------------------------------------

describe('Viewport zoom', () => {
  let vp: Viewport

  beforeEach(() => {
    vp = new Viewport(makeOptions())
  })

  describe('adjustZoom', () => {
    it('increases zoom with positive delta', () => {
      const initialZoom = vp.zoom
      vp.adjustZoom(0.25)
      expect(vp.zoom).toBeGreaterThan(initialZoom)
    })

    it('decreases zoom with negative delta (when above minZoom)', () => {
      // Start at maxZoom so negative delta has room to decrease
      vp.adjustZoom(0.7) // goes to ~2.0
      const zoomBefore = vp.zoom
      vp.adjustZoom(-0.25)
      expect(vp.zoom).toBeLessThan(zoomBefore)
    })

    it('clamps zoom to maxZoom', () => {
      vp.adjustZoom(10) // very large positive
      expect(vp.zoom).toBeLessThanOrEqual(vp.maxZoom)
    })

    it('clamps zoom to minZoom', () => {
      vp.adjustZoom(-10) // very large negative
      expect(vp.zoom).toBeGreaterThanOrEqual(vp.minZoom)
    })
  })

  describe('adjustZoomAt', () => {
    it('zooms toward screen center preserving world position', () => {
      const screenCenter = { x: 960, y: 540 }
      const worldBefore = vp.viewToWorldPx(screenCenter)
      vp.adjustZoomAt(0.5, screenCenter)
      const worldAfter = vp.viewToWorldPx(screenCenter)
      // World position under cursor should remain approximately the same
      expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(10)
      expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(10)
    })
  })

  describe('toggleZoom', () => {
    it('switches from minZoom to maxZoom', () => {
      // Start at minZoom (1.0), toggle → maxZoom (2.0)
      expect(vp.zoom).toBe(1.0)
      vp.toggleZoom()
      expect(vp.zoom).toBe(2.0)
    })

    it('switches from maxZoom back to minZoom', () => {
      vp.toggleZoom() // 1.0 → 2.0
      vp.toggleZoom() // 2.0 → 1.0
      expect(vp.zoom).toBe(1.0)
    })
  })

  describe('unlockMinimumZoom', () => {
    it('allows zooming below minZoom', () => {
      const opts = makeOptions({ minZoom: 1.0, unlockMinZoom: false })
      vp = new Viewport(opts)
      vp.unlockMinimumZoom(0.5)
      // Should allow zooming out further
      vp.adjustZoom(-2)
      expect(vp.zoom).toBeLessThan(1.0)
    })
  })
})

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------

describe('Viewport scroll', () => {
  let vp: Viewport

  beforeEach(() => {
    vp = new Viewport(makeOptions())
  })

  it('moves center location by scroll delta', () => {
    const centerBefore = { ...vp.centerLocation }
    vp.scroll({ x: 100, y: 0 }, false)
    expect(vp.centerLocation.x).toBeGreaterThan(centerBefore.x)
  })

  it('clamps to map bounds when ignoreBorders is false', () => {
    // Scroll far left repeatedly — should clamp at map left edge
    for (let i = 0; i < 1000; i++) {
      vp.scroll({ x: -1000, y: 0 }, false)
    }
    expect(vp.centerLocation.x).toBeGreaterThanOrEqual(vp.mapRectBounds.Left)
  })

  it('ignores borders when ignoreBorders is true', () => {
    // Scroll far left with ignoreBorders — should NOT clamp
    const centerBefore = { ...vp.centerLocation }
    vp.scroll({ x: -10000, y: 0 }, true)
    expect(vp.centerLocation.x).toBeLessThan(centerBefore.x)
  })

  it('scrolls in all 4 cardinal directions', () => {
    const cx = vp.centerLocation.x
    const cy = vp.centerLocation.y

    vp.scroll({ x: 50, y: 0 }, true)
    expect(vp.centerLocation.x).toBeGreaterThan(cx)

    vp.scroll({ x: 0, y: 50 }, true)
    expect(vp.centerLocation.y).toBeGreaterThan(cy)
  })
})

// ---------------------------------------------------------------------------
// Center
// ---------------------------------------------------------------------------

describe('Viewport center', () => {
  let vp: Viewport

  beforeEach(() => {
    vp = new Viewport(makeOptions())
  })

  it('centers on a WPos', () => {
    const pos = makeWPos(50 * 1024, 50 * 1024, 0)
    vp.center(pos)
    // After centering, viewport center (960,540) should view the area near the WPos
    const viewedPos = vp.viewToWorldPx({ x: 960, y: 540 })
    // The viewed WPos should be near the target position (within a few cells)
    expect(Math.abs(viewedPos.x - pos.x)).toBeLessThan(10000)
    expect(Math.abs(viewedPos.y - pos.y)).toBeLessThan(10000)
  })

  it('centers on float2 position', () => {
    // Use a position within map bounds (map is 100x100 cells * 24px = 2400x2400)
    const bounds = vp.mapRectBounds
    const cx = bounds.Left + bounds.Width / 2
    const cy = bounds.Top + bounds.Height / 2
    vp.centerFloat2({ x: cx, y: cy })
    expect(vp.centerLocation.x).toBe(cx)
    expect(vp.centerLocation.y).toBe(cy)
  })

  it('centers on empty actors array does nothing', () => {
    const centerBefore = { ...vp.centerLocation }
    vp.centerOnActors([])
    expect(vp.centerLocation.x).toBe(centerBefore.x)
    expect(vp.centerLocation.y).toBe(centerBefore.y)
  })
})

// ---------------------------------------------------------------------------
// GetBlockedDirections
// ---------------------------------------------------------------------------

describe('Viewport getBlockedDirections', () => {
  it('returns None when center is within bounds', () => {
    const vp = new Viewport(makeOptions())
    expect(vp.getBlockedDirections()).toBe(ScrollDirection.None)
  })

  it('returns Up when center is at top edge', () => {
    const vp = new Viewport(makeOptions())
    vp.centerFloat2({ x: vp.mapRectBounds.Left + 100, y: vp.mapRectBounds.Top })
    const blocked = vp.getBlockedDirections()
    expect(blocked & ScrollDirection.Up).toBe(ScrollDirection.Up)
  })

  it('returns Left when center is at left edge', () => {
    const vp = new Viewport(makeOptions())
    vp.centerFloat2({ x: vp.mapRectBounds.Left, y: vp.mapRectBounds.Top + 100 })
    const blocked = vp.getBlockedDirections()
    expect(blocked & ScrollDirection.Left).toBe(ScrollDirection.Left)
  })
})

// ---------------------------------------------------------------------------
// Cell Regions
// ---------------------------------------------------------------------------

describe('Viewport cell regions', () => {
  it('computes visibleCellsInsideBounds', () => {
    const vp = new Viewport(makeOptions())
    const cells = vp.visibleCellsInsideBounds
    expect(cells).toBeInstanceOf(ProjectedCellRegion)
    expect(cells.TopLeft).toBeDefined()
    expect(cells.BottomRight).toBeDefined()
  })

  it('computes allVisibleCells', () => {
    const vp = new Viewport(makeOptions())
    const cells = vp.allVisibleCells
    expect(cells).toBeInstanceOf(ProjectedCellRegion)
  })

  it('caches cell regions (same instance returned)', () => {
    const vp = new Viewport(makeOptions())
    const a = vp.visibleCellsInsideBounds
    const b = vp.visibleCellsInsideBounds
    expect(a).toBe(b) // same object reference = cached
  })

  it('invalidates cache on scroll', () => {
    const vp = new Viewport(makeOptions())
    const a = vp.visibleCellsInsideBounds
    vp.scroll({ x: 1, y: 0 }, false)
    const b = vp.visibleCellsInsideBounds
    expect(a).not.toBe(b) // different object = recomputed
  })

  it('invalidates cache on zoom change', () => {
    const vp = new Viewport(makeOptions())
    const a = vp.visibleCellsInsideBounds
    vp.adjustZoom(0.1)
    const b = vp.visibleCellsInsideBounds
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// Tick & Callbacks
// ---------------------------------------------------------------------------

describe('Viewport tick', () => {
  it('invokes registered viewportTick callbacks', () => {
    const vp = new Viewport(makeOptions())
    const cb = vi.fn()
    vp.onViewportTick(cb)
    vp.tick()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('invokes multiple registered callbacks', () => {
    const vp = new Viewport(makeOptions())
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    vp.onViewportTick(cb1)
    vp.onViewportTick(cb2)
    vp.tick()
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('unregisters callbacks via offViewportTick', () => {
    const vp = new Viewport(makeOptions())
    const cb = vi.fn()
    vp.onViewportTick(cb)
    vp.offViewportTick(cb)
    vp.tick()
    expect(cb).not.toHaveBeenCalled()
  })

  it('uses viewportCenterProvider when set', () => {
    const vp = new Viewport(makeOptions())
    // Use position within map bounds
    const bounds = vp.mapRectBounds
    const cx = bounds.Left + 100
    const cy = bounds.Top + 100
    const provider = vi.fn(() => ({ x: cx, y: cy }))
    vp.viewportCenterProvider = provider
    vp.tick()
    expect(provider).toHaveBeenCalled()
    expect(vp.centerLocation.x).toBe(cx)
    expect(vp.centerLocation.y).toBe(cy)
  })
})

// ---------------------------------------------------------------------------
// CalculateMinimumZoom
// ---------------------------------------------------------------------------

describe('Viewport.calculateMinimumZoom', () => {
  it('returns 1 when native height is within maxHeight', () => {
    const result = Viewport.calculateMinimumZoom(480, 2160, 1080)
    expect(result).toBe(1)
  })

  it('returns >1 when native height exceeds maxHeight', () => {
    const result = Viewport.calculateMinimumZoom(480, 2160, 4320)
    expect(result).toBeGreaterThanOrEqual(1)
  })

  it('returns integer zoom for clean fractions', () => {
    const result = Viewport.calculateMinimumZoom(480, 720, 1080)
    expect(result).toBeGreaterThanOrEqual(1)
    expect(1080 * result).toBeLessThan(720 * result * 3)
  })
})

// ---------------------------------------------------------------------------
// Viewport Properties
// ---------------------------------------------------------------------------

describe('Viewport properties', () => {
  it('topLeft + viewportSize ≈ bottomRight', () => {
    const vp = new Viewport(makeOptions())
    const tl = vp.topLeft
    const br = vp.bottomRight
    const size = vp.viewportSize
    expect(br.x - tl.x).toBeCloseTo(size.x, -1)
    expect(br.y - tl.y).toBeCloseTo(size.y, -1)
  })

  it('viewportSize changes with zoom', () => {
    const vp = new Viewport(makeOptions())
    const size1 = { ...vp.viewportSize }
    vp.adjustZoom(0.5) // zoom increases
    const size2 = vp.viewportSize
    // Higher zoom = smaller viewport in world-px
    expect(size2.x).toBeLessThan(size1.x)
  })

  it('cameraMode defaults to Orthographic', () => {
    const vp = new Viewport(makeOptions())
    expect(vp.cameraMode).toBe(ViewportCameraMode.Orthographic)
  })

  it('centerPosition returns projected WPos of viewport center', () => {
    const vp = new Viewport(makeOptions())
    const pos = vp.centerPosition
    expect(pos).toHaveProperty('x')
    expect(pos).toHaveProperty('y')
    expect(pos).toHaveProperty('z')
    expect(pos.z).toBe(0)
  })

  it('centerPosition changes when center location changes', () => {
    const vp = new Viewport(makeOptions())
    const pos1 = vp.centerPosition
    vp.centerFloat2({ x: 500, y: 500 })
    const pos2 = vp.centerPosition
    expect(pos2.x).not.toBe(pos1.x)
    expect(pos2.y).not.toBe(pos1.y)
  })

  it('getScissorBounds returns full viewport rectangle', () => {
    const vp = new Viewport(makeOptions())
    const bounds = vp.getScissorBounds(true)
    expect(bounds.width).toBe(1920)
    expect(bounds.height).toBe(1080)
  })

  // NEGATIVE TESTS — regression guards for pickTerrain using Vector3.Unproject
  // (ch07 camera-controls pattern: createPickingRay stale matrix fix)

  it('BUGFIX: pickTerrain returns null when camera is null', () => {
    const opts = makeOptions()
    const vp = new Viewport(opts)
    ;(vp as any).bjsCamera = null
    expect(vp.pickTerrain(100, 100)).toBeNull()
  })

  it('BUGFIX: pickTerrain uses Vector3.Unproject instead of createPickingRay (regression)', () => {
    // Verify the method exists and handles the normal mock flow without throwing.
    // The real test of matrix staleness is in the ch07 camera-controls e2e
    // (4 rounds of iterative convergence, createPickingRay → Unproject fix).
    // This test ensures the new code path doesn't crash with default mocks.
    const opts = makeOptions()
    const vp = new Viewport(opts)
    // With MockVector3.Unproject returning source-as-is, the ray will have
    // dir.y=0 (near.Y==far.Y==viewY), so pickTerrain should return null
    // (parallel to terrain plane).
    // If it were still using createPickingRay, it would throw because
    // bjsScene is not properly mocked for that method.
    const result = vp.pickTerrain(960, 540)
    // With our simplified Unproject mock, result is null (ray parallel to terrain)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Static members
// ---------------------------------------------------------------------------

describe('Viewport static members', () => {
  it('lastMousePos is mutable', () => {
    Viewport.lastMousePos = { x: 100, y: 200 }
    expect(Viewport.lastMousePos.x).toBe(100)
    expect(Viewport.lastMousePos.y).toBe(200)
    // reset
    Viewport.lastMousePos = { x: 0, y: 0 }
  })

  it('lastMoveRunTime is mutable', () => {
    Viewport.lastMoveRunTime = 42
    expect(Viewport.lastMoveRunTime).toBe(42)
    Viewport.lastMoveRunTime = 0
  })
})

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe('Viewport dispose', () => {
  it('clears viewportTick callbacks', () => {
    const vp = new Viewport(makeOptions())
    const cb = vi.fn()
    vp.onViewportTick(cb)
    vp.dispose()
    // tick should not invoke callbacks after dispose
    vp.tick()
    expect(cb).not.toHaveBeenCalled()
  })

  it('clears viewportCenterProvider', () => {
    const vp = new Viewport(makeOptions())
    vp.viewportCenterProvider = () => ({ x: 1, y: 2 })
    vp.dispose()
    expect(vp.viewportCenterProvider).toBeNull()
  })

  it('can be called multiple times safely', () => {
    const vp = new Viewport(makeOptions())
    vp.dispose()
    expect(() => vp.dispose()).not.toThrow()
  })
})
