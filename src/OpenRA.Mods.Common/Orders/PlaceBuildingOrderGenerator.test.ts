/**
 * PlaceBuildingOrderGenerator.test.ts — PlaceBuildingOrderGenerator migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: VariantWrapper construction, variant cycling, footprint
 * computation, plug acceptance, order generation, queue state lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — not directly used by this module, but may be
// transitively imported by dependencies
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Vector3: class { x = 0; y = 0; z = 0 },
  Matrix: { Identity: vi.fn(() => ({})), LookAtLH: vi.fn(() => ({})),
    PerspectiveFovLH: vi.fn(() => ({})), OrthoLH: vi.fn(() => ({})) },
  Camera: class {},
  ArcRotateCamera: class {},
  Engine: class {},
  Scene: class {},
}))

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  PlaceBuildingOrderGenerator,
  VariantWrapper,
  ModifierFlag,
} from './PlaceBuildingOrderGenerator.js'

import { PlaceBuildingCellType } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

import type {
  IPlaceBuildingOGActorInfo,
  IPlaceBuildingOGTraitInfo,
  IPlaceBuildingOGWorld,
  IPlaceBuildingOGQueue,
  IPlaceBuildingOGViewport,
  IPlaceBuildingOGSettings,
  IPlaceBuildingOGModifiers,
  IPlaceBuildingOGSound,
  IPlaceBuildingOGProductionItem,
  IPlaceBuildingOGKeyInput,
} from './PlaceBuildingOrderGenerator.js'

import type {
  IPlaceBuildingPreview,
  WorldRendererStub,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// Test helper factory functions
// ---------------------------------------------------------------------------

function makeTraitInfo(overrides: Partial<IPlaceBuildingOGTraitInfo> = {}): IPlaceBuildingOGTraitInfo {
  return {
    type: overrides.type ?? 'BuildingInfo',
    dimensions: overrides.dimensions ?? new CVec(2, 2),
    terrainTypes: overrides.terrainTypes ?? new Set(['Clear']),
    allowInvalidPlacement: overrides.allowInvalidPlacement ?? false,
    requiresBaseProvider: overrides.requiresBaseProvider ?? false,
    plugType: overrides.plugType ?? null,
    range: overrides.range ?? 5,
    nodeTypes: overrides.nodeTypes ?? new Set(),
    segmentType: overrides.segmentType ?? null,
    actors: overrides.actors ?? [],
    previewType: overrides.previewType ?? undefined,
    replaceableTypes: overrides.replaceableTypes ?? new Set(),
    forceFaction: overrides.forceFaction ?? null,
    buildSounds: overrides.buildSounds ?? [],
  }
}

function makeActorInfo(
  name: string,
  traitInfos: Record<string, IPlaceBuildingOGTraitInfo | null> = {},
): IPlaceBuildingOGActorInfo {
  return {
    name,
    getTraitInfo(traitName: string): IPlaceBuildingOGTraitInfo | null {
      return traitInfos[traitName] ?? null
    },
    getTraitInfoOrDefault(traitName: string): IPlaceBuildingOGTraitInfo | null {
      return traitInfos[traitName] ?? null
    },
    getTraitInfos(traitName: string): readonly IPlaceBuildingOGTraitInfo[] {
      const info = traitInfos[traitName]
      return info ? [info] : []
    },
    hasTraitInfo(traitName: string): boolean {
      return traitName in traitInfos
    },
  }
}

function makePlayer(overrides: Partial<PlayerStub & Record<string, unknown>> = {}): PlayerStub & Record<string, unknown> {
  return {
    playerName: 'TestPlayer',
    factionInternalName: 'random',
    ...overrides,
  }
}

function makeViewport(lastMouse: { x: number; y: number } = { x: 500, y: 300 }): IPlaceBuildingOGViewport {
  return {
    lastMousePos: lastMouse,
    viewToWorldPx(viewPos) {
      return { x: viewPos.x * 2, y: viewPos.y * 2, z: 0 }
    },
    worldToViewPx(worldPos) {
      return { x: Math.round(worldPos.x / 2), y: Math.round(worldPos.y / 2) }
    },
    viewToWorld(viewPos) {
      return new CPos(Math.floor(viewPos.x / 100), Math.floor(viewPos.y / 100))
    },
  }
}

function makeOrderGuard(
  o: unknown,
): { orderString: string; targetString: string; extraData: number; suppressVisualFeedback: boolean } {
  return o as { orderString: string; targetString: string; extraData: number; suppressVisualFeedback: boolean }
}

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function createActorInfo(name: string, extraTraits: Record<string, IPlaceBuildingOGTraitInfo | null> = {}) {
  const bi = makeTraitInfo({ type: 'BuildingInfo', dimensions: new CVec(2, 2) })
  return makeActorInfo(name, { BuildingInfo: bi, ...extraTraits })
}

function createWorld(
  overrides: Partial<IPlaceBuildingOGWorld> = {},
  actorsMap?: Map<string, IPlaceBuildingOGActorInfo>,
): IPlaceBuildingOGWorld {
  const actors = actorsMap ?? new Map<string, IPlaceBuildingOGActorInfo>()
  return {
    // WorldStub fields
    actors: [],
    map: overrides.map ?? {
      contains: () => true,
      rules: {
        getActorInfo(name: string): IPlaceBuildingOGActorInfo | undefined {
          return actors.get(name)
        },
      },
    },
    actorMap: overrides.actorMap ?? {
      getActorsAt: () => [],
    },
    buildingInfluence: overrides.buildingInfluence ?? {
      anyBuildingAt: () => false,
    },
    shroud: overrides.shroud ?? {
      isExplored: () => true,
    },
    selection: overrides.selection ?? null,
    localPlayer: overrides.localPlayer ?? null,
    paused: overrides.paused ?? false,
    cancelInputMode: overrides.cancelInputMode ?? vi.fn(),
    canPlaceBuilding: overrides.canPlaceBuilding ?? (() => true),
    isCellBuildable: overrides.isCellBuildable ?? (() => true),
  }
}

function createQueue(
  overrides: Partial<{
    actorId: number
    owner: PlayerStub & Record<string, unknown>
    items: IPlaceBuildingOGProductionItem[]
    producer: { actor: null; faction: string } | null
    cannotPlaceAudio: string | null
  }> = {},
): IPlaceBuildingOGQueue {
  const owner = overrides.owner ?? makePlayer()
  return {
    actor: {
      actorId: overrides.actorId ?? 42,
      isInWorld: true,
      isDead: false,
      disposed: false,
      owner,
    },
    allQueued() {
      return overrides.items ?? [{ done: true, item: 'fact' }]
    },
    mostLikelyProducer() {
      return overrides.producer ?? { actor: null, faction: 'random' }
    },
    info: {
      cannotPlaceAudio: overrides.cannotPlaceAudio ?? null,
    },
  }
}

function createSettings(mouseControlStyle: string = 'standard'): IPlaceBuildingOGSettings {
  return {
    mouseControlStyle,
    resolveActionButtonForPlaceBuilding: () => 1, // Left-click = 1
    resolveCancelButtonForPlaceBuilding: () => 3, // Right-click = 3
  }
}

function createModifiers(shift: boolean = false): IPlaceBuildingOGModifiers {
  return {
    hasModifier(mod: number): boolean {
      return shift && mod === ModifierFlag.Shift
    },
  }
}

function createKeyInput(key: string = 'Tab'): IPlaceBuildingOGKeyInput {
  return { key, event: 'Down', modifiers: 0 }
}

// ---------------------------------------------------------------------------
// VariantWrapper tests
// ---------------------------------------------------------------------------

describe('VariantWrapper', () => {
  it('constructs with BuildingInfo, PlugInfo, and LineBuildInfo extracted', () => {
    const plugInfo = makeTraitInfo({ type: 'PlugInfo', plugType: 'p1' })
    const lbInfo = makeTraitInfo({ type: 'LineBuildInfo', range: 3, nodeTypes: new Set(['wall']) })
    const ai = makeActorInfo('fact', {
      BuildingInfo: makeTraitInfo(),
      PlugInfo: plugInfo,
      LineBuildInfo: lbInfo,
    })
    const queue = createQueue()

    const vw = new VariantWrapper(null, queue, ai)

    expect(vw.actorInfo).toBe(ai)
    expect(vw.buildingInfo.type).toBe('BuildingInfo')
    expect(vw.plugInfo?.type).toBe('PlugInfo')
    expect(vw.plugInfo?.plugType).toBe('p1')
    expect(vw.lineBuildInfo?.type).toBe('LineBuildInfo')
    expect(vw.lineBuildInfo?.range).toBe(3)
  })

  it('has null PlugInfo and LineBuildInfo when absent', () => {
    const ai = makeActorInfo('fact', {
      BuildingInfo: makeTraitInfo(),
    })
    const queue = createQueue()

    const vw = new VariantWrapper(null, queue, ai)

    expect(vw.plugInfo).toBeNull()
    expect(vw.lineBuildInfo).toBeNull()
  })

  it('has null preview when no preview generator info', () => {
    const ai = makeActorInfo('fact', {
      BuildingInfo: makeTraitInfo(),
    })
    const queue = createQueue()

    const vw = new VariantWrapper(null, queue, ai)

    expect(vw.preview).toBeNull()
  })

  it('creates preview when IPlaceBuildingPreviewGeneratorInfo is present', () => {
    const mockPreview: IPlaceBuildingPreview = {
      topLeftScreenOffset: { x: 0, y: 0 },
      tick: vi.fn(),
      render: vi.fn(() => []),
      renderAnnotations: vi.fn(() => []),
    }
    const ai = makeActorInfo('fact', {
      BuildingInfo: makeTraitInfo(),
    })
    const aiWithPreview = {
      ...ai,
      getTraitInfoOrDefault(traitName: string) {
        if (traitName === 'IPlaceBuildingPreviewGeneratorInfo') {
          return {
            createPreview: () => mockPreview,
          } as unknown as IPlaceBuildingOGTraitInfo
        }
        if (traitName === 'BuildableInfo') return null
        return ai.getTraitInfoOrDefault(traitName)
      },
    }
    const queue = createQueue({
      producer: { actor: null, faction: 'gdi' },
    })

    const vw = new VariantWrapper(
      {} as WorldRendererStub,
      queue,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiWithPreview as any,
    )

    expect(vw.preview).toBe(mockPreview)
  })

  it('resolves faction from forceFaction when BuildableInfo.forceFaction is set', () => {
    const mockPreview: IPlaceBuildingPreview = {
      topLeftScreenOffset: { x: 0, y: 0 },
      tick: vi.fn(),
      render: vi.fn(() => []),
      renderAnnotations: vi.fn(() => []),
    }
    const bi = makeTraitInfo({ type: 'BuildableInfo', forceFaction: 'nod' })
    const ai = makeActorInfo('fact', {
      BuildingInfo: makeTraitInfo(),
    })
    const aiWithPreview = {
      ...ai,
      getTraitInfoOrDefault(traitName: string) {
        if (traitName === 'IPlaceBuildingPreviewGeneratorInfo') {
          return {
            createPreview: () => mockPreview,
          } as unknown as IPlaceBuildingOGTraitInfo
        }
        if (traitName === 'BuildableInfo') return bi as unknown as IPlaceBuildingOGTraitInfo
        return ai.getTraitInfoOrDefault(traitName)
      },
    }
    const queue = createQueue({
      producer: { actor: null, faction: 'gdi' },
    })

    const vw = new VariantWrapper(
      {} as WorldRendererStub,
      queue,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aiWithPreview as any,
    )

    expect(vw.preview).toBe(mockPreview)
  })

  it('getVariantActors returns actor names from PlaceBuildingVariantsInfo', () => {
    const vInfo = makeTraitInfo({
      type: 'PlaceBuildingVariantsInfo',
      actors: ['fact2', 'fact3'],
    })
    const ai = makeActorInfo('fact', {
      BuildingInfo: makeTraitInfo(),
      PlaceBuildingVariantsInfo: vInfo,
    })
    const queue = createQueue()

    const vw = new VariantWrapper(null, queue, ai)

    expect(vw.getVariantActors()).toEqual(['fact2', 'fact3'])
  })

  it('getVariantActors returns empty when no PlaceBuildingVariantsInfo', () => {
    const ai = makeActorInfo('fact', {
      BuildingInfo: makeTraitInfo(),
    })
    const queue = createQueue()

    const vw = new VariantWrapper(null, queue, ai)

    expect(vw.getVariantActors()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// PlaceBuildingOrderGenerator tests
// ---------------------------------------------------------------------------

describe('PlaceBuildingOrderGenerator', () => {
  let world: IPlaceBuildingOGWorld
  let queue: IPlaceBuildingOGQueue
  let viewport: IPlaceBuildingOGViewport
  let settings: IPlaceBuildingOGSettings
  let modifiers: IPlaceBuildingOGModifiers
  let sound: IPlaceBuildingOGSound
  let actors: Map<string, IPlaceBuildingOGActorInfo>

  beforeEach(() => {
    actors = new Map<string, IPlaceBuildingOGActorInfo>()
    const factAi = createActorInfo('fact')
    actors.set('fact', factAi)
    const fact2Ai = createActorInfo('fact2')
    actors.set('fact2', fact2Ai)

    world = createWorld({
      map: {
        contains: () => true,
        rules: {
          getActorInfo(name: string) {
            return actors.get(name)
          },
        },
      },
    }, actors)

    const player = makePlayer()
    queue = createQueue({
      owner: player,
      actorId: 10,
    })
    viewport = makeViewport()
    settings = createSettings()
    modifiers = createModifiers()
    sound = {
      playNotification: vi.fn(),
      addTransientLine: vi.fn(),
    }
  })

  function makeGenerator(
    opts: {
      name?: string
      mouseControlStyle?: string
      renderer?: WorldRendererStub | null
      mods?: IPlaceBuildingOGModifiers
    } = {},
  ): PlaceBuildingOrderGenerator {
    const s = createSettings(opts.mouseControlStyle ?? 'standard')
    return new PlaceBuildingOrderGenerator(
      queue,
      opts.name ?? 'fact',
      opts.renderer ?? null,
      world,
      viewport,
      s,
      () => opts.mods ?? modifiers,
      sound,
    )
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('builds variants list with base actor', () => {
      const gen = makeGenerator()
      expect(gen.variants.length).toBe(1)
      expect(gen.variants[0].actorInfo.name).toBe('fact')
    })

    it('builds variants list with PlaceBuildingVariants alternates', () => {
      const vInfo = makeTraitInfo({
        type: 'PlaceBuildingVariantsInfo',
        actors: ['fact2'],
      })
      const factAi = createActorInfo('fact', { PlaceBuildingVariantsInfo: vInfo })
      actors.set('fact', factAi)

      const gen = makeGenerator()
      expect(gen.variants.length).toBe(2)
      expect(gen.variants[0].actorInfo.name).toBe('fact')
      expect(gen.variants[1].actorInfo.name).toBe('fact2')
    })

    it('has empty variants when base actor not found in rules', () => {
      const gen = new PlaceBuildingOrderGenerator(
        queue, 'nonexistent', null, world, viewport, settings,
        () => modifiers, sound,
      )
      expect(gen.variants.length).toBe(0)
    })

    it('clears selection when mouseControlStyle is classic', () => {
      const selection = { clear: vi.fn() }
      const classicWorld = createWorld({ selection }, actors)
      const s = createSettings('classic')

      new PlaceBuildingOrderGenerator(
        queue, 'fact', null, classicWorld, viewport, s,
        () => modifiers, sound,
      )

      expect(selection.clear).toHaveBeenCalledOnce()
    })

    it('does NOT clear selection when mouseControlStyle is standard', () => {
      const selection = { clear: vi.fn() }
      const standardWorld = createWorld({ selection }, actors)
      const s = createSettings('standard')

      new PlaceBuildingOrderGenerator(
        queue, 'fact', null, standardWorld, viewport, s,
        () => modifiers, sound,
      )

      expect(selection.clear).not.toHaveBeenCalled()
    })

    it('initial variant is 0', () => {
      const gen = makeGenerator()
      expect(gen.variant).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Variant cycling (handleKeyPress)
  // ---------------------------------------------------------------------------

  describe('handleKeyPress', () => {
    it('returns false when only one variant', () => {
      const gen = makeGenerator()
      const ki = createKeyInput('Tab')
      expect(gen.handleKeyPress(ki)).toBe(false)
    })

    it('cycles variant on activated hotkey', () => {
      const vInfo = makeTraitInfo({
        type: 'PlaceBuildingVariantsInfo',
        actors: ['fact2'],
      })
      const factAi = createActorInfo('fact', { PlaceBuildingVariantsInfo: vInfo })
      actors.set('fact', factAi)

      // Create a player whose `info` has getTraitInfo returning a PlaceBuildingInfo
      // that activates for any key
      const player = makePlayer({
        info: {
          getTraitInfo(_traitName: string) {
            return {
              cannotPlaceNotification: null,
              cannotPlaceTextNotification: null,
              toggleVariantKey: {
                isActivatedBy: () => true,
              },
            }
          },
        },
      })

      const q = createQueue({
        owner: player as PlayerStub & Record<string, unknown>,
        items: [{ done: true, item: 'fact' }],
      })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, world, viewport, settings,
        () => modifiers, sound,
      )

      expect(gen.variant).toBe(0)
      const ki = createKeyInput()
      const handled = gen.handleKeyPress(ki)
      expect(handled).toBe(true)
      expect(gen.variant).toBe(1)

      // Cycle back to 0
      gen.handleKeyPress(ki)
      expect(gen.variant).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick lifecycle
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('cancels input mode when no completed item for base actor', () => {
      const cancelInputMode = vi.fn()
      const w = createWorld({ cancelInputMode }, actors)
      const q = createQueue({
        items: [{ done: false, item: 'fact' }],
      })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, w, viewport, settings,
        () => modifiers, sound,
      )

      gen.tick(w)

      expect(cancelInputMode).toHaveBeenCalledOnce()
    })

    it('does NOT cancel input mode when completed item exists', () => {
      const cancelInputMode = vi.fn()
      const w = createWorld({ cancelInputMode }, actors)
      const q = createQueue({
        items: [{ done: true, item: 'fact' }],
      })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, w, viewport, settings,
        () => modifiers, sound,
      )

      gen.tick(w)

      expect(cancelInputMode).not.toHaveBeenCalled()
    })

    it('ticks preview renderers when present', () => {
      const tickFn = vi.fn()
      const mockPreview: IPlaceBuildingPreview = {
        topLeftScreenOffset: { x: 0, y: 0 },
        tick: tickFn,
        render: vi.fn(() => []),
        renderAnnotations: vi.fn(() => []),
      }
      const ai = createActorInfo('fact')
      const aiWithPreview = {
        ...ai,
        getTraitInfoOrDefault(traitName: string) {
          if (traitName === 'IPlaceBuildingPreviewGeneratorInfo') {
            return {
              createPreview: () => mockPreview,
            } as unknown as IPlaceBuildingOGTraitInfo
          }
          if (traitName === 'BuildableInfo') return null
          return ai.getTraitInfoOrDefault(traitName)
        },
      }
      actors.set('fact', aiWithPreview as unknown as IPlaceBuildingOGActorInfo)

      const q = createQueue({ items: [{ done: true, item: 'fact' }] })
      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', {} as WorldRendererStub, world, viewport, settings,
        () => modifiers, sound,
      )

      gen.tick(world)
      expect(tickFn).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Get cursor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns the world default cursor', () => {
      const gen = makeGenerator()
      expect(gen.getCursor(world, CPos.Zero)).toBe('default')
    })

    it('returns custom cursor when specified in constructor', () => {
      const gen = new PlaceBuildingOrderGenerator(
        queue, 'fact', null, world, viewport, settings,
        () => modifiers, sound, 'custom-cursor',
      )
      expect(gen.getCursor(world, CPos.Zero)).toBe('custom-cursor')
    })
  })

  // ---------------------------------------------------------------------------
  // handleMouseInput
  // ---------------------------------------------------------------------------

  describe('handleMouseInput', () => {
    it('returns false (unhandled)', () => {
      const gen = makeGenerator()
      expect(gen.handleMouseInput({})).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Order generation
  // ---------------------------------------------------------------------------

  describe('order / innerOrder', () => {
    it('yields no orders when world is paused', () => {
      const pausedWorld = createWorld({ paused: true }, actors)
      const gen = new PlaceBuildingOrderGenerator(
        queue, 'fact', null, pausedWorld, viewport, settings,
        () => modifiers, sound,
      )

      // Simulate left-click Down event (actionButton = 1)
      gen.handleMouseInput({ button: 1, event: 'Down' })
      const orders = Array.from(gen.order(pausedWorld, CPos.Zero, 0))
      expect(orders.length).toBe(0)
    })

    it('yields PlaceBuilding order on valid placement', () => {
      const cancelInputMode = vi.fn()
      const w = createWorld({
        cancelInputMode,
        canPlaceBuilding: () => true,
      }, actors)
      const player = makePlayer()
      const q = createQueue({ owner: player, actorId: 42 })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, w, viewport, settings,
        () => modifiers, sound,
      )

      // Simulate left-click Down event (actionButton = 1)
      gen.handleMouseInput({ button: 1, event: 'Down' })
      const orders = Array.from(gen.order(w, CPos.Zero, 0))
      const placeOrders = orders.filter((o) => {
        const og = makeOrderGuard(o)
        return og.orderString === 'PlaceBuilding'
      })
      expect(placeOrders.length).toBe(1)
      expect(makeOrderGuard(placeOrders[0]).targetString).toBe('fact')
      expect(makeOrderGuard(placeOrders[0]).extraData).toBe(42)
      expect(makeOrderGuard(placeOrders[0]).suppressVisualFeedback).toBe(true)
    })

    it('yields LineBuild order when LineBuildInfo present and Shift not pressed', () => {
      const lbInfo = makeTraitInfo({ type: 'LineBuildInfo', range: 3, nodeTypes: new Set(['wall']) })
      const factAi = createActorInfo('fact', { LineBuildInfo: lbInfo })
      actors.set('fact', factAi)

      const w = createWorld({ canPlaceBuilding: () => true }, actors)
      const player = makePlayer()
      const q = createQueue({ owner: player, actorId: 42 })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, w, viewport, settings,
        () => createModifiers(false), sound,
      )

      // Simulate left-click Down event (actionButton = 1)
      gen.handleMouseInput({ button: 1, event: 'Down' })
      const orders = Array.from(gen.order(w, CPos.Zero, 0))
      const lbOrders = orders.filter((o) => makeOrderGuard(o).orderString === 'LineBuild')
      expect(lbOrders.length).toBe(1)
    })

    it('yields PlaceBuilding order when LineBuildInfo present but Shift pressed', () => {
      const lbInfo = makeTraitInfo({ type: 'LineBuildInfo', range: 3, nodeTypes: new Set(['wall']) })
      const factAi = createActorInfo('fact', { LineBuildInfo: lbInfo })
      actors.set('fact', factAi)

      const w = createWorld({ canPlaceBuilding: () => true }, actors)
      const player = makePlayer()
      const q = createQueue({ owner: player, actorId: 42 })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, w, viewport, settings,
        () => createModifiers(true), sound,
      )

      // Simulate left-click Down event (actionButton = 1)
      gen.handleMouseInput({ button: 1, event: 'Down' })
      const orders = Array.from(gen.order(w, CPos.Zero, 0))
      const placeOrders = orders.filter((o) => makeOrderGuard(o).orderString === 'PlaceBuilding')
      expect(placeOrders.length).toBe(1)
    })

    it('yields PlacePlug order when PlugInfo present', () => {
      const plugInfo = makeTraitInfo({ type: 'PlugInfo', plugType: 'p1' })
      const bi = makeTraitInfo({ type: 'BuildingInfo', dimensions: new CVec(1, 1) })
      const plugAi = makeActorInfo('plug', { BuildingInfo: bi, PlugInfo: plugInfo })
      actors.set('fact', plugAi as unknown as IPlaceBuildingOGActorInfo)

      const acceptingActor = {
        actorId: 99,
        isInWorld: true,
        isDead: false,
        disposed: false,
        owner: makePlayer(),
        traitsImplementing(traitName: string) {
          if (traitName === 'Pluggable') {
            return [{ acceptsPlug: () => true }]
          }
          return []
        },
      }

      const w = createWorld({
        canPlaceBuilding: () => true,
        actorMap: { getActorsAt: () => [acceptingActor] },
      }, actors)
      const player = makePlayer()
      const q = createQueue({ owner: player, actorId: 42 })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, w, viewport, settings,
        () => modifiers, sound,
      )

      // Simulate left-click Down event (actionButton = 1)
      gen.handleMouseInput({ button: 1, event: 'Down' })
      const orders = Array.from(gen.order(w, CPos.Zero, 0))
      const plugOrders = orders.filter((o) => makeOrderGuard(o).orderString === 'PlacePlug')
      expect(plugOrders.length).toBe(1)
    })

    it('yields no place orders and plays notification when cannot place', () => {
      const soundSpy = {
        playNotification: vi.fn(),
        addTransientLine: vi.fn(),
      }
      const w = createWorld({ canPlaceBuilding: () => false }, actors)
      const player = makePlayer()
      const q = createQueue({
        owner: player, actorId: 42,
        cannotPlaceAudio: 'BlockedAudio',
      })

      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', null, w, viewport, settings,
        () => modifiers, soundSpy,
      )

      // Simulate left-click Down event (actionButton = 1)
      gen.handleMouseInput({ button: 1, event: 'Down' })
      const orders = Array.from(gen.order(w, CPos.Zero, 0))
      const placeOrders = orders.filter((o) => {
        if (!o) return false
        const og = makeOrderGuard(o)
        return og.orderString === 'PlaceBuilding' ||
          og.orderString === 'LineBuild' ||
          og.orderString === 'PlacePlug'
      })
      expect(placeOrders.length).toBe(0)
      expect(soundSpy.playNotification).toHaveBeenCalledWith(
        w.map.rules,
        expect.anything(),
        'Speech',
        'BlockedAudio',
        expect.anything(),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Render methods
  // ---------------------------------------------------------------------------

  describe('renderAboveShroud', () => {
    it('does not throw when called with valid state', () => {
      const gen = makeGenerator()
      const wrStub = {} as WorldRendererStub
      expect(() => gen.renderAboveShroud(wrStub, world)).not.toThrow()
    })

    it('delegates to preview renderer when present', () => {
      const renderFn = vi.fn(() => [])
      const mockPreview: IPlaceBuildingPreview = {
        topLeftScreenOffset: { x: 0, y: 0 },
        tick: vi.fn(),
        render: renderFn,
        renderAnnotations: vi.fn(() => []),
      }
      const ai = createActorInfo('fact')
      const aiWithPreview = {
        ...ai,
        getTraitInfoOrDefault(traitName: string) {
          if (traitName === 'IPlaceBuildingPreviewGeneratorInfo') {
            return {
              createPreview: () => mockPreview,
            } as unknown as IPlaceBuildingOGTraitInfo
          }
          if (traitName === 'BuildableInfo') return null
          return ai.getTraitInfoOrDefault(traitName)
        },
      }
      actors.set('fact', aiWithPreview as unknown as IPlaceBuildingOGActorInfo)

      const q = createQueue({ items: [{ done: true, item: 'fact' }] })
      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', {} as WorldRendererStub, world, viewport, settings,
        () => modifiers, sound,
      )

      gen.renderAboveShroud({} as WorldRendererStub, world)
      expect(renderFn).toHaveBeenCalled()
    })
  })

  describe('renderAnnotations', () => {
    it('does not throw when called with valid state', () => {
      const gen = makeGenerator()
      const wrStub = {} as WorldRendererStub
      expect(() => gen.renderAnnotations(wrStub, world)).not.toThrow()
    })

    it('delegates to preview renderAnnotations when present', () => {
      const annFn = vi.fn(() => [])
      const mockPreview: IPlaceBuildingPreview = {
        topLeftScreenOffset: { x: 0, y: 0 },
        tick: vi.fn(),
        render: vi.fn(() => []),
        renderAnnotations: annFn,
      }
      const ai = createActorInfo('fact')
      const aiWithPreview = {
        ...ai,
        getTraitInfoOrDefault(traitName: string) {
          if (traitName === 'IPlaceBuildingPreviewGeneratorInfo') {
            return {
              createPreview: () => mockPreview,
            } as unknown as IPlaceBuildingOGTraitInfo
          }
          if (traitName === 'BuildableInfo') return null
          return ai.getTraitInfoOrDefault(traitName)
        },
      }
      actors.set('fact', aiWithPreview as unknown as IPlaceBuildingOGActorInfo)

      const q = createQueue({ items: [{ done: true, item: 'fact' }] })
      const gen = new PlaceBuildingOrderGenerator(
        q, 'fact', {} as WorldRendererStub, world, viewport, settings,
        () => modifiers, sound,
      )

      gen.renderAnnotations({} as WorldRendererStub, world)
      expect(annFn).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // orderGeneratorKey
  // ---------------------------------------------------------------------------

  describe('orderGeneratorKey', () => {
    it('returns the correct key', () => {
      const gen = makeGenerator()
      expect(gen.orderGeneratorKey).toBe('PlaceBuildingOrderGenerator')
    })
  })

  // ---------------------------------------------------------------------------
  // PlaceBuildingCellType factory
  // ---------------------------------------------------------------------------

  describe('PlaceBuildingCellType', () => {
    it('has correct flag values', () => {
      expect(PlaceBuildingCellType.None).toBe(0)
      expect(PlaceBuildingCellType.Valid).toBe(1)
      expect(PlaceBuildingCellType.Invalid).toBe(2)
      expect(PlaceBuildingCellType.LineBuild).toBe(4)
    })
  })
})
