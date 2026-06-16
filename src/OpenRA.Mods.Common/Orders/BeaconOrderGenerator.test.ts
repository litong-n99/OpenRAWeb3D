/**
 * BeaconOrderGenerator.test.ts — BeaconOrderGenerator unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: one-shot order emission with suppressVisualFeedback,
 * immediate input mode cancellation, cursor returns "ability", no-op render.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))
vi.mock('@babylonjs/core/Materials', () => ({}))
vi.mock('@babylonjs/core/Meshes', () => ({}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IMouseSettings,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { BeaconOrderGenerator } from './BeaconOrderGenerator.js'
import type { IOrderGeneratorWorld } from './OrderGenerator.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function cell(x: number, y: number): CPos {
  return new CPos(x, y)
}

function voidFn(): () => void {
  return vi.fn() as unknown as () => void
}

function createMockSettings(): IMouseSettings {
  return {
    mouseControlStyle: 'standard',
    resolveActionButton: vi.fn().mockReturnValue(2),
    resolveCancelButton: vi.fn().mockReturnValue(1),
  }
}

function createMockWorld(overrides: Partial<{
  cancelInputModeSpy: () => void
}> = {}): IOrderGeneratorWorld {
  return {
    actors: [],
    selection: null,
    cancelInputMode: overrides.cancelInputModeSpy ?? voidFn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BeaconOrderGenerator', () => {
  let settings: IMouseSettings

  beforeEach(() => {
    settings = createMockSettings()
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('sets orderGeneratorKey to BeaconOrderGenerator', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      expect(gen.orderGeneratorKey).toBe('BeaconOrderGenerator')
    })

    it('sets actionType to PlaceBuilding', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      expect(gen.actionButton).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // orderInner — one-shot beacon placement
  // ---------------------------------------------------------------------------

  describe('orderInner', () => {
    it('yields a single PlaceBeacon order with suppressVisualFeedback = true', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(5, 7), TargetModifiers.None as TargetModifiers, undefined),
      )
      expect(orders.length).toBe(1)
      expect(orders[0]!.orderName).toBe('PlaceBeacon')
      expect((orders[0]!.extraData as { suppressVisualFeedback: boolean }).suppressVisualFeedback).toBe(true)
    })

    it('calls cancelInputMode immediately (one-shot behavior)', () => {
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({ cancelInputModeSpy: cancelSpy })
      const gen = new BeaconOrderGenerator(w, settings)
      Array.from(
        gen['orderInner'](w, cell(5, 7), TargetModifiers.None as TargetModifiers, undefined),
      )
      expect(cancelSpy).toHaveBeenCalledOnce()
    })

    it('places beacon at the correct cell', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(12, 34), TargetModifiers.None as TargetModifiers, undefined),
      )
      expect(orders.length).toBe(1)
      const extra = orders[0]!.extraData as { cell: { X: number; Y: number } }
      expect(extra.cell.X).toBe(12)
      expect(extra.cell.Y).toBe(34)
    })

    it('is not queued (queued is false)', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(0, 0), TargetModifiers.None as TargetModifiers, undefined),
      )
      const extra = orders[0]!.extraData as { queued: boolean }
      expect(extra.queued).toBe(false)
    })

    it('targetString contains cell coordinates', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(8, 9), TargetModifiers.None as TargetModifiers, undefined),
      )
      expect(orders[0]!.targetString).toBe('8,9')
    })
  })

  // ---------------------------------------------------------------------------
  // getCursor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('always returns "ability" regardless of cell', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      expect(gen.getCursor(w, cell(0, 0))).toBe('ability')
      expect(gen.getCursor(w, cell(99, 99))).toBe('ability')
      expect(gen.getCursor(w, cell(-1, -1))).toBe('ability')
    })

    it('returns "ability" with or without mi/worldPixel parameters', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      expect(gen.getCursor(w, cell(0, 0), undefined, undefined)).toBe('ability')
      expect(
        gen.getCursor(w, cell(0, 0), { x: 100, y: 200 }, { button: 1, event: 'Down', modifiers: 0 }),
      ).toBe('ability')
    })
  })

  // ---------------------------------------------------------------------------
  // render methods — no-op
  // ---------------------------------------------------------------------------

  describe('render methods', () => {
    it('renderAboveShroud is a no-op', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      expect(() =>
        gen.renderAboveShroud(
          {} as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub,
          w,
        ),
      ).not.toThrow()
    })

    it('renderAnnotations is a no-op', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      expect(() =>
        gen.renderAnnotations(
          {} as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub,
          w,
        ),
      ).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // deactivate — inherited no-op
  // ---------------------------------------------------------------------------

  describe('deactivate', () => {
    it('is a no-op (no resources to clean up)', () => {
      const w = createMockWorld()
      const gen = new BeaconOrderGenerator(w, settings)
      expect(() => gen.deactivate()).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple calls — verify one-shot behavior
  // ---------------------------------------------------------------------------

  describe('one-shot behavior', () => {
    it('each call to orderInner cancels input mode (one-shot each time)', () => {
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({ cancelInputModeSpy: cancelSpy })
      const gen = new BeaconOrderGenerator(w, settings)

      Array.from(gen['orderInner'](w, cell(1, 1), TargetModifiers.None as TargetModifiers, undefined))
      expect(cancelSpy).toHaveBeenCalledTimes(1)

      Array.from(gen['orderInner'](w, cell(2, 2), TargetModifiers.None as TargetModifiers, undefined))
      expect(cancelSpy).toHaveBeenCalledTimes(2)
    })
  })
})
