/**
 * OrderGenerator.test.ts — OrderGenerator abstract base class unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: button resolution, order dispatch, Classic mode selection
 * clearing, default method behavior, and lifecycle management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — (not used by OrderGenerator, but prevent import errors)
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))
vi.mock('@babylonjs/core/Materials', () => ({}))
vi.mock('@babylonjs/core/Meshes', () => ({}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  MouseActionType,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IMouseSettings,
  WorldStub,
  WorldRendererStub,
  Order,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  OrderGenerator,
  type IOrderGeneratorWorld,
} from './OrderGenerator.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal CPos for testing. */
function cell(x: number, y: number): CPos {
  return new CPos(x, y)
}

/** Default world pixel for tests. */
const worldPixel = { x: 512, y: 384 }

/** Create mock IMouseSettings. */
function createMockSettings(
  overrides: Partial<{
    controlStyle: string
    actionButton: number
    cancelButton: number
  }> = {},
): IMouseSettings {
  return {
    mouseControlStyle: overrides.controlStyle ?? 'standard',
    resolveActionButton: vi.fn().mockReturnValue(overrides.actionButton ?? 1),
    resolveCancelButton: vi.fn().mockReturnValue(overrides.cancelButton ?? 2),
  }
}

/** Create a minimal IOrderGeneratorWorld. */
function createMockWorld(
  overrides: Partial<{
    selection: { clear: () => void } | null
    cancelInputMode: () => void
  }> = {},
): IOrderGeneratorWorld {
  return {
    actors: [],
    selection: overrides.selection ?? null,
    cancelInputMode: overrides.cancelInputMode ?? (() => {}),
  }
}

// ---------------------------------------------------------------------------
// Concrete subclass for testing abstract OrderGenerator
// ---------------------------------------------------------------------------

/**
 * Minimal concrete implementation for testing OrderGenerator abstract methods.
 * All abstract methods are public (TS interface compliance).
 */
class TestOrderGenerator extends OrderGenerator {
  protected readonly actionType = MouseActionType.Contextual

  // Tracker for verifying abstract method calls
  orderInnerCalls: Array<{
    world: WorldStub
    cell: CPos
    modifiers: number
    mi: unknown
  }> = []

  tickCalls: number = 0
  selectionChangedCalls: number = 0
  deactivateCalls: number = 0

  constructor(
    world: IOrderGeneratorWorld,
    settings: IMouseSettings,
  ) {
    super('TestOrderGenerator', world, settings)
  }

  // Abstract required (public for TS interface compliance)

  protected *orderInner(
    world: WorldStub,
    cell: CPos,
    modifiers: number,
    mi: unknown,
  ): Generator<Order | null> {
    this.orderInnerCalls.push({ world, cell, modifiers, mi })
    yield {
      orderName: 'TestOrder',
      targetString: `${cell.X},${cell.Y}`,
      extraData: null,
    }
  }

  getCursor(
    _world: WorldStub,
    _cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    _mi?: unknown,
  ): string {
    return 'test-cursor'
  }

  // Public to satisfy TS interface (matches OrderGenerator's public declarations)
  renderAboveShroud(
    _worldRenderer: WorldRendererStub,
    _world: WorldStub,
  ): void {
    // Test spy: no-op
  }

  renderAnnotations(
    _worldRenderer: WorldRendererStub,
    _world: WorldStub,
  ): void {
    // Test spy: no-op
  }

  // Virtual overrides for tracking

  override tick(world: WorldStub): void {
    this.tickCalls++
    super.tick(world)
  }

  override selectionChanged(
    world: WorldStub,
    selected: readonly unknown[],
  ): void {
    this.selectionChangedCalls++
    super.selectionChanged(world, selected)
  }

  override deactivate(): void {
    this.deactivateCalls++
    super.deactivate()
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderGenerator', () => {
  let settings: IMouseSettings
  let world: IOrderGeneratorWorld
  let generator: TestOrderGenerator

  beforeEach(() => {
    settings = createMockSettings()
    world = createMockWorld()
    generator = new TestOrderGenerator(world, settings)
  })

  // ---------------------------------------------------------------------------
  // Constructor & initialization
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('sets orderGeneratorKey from constructor parameter', () => {
      expect(generator.orderGeneratorKey).toBe('TestOrderGenerator')
    })

    it('resolves actionButton from settings using actionType', () => {
      expect(generator.actionButton).toBe(1)
      expect(settings.resolveActionButton).toHaveBeenCalledWith(
        MouseActionType.Contextual,
      )
    })

    it('resolves cancelButton from settings using actionType', () => {
      expect(generator.cancelButton).toBe(2)
      expect(settings.resolveCancelButton).toHaveBeenCalledWith(
        MouseActionType.Contextual,
      )
    })

    it('does not clear selection in standard mouse control style', () => {
      const clearSpy = vi.fn()
      const worldWithSel = createMockWorld({
        selection: { clear: clearSpy },
      })
      const stdSettings = createMockSettings({ controlStyle: 'standard' })
      new TestOrderGenerator(worldWithSel, stdSettings)
      expect(clearSpy).not.toHaveBeenCalled()
    })

    it('clears selection in classic mouse control style (matching C# line 27-28)', () => {
      const clearSpy = vi.fn()
      const worldWithSel = createMockWorld({
        selection: { clear: clearSpy },
      })
      const classicSettings = createMockSettings({ controlStyle: 'classic' })
      new TestOrderGenerator(worldWithSel, classicSettings)
      expect(clearSpy).toHaveBeenCalledOnce()
    })

    it('handles null selection in classic mode gracefully', () => {
      const worldNoSel = createMockWorld({ selection: null })
      const classicSettings = createMockSettings({ controlStyle: 'classic' })
      expect(
        () => new TestOrderGenerator(worldNoSel, classicSettings),
      ).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Button resolution
  // ---------------------------------------------------------------------------

  describe('button resolution', () => {
    it('actionButton delegates to settings.resolveActionButton', () => {
      const settings2 = createMockSettings({ actionButton: 3 })
      const gen = new TestOrderGenerator(createMockWorld(), settings2)
      expect(gen.actionButton).toBe(3)
    })

    it('cancelButton delegates to settings.resolveCancelButton', () => {
      const settings2 = createMockSettings({ cancelButton: 4 })
      const gen = new TestOrderGenerator(createMockWorld(), settings2)
      expect(gen.cancelButton).toBe(4)
    })
  })

  // ---------------------------------------------------------------------------
  // order() dispatch — action button
  // ---------------------------------------------------------------------------

  describe('order() — action button dispatch', () => {
    it('calls orderInner when action button is pressed Down (C# mi.Button == ActionButton && mi.Event == Down)', () => {
      const mi = { button: generator.actionButton, event: 'Down' }
      const result = Array.from(
        generator.order(
          world,
          cell(5, 3),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(generator.orderInnerCalls.length).toBe(1)
      expect(generator.orderInnerCalls[0].cell.X).toBe(5)
      expect(generator.orderInnerCalls[0].cell.Y).toBe(3)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('does NOT call orderInner when action button is pressed Up', () => {
      const mi = { button: generator.actionButton, event: 'Up' }
      Array.from(
        generator.order(
          world,
          cell(5, 3),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(generator.orderInnerCalls.length).toBe(0)
    })

    it('does NOT call orderInner when a different button is pressed', () => {
      const mi = { button: 99, event: 'Down' }
      Array.from(
        generator.order(
          world,
          cell(5, 3),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(generator.orderInnerCalls.length).toBe(0)
    })

    it('does NOT call orderInner when mi is null/undefined', () => {
      Array.from(
        generator.order(world, cell(5, 3), TargetModifiers.None),
      )
      expect(generator.orderInnerCalls.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // order() dispatch — cancel button
  // ---------------------------------------------------------------------------

  describe('order() — cancel button dispatch', () => {
    it('calls cancelInputMode when cancel button is released Up (C# mi.Button == CancelButton && mi.Event == Up)', () => {
      const cancelSpy = vi.fn()
      const worldWithCancel = createMockWorld({ cancelInputMode: cancelSpy })
      const gen = new TestOrderGenerator(worldWithCancel, settings)
      const mi = { button: gen.cancelButton, event: 'Up' }
      Array.from(
        gen.order(
          worldWithCancel,
          cell(1, 2),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(cancelSpy).toHaveBeenCalledOnce()
    })

    it('does NOT call cancelInputMode when cancel button is pressed Down', () => {
      const cancelSpy = vi.fn()
      const worldWithCancel = createMockWorld({ cancelInputMode: cancelSpy })
      const gen = new TestOrderGenerator(worldWithCancel, settings)
      const mi = { button: gen.cancelButton, event: 'Down' }
      Array.from(
        gen.order(
          worldWithCancel,
          cell(1, 2),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(cancelSpy).not.toHaveBeenCalled()
    })

    it('does NOT call cancelInputMode when a different button is released', () => {
      const cancelSpy = vi.fn()
      const worldWithCancel = createMockWorld({ cancelInputMode: cancelSpy })
      const gen = new TestOrderGenerator(worldWithCancel, settings)
      const mi = { button: 99, event: 'Up' }
      Array.from(
        gen.order(
          worldWithCancel,
          cell(1, 2),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(cancelSpy).not.toHaveBeenCalled()
    })

    it('returns no orders when cancelInputMode is called (matching C# return [];)', () => {
      const cancelSpy = vi.fn()
      const worldWithCancel = createMockWorld({ cancelInputMode: cancelSpy })
      const gen = new TestOrderGenerator(worldWithCancel, settings)
      const mi = { button: gen.cancelButton, event: 'Up' }
      const result = Array.from(
        gen.order(
          worldWithCancel,
          cell(1, 2),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(result.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // order() — edge cases
  // ---------------------------------------------------------------------------

  describe('order() — edge cases', () => {
    it('returns empty when mi is not an object', () => {
      const result = Array.from(
        generator.order(
          world,
          cell(0, 0),
          TargetModifiers.None,
          undefined,
          'not-an-object',
        ),
      )
      expect(result.length).toBe(0)
    })

    it('returns empty when actionButton is 0 and a different button is pressed', () => {
      const settingsZero = createMockSettings({ actionButton: 0 })
      const gen = new TestOrderGenerator(createMockWorld(), settingsZero)
      // actionButton 0 means "no button" — only button 0 (None) would match
      // Use button 1 (Left) which is not equal to 0
      const mi = { button: 1, event: 'Down' }
      const result = Array.from(
        gen.order(
          world,
          cell(0, 0),
          TargetModifiers.None,
          worldPixel,
          mi,
        ),
      )
      expect(result.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Default method behaviors (no-op / returns false)
  // ---------------------------------------------------------------------------

  describe('default methods — no-op base class behavior', () => {
    it('tick() defaults to no-op', () => {
      expect(() => generator.tick(world)).not.toThrow()
      expect(generator.tickCalls).toBe(1)
    })

    it('render() defaults to no-op', () => {
      expect(() =>
        generator.render({} as WorldRendererStub, world),
      ).not.toThrow()
    })

    it('handleKeyPress() defaults to returning false', () => {
      expect(generator.handleKeyPress({ key: 'Escape' })).toBe(false)
    })

    it('handleMouseInput() defaults to returning false', () => {
      expect(generator.handleMouseInput({ button: 1 })).toBe(false)
    })

    it('deactivate() defaults to no-op', () => {
      expect(() => generator.deactivate()).not.toThrow()
      expect(generator.deactivateCalls).toBe(1)
    })

    it('selectionChanged() defaults to no-op', () => {
      expect(() =>
        generator.selectionChanged(world, [{ actorId: 1 }]),
      ).not.toThrow()
      expect(generator.selectionChangedCalls).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Abstract method calling — render methods
  // ---------------------------------------------------------------------------

  describe('abstract methods — render', () => {
    it('renderAboveShroud is callable on concrete subclass', () => {
      // Spying on the public method
      const spy = vi.spyOn(generator, 'renderAboveShroud')
      generator.renderAboveShroud({} as WorldRendererStub, world)
      expect(spy).toHaveBeenCalledOnce()
    })

    it('renderAnnotations is callable on concrete subclass', () => {
      const spy = vi.spyOn(generator, 'renderAnnotations')
      generator.renderAnnotations({} as WorldRendererStub, world)
      expect(spy).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // getCursor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('getCursor returns the cursor from concrete implementation', () => {
      const cursor = generator.getCursor(world, cell(10, 20))
      expect(cursor).toBe('test-cursor')
    })
  })

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('multiple calls to deactivate succeed (idempotent at base level)', () => {
      generator.deactivate()
      generator.deactivate()
      expect(generator.deactivateCalls).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // order() — several calls verify correct dispatch ordering
  // ---------------------------------------------------------------------------

  describe('order() — interaction of action and cancel', () => {
    it('orderInner is called before cancelInputMode when both buttons are in sequence', () => {
      const cancelSpy = vi.fn()
      const worldWithCancel = createMockWorld({ cancelInputMode: cancelSpy })
      const gen = new TestOrderGenerator(worldWithCancel, settings)

      // First: action button Down
      const actionMi = { button: gen.actionButton, event: 'Down' }
      const result1 = Array.from(
        gen.order(
          worldWithCancel,
          cell(1, 1),
          TargetModifiers.None,
          worldPixel,
          actionMi,
        ),
      )
      expect(gen.orderInnerCalls.length).toBe(1)
      expect(cancelSpy).not.toHaveBeenCalled()
      expect(result1.length).toBeGreaterThanOrEqual(1)

      // Reset spy state
      gen.orderInnerCalls = []
      cancelSpy.mockClear()

      // Second: cancel button Up
      const cancelMi = { button: gen.cancelButton, event: 'Up' }
      const result2 = Array.from(
        gen.order(
          worldWithCancel,
          cell(1, 1),
          TargetModifiers.None,
          worldPixel,
          cancelMi,
        ),
      )
      expect(gen.orderInnerCalls.length).toBe(0)
      expect(cancelSpy).toHaveBeenCalledOnce()
      expect(result2.length).toBe(0)
    })
  })
})
