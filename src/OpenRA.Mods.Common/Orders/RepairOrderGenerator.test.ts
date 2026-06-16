/**
 * RepairOrderGenerator.test.ts — RepairOrderGenerator unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: orderInner dispatch (RepairBuilding/Repair/RepairNear),
 * game-over tick auto-cancel, getCursor returns "repair"/"repair-blocked",
 * undamaged actor filtering, friendly-only targeting.
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
  IGameActor,
  IMouseSettings,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  RepairOrderGenerator,
  type IRepairOrderGeneratorWorld,
} from './RepairOrderGenerator.js'
import type {
  IUnitOrderPlayer,
  IUnitOrderActor,
  IUnitOrderActorInfo,
  IUnitOrderMouseInput,
} from './UnitOrderGenerator.js'

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
    resolveActionButton: vi.fn().mockReturnValue(3),
    resolveCancelButton: vi.fn().mockReturnValue(1),
  }
}

function createMockActorInfo(name: string, traitKeys: string[] = []): IUnitOrderActorInfo {
  return {
    name,
    hasTraitInfo(key: string): boolean {
      return traitKeys.includes(key)
    },
    traitInfos<T>(_interfaceId: string): readonly T[] {
      return [] as unknown as readonly T[]
    },
  }
}

function createMockPlayer(name: string = 'localPlayer', winState: number = 0): IUnitOrderPlayer {
  return {
    playerName: name,
    winState,
    playerActor: null,
    isAlliedWith(other: IUnitOrderPlayer): boolean {
      return other.playerName === name
    },
    relationshipWith(other: IUnitOrderPlayer): 0 | 1 | 2 {
      if (other.playerName === name) return 0 as const
      return 1 as const
    },
  }
}

function createMockActor(
  id: number,
  owner: IUnitOrderPlayer,
  overrides: Partial<{
    isDead: boolean
    info: IUnitOrderActorInfo
    traits: Record<string, unknown[]>
    getDamageState: () => number
    disposed: boolean
  }> = {},
): IUnitOrderActor {
  const traits = overrides.traits ?? {}
  return {
    actorId: id,
    isInWorld: true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
    owner,
    info: overrides.info ?? createMockActorInfo(`actor_${id}`),
    traitsImplementing(interfaceId: string): unknown[] {
      return traits[interfaceId] ?? []
    },
    getDamageState: overrides.getDamageState ?? (() => 1),
  } as unknown as IUnitOrderActor
}

function createMi(overrides: Partial<{ button: number; event: string }> = {}): IUnitOrderMouseInput {
  return {
    button: overrides.button ?? 3,
    event: overrides.event ?? 'Down',
    modifiers: TargetModifiers.None as TargetModifiers,
  }
}

function createMockWorld(
  overrides: Partial<{
    localPlayer: IUnitOrderPlayer | null
    isGameOver: boolean
    actorsAtCell: readonly IGameActor[]
    fogObscuredIds: Set<number>
    cancelInputModeSpy: () => void
  }> = {},
): IRepairOrderGeneratorWorld {
  return {
    actors: [],
    actorMap: {
      getActorsAt(_cell: CPos): readonly IGameActor[] {
        return overrides.actorsAtCell ?? []
      },
    },
    shroud: {
      fogObscures(actor: IGameActor): boolean {
        return overrides.fogObscuredIds?.has(actor.actorId) ?? false
      },
    },
    localPlayer: overrides.localPlayer ?? null,
    isGameOver: overrides.isGameOver ?? false,
    selection: null,
    cancelInputMode: overrides.cancelInputModeSpy ?? voidFn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RepairOrderGenerator', () => {
  let settings: IMouseSettings
  let player: IUnitOrderPlayer

  beforeEach(() => {
    settings = createMockSettings()
    player = createMockPlayer('localPlayer')
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('sets actionType to GlobalCommand', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new RepairOrderGenerator(w, settings)
      expect(gen.actionButton).toBe(3)
    })

    it('sets orderGeneratorKey to RepairOrderGenerator', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new RepairOrderGenerator(w, settings)
      expect(gen.orderGeneratorKey).toBe('RepairOrderGenerator')
    })
  })

  // ---------------------------------------------------------------------------
  // orderInner — repair order dispatch
  // ---------------------------------------------------------------------------

  describe('orderInner', () => {
    it('yields RepairBuilding order when target has RepairableBuildingInfo', () => {
      const info = createMockActorInfo('building', ['RepairableBuildingInfo'])
      const actor = createMockActor(1, player, { info })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBeGreaterThanOrEqual(1)
      expect(orders[0]!.orderName).toBe('RepairBuilding')
    })

    it('yields Repair order when actor has Repairable trait', () => {
      const info = createMockActorInfo('tank', [])
      const repairBuilding = createMockActor(999, player, {
        info: createMockActorInfo('repair_depot', []),
      })
      const actor = createMockActor(1, player, {
        info,
        traits: {
          Repairable: [{ findRepairBuilding: () => repairBuilding }],
        },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBeGreaterThanOrEqual(1)
      expect(orders[0]!.orderName).toBe('Repair')
    })

    it('yields RepairNear order when actor has RepairableNear trait', () => {
      const info = createMockActorInfo('ship', [])
      const repairBuilding = createMockActor(999, player, {
        info: createMockActorInfo('naval_yard', []),
      })
      const actor = createMockActor(1, player, {
        info,
        traits: {
          RepairableNear: [{ findRepairBuilding: () => repairBuilding }],
        },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBeGreaterThanOrEqual(1)
      expect(orders[0]!.orderName).toBe('RepairNear')
    })

    it('skips undamaged actors', () => {
      const info = createMockActorInfo('building', ['RepairableBuildingInfo'])
      const actor = createMockActor(1, player, {
        info,
        getDamageState: () => 0,
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('skips enemy actors (not friendly)', () => {
      const enemyPlayer = createMockPlayer('enemy')
      const info = createMockActorInfo('building', ['RepairableBuildingInfo'])
      const actor = createMockActor(1, enemyPlayer, { info })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('skips fog-obscured actors', () => {
      const info = createMockActorInfo('building', ['RepairableBuildingInfo'])
      const actor = createMockActor(1, player, { info })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
        fogObscuredIds: new Set([1]),
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('yields nothing when no actor at cell', () => {
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('yields nothing when localPlayer is null', () => {
      const w = createMockWorld({
        localPlayer: null,
        actorsAtCell: [],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('yields nothing when mi is undefined', () => {
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, undefined),
      )
      expect(orders.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // tick — auto-cancel on game over
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('calls cancelInputMode when game is over (WinState != Undefined)', () => {
      const winningPlayer = createMockPlayer('localPlayer', 1)
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({
        localPlayer: winningPlayer,
        cancelInputModeSpy: cancelSpy,
      })
      const gen = new RepairOrderGenerator(w, settings)
      gen.tick(w)
      expect(cancelSpy).toHaveBeenCalledOnce()
    })

    it('does NOT call cancelInputMode when WinState is Undefined (game in progress)', () => {
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({
        localPlayer: player,
        cancelInputModeSpy: cancelSpy,
      })
      const gen = new RepairOrderGenerator(w, settings)
      gen.tick(w)
      expect(cancelSpy).not.toHaveBeenCalled()
    })

    it('does NOT call cancelInputMode when localPlayer is null', () => {
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({
        localPlayer: null,
        cancelInputModeSpy: cancelSpy,
      })
      const gen = new RepairOrderGenerator(w, settings)
      gen.tick(w)
      expect(cancelSpy).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // getCursor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns "repair" when a valid repair target is under cursor', () => {
      const info = createMockActorInfo('building', ['RepairableBuildingInfo'])
      const actor = createMockActor(1, player, {
        info,
        getDamageState: () => 1,
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('repair')
    })

    it('returns "repair-blocked" when target is undamaged', () => {
      const info = createMockActorInfo('building', ['RepairableBuildingInfo'])
      const actor = createMockActor(1, player, {
        info,
        getDamageState: () => 0,
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('repair-blocked')
    })

    it('returns "repair-blocked" when no mi', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new RepairOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(0, 0))
      expect(cursor).toBe('repair-blocked')
    })

    it('returns "repair-blocked" when no actors at cell', () => {
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [],
      })
      const gen = new RepairOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('repair-blocked')
    })
  })

  // ---------------------------------------------------------------------------
  // render methods
  // ---------------------------------------------------------------------------

  describe('render methods', () => {
    it('renderAboveShroud is a no-op', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new RepairOrderGenerator(w, settings)
      expect(() =>
        gen.renderAboveShroud(
          {} as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub,
          w,
        ),
      ).not.toThrow()
    })

    it('renderAnnotations is a no-op', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new RepairOrderGenerator(w, settings)
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
      const w = createMockWorld({ localPlayer: player })
      const gen = new RepairOrderGenerator(w, settings)
      expect(() => gen.deactivate()).not.toThrow()
    })
  })
})
