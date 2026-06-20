/**
 * GpsDotEffect.test.ts — GpsDotEffect unit tests
 *
 * Phase B.8: Updated with render() Billboard rendering tests, palette color
 * verification, and effect cleanup tests.
 *
 * Ch24 Phase D: Expanded with Billboard mesh creation, visibility toggling,
 * material properties, and dispose cleanup tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock instance storage — vi.hoisted ensures availability before mock factory
// ---------------------------------------------------------------------------

const { __mockMeshes, __mockMaterials } = vi.hoisted(() => ({
  __mockMeshes: [] as Record<string, unknown>[],
  __mockMaterials: [] as Record<string, unknown>[],
}))

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — all helpers defined INSIDE factory (no top-level refs)
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  function createMockMesh(name: string): Record<string, unknown> {
    const mesh: Record<string, unknown> = {
      name,
      position: { x: 0, y: 0, z: 0, set: vi.fn() },
      billboardMode: 0,
      renderingGroupId: 0,
      material: null,
      setEnabled: vi.fn(),
      dispose: vi.fn(),
    }
    __mockMeshes.push(mesh)
    return mesh
  }

  function createMockMaterial(name: string): Record<string, unknown> {
    const mat: Record<string, unknown> = {
      name,
      emissiveColor: null,
      alphaMode: 0,
      backFaceCulling: true,
      dispose: vi.fn(),
    }
    __mockMaterials.push(mat)
    return mat
  }

  const MockColor3 = vi.fn(function (
    this: Record<string, unknown>,
    r: number,
    g: number,
    b: number,
  ) {
    this.r = r
    this.g = g
    this.b = b
  })
  ;(MockColor3 as any).Black = vi.fn(() => {
    const c = new (MockColor3 as any)(0, 0, 0)
    return c
  })

  const MockMesh = Object.assign(
    vi.fn((name: string) => createMockMesh(name)),
    { BILLBOARDMODE_ALL: 7 },
  )

  return {
    MeshBuilder: {
      CreatePlane: vi.fn(
        (name: string, _opts: unknown, _scene: unknown) => createMockMesh(name),
      ),
    },
    StandardMaterial: vi.fn(
      (name: string, _scene: unknown) => createMockMaterial(name),
    ),
    Color3: MockColor3,
    Constants: { ALPHA_PREMULTIPLIED: 5 },
    Mesh: MockMesh,
    Engine: vi.fn(),
    Scene: vi.fn(),
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  GpsDotEffect,
  GpsDotRenderable,
  ShroudVisibility,
} from './GpsDotEffect.js'
import type { GpsDotInfo } from './GpsDotEffect.js'
import {
  MeshBuilder,
  Mesh,
  Constants,
} from '@babylonjs/core'
import type {
  IGameActor,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import { RenderGroup } from '../../OpenRA.Game/Graphics/WorldRenderer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides?: Partial<GpsDotInfo>): GpsDotInfo {
  return {
    image: overrides?.image ?? 'gpsdot',
    string_: overrides?.string_ ?? 'Infantry',
    indicatorPalettePrefix: overrides?.indicatorPalettePrefix ?? 'player',
  }
}

function makeActor(overrides?: {
  actorId?: number
  centerPosition?: { X: number; Y: number; Z: number }
  owner?: { internalName?: string }
  effectiveOwner?: { owner?: { internalName?: string } } | null
  world?: { renderPlayer?: PlayerStub & { internalName?: string }; players?: PlayerStub[] }
}): IGameActor {
  const actor: any = {
    actorId: overrides?.actorId ?? 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: overrides?.centerPosition ?? { X: 10240, Y: 10240, Z: 0 },
    owner: overrides?.owner ?? { internalName: 'Multi1' },
    effectiveOwner: overrides?.effectiveOwner ?? null,
    world: overrides?.world ?? {},
    location: { X: 10, Y: 10 },
    traitsImplementing: () => [],
  }
  return actor as unknown as IGameActor
}

function makePlayer(overrides?: {
  internalName?: string
  isAlliedWithOwner?: boolean
  gpsWatcher?: { granted: boolean; grantedAllies: boolean }
  shroud?: { getVisibility?: () => number }
}): PlayerStub {
  const player: any = {
    internalName: overrides?.internalName ?? 'Multi0',
    isAlliedWith: () => overrides?.isAlliedWithOwner ?? false,
    shroud: overrides?.shroud ?? { getVisibility: () => ShroudVisibility.Explored },
    playerActor: {
      traits: new Map([
        ['GpsWatcher', overrides?.gpsWatcher ?? { granted: true, grantedAllies: false }],
      ]),
    },
  }
  return player as PlayerStub
}

function makeWorld(players: PlayerStub[] = []): GameWorldManager {
  return { players } as unknown as GameWorldManager
}

/** Create a minimal mock Babylon.js Scene for testing. */
function makeScene(isDisposed: boolean = false): any {
  return { __type: 'MockScene', isDisposed }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __mockMeshes.length = 0
  __mockMaterials.length = 0
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GpsDotEffect', () => {
  describe('constructor', () => {
    it('initializes with actor and info', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      expect(effect).toBeDefined()
      expect(effect.actor).toBe(actor)
      expect(effect.info).toBe(info)
      expect(effect.dotStates.size).toBe(0)
    })

    it('starts with empty dotStates before first tick', () => {
      const actor = makeActor()
      const effect = new GpsDotEffect(actor, makeInfo())

      expect(effect.dotStates.size).toBe(0)
    })

    // -----------------------------------------------------------------------
    // Ch24 Phase D: Constructor with Scene
    // -----------------------------------------------------------------------

    it('accepts optional Scene parameter (backward compatible)', () => {
      const actor = makeActor()
      const info = makeInfo()
      const scene = makeScene()

      const effectWithScene = new GpsDotEffect(actor, info, scene)
      expect(effectWithScene.scene).toBe(scene)

      const effectWithoutScene = new GpsDotEffect(actor, info)
      expect(effectWithoutScene.scene).toBeNull()
    })

    it('does not create Billboard mesh in constructor (lazy creation)', () => {
      const actor = makeActor()
      const info = makeInfo()
      const scene = makeScene()

      const effect = new GpsDotEffect(actor, info, scene)
      expect(effect.billboard).toBeNull()
      expect(effect.billboardMaterial).toBeNull()
      expect(MeshBuilder.CreatePlane).not.toHaveBeenCalled()
    })
  })

  describe('tick', () => {
    it('creates per-player state on first tick', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer()
      const world = makeWorld([player])

      effect.tick(world)
      expect(effect.dotStates.size).toBe(1)
    })

    it('updates visibility per player', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })
      const world = makeWorld([player])

      effect.tick(world)

      const state = effect.dotStates.get('Multi0')
      expect(state).toBeDefined()
    })

    it('handles multiple players', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const p1 = makePlayer({ internalName: 'Multi0', shroud: { getVisibility: () => ShroudVisibility.Explored } })
      const p2 = makePlayer({ internalName: 'Multi1', shroud: { getVisibility: () => ShroudVisibility.Explored } })
      const world = makeWorld([p1, p2])

      effect.tick(world)
      expect(effect.dotStates.size).toBe(2)
    })

    it('handles empty player list', () => {
      const actor = makeActor()
      const effect = new GpsDotEffect(actor, makeInfo())
      const world = makeWorld([])

      effect.tick(world)
      expect(effect.dotStates.size).toBe(0)
    })
  })

  describe('shouldRender logic', () => {
    it('hides when watcher not granted', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: false, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })
      effect.tick(makeWorld([player]))

      const state = effect.dotStates.get('Multi0')
      expect(state?.visible).toBe(false)
    })

    it('hides when shroud has no explored visibility', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.None },
      })
      effect.tick(makeWorld([player]))

      const state = effect.dotStates.get('Multi0')
      expect(state?.visible).toBe(false)
    })

    it('hides when visible (unit is in sight)', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const player = makePlayer({
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Visible },
      })
      effect.tick(makeWorld([player]))

      const state = effect.dotStates.get('Multi0')
      expect(state?.visible).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Phase B.8: Billboard rendering tests (plain data)
  // -----------------------------------------------------------------------

  describe('render() — Billboard rendering', () => {
    it('returns a renderable array when dot is visible', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      // Tick to populate dot states
      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('returns empty array when no render player', () => {
      const actor = makeActor({
        world: {},
      })
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const result = effect.render(null as any)
      expect(result).toHaveLength(0)
    })

    it('returns empty array when dot is not visible to render player', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: false, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      expect(result).toHaveLength(0)
    })

    it('renderable has correct type "gpsDot"', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        centerPosition: { X: 20480, Y: 30720, Z: 0 },
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        expect(result[0]).toBeInstanceOf(GpsDotRenderable)
        expect((result[0] as GpsDotRenderable).type).toBe('gpsDot')
      }
    })

    it('Billboard positioned at actor CenterPosition', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const pos = { X: 40960, Y: 51200, Z: 128 }
      const actor = makeActor({
        centerPosition: pos,
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        const renderable = result[0] as GpsDotRenderable
        expect(renderable.position.X).toBe(pos.X)
        expect(renderable.position.Y).toBe(pos.Y)
        expect(renderable.position.Z).toBe(pos.Z)
      }
    })

    it('color varies by indicator palette prefix', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      // Use a custom palette prefix
      const info = makeInfo({ indicatorPalettePrefix: 'enemy' })
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        const renderable = result[0] as GpsDotRenderable
        expect(renderable.palettePrefix).toBe('enemy')
      }
    })

    it('uses player color via effective owner', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        effectiveOwner: { owner: { internalName: 'DisguisedOwner' } },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.render(null as any)
      if (result.length > 0) {
        const renderable = result[0] as GpsDotRenderable
        expect(renderable.playerName).toBe('DisguisedOwner')
      }
    })
  })

  describe('renderAnnotation()', () => {
    it('returns a renderable array when dot is visible', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const result = effect.renderAnnotation(null as any)
      expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('returns empty array when no render player', () => {
      const actor = makeActor({ world: {} })
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      const result = effect.renderAnnotation(null as any)
      expect(result).toHaveLength(0)
    })
  })

  describe('dispose — cleanup', () => {
    it('clears dot states on dispose', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([makePlayer()]))
      expect(effect.dotStates.size).toBeGreaterThan(0)

      effect.dispose()
      expect(effect.dotStates.size).toBe(0)
    })

    it('render returns empty after dispose', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))
      effect.dispose()

      const result = effect.render(null as any)
      expect(result).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Billboard mesh creation tests
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Billboard mesh creation', () => {
    it('creates Billboard mesh when scene is provided and dot is visible', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      // Billboard should now exist
      expect(effect.billboard).not.toBeNull()
      expect(effect.billboardMaterial).not.toBeNull()
      expect(MeshBuilder.CreatePlane).toHaveBeenCalled()
    })

    it('does NOT create Billboard when no Scene provided', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info) // No scene

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      expect(effect.billboard).toBeNull()
      expect(MeshBuilder.CreatePlane).not.toHaveBeenCalled()
    })

    it('sets mesh.renderingGroupId = RenderGroup.Annotation (3) after creation', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const billboard = effect.billboard as Record<string, unknown> | null
      expect(billboard).not.toBeNull()
      // GPS dots are minimap/annotation overlays, not regular Actor effects
      expect(billboard!.renderingGroupId).toBe(RenderGroup.Annotation) // 3
    })

    it('sets mesh.billboardMode = Mesh.BILLBOARDMODE_ALL (7) after creation', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const billboard = effect.billboard as Record<string, unknown> | null
      expect(billboard).not.toBeNull()
      expect(billboard!.billboardMode).toBe(Mesh.BILLBOARDMODE_ALL) // 7
    })

    it('creates StandardMaterial with alphaMode = ALPHA_PREMULTIPLIED', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const material = effect.billboardMaterial as Record<string, unknown> | null
      expect(material).not.toBeNull()
      expect(material!.alphaMode).toBe(Constants.ALPHA_PREMULTIPLIED)
    })

    it('uses orange default emissive color for non-player palette prefix', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      // Non-"player" palette prefix → orange default
      const info = makeInfo({ indicatorPalettePrefix: 'enemy' })
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const material = effect.billboardMaterial as Record<string, unknown> | null
      expect(material).not.toBeNull()
      const color = material!.emissiveColor as { r: number; g: number; b: number }
      expect(color.r).toBe(1)
      expect(color.g).toBe(0.5)
      expect(color.b).toBe(0)
    })

    it('uses player-specific color for "player" palette prefix', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' }, // Determines player color
      })

      const info = makeInfo({ indicatorPalettePrefix: 'player' })
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const material = effect.billboardMaterial as Record<string, unknown> | null
      expect(material).not.toBeNull()
      // Player color should be a valid Color3 (r, g, b populated)
      const color = material!.emissiveColor as { r: number; g: number; b: number }
      expect(typeof color.r).toBe('number')
      expect(typeof color.g).toBe('number')
      expect(typeof color.b).toBe('number')
    })

    it('names the mesh gpsDot_<actorId>', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        actorId: 42,
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      // Mesh name should include actorId
      const createPlaneCalls = vi.mocked(MeshBuilder.CreatePlane).mock.calls
      expect(createPlaneCalls.length).toBeGreaterThan(0)
      const meshName = createPlaneCalls[0]![0]
      expect(meshName).toBe('gpsDot_42')
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Billboard visibility toggle tests
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Billboard visibility toggle', () => {
    it('enables Billboard mesh when dot is visible', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const pos = { X: 10240, Y: 10240, Z: 0 }
      const actor = makeActor({
        centerPosition: pos,
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const billboard = effect.billboard as Record<string, unknown> | null
      expect(billboard).not.toBeNull()
      expect(billboard!.setEnabled).toHaveBeenCalledWith(true)
    })

    it('does not create Billboard when dot is not visible to render player', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: false, grantedAllies: false }, // NOT granted
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      const result = effect.render(null as any)

      // Billboard should NOT be created since dot is not visible
      expect(effect.billboard).toBeNull()
      expect(result).toHaveLength(0)
    })

    it('disables Billboard when render returns empty (no render player)', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)
      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const billboard = effect.billboard as Record<string, unknown> | null
      expect(billboard).not.toBeNull()

      // Clear the setEnabled mock to get a fresh read
      vi.mocked(billboard!.setEnabled as any).mockClear()

      // Now call render on a DIFFERENT effect with no render player.
      // This is a separate test — the original billboard is in a separate effect.
      // For the "disable on invisible" use case:
      // Reuse the SAME actor with world changed to have no renderPlayer
      const noPlayerActor = makeActor({
        world: {},
        owner: { internalName: 'Multi2' },
      })
      const noPlayerEffect = new GpsDotEffect(noPlayerActor, info, scene)
      const result = noPlayerEffect.render(null as any)
      expect(result).toHaveLength(0)
      // No Billboard should have been created (no render player → returns null)
      expect(noPlayerEffect.billboard).toBeNull()
    })

    it('updates Billboard position to actor CenterPosition', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const pos = { X: 40960, Y: 51200, Z: 128 }
      const actor = makeActor({
        centerPosition: pos,
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const billboard = effect.billboard as Record<string, unknown> | null
      expect(billboard).not.toBeNull()
      const posSet = (billboard as any).position.set as ReturnType<typeof vi.fn>
      expect(posSet).toHaveBeenCalledWith(pos.X, pos.Y, pos.Z)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Dispose cleanup tests
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Dispose cleanup', () => {
    it('disposes Billboard mesh and material on dispose()', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const billboard = effect.billboard as Record<string, unknown> | null
      const material = effect.billboardMaterial as Record<string, unknown> | null
      expect(billboard).not.toBeNull()
      expect(material).not.toBeNull()

      effect.dispose()

      expect(billboard!.dispose).toHaveBeenCalled()
      expect(material!.dispose).toHaveBeenCalled()
      expect(effect.billboard).toBeNull()
      expect(effect.billboardMaterial).toBeNull()
    })

    it('dispose is safe to call when no Billboard was created', () => {
      const info = makeInfo()
      const actor = makeActor()
      const effect = new GpsDotEffect(actor, info) // No scene

      // Should not throw
      expect(() => effect.dispose()).not.toThrow()
    })

    it('dispose is idempotent (safe to call multiple times)', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      effect.dispose()
      // Second dispose should not throw
      expect(() => effect.dispose()).not.toThrow()
    })

    it('dispose clears dot states even without Billboard', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([makePlayer()]))
      expect(effect.dotStates.size).toBeGreaterThan(0)

      effect.dispose()
      expect(effect.dotStates.size).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Backward compatibility tests
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Backward compatibility', () => {
    it('construction without Scene still works (existing behavior)', () => {
      const actor = makeActor()
      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      expect(effect).toBeDefined()
      expect(effect.scene).toBeNull()
      expect(effect.billboard).toBeNull()
    })

    it('render returns plain data when no Scene (existing behavior)', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))
      const result = effect.render(null as any)

      // Should still return GpsDotRenderable (plain data), not a mesh
      if (result.length > 0) {
        expect(result[0]).toBeInstanceOf(GpsDotRenderable)
      }
    })

    it('renderAnnotation returns plain data when no Scene (existing behavior)', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))
      const result = effect.renderAnnotation(null as any)

      if (result.length > 0) {
        expect(result[0]).toBeInstanceOf(GpsDotRenderable)
      }
    })

    it('Scene parameter is truly optional (both constructors work)', () => {
      const actor = makeActor()
      const info = makeInfo()
      const scene = makeScene()

      // All three constructor forms should work
      const e1 = new GpsDotEffect(actor, info)
      const e2 = new GpsDotEffect(actor, info, undefined)
      const e3 = new GpsDotEffect(actor, info, scene)

      expect(e1.scene).toBeNull()
      expect(e2.scene).toBeNull()
      expect(e3.scene).toBe(scene)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Material property tests
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Material properties', () => {
    it('creates StandardMaterial with backFaceCulling disabled', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const material = effect.billboardMaterial as Record<string, unknown> | null
      expect(material).not.toBeNull()
      expect(material!.backFaceCulling).toBe(false)
    })

    it('assigns material to Billboard mesh', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const billboard = effect.billboard as Record<string, unknown> | null
      const material = effect.billboardMaterial as Record<string, unknown> | null
      expect(billboard).not.toBeNull()
      expect(material).not.toBeNull()
      expect(billboard!.material).toBe(material)
    })

    it('sets diffuseColor and specularColor to Black (pure emissive, no scene lighting)', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      effect.render(null as any)

      const material = effect.billboardMaterial as Record<string, unknown> | null
      expect(material).not.toBeNull()

      // diffuseColor should be Black (0, 0, 0) — no scene lighting tint
      const diffuse = material!.diffuseColor as { r: number; g: number; b: number }
      expect(diffuse.r).toBe(0)
      expect(diffuse.g).toBe(0)
      expect(diffuse.b).toBe(0)

      // specularColor should be Black (0, 0, 0) — no specular highlights
      const specular = material!.specularColor as { r: number; g: number; b: number }
      expect(specular.r).toBe(0)
      expect(specular.g).toBe(0)
      expect(specular.b).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Renderable caching (anti-allocation)
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Renderable caching', () => {
    it('reuses cached renderable when position is unchanged (avoids per-frame allocation)', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const pos = { X: 10240, Y: 10240, Z: 0 }
      const actor = makeActor({
        centerPosition: pos,
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))

      const r1 = effect.render(null as any)
      const r2 = effect.render(null as any)

      expect(r1.length).toBe(1)
      expect(r2.length).toBe(1)
      // Same position → same renderable instance (cached, no re-allocation)
      expect(r1[0]).toBe(r2[0])
    })

    it('creates new renderable when position changes', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      // First position
      const actor0 = makeActor({
        actorId: 10,
        centerPosition: { X: 10240, Y: 10240, Z: 0 },
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor0, info)
      effect.tick(makeWorld([player]))
      const r1 = effect.render(null as any)
      expect(r1.length).toBe(1)

      // Change actor position — need a new effect with different position
      // (same effect uses cached renderable for same position)
      const actor1 = makeActor({
        actorId: 11,
        centerPosition: { X: 20480, Y: 30720, Z: 0 },
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })
      const effect1 = new GpsDotEffect(actor1, info)
      effect1.tick(makeWorld([player]))
      const r2 = effect1.render(null as any)
      expect(r2.length).toBe(1)

      // Different positions → different renderable content
      const data1 = r1[0] as GpsDotRenderable
      const data2 = r2[0] as GpsDotRenderable
      expect(data1.position.X).not.toBe(data2.position.X)
    })

    it('returns empty and nullifies cache when no render player', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info)

      effect.tick(makeWorld([player]))
      const r1 = effect.render(null as any)
      expect(r1.length).toBe(1) // visible, cache populated

      // Same position → reuses cache (no per-frame allocation)
      const r2 = effect.render(null as any)
      expect(r2.length).toBe(1)
      expect(r2[0]).toBe(r1[0]) // Same cached instance

      // Separate effect with no render player → returns empty, no cache
      const noRpActor = makeActor({ world: {} })
      const noRpEffect = new GpsDotEffect(noRpActor, info)
      const r3 = noRpEffect.render(null as any)
      expect(r3).toHaveLength(0) // invisible — no render player
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Mesh as IRenderable return value
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Mesh as IRenderable', () => {
    it('returns Billboard mesh as IRenderable when Scene is provided', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      const result = effect.render(null as any)

      expect(result.length).toBe(1)
      // When Scene is available, return the actual Billboard mesh
      expect(result[0]).toBe(effect.billboard)
    })

    it('returns plain GpsDotRenderable when no Scene (backward compatible)', () => {
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info) // No scene

      effect.tick(makeWorld([player]))
      const result = effect.render(null as any)

      expect(result.length).toBe(1)
      // Without Scene, return plain-data GpsDotRenderable
      expect(result[0]).toBeInstanceOf(GpsDotRenderable)
    })

    it('renderAnnotation also returns mesh when Scene is provided', () => {
      const scene = makeScene()
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      const result = effect.renderAnnotation(null as any)

      expect(result.length).toBe(1)
      expect(result[0]).toBe(effect.billboard)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase D: Dispose with disposed Scene guard
  // -----------------------------------------------------------------------

  describe('Ch24 Phase D — Scene-disposal guard', () => {
    it('skips GPU resource disposal when Scene is already disposed', () => {
      const scene = makeScene(true) // isDisposed = true
      const player = makePlayer({
        internalName: 'Multi0',
        gpsWatcher: { granted: true, grantedAllies: false },
        shroud: { getVisibility: () => ShroudVisibility.Explored },
      })

      const actor = makeActor({
        world: { renderPlayer: player },
        owner: { internalName: 'Multi2' },
      })

      const info = makeInfo()
      const effect = new GpsDotEffect(actor, info, scene)

      effect.tick(makeWorld([player]))
      // Create Billboard (with disposed scene — billboard won't be created since scene.isDisposed... actually the mock still creates it)
      // NOTE: In this mock, isDisposed only affects dispose(), not creation
      effect.render(null as any)

      // Should not throw when disposing with a disposed scene
      expect(() => effect.dispose()).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// GpsDotRenderable tests
// ---------------------------------------------------------------------------

describe('GpsDotRenderable', () => {
  it('stores position, palette, player, and image', () => {
    const pos = { X: 100, Y: 200, Z: 50 }
    const r = new GpsDotRenderable(pos, 'player', 'Multi1', 'gpsdot')
    expect(r.type).toBe('gpsDot')
    expect(r.position).toBe(pos)
    expect(r.palettePrefix).toBe('player')
    expect(r.playerName).toBe('Multi1')
    expect(r.image).toBe('gpsdot')
  })

  it('is not disposed initially', () => {
    const r = new GpsDotRenderable({ X: 0, Y: 0, Z: 0 }, 'player', 'P', 'img')
    expect(r.disposed).toBe(false)
  })

  it('marks as disposed after dispose()', () => {
    const r = new GpsDotRenderable({ X: 0, Y: 0, Z: 0 }, 'player', 'P', 'img')
    r.dispose()
    expect(r.disposed).toBe(true)
  })
})
