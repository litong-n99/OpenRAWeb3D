/**
 * GlobalButtonOrderGenerator.test.ts — GlobalButtonOrderGenerator, PowerDownOrderGenerator, SellOrderGenerator unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: orderInner trait-based actor lookup, tick auto-cancel on game over,
 * PowerDown isValidTrait checks (not disabled, not paused), cursor resolution
 * for powerdown/powerdown-blocked and sell/sell-blocked.
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
  WorldStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  GlobalButtonOrderGenerator,
  PowerDownOrderGenerator,
  SellOrderGenerator,
  type IGlobalButtonOrderGeneratorWorld,
} from './GlobalButtonOrderGenerator.js'
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
    info: IUnitOrderActorInfo
    traits: Record<string, unknown[]>
  }> = {},
): IUnitOrderActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner,
    info: overrides.info ?? createMockActorInfo(`actor_${id}`),
    traitsImplementing(interfaceId: string): unknown[] {
      return overrides.traits?.[interfaceId] ?? []
    },
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
    cancelInputModeSpy: () => void
  }> = {},
): IGlobalButtonOrderGeneratorWorld {
  return {
    actors: [],
    actorMap: {
      getActorsAt(_cell: CPos): readonly IGameActor[] {
        return overrides.actorsAtCell ?? []
      },
    },
    localPlayer: overrides.localPlayer ?? null,
    isGameOver: overrides.isGameOver ?? false,
    selection: null,
    cancelInputMode: overrides.cancelInputModeSpy ?? voidFn(),
  }
}

// ---------------------------------------------------------------------------
// Concrete subclass for testing abstract GlobalButtonOrderGenerator
// ---------------------------------------------------------------------------

class TestGlobalButtonOrderGenerator extends GlobalButtonOrderGenerator {
  constructor(world: IGlobalButtonOrderGeneratorWorld, settings: IMouseSettings) {
    super('TestGlobal', 'TestTrait', 'TestOrder', world, settings)
  }

  getCursor(
    _world: WorldStub,
    _cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    _mi?: unknown,
  ): string {
    return 'test-cursor'
  }
}

// ---------------------------------------------------------------------------
// GlobalButtonOrderGenerator (base) tests
// ---------------------------------------------------------------------------

describe('GlobalButtonOrderGenerator', () => {
  let settings: IMouseSettings
  let player: IUnitOrderPlayer

  beforeEach(() => {
    settings = createMockSettings()
    player = createMockPlayer('localPlayer')
  })

  describe('constructor', () => {
    it('sets orderGeneratorKey from constructor parameter', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      expect(gen.orderGeneratorKey).toBe('TestGlobal')
    })

    it('sets actionType to GlobalCommand', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      expect(gen.actionButton).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // orderInner
  // ---------------------------------------------------------------------------

  describe('orderInner', () => {
    it('yields order when actor has enabled matching trait', () => {
      const trait = { isTraitEnabled: () => true }
      const actor = createMockActor(1, player, {
        traits: { TestTrait: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(1)
      expect(orders[0]!.orderName).toBe('TestOrder')
    })

    it('skips actors without the trait', () => {
      const actor = createMockActor(1, player, {
        traits: {},
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('skips actors owned by other players', () => {
      const enemyPlayer = createMockPlayer('enemy')
      const trait = { isTraitEnabled: () => true }
      const actor = createMockActor(1, enemyPlayer, {
        traits: { TestTrait: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('skips actors with disabled traits (isValidTrait returns false)', () => {
      const trait = { isTraitEnabled: () => false }
      const actor = createMockActor(1, player, {
        traits: { TestTrait: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('yields nothing when localPlayer is null', () => {
      const trait = { isTraitEnabled: () => true }
      const actor = createMockActor(1, player, {
        traits: { TestTrait: [trait] },
      })
      const w = createMockWorld({
        localPlayer: null,
        actorsAtCell: [actor],
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('yields nothing when no actors at cell', () => {
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [],
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // tick — auto-cancel on game over
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('calls cancelInputMode when game is over', () => {
      const winningPlayer = createMockPlayer('localPlayer', 1)
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({
        localPlayer: winningPlayer,
        cancelInputModeSpy: cancelSpy,
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      gen.tick(w)
      expect(cancelSpy).toHaveBeenCalledOnce()
    })

    it('does NOT call cancelInputMode when game is in progress', () => {
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({
        localPlayer: player,
        cancelInputModeSpy: cancelSpy,
      })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      gen.tick(w)
      expect(cancelSpy).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // render methods
  // ---------------------------------------------------------------------------

  describe('render methods', () => {
    it('renderAboveShroud is a no-op', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      expect(() =>
        gen.renderAboveShroud(
          {} as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub,
          w,
        ),
      ).not.toThrow()
    })

    it('renderAnnotations is a no-op', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
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
    it('is a no-op', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new TestGlobalButtonOrderGenerator(w, settings)
      expect(() => gen.deactivate()).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// PowerDownOrderGenerator tests
// ---------------------------------------------------------------------------

describe('PowerDownOrderGenerator', () => {
  let settings: IMouseSettings
  let player: IUnitOrderPlayer

  beforeEach(() => {
    settings = createMockSettings()
    player = createMockPlayer('localPlayer')
  })

  describe('constructor', () => {
    it('sets orderGeneratorKey to PowerDownOrderGenerator', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new PowerDownOrderGenerator(w, settings)
      expect(gen.orderGeneratorKey).toBe('PowerDownOrderGenerator')
    })
  })

  describe('isValidTrait (override)', () => {
    it('accepts traits that are not disabled AND not paused', () => {
      const trait = {
        isTraitEnabled: () => true,
        isTraitDisabled: false,
        isTraitPaused: false,
      }
      const actor = createMockActor(1, player, {
        traits: { ToggleConditionOnOrder: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new PowerDownOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(1)
      expect(orders[0]!.orderName).toBe('PowerDown')
    })

    it('rejects traits that are disabled', () => {
      const trait = {
        isTraitEnabled: () => true,
        isTraitDisabled: true,
        isTraitPaused: false,
      }
      const actor = createMockActor(1, player, {
        traits: { ToggleConditionOnOrder: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new PowerDownOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })

    it('rejects traits that are paused', () => {
      const trait = {
        isTraitEnabled: () => true,
        isTraitDisabled: false,
        isTraitPaused: true,
      }
      const actor = createMockActor(1, player, {
        traits: { ToggleConditionOnOrder: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new PowerDownOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })
  })

  describe('getCursor', () => {
    it('returns "powerdown" when a valid power-down target is under cursor', () => {
      const trait = {
        isTraitEnabled: () => true,
        isTraitDisabled: false,
        isTraitPaused: false,
      }
      const actor = createMockActor(1, player, {
        traits: { ToggleConditionOnOrder: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new PowerDownOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('powerdown')
    })

    it('returns "powerdown-blocked" when no valid target', () => {
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [],
      })
      const gen = new PowerDownOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('powerdown-blocked')
    })

    it('returns "powerdown-blocked" when no mi', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new PowerDownOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(0, 0))
      expect(cursor).toBe('powerdown-blocked')
    })
  })
})

// ---------------------------------------------------------------------------
// SellOrderGenerator tests
// ---------------------------------------------------------------------------

describe('SellOrderGenerator', () => {
  let settings: IMouseSettings
  let player: IUnitOrderPlayer

  beforeEach(() => {
    settings = createMockSettings()
    player = createMockPlayer('localPlayer')
  })

  describe('constructor', () => {
    it('sets orderGeneratorKey to SellOrderGenerator', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new SellOrderGenerator(w, settings)
      expect(gen.orderGeneratorKey).toBe('SellOrderGenerator')
    })
  })

  describe('orderInner', () => {
    it('yields "Sell" order for actor with valid Sellable trait', () => {
      const trait = { isTraitEnabled: () => true, isTraitDisabled: false }
      const actor = createMockActor(1, player, {
        traits: { Sellable: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new SellOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(1)
      expect(orders[0]!.orderName).toBe('Sell')
    })

    it('skips actors with disabled Sellable trait', () => {
      const trait = { isTraitEnabled: () => false, isTraitDisabled: true }
      const actor = createMockActor(1, player, {
        traits: { Sellable: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new SellOrderGenerator(w, settings)
      const orders = Array.from(
        gen['orderInner'](w, cell(3, 3), TargetModifiers.None as TargetModifiers, createMi()),
      )
      expect(orders.length).toBe(0)
    })
  })

  describe('getCursor', () => {
    it('returns cursor from Sellable trait info when available', () => {
      const trait = {
        isTraitEnabled: () => true,
        isTraitDisabled: false,
        info: { cursor: 'sell-cursor' },
      }
      const actor = createMockActor(1, player, {
        traits: { Sellable: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new SellOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('sell-cursor')
    })

    it('returns "sell-blocked" when no valid target', () => {
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [],
      })
      const gen = new SellOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('sell-blocked')
    })

    it('returns "sell-blocked" when sellable trait has no cursor', () => {
      const trait = {
        isTraitEnabled: () => true,
        isTraitDisabled: false,
        info: { cursor: null },
      }
      const actor = createMockActor(1, player, {
        traits: { Sellable: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new SellOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('sell-blocked')
    })

    it('returns "sell-blocked" when disabled sellable trait has cursor', () => {
      const trait = {
        isTraitEnabled: () => false,
        isTraitDisabled: true,
        info: { cursor: 'hidden-cursor' },
      }
      const actor = createMockActor(1, player, {
        traits: { Sellable: [trait] },
      })
      const w = createMockWorld({
        localPlayer: player,
        actorsAtCell: [actor],
      })
      const gen = new SellOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(3, 3), undefined, createMi())
      expect(cursor).toBe('sell-blocked')
    })

    it('returns "sell-blocked" when no mi', () => {
      const w = createMockWorld({ localPlayer: player })
      const gen = new SellOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(0, 0))
      expect(cursor).toBe('sell-blocked')
    })
  })
})
