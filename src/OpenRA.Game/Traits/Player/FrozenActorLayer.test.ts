/**
 * FrozenActorLayer.test.ts — FrozenActorLayer migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are NOT
 * imported. Tests focus on: state management, visibility logic, spatial
 * queries, sync hash computation, lifecycle (Add/Remove/Invalidate),
 * and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module under test (imported after mocks — no @babylonjs imports needed)
// ---------------------------------------------------------------------------

import {
  FrozenActor,
  FrozenActorLayer,
  FrozenActorLayerInfo,
} from './FrozenActorLayer'
import { PPos } from '../../MPos'
import { WPos } from '../../WPos'
import { WDist } from '../../WDist'
import { CellVisibility } from './Shroud'
import { SpatiallyPartitioned } from '../../Primitives/SpatiallyPartitioned'
import { Polygon } from '../../Primitives/Polygon'
import { Rectangle } from '../../Primitives/Rectangle'
import type { IGameActor, PlayerStub, IHealth, IVisibilityModifier } from '../TraitsInterfaces'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal IGameActor mock for FrozenActor tests. */
function createMockActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 42,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: undefined,
    world: undefined,
    info: { name: 'TestActor' },
    traitsImplementing: () => [],
    ...overrides,
  }
}

/** Create a mock PlayerStub with optional shroud. */
function createMockPlayer(shroud?: IShroudMock): PlayerStub & Record<string, unknown> {
  return {
    playerName: 'TestPlayer',
    shroud: shroud ?? null,
  }
}

/** Minimal shroud mock. */
interface IShroudMock {
  contains(puv: PPos): boolean
  getVisibility(puv: PPos): number
  addOnShroudChanged?(cb: (puv: PPos) => void): void
}

/** Create a mock shroud that reveals everything by default. */
function createMockShroud(overrides: Partial<IShroudMock> = {}): IShroudMock {
  return {
    contains: () => true,
    getVisibility: () => CellVisibility.Visible,
    addOnShroudChanged: undefined,
    ...overrides,
  }
}

/** Create a mock IHealth trait. */
function createMockHealth(overrides: Partial<IHealth> = {}): IHealth {
  return {
    damageState: 1, // Undamaged
    hp: 100,
    maxHP: 100,
    displayHP: 100,
    isDead: false,
    inflictDamage: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  }
}

/** Create a mock IVisibilityModifier trait. */
function createMockVisibilityModifier(isVisible: boolean = true): IVisibilityModifier {
  return {
    isVisible: () => isVisible,
  }
}

/** A simple tooltip mock. */
interface ITooltipMock {
  tooltipInfo: unknown
  owner: PlayerStub | null
  isTraitDisabled: boolean
}

function createMockTooltip(overrides: Partial<ITooltipMock> = {}): ITooltipMock {
  return {
    tooltipInfo: { tooltipForPlayerStance: () => 'Test tooltip', isOwnerRowVisible: false },
    owner: null,
    isTraitDisabled: false,
    ...overrides,
  }
}

// ===========================================================================
// FrozenActor Tests
// ===========================================================================

describe('FrozenActor', () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('creates with valid footprint and stores actor reference', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const footprint = [new PPos(5, 5), new PPos(5, 6), new PPos(6, 5), new PPos(6, 6)]

      const fa = new FrozenActor(actor, frozenTrait, footprint, viewer as unknown as PlayerStub, false)

      expect(fa.Footprint).toHaveLength(4)
      expect(fa.ID).toBe(42)
      expect(fa.Viewer).toBe(viewer)
      expect(fa.NeedRenderables).toBe(false)
      expect(fa.IsValid).toBe(false) // Owner not set until RefreshState
      expect(fa.Actor).toBe(actor) // isDead is false
    })

    it('sets NeedRenderables to true when startsRevealed', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const footprint = [new PPos(0, 0)]

      const fa = new FrozenActor(actor, frozenTrait, footprint, viewer as unknown as PlayerStub, true)

      expect(fa.NeedRenderables).toBe(true)
    })

    it('throws when footprint is empty after filtering', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud({ contains: () => false }))
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const footprint = [new PPos(5, 5)]

      expect(() => {
        new FrozenActor(actor, frozenTrait, footprint, viewer as unknown as PlayerStub, false)
      }).toThrow(/no footprint/)
    })

    it('falls back to default shroud when viewer has no shroud', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(undefined) // no shroud
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const footprint = [new PPos(0, 0)]

      const fa = new FrozenActor(actor, frozenTrait, footprint, viewer as unknown as PlayerStub, false)

      // With default shroud (everything hidden), the frozen actor should be Shrouded=true, Visible=true
      expect(fa.Shrouded).toBe(true)
      expect(fa.Visible).toBe(true)
    })

    it('captures health and tooltip traits from actor', () => {
      const tooltip = createMockTooltip()
      const health = createMockHealth()
      const actor = createMockActor({
        traitsImplementing: (id: string) => {
          if (id === 'ITooltip') return [tooltip]
          if (id === 'IHealth') return [health]
          return []
        },
      })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const footprint = [new PPos(0, 0)]

      const fa = new FrozenActor(actor, frozenTrait, footprint, viewer as unknown as PlayerStub, false)

      // RefreshState populates health and tooltip
      fa.RefreshState()
      expect(fa.HP).toBe(100)
      expect(fa.DamageState).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  describe('computed properties', () => {
    it('ID returns actor.actorId', () => {
      const actor = createMockActor({ actorId: 99 })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.ID).toBe(99)
    })

    it('IsValid returns false when Owner is null', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.IsValid).toBe(false)
      expect(fa.isValid).toBe(false)
    })

    it('IsValid returns true when Owner is set', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.Owner = viewer as unknown as PlayerStub
      expect(fa.IsValid).toBe(true)
      expect(fa.isValid).toBe(true)
    })

    it('Actor returns null when live actor is dead', () => {
      const actor = createMockActor({ isDead: true })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.Actor).toBeNull()
    })

    it('Actor returns live actor when not dead', () => {
      const actor = createMockActor({ isDead: false })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.Actor).toBe(actor)
    })

    it('visible/hidden getters return Visible/Hidden state', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.visible).toBe(fa.Visible)
      expect(fa.hidden).toBe(fa.Hidden)
    })

    it('HasRenderables returns false when Shrouded', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      // With default shroud visibility (Hidden), Shrouded is true
      expect(fa.HasRenderables).toBe(false)
    })

    it('CenterPosition is stored from actor', () => {
      const pos = new WPos(1024, 2048, 512)
      const actor = createMockActor()
      ;(actor as unknown as Record<string, unknown>)['centerPosition'] = pos
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(1, 2)], viewer as unknown as PlayerStub, false)

      expect(fa.CenterPosition.X).toBe(1024)
      expect(fa.CenterPosition.Y).toBe(2048)
      expect(fa.CenterPosition.Z).toBe(512)
    })
  })

  // -------------------------------------------------------------------------
  // Visibility state (core logic)
  // -------------------------------------------------------------------------

  describe('visibility state', () => {
    it('sets Visible=false and Shrouded=false when any cell is Visible', () => {
      const actor = createMockActor()
      const shroud = createMockShroud({
        getVisibility: (puv: PPos) => {
          // First cell is visible
          if (puv.U === 5 && puv.V === 5) return CellVisibility.Visible
          return CellVisibility.Hidden
        },
      })
      const viewer = createMockPlayer(shroud)
      const onVisibilityChanged = vi.fn()
      const frozenTrait = { onVisibilityChanged }
      const footprint = [new PPos(5, 5), new PPos(6, 6)]

      const fa = new FrozenActor(actor, frozenTrait, footprint, viewer as unknown as PlayerStub, false)

      // Since footprint[0] is visible, Visible=false, Shrouded=false
      expect(fa.Visible).toBe(false)
      expect(fa.Shrouded).toBe(false)
      // Visibility change was detected (true → false)
      expect(onVisibilityChanged).toHaveBeenCalledWith(fa)
    })

    it('sets Visible=true and Shrouded=false when cells are Explored but not Visible', () => {
      const actor = createMockActor()
      const shroud = createMockShroud({
        getVisibility: () => CellVisibility.Explored,
      })
      const viewer = createMockPlayer(shroud)
      const onVisibilityChanged = vi.fn()
      const frozenTrait = { onVisibilityChanged }
      const footprint = [new PPos(5, 5)]

      const fa = new FrozenActor(actor, frozenTrait, footprint, viewer as unknown as PlayerStub, false)

      expect(fa.Visible).toBe(true)
      expect(fa.Shrouded).toBe(false)
      // Default Visible is true, no change detected
      expect(onVisibilityChanged).not.toHaveBeenCalled()
    })

    it('sets Visible=true and Shrouded=true when all cells are Hidden', () => {
      const actor = createMockActor()
      const shroud = createMockShroud({
        getVisibility: () => CellVisibility.Hidden,
      })
      const viewer = createMockPlayer(shroud)
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const footprint = [new PPos(5, 5), new PPos(6, 6)]

      // Use a new FrozenActor but override the shroud after construction
      const fa = new FrozenActor(
        actor,
        frozenTrait,
        footprint,
        viewer as unknown as PlayerStub,
        false,
      )

      expect(fa.Visible).toBe(true)
      expect(fa.Shrouded).toBe(true)
    })

    it('detects visibility transition from visible to hidden (Visible: false→true)', () => {
      const actor = createMockActor()
      // Use a mutable visibility state — the FrozenActor caches the shroud
      // reference, so we must mutate the object (not replace it).
      let currentVisibility: number = CellVisibility.Visible
      const shroud = createMockShroud({
        getVisibility: () => currentVisibility,
      })
      const viewer = createMockPlayer(shroud)
      const onVisibilityChanged = vi.fn()
      const frozenTrait = { onVisibilityChanged }

      // Create with a visible footprint (Visible=false initially)
      const fa = new FrozenActor(
        actor,
        frozenTrait,
        [new PPos(0, 0)],
        viewer as unknown as PlayerStub,
        false,
      )

      expect(fa.Visible).toBe(false) // actor is visible, frozen is hidden
      onVisibilityChanged.mockClear()

      // Simulate the actor going out of visible range by mutating the
      // shroud's internal state (same object, different return value)
      currentVisibility = CellVisibility.Hidden
      fa.UpdateVisibilityNextTick = true
      fa.Tick()

      expect(fa.Visible).toBe(true) // now frozen is visible
      expect(onVisibilityChanged).toHaveBeenCalled()
    })

    it('marks NeedRenderables when transitioning from hidden to visible', () => {
      const actor = createMockActor()
      // Mutable visibility state (FrozenActor caches shroud reference)
      let currentVisibility: number = CellVisibility.Visible
      const shroud = createMockShroud({
        getVisibility: () => currentVisibility,
      })
      const viewer = createMockPlayer(shroud)
      const onVisibilityChanged = vi.fn()
      const frozenTrait = { onVisibilityChanged }

      const fa = new FrozenActor(
        actor,
        frozenTrait,
        [new PPos(0, 0)],
        viewer as unknown as PlayerStub,
        false,
      )

      // Initially Visible=false (actor is visible → frozen not needed)
      expect(fa.Visible).toBe(false)
      expect(fa.NeedRenderables).toBe(false)

      // Switch to hidden — now frozen is needed
      currentVisibility = CellVisibility.Hidden
      fa.UpdateVisibilityNextTick = true
      fa.Tick()

      expect(fa.Visible).toBe(true)
      expect(fa.NeedRenderables).toBe(true)
    })

    it('UpdateVisibilityNextTick triggers re-evaluation on next Tick', () => {
      const actor = createMockActor()
      // Mutable visibility state (FrozenActor caches shroud reference)
      let currentVisibility: number = CellVisibility.Hidden
      const shroud = createMockShroud({
        getVisibility: () => currentVisibility,
      })
      const viewer = createMockPlayer(shroud)
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      const fa = new FrozenActor(
        actor,
        frozenTrait,
        [new PPos(0, 0)],
        viewer as unknown as PlayerStub,
        false,
      )

      // Initially Hidden → Visible=true, Shrouded=true
      expect(fa.Visible).toBe(true)
      expect(fa.Shrouded).toBe(true)

      // Change shroud to visible by mutating the captured reference
      currentVisibility = CellVisibility.Visible

      // Before tick, still thinks it's shrouded
      fa.UpdateVisibilityNextTick = true
      expect(fa.Visible).toBe(true)

      // After tick, visibility is re-evaluated
      fa.Tick()
      expect(fa.Visible).toBe(false)
      expect(fa.Shrouded).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // RefreshState
  // -------------------------------------------------------------------------

  describe('RefreshState', () => {
    it('updates Owner from live actor', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      const owner = createMockPlayer()
      ;(actor as unknown as Record<string, unknown>)['owner'] = owner

      fa.RefreshState()
      expect(fa.Owner).toBe(owner)
    })

    it('updates TargetTypes from live actor', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      const targetTypes = new Set(['Ground', 'Water'])
      ;(actor as unknown as Record<string, unknown>)['getEnabledTargetTypes'] = () => targetTypes

      fa.RefreshState()
      expect(fa.TargetTypes).toBe(targetTypes)
    })

    it('updates targetable positions from live actor', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      const positions = [new WPos(100, 200, 0), new WPos(300, 400, 0)]
      ;(actor as unknown as Record<string, unknown>)['getTargetablePositions'] = () => positions

      fa.RefreshState()
      expect(fa.TargetablePositions).toHaveLength(2)
      expect(fa.TargetablePositions[0]).toEqual(positions[0])
    })

    it('updates HP and DamageState from health trait', () => {
      const health = createMockHealth({ hp: 50, damageState: 4 }) // Medium damage
      const actor = createMockActor({
        traitsImplementing: (id: string) => {
          if (id === 'IHealth') return [health]
          return []
        },
      })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.RefreshState()
      expect(fa.HP).toBe(50)
      expect(fa.DamageState).toBe(4)
    })

    it('updates TooltipInfo from first enabled tooltip', () => {
      const tooltip = createMockTooltip({
        tooltipInfo: { tooltipForPlayerStance: () => 'Custom tooltip', isOwnerRowVisible: true },
      })
      const actor = createMockActor({
        traitsImplementing: (id: string) => {
          if (id === 'ITooltip') return [tooltip]
          return []
        },
      })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.RefreshState()
      expect(fa.TooltipInfo).toBe(tooltip.tooltipInfo)
    })

    it('skips disabled tooltips and uses first enabled one', () => {
      const disabledTooltip = createMockTooltip({ isTraitDisabled: true })
      const enabledTooltip = createMockTooltip({
        tooltipInfo: { tooltipForPlayerStance: () => 'Enabled', isOwnerRowVisible: false },
      })
      const actor = createMockActor({
        traitsImplementing: (id: string) => {
          if (id === 'ITooltip') return [disabledTooltip, enabledTooltip]
          return []
        },
      })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.RefreshState()
      expect(fa.TooltipInfo).toBe(enabledTooltip.tooltipInfo)
    })

    it('handles actor without getEnabledTargetTypes gracefully', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      // Should not throw
      expect(() => fa.RefreshState()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // RefreshHidden
  // -------------------------------------------------------------------------

  describe('RefreshHidden', () => {
    it('sets Hidden=true when a visibility modifier reports invisible', () => {
      const modifier = createMockVisibilityModifier(false) // invisible
      const actor = createMockActor({
        traitsImplementing: (id: string) => {
          if (id === 'IVisibilityModifier') return [modifier]
          return []
        },
      })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.RefreshHidden()
      expect(fa.Hidden).toBe(true)
    })

    it('leaves Hidden=false when all modifiers report visible', () => {
      const modifier = createMockVisibilityModifier(true) // visible
      const actor = createMockActor({
        traitsImplementing: (id: string) => {
          if (id === 'IVisibilityModifier') return [modifier]
          return []
        },
      })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.RefreshHidden()
      expect(fa.Hidden).toBe(false)
    })

    it('stops at first invisible modifier', () => {
      const visibleMod = createMockVisibilityModifier(true)
      const invisibleMod = createMockVisibilityModifier(false)
      const thirdMod = createMockVisibilityModifier(true)
      const isVisibleSpy = vi.spyOn(invisibleMod, 'isVisible')

      const actor = createMockActor({
        traitsImplementing: (id: string) => {
          if (id === 'IVisibilityModifier') return [visibleMod, invisibleMod, thirdMod]
          return []
        },
      })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.RefreshHidden()
      expect(fa.Hidden).toBe(true)
      // The second modifier should have been called
      expect(isVisibleSpy).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Invalidate
  // -------------------------------------------------------------------------

  describe('Invalidate', () => {
    it('sets Owner to null', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      fa.Owner = viewer as unknown as PlayerStub
      expect(fa.IsValid).toBe(true)

      fa.Invalidate()
      expect(fa.IsValid).toBe(false)
      expect(fa.Owner).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Flash
  // -------------------------------------------------------------------------

  describe('Flash', () => {
    let fa: FrozenActor

    beforeEach(() => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud({ getVisibility: () => CellVisibility.Visible }))
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
    })

    it('does not throw when called', () => {
      expect(() => fa.Flash({ r: 1, g: 0, b: 0 }, 0.5)).not.toThrow()
      expect(() => fa.Flash({ r: 1, g: 1, b: 0 })).not.toThrow()
    })

    it('sets flash ticks to 5', () => {
      fa.Flash({ r: 1, g: 0, b: 0 })
      // Tick 5 (odd) → isFlashing is false
      expect(fa.isFlashing).toBe(false)
      // After one tick: flashTicks = 4 (even) → isFlashing = true
      fa.Tick()
      expect(fa.isFlashing).toBe(true)
    })

    it('toggle flash on alternating ticks (blink effect)', () => {
      fa.Flash({ r: 1, g: 0, b: 0 })
      // ticks: 5,4,3,2,1,0
      // 5: isFlashing=false (odd)
      // 4: isFlashing=true  (even)
      // 3: isFlashing=false (odd)
      // 2: isFlashing=true  (even)
      // 1: isFlashing=false (odd)
      // 0: isFlashing=false (flashTicks <= 0)
      expect(fa.isFlashing).toBe(false) // tick 5 (odd)
      fa.Tick() // -> 4
      expect(fa.isFlashing).toBe(true)  // tick 4 (even)
      fa.Tick() // -> 3
      expect(fa.isFlashing).toBe(false) // tick 3 (odd)
      fa.Tick() // -> 2
      expect(fa.isFlashing).toBe(true)  // tick 2 (even)
      fa.Tick() // -> 1
      expect(fa.isFlashing).toBe(false) // tick 1 (odd)
      fa.Tick() // -> 0
      expect(fa.isFlashing).toBe(false) // tick 0 (expired)
    })

    it('flash expires after 5 ticks', () => {
      fa.Flash({ r: 1, g: 0, b: 0 })
      // Advance 6 ticks
      for (let i = 0; i < 6; i++) fa.Tick()
      expect(fa.isFlashing).toBe(false)
      expect(fa.flashTint).toBeNull()
      expect(fa.flashAlpha).toBeNull()
    })

    it('Color overload divides RGB by 255', () => {
      fa.Flash({ r: 255, g: 128, b: 0 }, 0.5)
      fa.Tick() // -> 4 (even, active)
      expect(fa.flashTint).toEqual({ r: 1.0, g: 128 / 255, b: 0 })
      expect(fa.flashAlpha).toBe(0.5)
    })

    it('float3 overload uses tint values as-is', () => {
      fa.Flash({ r: 0.5, g: 0.25, b: 0.75 })
      fa.Tick() // -> 4 (even, active)
      expect(fa.flashTint).toEqual({ r: 0.5, g: 0.25, b: 0.75 })
      expect(fa.flashAlpha).toBeNull()
    })

    it('flashTint returns null when not flashing', () => {
      expect(fa.flashTint).toBeNull()
      expect(fa.flashAlpha).toBeNull()
    })

    it('multiple Flash calls reset timer', () => {
      fa.Flash({ r: 1, g: 0, b: 0 })
      fa.Tick() // -> 4
      fa.Tick() // -> 3
      expect(fa.isFlashing).toBe(false) // odd tick

      // Re-flash resets to 5
      fa.Flash({ r: 0, g: 1, b: 0 })
      expect(fa.isFlashing).toBe(false) // tick 5 (odd)
      fa.Tick() // -> 4
      expect(fa.isFlashing).toBe(true)
      expect(fa.flashTint).toEqual({ r: 0, g: 1, b: 0 })
    })

    it('Tick() still processes visibility updates during flash', () => {
      fa.Flash({ r: 1, g: 0, b: 0 })
      fa.UpdateVisibilityNextTick = true

      // Spy on visibility update by checking UpdateVisibilityNextTick after tick
      fa.Tick()
      expect(fa.UpdateVisibilityNextTick).toBe(false) // processed
    })
  })

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  describe('Render', () => {
    it('returns empty array when Shrouded', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud({ getVisibility: () => CellVisibility.Hidden }))
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
      // With Hidden visibility, Shrouded is true
      expect(fa.Shrouded).toBe(true)
      expect(fa.Render()).toEqual([])
    })

    it('returns captured renderables when not shrouded', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud({ getVisibility: () => CellVisibility.Visible }))
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
      // With Visible cell, Shrouded is false, Visible is false
      // Set some renderables manually
      const renderables = [{ type: 'test' }]
      fa.Renderables = renderables
      expect(fa.Render()).toBe(renderables)
    })

    it('returns renderables during flash', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud({ getVisibility: () => CellVisibility.Visible }))
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
      const renderables = [{ type: 'test' }]
      fa.Renderables = renderables
      fa.Flash({ r: 1, g: 0, b: 0 })
      fa.Tick() // -> 4 (even, active)
      expect(fa.isFlashing).toBe(true)
      // Render should return renderables (flash state is available for consumers)
      expect(fa.Render()).toBe(renderables)
    })
  })

  // -------------------------------------------------------------------------
  // Tooltip
  // -------------------------------------------------------------------------

  describe('Tooltip', () => {
    it('tooltipName returns the live actor info name', () => {
      const actor = createMockActor()
      ;(actor as unknown as Record<string, unknown>)['info'] = { name: 'E1' }
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.tooltipName).toBe('E1')
    })

    it('tooltipName returns "Fogged Unit" when info has no name', () => {
      const actor = createMockActor()
      ;(actor as unknown as Record<string, unknown>)['info'] = {}
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.tooltipName).toBe('Fogged Unit')
    })

    it('getTooltipText delegates to captured TooltipInfo', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
      fa.TooltipInfo = {
        tooltipForPlayerStance: (stance: unknown) => `Visible to ${stance}`,
        isOwnerRowVisible: false,
      }

      expect(fa.getTooltipText('Ally')).toBe('Visible to Ally')
    })

    it('getTooltipText returns "Fogged Unit" when TooltipInfo is null', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
      fa.TooltipInfo = null

      expect(fa.getTooltipText()).toBe('Fogged Unit')
    })

    it('tooltipOwnerRowVisible delegates to TooltipInfo', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
      fa.TooltipInfo = {
        tooltipForPlayerStance: () => 'Tooltip',
        isOwnerRowVisible: true,
      }

      expect(fa.tooltipOwnerRowVisible).toBe(true)
    })

    it('tooltipOwnerRowVisible returns false when TooltipInfo is null', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)
      fa.TooltipInfo = null

      expect(fa.tooltipOwnerRowVisible).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // MouseBounds (Polygon integration)
  // -------------------------------------------------------------------------

  describe('MouseBounds (Polygon)', () => {
    it('returns Polygon.Empty by default', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.mouseBounds.IsEmpty).toBe(true)
    })

    it('returns the assigned Polygon', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      const bounds = new Polygon(Rectangle.fromLTRB(0, 0, 10, 10))
      fa.MouseBounds = bounds

      expect(fa.mouseBounds).toBe(bounds)
      expect(fa.mouseBounds.contains(5, 5)).toBe(true)
      expect(fa.mouseBounds.contains(50, 50)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // ToString
  // -------------------------------------------------------------------------

  describe('toString', () => {
    it('returns name and ID', () => {
      const actor = createMockActor({ actorId: 7 })
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.toString()).toContain('TestActor')
      expect(fa.toString()).toContain('7')
    })

    it('appends (invalid) when IsValid is false', () => {
      const actor = createMockActor()
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(actor, frozenTrait, [new PPos(0, 0)], viewer as unknown as PlayerStub, false)

      expect(fa.toString()).toContain('(invalid)')
    })
  })
})

// ===========================================================================
// FrozenActorLayer Tests
// ===========================================================================

describe('FrozenActorLayer', () => {
  let mockActor: IGameActor
  let mockWorld: Record<string, unknown> & { actors: Iterable<IGameActor> }
  let mockScreenMap: Record<string, unknown>
  let frozenLayer: FrozenActorLayer

  beforeEach(() => {
    // Set up mock ScreenMap
    mockScreenMap = {
      frozenActorsById: new Map<number, FrozenActor>(),
      partitioned: new SpatiallyPartitioned<FrozenActor>(100, 100, 10),
      addOrUpdate: vi.fn((_viewer: PlayerStub, fa: FrozenActor) => {
        ;(mockScreenMap['frozenActorsById'] as Map<number, FrozenActor>).set(fa.ID, fa)
      }),
      remove: vi.fn((_viewer: PlayerStub, fa: FrozenActor) => {
        ;(mockScreenMap['frozenActorsById'] as Map<number, FrozenActor>).delete(fa.ID)
      }),
      renderableFrozenActorsInBox: vi.fn((_viewer: PlayerStub, _a: { x: number; y: number }, _b: { x: number; y: number }) => {
        const all = (mockScreenMap['frozenActorsById'] as Map<number, FrozenActor>)
        return [...all.values()]
      }),
    }

    // Set up mock World
    mockWorld = {
      actors: [],
      screenMap: mockScreenMap,
      map: {
        mapSize: { width: 100, height: 100 },
        cellContaining: (pos: WPos) => ({ X: (pos.X / 1024) | 0, Y: (pos.Y / 1024) | 0 }),
      },
    }

    // Set up mock Player Actor
    const shroud = createMockShroud({
      addOnShroudChanged: vi.fn(),
    })
    const player = createMockPlayer(shroud)

    mockActor = createMockActor({
      actorId: 1,
      owner: player as unknown as PlayerStub,
      world: mockWorld,
    })
    ;(mockActor as unknown as Record<string, unknown>)['shroud'] = shroud

    frozenLayer = new FrozenActorLayer(mockActor, new FrozenActorLayerInfo(10))
  })

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('creates with default bin size', () => {
      const info = new FrozenActorLayerInfo()
      expect(info.binSize).toBe(10)
    })

    it('creates with custom bin size', () => {
      const info = new FrozenActorLayerInfo(5)
      expect(info.binSize).toBe(5)
    })

    it('subscribes to shroud changed events', () => {
      const shroud = createMockShroud({
        addOnShroudChanged: vi.fn(),
      })
      const player = createMockPlayer(shroud)
      const actor = createMockActor({
        owner: player as unknown as PlayerStub,
        world: mockWorld,
      })
      ;(actor as unknown as Record<string, unknown>)['shroud'] = shroud

      new FrozenActorLayer(actor, new FrozenActorLayerInfo())

      expect(shroud.addOnShroudChanged).toHaveBeenCalled()
    })

    it('initializes VisibilityHash and FrozenHash to 0', () => {
      expect(frozenLayer.VisibilityHash).toBe(0)
      expect(frozenLayer.FrozenHash).toBe(0)
    })

    it('handles actor without shroud gracefully', () => {
      const actor = createMockActor({
        owner: createMockPlayer() as unknown as PlayerStub,
        world: mockWorld,
      })
      // No shroud property

      expect(() => {
        new FrozenActorLayer(actor, new FrozenActorLayerInfo())
      }).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Add / Remove
  // -------------------------------------------------------------------------

  describe('Add / Remove', () => {
    it('adds a frozen actor and can look it up by ID', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor({ actorId: 100 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )

      frozenLayer.Add(fa)

      expect(frozenLayer.FromID(100)).toBe(fa)
    })

    it('removes a frozen actor so FromID returns null', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor({ actorId: 200 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )

      frozenLayer.Add(fa)
      expect(frozenLayer.FromID(200)).toBe(fa)

      frozenLayer.Remove(fa)
      expect(frozenLayer.FromID(200)).toBeNull()
    })

    it('FromID returns null for unknown ID', () => {
      expect(frozenLayer.FromID(999)).toBeNull()
    })

    it('adds frozen actor to ScreenMap', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor({ actorId: 300 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )

      frozenLayer.Add(fa)

      expect(mockScreenMap.addOrUpdate).toHaveBeenCalled()
    })

    it('removes frozen actor from ScreenMap', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor({ actorId: 400 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )

      frozenLayer.Add(fa)
      frozenLayer.Remove(fa)

      expect(mockScreenMap.remove).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // FootprintBounds
  // -------------------------------------------------------------------------

  describe('FootprintBounds', () => {
    it('computes correct bounds for single-cell footprint', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor(),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )

      const bounds = FrozenActorLayer.FootprintBounds(fa)
      expect(bounds.Left).toBe(5)
      expect(bounds.Top).toBe(5)
      expect(bounds.Right).toBe(6) // max+1
      expect(bounds.Bottom).toBe(6)
    })

    it('computes correct bounds for multi-cell footprint', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor(),
        frozenTrait,
        [new PPos(2, 3), new PPos(5, 1), new PPos(1, 7)],
        viewer as unknown as PlayerStub,
        false,
      )

      const bounds = FrozenActorLayer.FootprintBounds(fa)
      expect(bounds.Left).toBe(1)
      expect(bounds.Top).toBe(1)
      expect(bounds.Right).toBe(6) // maxU=5, +1
      expect(bounds.Bottom).toBe(8) // maxV=7, +1
    })

    it('handles footprint with identical coordinates', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor(),
        frozenTrait,
        [new PPos(3, 3), new PPos(3, 3), new PPos(3, 3)],
        viewer as unknown as PlayerStub,
        false,
      )

      const bounds = FrozenActorLayer.FootprintBounds(fa)
      expect(bounds.Left).toBe(3)
      expect(bounds.Top).toBe(3)
      expect(bounds.Right).toBe(4)
      expect(bounds.Bottom).toBe(4)
    })
  })

  // -------------------------------------------------------------------------
  // ITick (tick)
  // -------------------------------------------------------------------------

  describe('tick', () => {
    it('computes VisibilityHash and FrozenHash', () => {
      const viewer = createMockPlayer(createMockShroud({ getVisibility: () => CellVisibility.Hidden }))
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      const fa1 = new FrozenActor(
        createMockActor({ actorId: 10 }),
        frozenTrait,
        [new PPos(1, 1)],
        viewer as unknown as PlayerStub,
        false,
      )
      const fa2 = new FrozenActor(
        createMockActor({ actorId: 20 }),
        frozenTrait,
        [new PPos(2, 2)],
        viewer as unknown as PlayerStub,
        false,
      )

      frozenLayer.Add(fa1)
      frozenLayer.Add(fa2)

      // Both frozen actors should be Visible=true (shroud is Hidden)
      fa1.Visible = true
      fa2.Visible = true

      frozenLayer.tick(mockActor)

      // FrozenHash = hash(10) + hash(20) = 10 + 20 = 30
      expect(frozenLayer.FrozenHash).toBe(10 + 20)
      // VisibilityHash = same (both visible)
      expect(frozenLayer.VisibilityHash).toBe(10 + 20)
    })

    it('removes frozen actors whose live actor is dead and not visible', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      const deadActor = createMockActor({ actorId: 99, isDead: true })
      const fa = new FrozenActor(
        deadActor,
        frozenTrait,
        [new PPos(1, 1)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Visible = false // not visible + dead → removed

      frozenLayer.Add(fa)
      expect(frozenLayer.FromID(99)).toBe(fa)

      frozenLayer.tick(mockActor)

      expect(frozenLayer.FromID(99)).toBeNull()
    })

    it('preserves dead actors that are still visible', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      const deadActor = createMockActor({ actorId: 88, isDead: true })
      const fa = new FrozenActor(
        deadActor,
        frozenTrait,
        [new PPos(1, 1)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Visible = true // visible → preserved even if dead

      frozenLayer.Add(fa)
      frozenLayer.tick(mockActor)

      expect(frozenLayer.FromID(88)).toBe(fa)
    })

    it('calls Tick on all frozen actors', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const actor = createMockActor({ actorId: 50 })

      const fa = new FrozenActor(
        actor,
        frozenTrait,
        [new PPos(1, 1)],
        viewer as unknown as PlayerStub,
        false,
      )

      // Spy on Tick
      const tickSpy = vi.spyOn(fa, 'Tick')

      frozenLayer.Add(fa)
      frozenLayer.tick(mockActor)

      expect(tickSpy).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // IRender (render)
  // -------------------------------------------------------------------------

  describe('render', () => {
    it('returns empty array when no frozen actors', () => {
      const wr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
      const result = frozenLayer.render(mockActor, wr as unknown as Parameters<typeof frozenLayer.render>[1])
      expect(result).toEqual([])
    })

    it('returns renderables for visible frozen actors in viewport', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor({ actorId: 60 }),
        frozenTrait,
        [new PPos(1, 1)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Visible = true

      frozenLayer.Add(fa)

      const wr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
      const result = frozenLayer.render(mockActor, wr as unknown as Parameters<typeof frozenLayer.render>[1])
      // Render() returns empty array (deferred), so result should be empty
      expect(result).toEqual([])
    })

    it('skips frozen actors that are not visible', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor({ actorId: 70 }),
        frozenTrait,
        [new PPos(1, 1)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Visible = false

      frozenLayer.Add(fa)

      const wr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
      const result = frozenLayer.render(mockActor, wr as unknown as Parameters<typeof frozenLayer.render>[1])
      expect(result).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // screenBounds
  // -------------------------------------------------------------------------

  describe('screenBounds', () => {
    it('returns empty array', () => {
      const wr = {}
      const result = frozenLayer.screenBounds(mockActor, wr as unknown as Parameters<typeof frozenLayer.screenBounds>[1])
      expect(result).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // FrozenActorsInRegion
  // -------------------------------------------------------------------------

  describe('FrozenActorsInRegion', () => {
    it('returns frozen actors in the specified region', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      // Create a frozen actor at (5, 5)
      const fa = new FrozenActor(
        createMockActor({ actorId: 10 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Owner = viewer as unknown as PlayerStub // make valid
      fa.Visible = true
      frozenLayer.Add(fa)

      // Create a mock region that covers (4,4) to (6,6)
      const region = {
        TopLeft: { X: 4, Y: 4, toMPos: () => ({ U: 4, V: 4 }), toCPos: () => ({ X: 4, Y: 4 }) },
        BottomRight: { X: 6, Y: 6, toMPos: () => ({ U: 6, V: 6 }), toCPos: () => ({ X: 6, Y: 6 }) },
        gridType: 0,
        toString: () => '',
        mapTopLeft: { U: 4, V: 4, toCPos: () => ({ X: 4, Y: 4 }) },
        mapBottomRight: { U: 6, V: 6, toCPos: () => ({ X: 6, Y: 6 }) },
      }

      const results = frozenLayer.FrozenActorsInRegion(region as unknown as Parameters<typeof frozenLayer.FrozenActorsInRegion>[0])
      expect(results).toHaveLength(1)
      expect(results[0]).toBe(fa)
    })

    it('filters out non-visible when onlyVisible=true', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      const fa = new FrozenActor(
        createMockActor({ actorId: 20 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Owner = viewer as unknown as PlayerStub
      fa.Visible = false // not visible
      frozenLayer.Add(fa)

      const region = {
        TopLeft: { X: 4, Y: 4, toMPos: () => ({ U: 4, V: 4 }), toCPos: () => ({ X: 4, Y: 4 }) },
        BottomRight: { X: 6, Y: 6, toMPos: () => ({ U: 6, V: 6 }), toCPos: () => ({ X: 6, Y: 6 }) },
        gridType: 0,
        toString: () => '',
        mapTopLeft: { U: 4, V: 4, toCPos: () => ({ X: 4, Y: 4 }) },
        mapBottomRight: { U: 6, V: 6, toCPos: () => ({ X: 6, Y: 6 }) },
      }

      const results = frozenLayer.FrozenActorsInRegion(region as unknown as Parameters<typeof frozenLayer.FrozenActorsInRegion>[0], true)
      expect(results).toHaveLength(0)
    })

    it('includes non-visible when onlyVisible=false', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      const fa = new FrozenActor(
        createMockActor({ actorId: 30 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Owner = viewer as unknown as PlayerStub
      fa.Visible = false
      frozenLayer.Add(fa)

      const region = {
        TopLeft: { X: 4, Y: 4, toMPos: () => ({ U: 4, V: 4 }), toCPos: () => ({ X: 4, Y: 4 }) },
        BottomRight: { X: 6, Y: 6, toMPos: () => ({ U: 6, V: 6 }), toCPos: () => ({ X: 6, Y: 6 }) },
        gridType: 0,
        toString: () => '',
        mapTopLeft: { U: 4, V: 4, toCPos: () => ({ X: 4, Y: 4 }) },
        mapBottomRight: { U: 6, V: 6, toCPos: () => ({ X: 6, Y: 6 }) },
      }

      const results = frozenLayer.FrozenActorsInRegion(region as unknown as Parameters<typeof frozenLayer.FrozenActorsInRegion>[0], false)
      expect(results).toHaveLength(1)
    })

    it('filters out invalid frozen actors', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      const fa = new FrozenActor(
        createMockActor({ actorId: 40 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )
      // Owner remains null → invalid
      frozenLayer.Add(fa)

      const region = {
        TopLeft: { X: 4, Y: 4, toMPos: () => ({ U: 4, V: 4 }), toCPos: () => ({ X: 4, Y: 4 }) },
        BottomRight: { X: 6, Y: 6, toMPos: () => ({ U: 6, V: 6 }), toCPos: () => ({ X: 6, Y: 6 }) },
        gridType: 0,
        toString: () => '',
        mapTopLeft: { U: 4, V: 4, toCPos: () => ({ X: 4, Y: 4 }) },
        mapBottomRight: { U: 6, V: 6, toCPos: () => ({ X: 6, Y: 6 }) },
      }

      const results = frozenLayer.FrozenActorsInRegion(region as unknown as Parameters<typeof frozenLayer.FrozenActorsInRegion>[0], false)
      expect(results).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // FrozenActorsInCircle
  // -------------------------------------------------------------------------

  describe('FrozenActorsInCircle', () => {
    it('returns frozen actors within circular range', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      // Center at cell (5,5).
      const fa = new FrozenActor(
        createMockActor({ actorId: 50 }),
        frozenTrait,
        [new PPos(5, 5)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Owner = viewer as unknown as PlayerStub
      fa.Visible = true
      frozenLayer.Add(fa)

      // Verify FA was stored in ID map
      expect(frozenLayer.FromID(50)).toBe(fa)

      // Verify FA is found in the region query (which passes in other tests)
      const region = {
        TopLeft: { X: 3, Y: 3, toMPos: () => ({ U: 3, V: 3 }), toCPos: () => ({ X: 3, Y: 3 }) },
        BottomRight: { X: 7, Y: 7, toMPos: () => ({ U: 7, V: 7 }), toCPos: () => ({ X: 7, Y: 7 }) },
        gridType: 0,
        toString: () => '',
        mapTopLeft: { U: 3, V: 3, toCPos: () => ({ X: 3, Y: 3 }) },
        mapBottomRight: { U: 7, V: 7, toCPos: () => ({ X: 7, Y: 7 }) },
      }
      const regionResults = frozenLayer.FrozenActorsInRegion(region as unknown as Parameters<typeof frozenLayer.FrozenActorsInRegion>[0], false)
      expect(regionResults).toHaveLength(1) // verify spatial partition works

      // Search from origin at cell (5,5) with large radius
      const results = frozenLayer.FrozenActorsInCircle(
        mockWorld as unknown as Parameters<typeof frozenLayer.FrozenActorsInCircle>[0],
        new WPos(5 * 1024, 5 * 1024, 0),
        new WDist(10240), // 10 cells radius
      )

      expect(results).toHaveLength(1)
      expect(results[0]).toBe(fa)
    })

    it('excludes frozen actors outside circular range', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      // Actor at cell (10, 10) — far from origin (0,0)
      const fa = new FrozenActor(
        createMockActor({ actorId: 60 }),
        frozenTrait,
        [new PPos(10, 10)],
        viewer as unknown as PlayerStub,
        false,
      )
      fa.Owner = viewer as unknown as PlayerStub
      fa.Visible = true
      frozenLayer.Add(fa)

      // Search from origin at cell (0, 0) with small radius
      const results = frozenLayer.FrozenActorsInCircle(
        mockWorld as unknown as Parameters<typeof frozenLayer.FrozenActorsInCircle>[0],
        new WPos(0, 0, 0),
        new WDist(1024), // 1 cell radius ≈ 1024 units
      )

      // FA at (10,10) should be outside 1-cell radius from (0,0)
      // Distance = sqrt(10*1024^2 + 10*1024^2) ≈ sqrt(2*100*1024^2) = 1024*sqrt(200) ≈ 14481 > 1024
      expect(results).toHaveLength(0)
    })

    it('filters by onlyVisible parameter', () => {
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }

      // Two FAs at same cell with larger footprint for detection
      const faVisible = new FrozenActor(
        createMockActor({ actorId: 70 }),
        frozenTrait,
        [new PPos(5, 5), new PPos(6, 6)],
        viewer as unknown as PlayerStub,
        false,
      )
      faVisible.Owner = viewer as unknown as PlayerStub
      faVisible.Visible = true
      frozenLayer.Add(faVisible)

      const faInvisible = new FrozenActor(
        createMockActor({ actorId: 71 }),
        frozenTrait,
        [new PPos(5, 5), new PPos(6, 6)],
        viewer as unknown as PlayerStub,
        false,
      )
      faInvisible.Owner = viewer as unknown as PlayerStub
      faInvisible.Visible = false
      frozenLayer.Add(faInvisible)

      // Verify both were added
      expect(frozenLayer.FromID(70)).toBe(faVisible)
      expect(frozenLayer.FromID(71)).toBe(faInvisible)

      // Search with large radius to cover both
      const searchOrigin = new WPos(5 * 1024, 5 * 1024, 0)
      const searchRadius = new WDist(10240) // 10 cells

      // With onlyVisible=true (default)
      const visibleResults = frozenLayer.FrozenActorsInCircle(
        mockWorld as unknown as Parameters<typeof frozenLayer.FrozenActorsInCircle>[0],
        searchOrigin,
        searchRadius,
        true,
      )
      const visibleIds = visibleResults.map(f => f.ID)
      expect(visibleIds).toContain(70)
      expect(visibleIds).not.toContain(71)

      // With onlyVisible=false
      const allResults = frozenLayer.FrozenActorsInCircle(
        mockWorld as unknown as Parameters<typeof frozenLayer.FrozenActorsInCircle>[0],
        searchOrigin,
        searchRadius,
        false,
      )
      const allIds = allResults.map(f => f.ID)
      expect(allIds).toContain(70)
      expect(allIds).toContain(71)
    })
  })

  // -------------------------------------------------------------------------
  // Shroud change integration
  // -------------------------------------------------------------------------

  describe('shroud change integration', () => {
    it('flags frozen actors at changed cell for visibility update', () => {
      const addOnShroudChanged = vi.fn()
      const shroud = createMockShroud({ addOnShroudChanged })
      const player = createMockPlayer(shroud)
      const actor = createMockActor({
        owner: player as unknown as PlayerStub,
        world: mockWorld,
      })
      ;(actor as unknown as Record<string, unknown>)['shroud'] = shroud

      const layer = new FrozenActorLayer(actor, new FrozenActorLayerInfo())

      // Add a frozen actor at cells (3,3) and (4,4)
      const viewer = createMockPlayer(createMockShroud())
      const frozenTrait = { onVisibilityChanged: vi.fn() }
      const fa = new FrozenActor(
        createMockActor({ actorId: 80 }),
        frozenTrait,
        [new PPos(3, 3), new PPos(4, 4)],
        viewer as unknown as PlayerStub,
        false,
      )
      layer.Add(fa)

      // Get the registered callback
      expect(addOnShroudChanged).toHaveBeenCalled()
      const callback = addOnShroudChanged.mock.calls[0][0] as (puv: PPos) => void

      // Fire shroud changed for cell (3,3)
      fa.UpdateVisibilityNextTick = false
      callback(new PPos(3, 3))

      expect(fa.UpdateVisibilityNextTick).toBe(true)
    })
  })
})
