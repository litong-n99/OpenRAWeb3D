/**
 * PlaceBuilding.test.ts — PlaceBuilding migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, order resolution, notification timing,
 * buildable counting, and replacement logic.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  PlaceBuilding,
  PlaceBuildingInfo,
  PlaceBuildingInit,
  type IPlaceBuildingWorld,
  type IPlaceBuildingActorInfo,
  type IPlaceBuildingTraitInfo,
  type IPlaceBuildingBuildingInfo,
  type IPlaceBuildingProductionQueue,
  type IPlaceBuildingProductionItem,
  type IPlaceBuildingProducer,
  type IPlaceBuildingSound,
  type IPlaceBuildingMap,
  type IPlaceBuildingRules,
  type IPlaceBuildingActorMap,
  type IPlaceBuildingUtils,
  type IPlaceBuildingBaseProvider,
  type ILineBuildCellResult,
} from './PlaceBuilding.js'

import type {
  IGameActor,
  PlayerStub,
  Order,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ActorInit } from '../../../OpenRA.Game/ActorInitializer.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Internal test types — mutable versions for flexible setup
// ---------------------------------------------------------------------------

interface WorldInternals {
  _actorsById: Map<number, IGameActor>
  _actorsByTrait: Map<string, Array<{ actor: IGameActor; trait: unknown }>>
  _createdActors: IGameActor[]
  _removedActors: IGameActor[]
}

type TestWorld = IPlaceBuildingWorld & WorldInternals

interface ActorInfoEx extends IPlaceBuildingActorInfo {
  _addTraitInfo(traitName: string, info: IPlaceBuildingTraitInfo): void
}

interface BuildingInfoEx extends IPlaceBuildingBuildingInfo {
  _setRequiresBaseProvider(v: boolean): void
  _setFindBaseProvider(fn: (world: IPlaceBuildingWorld, owner: PlayerStub, topLeft: CPos) => IPlaceBuildingBaseProvider | null): void
}

interface QueueEx extends IPlaceBuildingProductionQueue {
  _items: IPlaceBuildingProductionItem[]
  _endedItems: IPlaceBuildingProductionItem[]
  addItem(item: IPlaceBuildingProductionItem): void
  clearItems(): void
}

interface SoundEx extends IPlaceBuildingSound {
  _playedToPlayer: Array<{ type: string; player: PlayerStub; sound: string }>
  _playedNotification: Array<{ channel: string; notification: string; faction: string }>
  _transientLines: Array<{ player: PlayerStub; text: string | null }>
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePlayer(id: number, faction?: string): PlayerStub {
  return {
    playerIndex: id,
    playerReferenceId: id,
    internalName: `player${id}`,
    faction: faction ?? 'random',
    spawn: 0,
    nonCombatant: false,
    playable: true,
  } as unknown as PlayerStub
}

function makeActor(
  id: number,
  owner: PlayerStub,
  overrides?: Partial<IGameActor>,
): IGameActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner,
    traitsImplementing: undefined,
    ...overrides,
  } as unknown as IGameActor
}

function makeOrder(overrides?: Partial<Order>): Order {
  return {
    orderName: '',
    orderString: '',
    targetString: null,
    extraData: 0,
    ...overrides,
  } as unknown as Order
}

function makeActorInfo(name: string): ActorInfoEx {
  const traitInfos = new Map<string, IPlaceBuildingTraitInfo[]>()
  return {
    name,
    hasTraitInfo(traitName: string): boolean {
      return traitInfos.has(traitName)
    },
    getTraitInfos(traitName: string): readonly IPlaceBuildingTraitInfo[] {
      return traitInfos.get(traitName) ?? []
    },
    getTraitInfo(traitName: string): IPlaceBuildingTraitInfo | null {
      const infos = traitInfos.get(traitName)
      return infos && infos.length > 0 ? infos[0] : null
    },
    _addTraitInfo(traitName: string, info: IPlaceBuildingTraitInfo): void {
      const existing = traitInfos.get(traitName) ?? []
      existing.push(info)
      traitInfos.set(traitName, existing)
    },
  }
}

function makeBuildingInfo(overrides?: {
  requiresBaseProvider?: boolean
  buildSounds?: string[]
  findBaseProvider?: (world: IPlaceBuildingWorld, owner: PlayerStub, topLeft: CPos) => IPlaceBuildingBaseProvider | null
}): BuildingInfoEx {
  let _requiresBaseProvider = overrides?.requiresBaseProvider ?? false
  let _findBaseProvider = overrides?.findBaseProvider ?? null
  const _buildSounds = overrides?.buildSounds ?? []

  return {
    type: 'BuildingInfo',
    get requiresBaseProvider(): boolean { return _requiresBaseProvider },
    get buildSounds(): readonly string[] { return _buildSounds },
    tiles(topLeft: CPos): CPos[] { return [topLeft] },
    isCloseEnoughToBase(): boolean { return true },
    findBaseProvider(
      world: IPlaceBuildingWorld,
      owner: PlayerStub,
      topLeft: CPos,
    ): IPlaceBuildingBaseProvider | null {
      if (_findBaseProvider) return _findBaseProvider(world, owner, topLeft)
      return null
    },
    _setRequiresBaseProvider(v: boolean): void { _requiresBaseProvider = v },
    _setFindBaseProvider(fn: (w: IPlaceBuildingWorld, o: PlayerStub, t: CPos) => IPlaceBuildingBaseProvider | null): void { _findBaseProvider = fn },
  }
}

function makeWorld(overrides?: Partial<IPlaceBuildingWorld>): TestWorld {
  const actorsById = new Map<number, IGameActor>()
  const actorsByTrait = new Map<string, Array<{ actor: IGameActor; trait: unknown }>>()
  const createdActors: IGameActor[] = []
  const removedActors: IGameActor[] = []

  const base: IPlaceBuildingWorld = {
    map: {
      cellContaining(_pos: unknown): CPos { return { X: 5, Y: 5, Layer: 0 } as CPos },
      contains(_cell: CPos): boolean { return true },
      rules: {
        getActorInfo(_name: string): IPlaceBuildingActorInfo | undefined { return undefined },
      },
    } as IPlaceBuildingMap,
    actorMap: {
      getActorsAt(_cell: CPos): IGameActor[] { return [] },
    } as IPlaceBuildingActorMap,
    buildingInfluence: { anyBuildingAt: () => false },
    buildingUtils: {
      canPlaceBuilding: (): boolean => true,
      getLineBuildCells: (): readonly ILineBuildCellResult[] => [],
    } as unknown as IPlaceBuildingUtils,
    getActorById(id: number): IGameActor | null {
      return actorsById.get(id) ?? null
    },
    createActor(name: string, inits: ActorInit<unknown>[]): IGameActor {
      const actor = makeActor(createdActors.length + 100, makePlayer(0))
      ;(actor as unknown as Record<string, unknown>).createdName = name
      ;(actor as unknown as Record<string, unknown>).createdInits = inits
      createdActors.push(actor)
      return actor
    },
    remove(actor: IGameActor): void {
      removedActors.push(actor)
    },
    actorsWithTrait(traitName: string): Iterable<{ actor: IGameActor; trait: unknown }> {
      const entries = actorsByTrait.get(traitName) ?? []
      return entries[Symbol.iterator]()
    },
    localPlayer: makePlayer(0),
  }

  return {
    ...base,
    ...overrides,
    _actorsById: actorsById,
    _actorsByTrait: actorsByTrait,
    _createdActors: createdActors,
    _removedActors: removedActors,
  } as unknown as TestWorld
}

function makeQueue(
  buildableChecker?: (info: IPlaceBuildingActorInfo) => boolean,
): QueueEx {
  const items: IPlaceBuildingProductionItem[] = []
  const endedItems: IPlaceBuildingProductionItem[] = []
  return {
    _items: items,
    _endedItems: endedItems,
    canBuild(actorInfo: IPlaceBuildingActorInfo): boolean {
      return buildableChecker ? buildableChecker(actorInfo) : true
    },
    allQueued(): readonly IPlaceBuildingProductionItem[] { return items },
    endProduction(item: IPlaceBuildingProductionItem): void { endedItems.push(item) },
    mostLikelyProducer(): IPlaceBuildingProducer | null {
      return { actor: null, trait: { faction: 'test' } }
    },
    buildableItems(): readonly IPlaceBuildingActorInfo[] {
      return [{ name: 'barracks', hasTraitInfo: () => true, getTraitInfos: () => [], getTraitInfo: () => null }]
    },
    addItem(item: IPlaceBuildingProductionItem): void { items.push(item) },
    clearItems(): void { items.length = 0 },
  }
}

function makeSound(): SoundEx {
  const playedToPlayer: Array<{ type: string; player: PlayerStub; sound: string }> = []
  const playedNotification: Array<{ channel: string; notification: string; faction: string }> = []
  const transientLines: Array<{ player: PlayerStub; text: string | null }> = []
  return {
    _playedToPlayer: playedToPlayer,
    _playedNotification: playedNotification,
    _transientLines: transientLines,
    playToPlayer(type: string, player: PlayerStub, sound: string): void {
      playedToPlayer.push({ type, player, sound })
    },
    playNotification(
      _rules: unknown, _player: PlayerStub,
      channel: string, notification: string | null, faction: string,
    ): void {
      if (notification) playedNotification.push({ channel, notification, faction })
    },
    addTransientLine(player: PlayerStub, text: string | null): void {
      transientLines.push({ player, text })
    },
  }
}

/** Helper to set the world on an actor. */
function setWorldOn(actor: IGameActor, world: IPlaceBuildingWorld): void {
  ;(actor as unknown as Record<string, unknown>).world = world
}

/** Helper to get created name from a test actor. */
function createdNameOf(actor: IGameActor): string | undefined {
  return (actor as unknown as Record<string, unknown>).createdName as string | undefined
}

/** Helper to get created inits from a test actor. */
function createdInitsOf(actor: IGameActor): ActorInit<unknown>[] {
  return (actor as unknown as Record<string, unknown>).createdInits as ActorInit<unknown>[] ?? []
}

// ---------------------------------------------------------------------------
// PlaceBuildingInit tests
// ---------------------------------------------------------------------------

describe('PlaceBuildingInit', () => {
  it('is an ActorInit with key "placeBuilding"', () => {
    const init = new PlaceBuildingInit()
    expect(init.key).toBe('placeBuilding')
  })

  it('has void value', () => {
    const init = new PlaceBuildingInit()
    expect(init.value).toBeUndefined()
  })

  it('extends ActorInit<void>', () => {
    const init = new PlaceBuildingInit()
    expect(init).toBeInstanceOf(ActorInit)
  })
})

// ---------------------------------------------------------------------------
// PlaceBuildingInfo tests
// ---------------------------------------------------------------------------

describe('PlaceBuildingInfo', () => {
  it('creates with default values', () => {
    const info = new PlaceBuildingInfo()
    expect(info.newOptionsNotificationDelay).toBe(10)
    expect(info.newOptionsNotification).toBeNull()
    expect(info.newOptionsTextNotification).toBeNull()
    expect(info.cannotPlaceNotification).toBeNull()
    expect(info.cannotPlaceTextNotification).toBeNull()
    expect(info.toggleVariantKey).toBeDefined()
  })

  it('creates with custom values', () => {
    const info = new PlaceBuildingInfo({
      newOptionsNotificationDelay: 20,
      newOptionsNotification: 'NewOptions',
      cannotPlaceNotification: 'CannotPlace',
    })
    expect(info.newOptionsNotificationDelay).toBe(20)
    expect(info.newOptionsNotification).toBe('NewOptions')
    expect(info.cannotPlaceNotification).toBe('CannotPlace')
  })

  it('supports nulling out optional notifications', () => {
    const info = new PlaceBuildingInfo({ newOptionsNotification: null, cannotPlaceNotification: null })
    expect(info.newOptionsNotification).toBeNull()
    expect(info.cannotPlaceNotification).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — construction
// ---------------------------------------------------------------------------

describe('PlaceBuilding', () => {
  it('stores info on construction', () => {
    const info = new PlaceBuildingInfo()
    const pb = new PlaceBuilding(info)
    expect(pb.info).toBe(info)
  })

  it('implements IResolveOrder and ITick', () => {
    const pb = new PlaceBuilding(new PlaceBuildingInfo())
    expect(typeof pb.resolveOrder).toBe('function')
    expect(typeof pb.tick).toBe('function')
  })

  it('setSoundContext stores sound reference', () => {
    const pb = new PlaceBuilding(new PlaceBuildingInfo())
    pb.setSoundContext(makeSound())
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — getNumBuildables
// ---------------------------------------------------------------------------

describe('PlaceBuilding.getNumBuildables', () => {
  it('returns 0 for non-local player', () => {
    const world = makeWorld()
    expect(PlaceBuilding.getNumBuildables(makePlayer(1), world)).toBe(0)
  })

  it('returns 0 for local player with no queues', () => {
    const world = makeWorld()
    expect(PlaceBuilding.getNumBuildables(world.localPlayer!, world)).toBe(0)
  })

  it('counts distinct buildable items for local player', () => {
    const world = makeWorld()
    const player = world.localPlayer!
    world._actorsByTrait.set('ProductionQueue', [
      { actor: makeActor(1, player), trait: makeQueue() },
    ])
    expect(PlaceBuilding.getNumBuildables(player, world)).toBe(1)
  })

  it('skips queues owned by other players', () => {
    const world = makeWorld()
    const localPlayer = world.localPlayer!
    world._actorsByTrait.set('ProductionQueue', [
      { actor: makeActor(1, makePlayer(1)), trait: makeQueue() },
    ])
    expect(PlaceBuilding.getNumBuildables(localPlayer, world)).toBe(0)
  })

  it('deduplicates buildable items across queues', () => {
    const world = makeWorld()
    const player = world.localPlayer!
    world._actorsByTrait.set('ProductionQueue', [
      { actor: makeActor(1, player), trait: makeQueue() },
      { actor: makeActor(2, player), trait: makeQueue() },
    ])
    expect(PlaceBuilding.getNumBuildables(player, world)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — resolveOrder (PlaceBuilding)
// ---------------------------------------------------------------------------

describe('PlaceBuilding.resolveOrder — PlaceBuilding', () => {
  let pb: PlaceBuilding
  let world: TestWorld
  let sound: SoundEx
  let player: PlayerStub
  let self: IGameActor
  let targetActor: IGameActor
  let actorInfo: ActorInfoEx
  let buildingInfo: BuildingInfoEx
  let queue: QueueEx

  beforeEach(() => {
    pb = new PlaceBuilding(new PlaceBuildingInfo({ newOptionsNotificationDelay: 10 }))
    sound = makeSound()
    pb.setSoundContext(sound)

    world = makeWorld()
    player = world.localPlayer!
    self = makeActor(1, player)
    setWorldOn(self, world)

    targetActor = makeActor(2, player)
    world._actorsById.set(2, targetActor)

    actorInfo = makeActorInfo('powerplant')
    buildingInfo = makeBuildingInfo({ buildSounds: ['build1.wav', 'build2.wav'] })
    actorInfo._addTraitInfo('BuildingInfo', buildingInfo)

    // Set up rules
    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo(name: string) {
          if (name === 'powerplant') return actorInfo
          return undefined
        },
      } as IPlaceBuildingRules,
    })

    // Set up building utils
    Object.assign(world as unknown as Record<string, unknown>, {
      buildingUtils: {
        canPlaceBuilding: () => true,
        getLineBuildCells: () => [],
      } as unknown as IPlaceBuildingUtils,
    })

    queue = makeQueue()
    queue.addItem({ done: true, item: 'powerplant' })

    // Create target actor with queue
    Object.assign(targetActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'ProductionQueue') return [queue]
        if (name === 'INotifyBuildingPlaced') return []
        return undefined
      },
    })
  })

  it('ignores unknown order strings', () => {
    pb.resolveOrder(self, makeOrder({ orderString: 'Attack' } as Partial<Order>))
    expect(world._createdActors.length).toBe(0)
  })

  it('creates actor for PlaceBuilding order', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding',
      targetString: 'powerplant',
      extraData: 2,
    } as Partial<Order>))

    expect(world._createdActors.length).toBe(1)
    expect(createdNameOf(world._createdActors[0])).toBe('powerplant')
    const hasPlaceBuildingInit = createdInitsOf(world._createdActors[0]).some(
      (i) => i instanceof PlaceBuildingInit,
    )
    expect(hasPlaceBuildingInit).toBe(true)
  })

  it('plays build sounds when creating actor', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))

    expect(sound._playedToPlayer.length).toBe(2)
    expect(sound._playedToPlayer[0].sound).toBe('build1.wav')
  })

  it('ends production after placement', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))

    expect(queue._endedItems.length).toBe(1)
    expect(queue._endedItems[0].item).toBe('powerplant')
  })

  it('returns early if target actor is null', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 999,
    } as Partial<Order>))
    expect(world._createdActors.length).toBe(0)
  })

  it('returns early if target actor is dead', () => {
    const deadActor = makeActor(3, player, { isDead: true })
    world._actorsById.set(3, deadActor)
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 3,
    } as Partial<Order>))
    expect(world._createdActors.length).toBe(0)
  })

  it('returns early if no matching queue', () => {
    queue.clearItems()
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))
    expect(world._createdActors.length).toBe(0)
  })

  it('returns early if actor info not found in rules', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'unknown_actor', extraData: 2,
    } as Partial<Order>))
    expect(world._createdActors.length).toBe(0)
  })

  it('returns early if world is not set on self', () => {
    const noWorld = makeActor(99, player)
    pb.resolveOrder(noWorld, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))
    expect(world._createdActors.length).toBe(0)
  })

  it('validates placement and returns early if invalid', () => {
    Object.assign(world as unknown as Record<string, unknown>, {
      buildingUtils: {
        canPlaceBuilding: () => false,
        getLineBuildCells: () => [],
      } as unknown as IPlaceBuildingUtils,
    })
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))
    expect(world._createdActors.length).toBe(0)
  })

  it('notifies INotifyBuildingPlaced on self after placement', () => {
    const notifiedBuildings: IGameActor[] = []
    const notifSelf = makeActor(1, player)
    setWorldOn(notifSelf, world)
    Object.assign(notifSelf as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'INotifyBuildingPlaced') {
          return [{ buildingPlaced(_notifier: unknown, building: unknown) { notifiedBuildings.push(building as IGameActor) } }]
        }
        return undefined
      },
    })

    pb.resolveOrder(notifSelf, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))

    expect(notifiedBuildings.length).toBe(1)
  })

  it('triggers base provider cooldown when required', () => {
    let cooldownTriggered = false
    buildingInfo._setRequiresBaseProvider(true)
    buildingInfo._setFindBaseProvider(() => ({
      beginCooldown: () => { cooldownTriggered = true },
    }))
    actorInfo._addTraitInfo('BuildingInfo', buildingInfo)

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))

    expect(cooldownTriggered).toBe(true)
  })

  it('handles variant override from ExtraLocation', () => {
    const variantActorInfo = makeActorInfo('powerplant_variant')
    variantActorInfo._addTraitInfo('BuildingInfo', makeBuildingInfo())

    actorInfo._addTraitInfo('PlaceBuildingVariantsInfo', {
      type: 'PlaceBuildingVariantsInfo',
      actors: ['powerplant_variant'],
    })

    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo(name: string) {
          if (name === 'powerplant') return actorInfo
          if (name === 'powerplant_variant') return variantActorInfo
          return undefined
        },
      } as IPlaceBuildingRules,
    })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
      extraLocation: { X: 1, Y: 0 },
    } as Partial<Order>))

    expect(world._createdActors.length).toBe(1)
    expect(createdNameOf(world._createdActors[0])).toBe('powerplant_variant')
  })

  it('falls back to original actor if variant not found', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
      extraLocation: { X: 5, Y: 0 },
    } as Partial<Order>))

    expect(createdNameOf(world._createdActors[0])).toBe('powerplant')
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — resolveOrder (LineBuild)
// ---------------------------------------------------------------------------

describe('PlaceBuilding.resolveOrder — LineBuild', () => {
  let pb: PlaceBuilding
  let world: TestWorld
  let player: PlayerStub
  let self: IGameActor
  let actorInfo: ActorInfoEx
  let queue: QueueEx

  beforeEach(() => {
    pb = new PlaceBuilding(new PlaceBuildingInfo())
    pb.setSoundContext(makeSound())

    world = makeWorld()
    player = world.localPlayer!
    self = makeActor(1, player)
    setWorldOn(self, world)

    const targetActor = makeActor(2, player)
    ;(targetActor as unknown as Record<string, unknown>).location = { X: 5, Y: 5, Layer: 0 } as CPos
    world._actorsById.set(2, targetActor)

    actorInfo = makeActorInfo('wall')
    const buildingInfo = makeBuildingInfo({ buildSounds: ['wall_build.wav'] })
    actorInfo._addTraitInfo('BuildingInfo', buildingInfo)
    actorInfo._addTraitInfo('LineBuildInfo', {
      type: 'LineBuildInfo', segmentType: 'wall_segment', range: 5, nodeTypes: new Set(['wall']),
    })

    const segActorInfo = makeActorInfo('wall_segment')
    segActorInfo._addTraitInfo('BuildingInfo', makeBuildingInfo())

    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo(name: string) {
          if (name === 'wall') return actorInfo
          if (name === 'wall_segment') return segActorInfo
          return undefined
        },
      } as IPlaceBuildingRules,
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      buildingUtils: {
        canPlaceBuilding: () => true,
        getLineBuildCells(): ILineBuildCellResult[] {
          const cell5 = { X: 5, Y: 5, Layer: 0 } as CPos
          return [
            { cell: cell5, connector: null },
            { cell: { X: 6, Y: 5, Layer: 0 } as CPos, connector: null },
            { cell: { X: 7, Y: 5, Layer: 0 } as CPos, connector: null },
          ]
        },
      } as unknown as IPlaceBuildingUtils,
    })

    queue = makeQueue()
    queue.addItem({ done: true, item: 'wall' })

    Object.assign(targetActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'ProductionQueue') return [queue]
        return undefined
      },
    })
  })

  it('creates parent actor for LineBuild order', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'LineBuild', targetString: 'wall', extraData: 2,
    } as Partial<Order>))

    expect(world._createdActors.length).toBeGreaterThanOrEqual(1)
    expect(createdNameOf(world._createdActors[0])).toBe('wall')
    expect(createdInitsOf(world._createdActors[0]).some((i) => i instanceof PlaceBuildingInit)).toBe(true)
  })

  it('creates segment actors for line build cells', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'LineBuild', targetString: 'wall', extraData: 2,
    } as Partial<Order>))

    expect(world._createdActors.length).toBe(3)
    for (const seg of world._createdActors.slice(1)) {
      expect(createdNameOf(seg)).toBe('wall_segment')
    }
  })

  it('includes LineBuildDirectionInit and LineBuildParentInit on segments', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'LineBuild', targetString: 'wall', extraData: 2,
    } as Partial<Order>))

    const inits = createdInitsOf(world._createdActors[1])
    const hasDirInit = inits.some((i) => (i as unknown as { key?: string }).key === 'lineBuildDirection')
    const hasParentInit = inits.some((i) => (i as unknown as { key?: string }).key === 'lineBuildParent')
    expect(hasDirInit).toBe(true)
    expect(hasParentInit).toBe(true)
  })

  it('ends production after line build', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'LineBuild', targetString: 'wall', extraData: 2,
    } as Partial<Order>))
    expect(queue._endedItems.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — resolveOrder (PlacePlug)
// ---------------------------------------------------------------------------

describe('PlaceBuilding.resolveOrder — PlacePlug', () => {
  let pb: PlaceBuilding
  let world: TestWorld
  let sound: SoundEx
  let player: PlayerStub
  let self: IGameActor
  let actorInfo: ActorInfoEx
  let queue: QueueEx

  beforeEach(() => {
    pb = new PlaceBuilding(new PlaceBuildingInfo())
    sound = makeSound()
    pb.setSoundContext(sound)

    world = makeWorld()
    player = world.localPlayer!
    self = makeActor(1, player)
    setWorldOn(self, world)

    const targetActor = makeActor(2, player)
    world._actorsById.set(2, targetActor)

    actorInfo = makeActorInfo('plug_actor')
    actorInfo._addTraitInfo('PlugInfo', { type: 'PlugInfo', plugType: 'turret' })
    const buildingInfo = makeBuildingInfo({ buildSounds: ['plug.wav'] })
    actorInfo._addTraitInfo('BuildingInfo', buildingInfo)

    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo(name: string) {
          if (name === 'plug_actor') return actorInfo
          return undefined
        },
      } as IPlaceBuildingRules,
    })

    queue = makeQueue()
    queue.addItem({ done: true, item: 'plug_actor' })

    Object.assign(targetActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'ProductionQueue') return [queue]
        return undefined
      },
    })
  })

  it('enables plug on matching Pluggable', () => {
    const enabledTypes: string[] = []
    const pluggableActor = makeActor(10, player)
    Object.assign(pluggableActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'Pluggable') {
          return [{
            acceptsPlug(type: string) { return type === 'turret' },
            enablePlug(_actor: unknown, type: string) { enabledTypes.push(type) },
          }]
        }
        return undefined
      },
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      actorMap: { getActorsAt(_cell: CPos): IGameActor[] { return [pluggableActor] } },
    })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlacePlug', targetString: 'plug_actor', extraData: 2,
    } as Partial<Order>))

    expect(enabledTypes.length).toBe(1)
    expect(enabledTypes[0]).toBe('turret')
  })

  it('plays build sounds after enabling plug', () => {
    const pluggableActor = makeActor(10, player)
    ;(pluggableActor as unknown as Record<string, unknown>).centerPosition = { X: 100, Y: 200 }
    Object.assign(pluggableActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'Pluggable') return [{ acceptsPlug: () => true, enablePlug() {} }]
        return undefined
      },
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      actorMap: { getActorsAt(_cell: CPos): IGameActor[] { return [pluggableActor] } },
    })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlacePlug', targetString: 'plug_actor', extraData: 2,
    } as Partial<Order>))

    expect(sound._playedToPlayer.length).toBe(1)
    expect(sound._playedToPlayer[0].sound).toBe('plug.wav')
  })

  it('returns early if no PlugInfo on actor', () => {
    const noPlugInfo = makeActorInfo('no_plug_actor')
    noPlugInfo._addTraitInfo('BuildingInfo', makeBuildingInfo())

    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo(name: string) {
          if (name === 'no_plug_actor') return noPlugInfo
          return undefined
        },
      } as IPlaceBuildingRules,
    })

    queue.clearItems()
    queue.addItem({ done: true, item: 'no_plug_actor' })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlacePlug', targetString: 'no_plug_actor', extraData: 2,
    } as Partial<Order>))

    expect(queue._endedItems.length).toBe(1)
  })

  it('ends production after placing plug', () => {
    const pluggableActor = makeActor(10, player)
    Object.assign(pluggableActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'Pluggable') return [{ acceptsPlug: () => true, enablePlug() {} }]
        return undefined
      },
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      actorMap: { getActorsAt(_cell: CPos): IGameActor[] { return [pluggableActor] } },
    })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlacePlug', targetString: 'plug_actor', extraData: 2,
    } as Partial<Order>))

    expect(queue._endedItems.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — tick and notification delay
// ---------------------------------------------------------------------------

describe('PlaceBuilding.tick — notification delay', () => {
  let pb: PlaceBuilding
  let player: PlayerStub
  let self: IGameActor
  let sound: SoundEx

  beforeEach(() => {
    pb = new PlaceBuilding(new PlaceBuildingInfo({
      newOptionsNotificationDelay: 5,
      newOptionsNotification: 'NewBuildOptions',
      newOptionsTextNotification: 'New options available!',
    }))
    sound = makeSound()
    pb.setSoundContext(sound)
    player = makePlayer(0, 'gdi')
    self = makeActor(1, player)
  })

  it('does nothing when no notification is triggered', () => {
    pb.tick(self)
    expect(sound._playedNotification.length).toBe(0)
  })

  it('plays notification after delay ticks', () => {
    ;(pb as unknown as Record<string, boolean>)._triggerNotification = true
    for (let i = 0; i < 4; i++) pb.tick(self)
    expect(sound._playedNotification.length).toBe(0)
    pb.tick(self)
    expect(sound._playedNotification.length).toBe(1)
    expect(sound._playedNotification[0].notification).toBe('NewBuildOptions')
    expect(sound._playedNotification[0].faction).toBe('gdi')
  })

  it('resets trigger and tick after playing notification', () => {
    ;(pb as unknown as Record<string, boolean>)._triggerNotification = true
    for (let i = 0; i < 5; i++) pb.tick(self)
    expect(sound._playedNotification.length).toBe(1)
    expect((pb as unknown as Record<string, boolean>)._triggerNotification).toBe(false)
    pb.tick(self)
    expect(sound._playedNotification.length).toBe(1)
  })

  it('sends text notification when configured', () => {
    ;(pb as unknown as Record<string, boolean>)._triggerNotification = true
    for (let i = 0; i < 5; i++) pb.tick(self)
    expect(sound._transientLines.length).toBe(1)
    expect(sound._transientLines[0].text).toBe('New options available!')
  })

  it('does not play notification if none configured', () => {
    pb = new PlaceBuilding(new PlaceBuildingInfo({
      newOptionsNotificationDelay: 3, newOptionsNotification: null,
    }))
    pb.setSoundContext(sound)
    ;(pb as unknown as Record<string, boolean>)._triggerNotification = true
    for (let i = 0; i < 3; i++) pb.tick(self)
    expect(sound._playedNotification.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — faction resolution
// ---------------------------------------------------------------------------

describe('PlaceBuilding — faction resolution', () => {
  let world: TestWorld
  let player: PlayerStub
  let self: IGameActor
  let actorInfo: ActorInfoEx
  let queue: QueueEx
  let pb: PlaceBuilding

  beforeEach(() => {
    pb = new PlaceBuilding(new PlaceBuildingInfo())
    pb.setSoundContext(makeSound())

    world = makeWorld()
    player = makePlayer(0, 'gdi')
    self = makeActor(1, player)
    setWorldOn(self, world)

    const targetActor = makeActor(2, player)
    world._actorsById.set(2, targetActor)

    actorInfo = makeActorInfo('barracks')
    actorInfo._addTraitInfo('BuildingInfo', makeBuildingInfo())

    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo(name: string) {
          if (name === 'barracks') return actorInfo
          return undefined
        },
      } as IPlaceBuildingRules,
    })

    queue = makeQueue()
    // Override producer to not specify a faction, so player faction is used
    ;(queue as unknown as Record<string, unknown>).mostLikelyProducer = () => ({
      actor: null,
      trait: null, // No faction override
    })
    queue.addItem({ done: true, item: 'barracks' })

    Object.assign(targetActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'ProductionQueue') return [queue]
        return undefined
      },
    })
  })

  it('uses player faction when no override', () => {
    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'barracks', extraData: 2,
    } as Partial<Order>))

    const inits = createdInitsOf(world._createdActors[0])
    const factionInit = inits.find((i) => (i as unknown as { key?: string }).key === 'faction')
    expect(factionInit).toBeDefined()
    // Player faction is 'gdi', no producer override → should be 'gdi'
    expect((factionInit as ActorInit<string>).value).toBe('gdi')
  })

  it('uses BuildableInfo.forceFaction when set', () => {
    actorInfo._addTraitInfo('BuildableInfo', { type: 'BuildableInfo', forceFaction: 'nod' })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'barracks', extraData: 2,
    } as Partial<Order>))

    const inits = createdInitsOf(world._createdActors[0])
    const factionInit = inits.find((i) => (i as unknown as { key?: string }).key === 'faction')
    expect((factionInit as ActorInit<string>).value).toBe('nod')
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — replacement logic
// ---------------------------------------------------------------------------

describe('PlaceBuilding — replacement logic', () => {
  let world: TestWorld
  let player: PlayerStub
  let self: IGameActor
  let actorInfo: ActorInfoEx
  let queue: QueueEx
  let pb: PlaceBuilding

  beforeEach(() => {
    pb = new PlaceBuilding(new PlaceBuildingInfo())
    pb.setSoundContext(makeSound())

    world = makeWorld()
    player = makePlayer(0, 'gdi')
    self = makeActor(1, player)
    setWorldOn(self, world)

    const targetActor = makeActor(2, player)
    world._actorsById.set(2, targetActor)

    actorInfo = makeActorInfo('concrete')
    actorInfo._addTraitInfo('BuildingInfo', makeBuildingInfo())
    actorInfo._addTraitInfo('ReplacementInfo', {
      type: 'ReplacementInfo', replaceableTypes: new Set(['wall']),
    })

    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo(name: string) {
          if (name === 'concrete') return actorInfo
          return undefined
        },
      } as IPlaceBuildingRules,
    })

    queue = makeQueue()
    queue.addItem({ done: true, item: 'concrete' })

    Object.assign(targetActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'ProductionQueue') return [queue]
        return undefined
      },
    })
  })

  it('removes replaceable actors at footprint cells', () => {
    const replaceableActor = makeActor(50, player)
    Object.assign(replaceableActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'Replaceable') return [{ isTraitDisabled: false, info: { types: new Set(['wall']) } }]
        return undefined
      },
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      actorMap: { getActorsAt(_cell: CPos): IGameActor[] { return [replaceableActor] } },
    })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'concrete', extraData: 2,
    } as Partial<Order>))

    expect(world._removedActors.length).toBe(1)
    expect(world._removedActors[0]).toBe(replaceableActor)
  })

  it('does not remove actors with non-matching Replaceable types', () => {
    const replaceableActor = makeActor(50, player)
    Object.assign(replaceableActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'Replaceable') return [{ isTraitDisabled: false, info: { types: new Set(['turret']) } }]
        return undefined
      },
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      actorMap: { getActorsAt(_cell: CPos): IGameActor[] { return [replaceableActor] } },
    })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'concrete', extraData: 2,
    } as Partial<Order>))

    expect(world._removedActors.length).toBe(0)
  })

  it('skips replaceable actors when isTraitDisabled', () => {
    const replaceableActor = makeActor(50, player)
    Object.assign(replaceableActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'Replaceable') return [{ isTraitDisabled: true, info: { types: new Set(['wall']) } }]
        return undefined
      },
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      actorMap: { getActorsAt(_cell: CPos): IGameActor[] { return [replaceableActor] } },
    })

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'concrete', extraData: 2,
    } as Partial<Order>))

    expect(world._removedActors.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PlaceBuilding — cannot-place notification
// ---------------------------------------------------------------------------

describe('PlaceBuilding — cannot-place notification', () => {
  it('plays cannot-place notification when placement is invalid', () => {
    const pb = new PlaceBuilding(new PlaceBuildingInfo({ cannotPlaceNotification: 'CannotPlaceHere' }))
    const sound = makeSound()
    pb.setSoundContext(sound)

    const world = makeWorld()
    const player = world.localPlayer!
    const self = makeActor(1, player)
    setWorldOn(self, world)

    let targetActor = makeActor(2, player)
    world._actorsById.set(2, targetActor)

    const actorInfo = makeActorInfo('powerplant')
    actorInfo._addTraitInfo('BuildingInfo', makeBuildingInfo())

    Object.assign(world.map as unknown as Record<string, unknown>, {
      rules: {
        getActorInfo: (name: string) => name === 'powerplant' ? actorInfo : undefined,
      } as IPlaceBuildingRules,
    })

    Object.assign(world as unknown as Record<string, unknown>, {
      buildingUtils: {
        canPlaceBuilding: () => false,
        getLineBuildCells: () => [],
      } as unknown as IPlaceBuildingUtils,
    })

    const queue = makeQueue()
    queue.addItem({ done: true, item: 'powerplant' })

    targetActor = makeActor(2, player)
    Object.assign(targetActor as unknown as Record<string, unknown>, {
      traitsImplementing: (name: string) => {
        if (name === 'ProductionQueue') return [queue]
        return undefined
      },
    })
    world._actorsById.set(2, targetActor)

    pb.resolveOrder(self, makeOrder({
      orderString: 'PlaceBuilding', targetString: 'powerplant', extraData: 2,
    } as Partial<Order>))

    expect(sound._playedNotification.length).toBe(1)
    expect(sound._playedNotification[0].notification).toBe('CannotPlaceHere')
  })
})
