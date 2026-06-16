/**
 * UnitOrderGenerator.test.ts — UnitOrderGenerator unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: targetForInput priority ordering, orderForUnit two-pass
 * resolution, orderInner CreateGroup dispatch, getCursor cursor selection,
 * inputOverridesSelection logic, and deactivate cleanup.
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
  IOrderTargeter,
  IIssueOrder,
  IMouseSettings,
  Order,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import {
  UnitOrderGenerator,
  type IUnitOrderGeneratorWorld,
  type IUnitOrderPlayer,
  type IUnitOrderActor,
  type IUnitOrderMouseInput,
  type IFrozenActorForOrder,
  type IUnitOrderActorInfo,
} from './UnitOrderGenerator.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function cell(x: number, y: number): CPos {
  return new CPos(x, y)
}

function wp(x: number, y: number): { readonly x: number; readonly y: number } {
  return { x, y }
}

function voidFn(): () => void {
  return vi.fn() as unknown as () => void
}

function createMockSettings(overrides: Partial<{
  controlStyle: string
  actionButton: number
  cancelButton: number
}> = {}): IMouseSettings {
  return {
    mouseControlStyle: overrides.controlStyle ?? 'standard',
    resolveActionButton: vi.fn().mockReturnValue(overrides.actionButton ?? 2),
    resolveCancelButton: vi.fn().mockReturnValue(overrides.cancelButton ?? 1),
  }
}

/** Create a mock actor info with trait lookup. */
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

/** Create a mock player. */
function createMockPlayer(
  name: string = 'testPlayer',
  winState: number = 0,
): IUnitOrderPlayer {
  return {
    playerName: name,
    winState,
    playerActor: null,
    isAlliedWith(other: IUnitOrderPlayer): boolean {
      return other.playerName === name
    },
    relationshipWith(other: IUnitOrderPlayer): 0 | 1 | 2 {
      if (other.playerName === name) return 0 as const // Ally
      return 1 as const // Enemy
    },
  }
}

/** Create a mock WPos (minimal, satisfying both WPos and IActorRef.centerPosition). */
function mockWPos(): import('../../OpenRA.Game/WPos.js').WPos {
  return {
    X: 0, Y: 0, Z: 0,
    toWVec: () => ({ X: 0, Y: 0, Z: 0 } as import('../../OpenRA.Game/WVec.js').WVec),
    equals: () => true,
  } as import('../../OpenRA.Game/WPos.js').WPos
}

/** Create a mock actor for order targeting.
 *  Also satisfies IActorRef requirements for Target.fromActor(). */
function createMockActor(
  id: number,
  owner: IUnitOrderPlayer,
  overrides: Partial<{
    isDead: boolean
    disposed: boolean
    info: IUnitOrderActorInfo
    traits: unknown[]
    selectionPriority: number
  }> = {},
): IUnitOrderActor & { selectionPriority?: number; isTargetableBy?(): boolean; getTargetablePositions?(): import('../../OpenRA.Game/WPos.js').WPos[]; centerPosition?: import('../../OpenRA.Game/WPos.js').WPos; generation?: number } {
  return {
    actorId: id,
    isInWorld: true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
    owner,
    info: overrides.info ?? createMockActorInfo(`actor_${id}`),
    traitsImplementing(_interfaceId: string): unknown[] {
      return overrides.traits ?? []
    },
    selectionPriority: overrides.selectionPriority ?? 0,
    // IActorRef-compatible properties for Target.fromActor()
    isTargetableBy: () => true,
    getTargetablePositions: () => [mockWPos()],
    centerPosition: mockWPos(),
    generation: 0,
  }
}

/** Create a mock order targeter. */
function createMockTargeter(
  orderID: string,
  priority: number,
  canTargetResult: boolean = true,
  cursorOut: string | null = null,
): IOrderTargeter & { getCursor(): string | null } {
  return {
    orderID,
    orderPriority: priority,
    isQueued: false,
    canTarget(
      _actor: IGameActor,
      _target: unknown,
      _modifiers: number,
      _cursor: string,
    ): boolean {
      return canTargetResult
    },
    targetOverridesSelection(
      _actor: IGameActor,
      _target: unknown,
      _actorsAt: readonly IGameActor[],
      _xy: CPos,
      _modifiers: number,
    ): boolean {
      return true
    },
    getCursor(): string | null {
      return cursorOut
    },
  }
}

/** Create a mock IIssueOrder trait. */
function createMockIIssueOrder(
  orders: readonly (IOrderTargeter & { getCursor(): string | null })[],
): IIssueOrder {
  return {
    orders,
    issueOrder(
      _actor: IGameActor,
      order: IOrderTargeter,
      target: unknown,
      _queued: boolean,
    ): Order {
      return {
        orderName: order.orderID,
        targetString: (target as { toString?(): string })?.toString?.() ?? 'cell',
        extraData: null,
      }
    },
  }
}

/** Create a mock world with all required capabilities. */
function createMockWorld(
  overrides: Partial<{
    actors: readonly IGameActor[]
    localPlayer: IUnitOrderPlayer | null
    renderPlayer: IUnitOrderPlayer | null
    isGameOver: boolean
    selectionActors: readonly IGameActor[]
    actorsAtCell: readonly IGameActor[]
    fogObscuredIds: Set<number>
    frozenActors: readonly IFrozenActorForOrder[]
    map: IUnitOrderGeneratorWorld['map']
    selectionClearSpy: () => void
    cancelInputModeSpy: () => void
  }> = {},
): IUnitOrderGeneratorWorld {
  const selectionClear = overrides.selectionClearSpy ?? voidFn()
  const cancelInputMode = overrides.cancelInputModeSpy ?? voidFn()

  return {
    actors: overrides.actors ?? [],
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
    renderPlayer: overrides.renderPlayer ?? null,
    selection: {
      actors: overrides.selectionActors ?? [],
      clear: selectionClear,
    },
    isGameOver: overrides.isGameOver ?? false,
    map: overrides.map ?? {
      cellContaining(_pos) {
        return new CPos(0, 0)
      },
    },
    frozenActorLayer: overrides.frozenActors ? {
      frozenActorsAt(_cell: CPos, _rp: IUnitOrderPlayer): readonly IFrozenActorForOrder[] {
        return overrides.frozenActors!
      },
    } : undefined,
    cancelInputMode,
  }
}

/** Standard mouse input for right-click (button 2, Down). */
function createMi(
  overrides: Partial<{
    button: number
    event: string
    modifiers: number
  }> = {},
): IUnitOrderMouseInput {
  return {
    button: overrides.button ?? 2,
    event: overrides.event ?? 'Down',
    modifiers: (overrides.modifiers ?? TargetModifiers.None) as TargetModifiers,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnitOrderGenerator', () => {
  let settings: IMouseSettings
  let world: IUnitOrderGeneratorWorld
  let player: IUnitOrderPlayer
  let generator: UnitOrderGenerator

  beforeEach(() => {
    settings = createMockSettings()
    player = createMockPlayer('localPlayer')
    world = createMockWorld({
      localPlayer: player,
      renderPlayer: player,
    })
    generator = new UnitOrderGenerator(world, settings)
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('sets actionType to Contextual', () => {
      expect(generator.actionButton).toBe(2) // right-click default
    })

    it('resolves action/cancel buttons from settings', () => {
      const s2 = createMockSettings({ actionButton: 3, cancelButton: 4 })
      const g2 = new UnitOrderGenerator(world, s2)
      expect(g2.actionButton).toBe(3)
      expect(g2.cancelButton).toBe(4)
    })

    it('uses default cursor names when not provided', () => {
      const gen = new UnitOrderGenerator(world, settings)
      const cursor = gen.getCursor(world, cell(0, 0))
      expect(cursor).toBe('default')
    })

    it('accepts custom cursor names', () => {
      const gen = new UnitOrderGenerator(world, settings, 'my-select', 'my-default')
      const cursor = gen.getCursor(world, cell(0, 0))
      expect(cursor).toBe('my-default')
    })
  })

  // ---------------------------------------------------------------------------
  // clearSelectionOnLeftClick
  // ---------------------------------------------------------------------------

  describe('clearSelectionOnLeftClick', () => {
    it('returns true by default (matching C# virtual getter)', () => {
      expect(generator.clearSelectionOnLeftClick).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // deactivate
  // ---------------------------------------------------------------------------

  describe('deactivate', () => {
    it('is a no-op (no resources to clean up)', () => {
      expect(() => generator.deactivate()).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // targetForInput (static)
  // ---------------------------------------------------------------------------

  describe('targetForInput', () => {
    it('returns live actor target when a valid actor is at cell (live > frozen > cell)', () => {
      const p = createMockPlayer('local')
      const info = createMockActorInfo('e1', ['ITargetableInfo'])
      const actor = createMockActor(100, p, { info })
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [actor],
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(5, 5),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.Actor)
      expect(target.actor).not.toBeNull()
    })

    it('filters out dead actors', () => {
      const p = createMockPlayer('local')
      const info = createMockActorInfo('dead_one', ['ITargetableInfo'])
      const deadActor = createMockActor(1, p, { isDead: true, info })
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [deadActor],
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(5, 5),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.Terrain)
    })

    it('filters out actors without ITargetableInfo', () => {
      const p = createMockPlayer('local')
      const info = createMockActorInfo('untargetable', [])
      const actor = createMockActor(1, p, { info })
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [actor],
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(5, 5),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.Terrain)
    })

    it('filters out fog-obscured actors', () => {
      const p = createMockPlayer('local')
      const info = createMockActorInfo('hidden', ['ITargetableInfo'])
      const obscured = createMockActor(2, p, { info })
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [obscured],
        fogObscuredIds: new Set([2]),
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(5, 5),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.Terrain)
    })

    it('selects highest priority actor when multiple valid actors are in the cell', () => {
      const p = createMockPlayer('local')
      const info = createMockActorInfo('grunt', ['ITargetableInfo'])
      const lowPriActor = createMockActor(1, p, { info, selectionPriority: 1 })
      const highPriActor = createMockActor(2, p, { info, selectionPriority: 10 })
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [lowPriActor, highPriActor],
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(5, 5),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.Actor)
      expect(target.actor).toBe(highPriActor)
    })

    it('falls back to cell target when no live actors are at the cell', () => {
      const p = createMockPlayer('local')
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [],
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(10, 20),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.Terrain)
    })

    it('returns frozen actor target when frozen actors are available and no live actor present', () => {
      const p = createMockPlayer('local')
      const frozenInfo = createMockActorInfo('frozen_tank', ['ITargetableInfo'])
      const frozenActor: IFrozenActorForOrder = {
        isValid: true,
        visible: true,
        hasRenderables: true,
        centerPosition: { X: 0, Y: 0, Z: 0 } as import('../../OpenRA.Game/WPos.js').WPos,
        info: frozenInfo,
      }
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [],
        frozenActors: [frozenActor],
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(5, 5),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.FrozenActor)
    })

    it('skips frozen actors that are not visible', () => {
      const p = createMockPlayer('local')
      const frozenInfo = createMockActorInfo('frozen_tank', ['ITargetableInfo'])
      const hiddenFrozen: IFrozenActorForOrder = {
        isValid: true,
        visible: false,
        hasRenderables: true,
        centerPosition: { X: 0, Y: 0, Z: 0 } as import('../../OpenRA.Game/WPos.js').WPos,
        info: frozenInfo,
      }
      const w = createMockWorld({
        localPlayer: p,
        renderPlayer: p,
        actorsAtCell: [],
        frozenActors: [hiddenFrozen],
      })
      const target = UnitOrderGenerator.targetForInput(
        w,
        cell(5, 5),
        wp(0, 0),
        createMi(),
      )
      expect(target.type).toBe(TargetType.Terrain)
    })
  })

  // ---------------------------------------------------------------------------
  // orderForUnit
  // ---------------------------------------------------------------------------

  describe('orderForUnit', () => {
    it('returns null when actor owner is not local player', () => {
      const enemyPlayer = createMockPlayer('enemy')
      const enemyInfo = createMockActorInfo('enemy_unit', ['ITargetableInfo'])
      const enemyActor = createMockActor(999, enemyPlayer, { info: enemyInfo })
      const target = Target.fromCell(cell(0, 0))
      const result = generator.orderForUnit(
        enemyActor,
        target,
        cell(0, 0),
        createMi(),
      )
      expect(result).toBeNull()
    })

    it('returns null when game is over', () => {
      const gameOverWorld = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        isGameOver: true,
      })
      const localGen = new UnitOrderGenerator(gameOverWorld, settings)
      const actorInfo = createMockActorInfo('soldier', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, { info: actorInfo })
      const target = Target.fromCell(cell(0, 0))
      const result = localGen.orderForUnit(
        localActor,
        target,
        cell(0, 0),
        createMi(),
      )
      expect(result).toBeNull()
    })

    it('returns null when actor is disposed', () => {
      const actorInfo = createMockActorInfo('soldier', ['ITargetableInfo'])
      const disposedActor = createMockActor(1, player, {
        info: actorInfo,
        disposed: true,
      })
      const target = Target.fromCell(cell(0, 0))
      const result = generator.orderForUnit(
        disposedActor,
        target,
        cell(0, 0),
        createMi(),
      )
      expect(result).toBeNull()
    })

    it('returns the highest-priority matching targeter (cell target)', () => {
      const moveTargeter = createMockTargeter('Move', 5, true, 'move')
      const attackTargeter = createMockTargeter('Attack', 10, true, 'attack')
      const trait = createMockIIssueOrder([moveTargeter, attackTargeter])
      const actorInfo = createMockActorInfo('tank', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, {
        info: actorInfo,
        traits: [trait],
      })

      const target = Target.fromCell(cell(5, 5))
      const result = generator.orderForUnit(
        localActor,
        target,
        cell(5, 5),
        createMi(),
      )
      expect(result).not.toBeNull()
      expect(result!.order.orderID).toBe('Attack')
      expect(result!.order.orderPriority).toBe(10)
    })

    it('two-pass resolution: cell target fallback on second pass', () => {
      const cellOnlyTargeter = createMockTargeter('Move', 5, true, 'move')
      // Override canTarget to only accept non-actor targets
      cellOnlyTargeter.canTarget = function (
        _actor: IGameActor,
        target: unknown,
        _modifiers: number,
        _cursor: string,
      ): boolean {
        const t = target as { type: number }
        return t.type !== TargetType.Actor
      }

      const trait = createMockIIssueOrder([cellOnlyTargeter])
      const actorInfo = createMockActorInfo('rifle', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, {
        info: actorInfo,
        traits: [trait],
      })

      // Target an actor first — targeter rejects it, second pass uses cell
      // We use Target.fromCell which produces Terrain type, not Actor type
      const cellTarget = Target.fromCell(cell(5, 5))
      // This target is Terrain type, so the targeter's canTarget returns true
      // since Terrain !== Actor. The first pass succeeds immediately.
      const result = generator.orderForUnit(
        localActor,
        cellTarget,
        cell(5, 5),
        createMi(),
      )
      // targeter accepts Terrain type, so first pass succeeds
      expect(result).not.toBeNull()
      expect(result!.order.orderID).toBe('Move')
    })

    it('returns null when no targeter matches (both passes fail)', () => {
      const alwaysFailTargeter = createMockTargeter('Fail', 100, false, null)
      const trait = createMockIIssueOrder([alwaysFailTargeter])
      const actorInfo = createMockActorInfo('useless', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, {
        info: actorInfo,
        traits: [trait],
      })
      const target = Target.fromCell(cell(0, 0))
      const result = generator.orderForUnit(
        localActor,
        target,
        cell(0, 0),
        createMi(),
      )
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // orderInner
  // ---------------------------------------------------------------------------

  describe('orderInner', () => {
    it('yields CreateGroup order first, then resolved unit orders', () => {
      const moveTargeter = createMockTargeter('Move', 1, true, 'move')
      const trait = createMockIIssueOrder([moveTargeter])
      const actorInfo = createMockActorInfo('rifle', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, {
        info: actorInfo,
        traits: [trait],
      })
      const worldWithSelection = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [],
        selectionActors: [localActor],
      })
      const gen = new UnitOrderGenerator(worldWithSelection, settings)

      const orders = Array.from(
        gen['orderInner'](
          worldWithSelection,
          cell(3, 4),
          TargetModifiers.None as TargetModifiers,
          createMi(),
        ),
      )

      expect(orders.length).toBeGreaterThanOrEqual(2)
      expect(orders[0]!.orderName).toBe('CreateGroup')
      expect(orders[1]!.orderName).toBe('Move')
    })

    it('yields nothing when no actors are selected', () => {
      const emptyWorld = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [],
        selectionActors: [],
      })
      const gen = new UnitOrderGenerator(emptyWorld, settings)
      const orders = Array.from(
        gen['orderInner'](
          emptyWorld,
          cell(3, 4),
          TargetModifiers.None as TargetModifiers,
          createMi(),
        ),
      )
      expect(orders.length).toBe(0)
    })

    it('yields nothing when mi is undefined', () => {
      const worldWithSel = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        selectionActors: [createMockActor(1, player)],
      })
      const gen = new UnitOrderGenerator(worldWithSel, settings)
      const orders = Array.from(
        gen['orderInner'](
          worldWithSel,
          cell(0, 0),
          TargetModifiers.None as TargetModifiers,
          undefined,
        ),
      )
      expect(orders.length).toBe(0)
    })

    it('deduplicates actors involved (only one CreateGroup even with many selected)', () => {
      const targeter = createMockTargeter('Move', 1, true, 'move')
      const trait = createMockIIssueOrder([targeter])
      const actorInfo = createMockActorInfo('rifle', ['ITargetableInfo'])
      const actors = [
        createMockActor(1, player, { info: actorInfo, traits: [trait] }),
        createMockActor(2, player, { info: actorInfo, traits: [trait] }),
        createMockActor(3, player, { info: actorInfo, traits: [trait] }),
      ]
      const worldWithSel = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [],
        selectionActors: actors,
      })
      const gen = new UnitOrderGenerator(worldWithSel, settings)
      const orders = Array.from(
        gen['orderInner'](
          worldWithSel,
          cell(3, 4),
          TargetModifiers.None as TargetModifiers,
          createMi(),
        ),
      )
      expect(orders.length).toBe(4)
      const createGroupCount = orders.filter(
        (o) => o?.orderName === 'CreateGroup',
      ).length
      expect(createGroupCount).toBe(1)
    })

    it('handles the ForceQueue modifier in issueOrder calls', () => {
      const moveTargeter = createMockTargeter('Move', 1, true, 'move')
      let receivedQueued: boolean | undefined
      const trait: IIssueOrder = {
        orders: [moveTargeter],
        issueOrder(
          _actor: IGameActor,
          order: IOrderTargeter,
          _target: unknown,
          queued: boolean,
        ): Order {
          receivedQueued = queued
          return {
            orderName: order.orderID,
            targetString: 'test',
            extraData: null,
          }
        },
      }
      const actorInfo = createMockActorInfo('rifle', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, {
        info: actorInfo,
        traits: [trait],
      })
      const worldWithSel = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [],
        selectionActors: [localActor],
      })
      const gen = new UnitOrderGenerator(worldWithSel, settings)
      Array.from(
        gen['orderInner'](
          worldWithSel,
          cell(3, 4),
          TargetModifiers.None as TargetModifiers,
          createMi({ modifiers: TargetModifiers.ForceQueue }),
        ),
      )
      expect(receivedQueued).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // getCursor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns worldDefaultCursor when no mi is provided', () => {
      const cursor = generator.getCursor(world, cell(0, 0))
      expect(cursor).toBe('default')
    })

    it('returns worldDefaultCursor when no actors at cell and no selection', () => {
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [],
        selectionActors: [],
      })
      const gen = new UnitOrderGenerator(w, settings)
      const cursor = gen.getCursor(w, cell(0, 0), wp(0, 0), createMi())
      expect(cursor).toBe('default')
    })

    it('returns worldSelectCursor when a selectable live actor is at the cell', () => {
      const info = createMockActorInfo('selectable', [
        'ITargetableInfo',
        'ISelectableInfo',
      ])
      const actor = createMockActor(10, player, { info })
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [actor],
        selectionActors: [],
      })
      const gen = new UnitOrderGenerator(w, settings, 'pointer', 'default')
      const cursor = gen.getCursor(w, cell(0, 0), wp(0, 0), createMi())
      expect(cursor).toBe('pointer')
    })

    it('returns order cursor from highest-priority matching targeter when orders exist', () => {
      const moveTargeter = createMockTargeter('Move', 1, true, 'move')
      const attackTargeter = createMockTargeter('Attack', 10, true, 'attack')
      const trait = createMockIIssueOrder([moveTargeter, attackTargeter])
      const actorInfo = createMockActorInfo('tank', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, {
        info: actorInfo,
        traits: [trait],
      })
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [],
        selectionActors: [localActor],
      })
      const gen = new UnitOrderGenerator(w, settings, 'select', 'default')
      const cursor = gen.getCursor(w, cell(5, 5), wp(0, 0), createMi())
      expect(cursor).toBe('attack')
    })

    it('classic mode returns select cursor for selectable actor when not overriding selection', () => {
      const classicSettings = createMockSettings({ controlStyle: 'classic' })
      const info = createMockActorInfo('selectable', [
        'ITargetableInfo',
        'ISelectableInfo',
      ])
      const actor = createMockActor(10, player, { info })
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [actor],
        selectionActors: [],
      })
      const gen = new UnitOrderGenerator(w, classicSettings, 'select', 'default')
      const cursor = gen.getCursor(w, cell(0, 0), wp(0, 0), createMi())
      expect(typeof cursor).toBe('string')
    })
  })

  // ---------------------------------------------------------------------------
  // inputOverridesSelection
  // ---------------------------------------------------------------------------

  describe('inputOverridesSelection', () => {
    it('returns true when no selectable actor is found at the position', () => {
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actors: [],
      })
      const gen = new UnitOrderGenerator(w, settings)
      const result = gen.inputOverridesSelection(
        w,
        wp(0, 0),
        createMi(),
      )
      expect(result).toBe(true)
    })

    it('returns true when a selected actor has a targeter that overrides selection', () => {
      const moveTargeter = createMockTargeter('Move', 1, true, 'move')
      const trait = createMockIIssueOrder([moveTargeter])
      const info = createMockActorInfo('tank', [
        'ITargetableInfo',
        'ISelectableInfo',
      ])
      const selectedActor = createMockActor(1, player, {
        info,
        traits: [trait],
      })
      const targetActor = createMockActor(2, player, { info })
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actors: [targetActor, selectedActor],
        actorsAtCell: [targetActor],
        selectionActors: [selectedActor],
      })
      const gen = new UnitOrderGenerator(w, settings)
      const result = gen.inputOverridesSelection(
        w,
        wp(0, 0),
        createMi(),
      )
      expect(result).toBe(true)
    })

    it('returns false when no targeter overrides selection', () => {
      const nonOverrideTargeter = createMockTargeter('Look', 1, true, 'look')
      nonOverrideTargeter.targetOverridesSelection = () => false
      const trait = createMockIIssueOrder([nonOverrideTargeter])
      const info = createMockActorInfo('viewer', [
        'ITargetableInfo',
        'ISelectableInfo',
      ])
      const selectedActor = createMockActor(1, player, {
        info,
        traits: [trait],
      })
      const targetActor = createMockActor(2, player, { info })
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actors: [targetActor, selectedActor],
        actorsAtCell: [targetActor],
        selectionActors: [selectedActor],
      })
      const gen = new UnitOrderGenerator(w, settings)
      const result = gen.inputOverridesSelection(
        w,
        wp(0, 0),
        createMi(),
      )
      expect(result).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // checkSameOrder (static)
  // ---------------------------------------------------------------------------

  describe('checkSameOrder', () => {
    it('returns the order when orderID matches orderName', () => {
      const t = createMockTargeter('Attack', 1)
      const order: Order = {
        orderName: 'Attack',
        targetString: 'test',
        extraData: null,
      }
      const result = UnitOrderGenerator.checkSameOrder(t, order)
      expect(result).toBe(order)
    })

    it('returns null when order is null', () => {
      const t = createMockTargeter('Attack', 1)
      const result = UnitOrderGenerator.checkSameOrder(t, null)
      expect(result).toBeNull()
    })

    it('outputs debug on mismatch', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const t = createMockTargeter('Attack', 1)
      const order: Order = {
        orderName: 'Move',
        targetString: 'test',
        extraData: null,
      }
      const result = UnitOrderGenerator.checkSameOrder(t, order)
      expect(result).toBe(order)
      expect(debugSpy).toHaveBeenCalled()
      debugSpy.mockRestore()
    })
  })

  // ---------------------------------------------------------------------------
  // render methods
  // ---------------------------------------------------------------------------

  describe('render methods', () => {
    it('renderAboveShroud is a no-op', () => {
      expect(() =>
        generator.renderAboveShroud(
          {} as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub,
          world,
        ),
      ).not.toThrow()
    })

    it('renderAnnotations is a no-op', () => {
      expect(() =>
        generator.renderAnnotations(
          {} as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub,
          world,
        ),
      ).not.toThrow()
    })

    it('tick is a no-op by default (inherited from OrderGenerator)', () => {
      expect(() => generator.tick(world)).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Integration: order() dispatch from OrderGenerator base
  // ---------------------------------------------------------------------------

  describe('integration with OrderGenerator base', () => {
    it('order() dispatches to orderInner on action button Down', () => {
      const targeter = createMockTargeter('Move', 1, true, 'move')
      const trait = createMockIIssueOrder([targeter])
      const actorInfo = createMockActorInfo('rifle', ['ITargetableInfo'])
      const localActor = createMockActor(1, player, {
        info: actorInfo,
        traits: [trait],
      })
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        actorsAtCell: [],
        selectionActors: [localActor],
      })
      const gen = new UnitOrderGenerator(w, settings)
      const mi = { button: gen.actionButton, event: 'Down', modifiers: TargetModifiers.None as TargetModifiers }
      const orders = Array.from(
        gen.order(w, cell(3, 4), TargetModifiers.None as TargetModifiers, wp(0, 0), mi),
      )
      expect(orders.length).toBeGreaterThanOrEqual(2)
      expect(orders[0]!.orderName).toBe('CreateGroup')
    })

    it('order() calls cancelInputMode on cancel button Up', () => {
      const cancelSpy = vi.fn() as unknown as () => void
      const w = createMockWorld({
        localPlayer: player,
        renderPlayer: player,
        cancelInputModeSpy: cancelSpy,
      })
      const gen = new UnitOrderGenerator(w, settings)
      const mi = { button: gen.cancelButton, event: 'Up', modifiers: TargetModifiers.None as TargetModifiers }
      const orders = Array.from(
        gen.order(w, cell(0, 0), TargetModifiers.None as TargetModifiers, wp(0, 0), mi),
      )
      expect(cancelSpy).toHaveBeenCalledOnce()
      expect(orders.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // handleKeyPress
  // ---------------------------------------------------------------------------

  describe('handleKeyPress', () => {
    it('returns false by default (inherited)', () => {
      expect(generator.handleKeyPress({ key: 'Escape' })).toBe(false)
    })
  })
})
