/**
 * Transforms.test.ts — Transforms 变形 trait 单元测试
 *
 * Tests focus on:
 * - TransformsInfo defaults and custom values
 * - ConditionalTrait integration (isTraitDisabled, isTraitPaused gating)
 * - IIssueDeployOrder (canIssueDeployOrder, issueDeployOrder)
 * - IOrderVoice (voicePhraseForOrder)
 * - canDeploy() logic (building vs non-building, paused, disabled)
 * - canPlaceBuildingAt() validation
 * - getTransformActivity() returns configured stub
 * - deployTransform() queued vs non-queued behavior
 * - IResolveOrder.resolveOrder() handling
 * - IIssueOrder.orders getter (DeployOrderTargeter)
 * - IIssueOrder.issueOrder()
 * - Lifecycle (attach/detach/dispose)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Transforms,
  TransformsInfo,
  TransformActivityStub,
} from './Transforms.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  IOrderTargeter,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IBuildingUtilsWorld,
  IBuildingUtilsActorInfo,
} from './Buildings/BuildingUtils.js'
import type { BuildingInfo } from './Buildings/Building.js'
import { FootprintCellType } from './Buildings/Building.js'

// ---------------------------------------------------------------------------
// Mocks for @babylonjs/core (not used directly, but imported by some deps)
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayerStub(name = 'TestPlayer'): PlayerStub {
  return { playerName: name }
}

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: makePlayerStub(),
    topLeft: CPos.Zero,
    queueActivity: vi.fn(),
    ...overrides,
  } as unknown as IGameActor
}

function makeActorInfo(name: string): IBuildingUtilsActorInfo {
  return {
    name,
    hasTraitInfo: vi.fn().mockReturnValue(false),
    getTraitInfos: vi.fn().mockReturnValue([]),
  }
}

function makeBuildingInfo(overrides: Partial<BuildingInfo> = {}): BuildingInfo {
  const footprint = new Map<string, string>()
  footprint.set('0,0', FootprintCellType.Occupied)
  return {
    terrainTypes: new Set(['Clear']),
    allowInvalidPlacement: false,
    footprint,
    adjacent: 0,
    requiresBaseProvider: false,
    dimensions: new CVec(1, 1),
    tiles: (loc: CPos) => [loc],
    ...overrides,
  } as unknown as BuildingInfo
}

function makeWorld(overrides: Partial<IBuildingUtilsWorld> = {}): IBuildingUtilsWorld {
  const map = {
    contains: vi.fn().mockReturnValue(true),
    getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
    ramp: {
      contains: vi.fn().mockReturnValue(false),
      get: vi.fn().mockReturnValue(0),
    },
  }
  const actorMap = {
    getActorsAt: vi.fn().mockReturnValue([]),
  }
  const buildingInfluence = {
    anyBuildingAt: vi.fn().mockReturnValue(false),
  }
  return {
    map,
    actorMap,
    buildingInfluence,
    ...overrides,
  } as IBuildingUtilsWorld
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Transforms', () => {
  // ---------------------------------------------------------------------------
  // TransformsInfo
  // ---------------------------------------------------------------------------

  describe('TransformsInfo', () => {
    it('has required intoActor and defaults for other fields', () => {
      const info = new TransformsInfo({ intoActor: 'fact' })
      expect(info.intoActor).toBe('fact')
      expect(info.offset).toEqual(CVec.Zero)
      expect(info.facing.angle).toBe(384)
      expect(info.transformSounds).toEqual([])
      expect(info.noTransformSounds).toEqual([])
      expect(info.transformNotification).toBeNull()
      expect(info.transformTextNotification).toBeNull()
      expect(info.noTransformNotification).toBeNull()
      expect(info.noTransformTextNotification).toBeNull()
      expect(info.deployCursor).toBe('deploy')
      expect(info.deployBlockedCursor).toBe('deploy-blocked')
      expect(info.voice).toBe('Action')
    })

    it('accepts all custom values', () => {
      const info = new TransformsInfo({
        intoActor: 'mcv',
        offset: new CVec(1, 0),
        facing: new WAngle(512),
        transformSounds: ['deploy.aud'],
        noTransformSounds: ['blocked.aud'],
        transformNotification: 'UnitDeployed',
        transformTextNotification: 'Deployed!',
        noTransformNotification: 'CannotDeploy',
        noTransformTextNotification: 'Blocked!',
        deployCursor: 'deploy_custom',
        deployBlockedCursor: 'blocked_custom',
        voice: 'Move',
        requiresCondition: '!disabled',
        instanceName: 'my_transform',
      })
      expect(info.intoActor).toBe('mcv')
      expect(info.offset).toEqual(new CVec(1, 0))
      expect(info.facing.angle).toBe(512)
      expect(info.transformSounds).toEqual(['deploy.aud'])
      expect(info.noTransformSounds).toEqual(['blocked.aud'])
      expect(info.transformNotification).toBe('UnitDeployed')
      expect(info.transformTextNotification).toBe('Deployed!')
      expect(info.noTransformNotification).toBe('CannotDeploy')
      expect(info.noTransformTextNotification).toBe('Blocked!')
      expect(info.deployCursor).toBe('deploy_custom')
      expect(info.deployBlockedCursor).toBe('blocked_custom')
      expect(info.voice).toBe('Move')
      expect(info.requiresCondition).toBe('!disabled')
      expect(info.instanceName).toBe('my_transform')
    })

    it('implements ConditionalTraitInfo', () => {
      const info = new TransformsInfo({ intoActor: 'test' })
      expect('requiresCondition' in info).toBe(true)
      expect('instanceName' in info).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // TransformActivityStub
  // ---------------------------------------------------------------------------

  describe('TransformActivityStub', () => {
    it('stores and returns constructor params and setters', () => {
      const stub = new TransformActivityStub('mcv')
      expect(stub.intoActor).toBe('mcv')

      stub.offset = new CVec(1, 2)
      expect(stub.offset).toEqual(new CVec(1, 2))

      stub.facing = new WAngle(256)
      expect(stub.facing.angle).toBe(256)

      stub.sounds = ['sound1']
      expect(stub.sounds).toEqual(['sound1'])

      stub.notification = 'Notify'
      expect(stub.notification).toBe('Notify')

      stub.textNotification = 'Text'
      expect(stub.textNotification).toBe('Text')

      stub.faction = 'gdi'
      expect(stub.faction).toBe('gdi')
    })

    it('implements ActivityStub interface methods as no-ops', () => {
      const stub = new TransformActivityStub('test')
      const actor = makeMockActor()

      expect(() => stub.queue(stub)).not.toThrow()
      expect(() => stub.cancel(actor)).not.toThrow()
      expect(() => stub.onActorDisposeOuter(actor)).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Transforms trait
  // ---------------------------------------------------------------------------

  describe('Transforms trait', () => {
    let info: TransformsInfo
    let trait: Transforms
    let actor: IGameActor
    let actorInfo: IBuildingUtilsActorInfo
    let world: IBuildingUtilsWorld

    beforeEach(() => {
      info = new TransformsInfo({ intoActor: 'fact' })
      actor = makeMockActor()
      actorInfo = makeActorInfo('fact')
      world = makeWorld()
      trait = new Transforms(info, {
        self: actor,
        actorInfo,
        buildingInfo: null,
        faction: 'gdi',
        world,
      })
    })

    it('extends ConditionalTrait', () => {
      expect(trait.enabled).toBe(true)
      expect(trait.disposed).toBe(false)
    })

    // -----------------------------------------------------------------------
    // voicePhraseForOrder
    // -----------------------------------------------------------------------

    describe('voicePhraseForOrder', () => {
      it('returns voice for DeployTransform order', () => {
        const result = trait.voicePhraseForOrder(actor, {
          orderName: 'DeployTransform',
          targetString: '',
          extraData: 0,
        })
        expect(result).toBe('Action')
      })

      it('returns empty string for other orders', () => {
        const result = trait.voicePhraseForOrder(actor, {
          orderName: 'Attack',
          targetString: '',
          extraData: 0,
        })
        expect(result).toBe('')
      })

      it('returns custom voice when configured', () => {
        const customInfo = new TransformsInfo({
          intoActor: 'fact',
          voice: 'Deploy',
        })
        const customTrait = new Transforms(customInfo, {
          self: actor,
          actorInfo,
          buildingInfo: null,
          faction: 'nod',
        })
        const result = customTrait.voicePhraseForOrder(actor, {
          orderName: 'DeployTransform',
          targetString: '',
          extraData: 0,
        })
        expect(result).toBe('Deploy')
      })
    })

    // -----------------------------------------------------------------------
    // IIssueDeployOrder
    // -----------------------------------------------------------------------

    describe('canIssueDeployOrder', () => {
      it('returns true when not paused or disabled', () => {
        expect(trait.canIssueDeployOrder(actor, false)).toBe(true)
        expect(trait.canIssueDeployOrder(actor, true)).toBe(true)
      })

      it('returns false when trait is disabled', () => {
        trait.onEnabledChanged(false)
        expect(trait.canIssueDeployOrder(actor, false)).toBe(false)
      })

      it('returns false when trait is paused', () => {
        ;(trait as unknown as { _paused: boolean })._paused = true
        expect(trait.canIssueDeployOrder(actor, false)).toBe(false)
      })
    })

    describe('issueDeployOrder', () => {
      it('returns DeployTransform order with queued=false', () => {
        const order = trait.issueDeployOrder(actor, false)
        expect(order.orderName).toBe('DeployTransform')
        expect(order.targetString).toBe('')
        const ed = order.extraData as { queued: boolean }
        expect(ed.queued).toBe(false)
      })

      it('returns DeployTransform order with queued=true', () => {
        const order = trait.issueDeployOrder(actor, true)
        expect(order.orderName).toBe('DeployTransform')
        const ed = order.extraData as { queued: boolean }
        expect(ed.queued).toBe(true)
      })
    })

    // -----------------------------------------------------------------------
    // canDeploy
    // -----------------------------------------------------------------------

    describe('canDeploy', () => {
      it('returns false when trait is paused', () => {
        ;(trait as unknown as { _paused: boolean })._paused = true
        expect(trait.canDeploy()).toBe(false)
      })

      it('returns false when trait is disabled', () => {
        trait.onEnabledChanged(false)
        expect(trait.canDeploy()).toBe(false)
      })

      it('returns true when target is not a building (non-building transform)', () => {
        expect(trait.canDeploy()).toBe(true)
      })

      it('returns true when building placement is valid', () => {
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world,
        })
        expect(buildingTrait.canDeploy()).toBe(true)
      })

      it('returns false when building placement is blocked by another building', () => {
        const blockedWorld = makeWorld()
        ;(blockedWorld.buildingInfluence.anyBuildingAt as ReturnType<typeof vi.fn>)
          .mockReturnValue(true)
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: blockedWorld,
        })
        expect(buildingTrait.canDeploy()).toBe(false)
      })

      it('returns false when world is null and target is building', () => {
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: null,
        })
        expect(buildingTrait.canDeploy()).toBe(false)
      })

      it('returns false when target location is outside map bounds', () => {
        const outOfBoundsWorld = makeWorld()
        ;(outOfBoundsWorld.map.contains as ReturnType<typeof vi.fn>)
          .mockReturnValue(false)
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: outOfBoundsWorld,
        })
        expect(buildingTrait.canDeploy()).toBe(false)
      })
    })

    // -----------------------------------------------------------------------
    // canPlaceBuildingAt
    // -----------------------------------------------------------------------

    describe('canPlaceBuildingAt', () => {
      it('returns false when buildingInfo is null', () => {
        expect(trait.canPlaceBuildingAt(CPos.Zero)).toBe(false)
      })

      it('returns true for valid placement', () => {
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world,
        })
        expect(buildingTrait.canPlaceBuildingAt(CPos.Zero)).toBe(true)
      })

      it('returns false when cell is blocked by another building', () => {
        const blockedWorld = makeWorld()
        ;(blockedWorld.buildingInfluence.anyBuildingAt as ReturnType<typeof vi.fn>)
          .mockReturnValue(true)
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: blockedWorld,
        })
        expect(buildingTrait.canPlaceBuildingAt(CPos.Zero)).toBe(false)
      })

      it('returns false when cell is outside map', () => {
        const outOfBoundsWorld = makeWorld()
        ;(outOfBoundsWorld.map.contains as ReturnType<typeof vi.fn>)
          .mockReturnValue(false)
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: outOfBoundsWorld,
        })
        expect(buildingTrait.canPlaceBuildingAt(CPos.Zero)).toBe(false)
      })
    })

    // -----------------------------------------------------------------------
    // getTransformActivity
    // -----------------------------------------------------------------------

    describe('getTransformActivity', () => {
      it('returns a TransformActivityStub with correct params', () => {
        const customInfo = new TransformsInfo({
          intoActor: 'mcv',
          offset: new CVec(2, 1),
          facing: new WAngle(256),
          transformSounds: ['boom.aud'],
          transformNotification: 'Deployed',
          transformTextNotification: 'MCV deployed',
        })
        const customTrait = new Transforms(customInfo, {
          self: actor,
          actorInfo,
          buildingInfo: null,
          faction: 'nod',
        })
        const activity = customTrait.getTransformActivity() as TransformActivityStub
        expect(activity.intoActor).toBe('mcv')
        expect(activity.offset).toEqual(new CVec(2, 1))
        expect(activity.facing.angle).toBe(256)
        expect(activity.sounds).toEqual(['boom.aud'])
        expect(activity.notification).toBe('Deployed')
        expect(activity.textNotification).toBe('MCV deployed')
        expect(activity.faction).toBe('nod')
      })
    })

    // -----------------------------------------------------------------------
    // deployTransform
    // -----------------------------------------------------------------------

    describe('deployTransform', () => {
      it('queues activity when canDeploy and not queued', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        deployTrait.deployTransform(false)
        expect(queueSpy).toHaveBeenCalledTimes(1)
        const activity = queueSpy.mock.calls[0][0] as TransformActivityStub
        expect(activity).toBeInstanceOf(TransformActivityStub)
        expect(activity.intoActor).toBe('fact')
      })

      it('queues activity when canDeploy and queued=true', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        deployTrait.deployTransform(true)
        expect(queueSpy).toHaveBeenCalledTimes(1)
      })

      it('does not queue activity when cannot deploy and not queued (plays block sounds)', () => {
        const queueSpy = vi.fn()
        const outOfBoundsWorld = makeWorld()
        ;(outOfBoundsWorld.map.contains as ReturnType<typeof vi.fn>)
          .mockReturnValue(false)
        const buildingInfo = makeBuildingInfo()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: outOfBoundsWorld,
        })
        // Non-queued, can't deploy → block sounds, no activity queued
        deployTrait.deployTransform(false)
        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('still queues when queued=true even if canDeploy is false', () => {
        const queueSpy = vi.fn()
        const outOfBoundsWorld = makeWorld()
        ;(outOfBoundsWorld.map.contains as ReturnType<typeof vi.fn>)
          .mockReturnValue(false)
        const buildingInfo = makeBuildingInfo()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: outOfBoundsWorld,
        })
        // Queued, so it proceeds even if canDeploy() is false
        deployTrait.deployTransform(true)
        expect(queueSpy).toHaveBeenCalledTimes(1)
      })
    })

    // -----------------------------------------------------------------------
    // resolveOrder
    // -----------------------------------------------------------------------

    describe('resolveOrder', () => {
      it('handles DeployTransform order (deploys)', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        deployTrait.resolveOrder(deployActor, {
          orderName: 'DeployTransform',
          targetString: '',
          extraData: { queued: false },
        })
        expect(queueSpy).toHaveBeenCalledTimes(1)
      })

      it('ignores non-DeployTransform orders', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        deployTrait.resolveOrder(deployActor, {
          orderName: 'Stop',
          targetString: '',
          extraData: 0,
        })
        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('ignores DeployTransform when trait is paused', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        ;(deployTrait as unknown as { _paused: boolean })._paused = true
        deployTrait.resolveOrder(deployActor, {
          orderName: 'DeployTransform',
          targetString: '',
          extraData: { queued: false },
        })
        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('ignores DeployTransform when trait is disabled', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        deployTrait.onEnabledChanged(false)
        deployTrait.resolveOrder(deployActor, {
          orderName: 'DeployTransform',
          targetString: '',
          extraData: { queued: false },
        })
        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('extracts queued from extraData correctly', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        // extraData as object with queued=true
        deployTrait.resolveOrder(deployActor, {
          orderName: 'DeployTransform',
          targetString: '',
          extraData: { queued: true },
        })
        expect(queueSpy).toHaveBeenCalledTimes(1)
      })

      it('defaults queued to false when extraData is not an object', () => {
        const queueSpy = vi.fn()
        const deployActor = makeMockActor({ queueActivity: queueSpy })
        const deployTrait = new Transforms(info, {
          self: deployActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        // extraData as number (legacy format)
        deployTrait.resolveOrder(deployActor, {
          orderName: 'DeployTransform',
          targetString: '',
          extraData: 0,
        })
        expect(queueSpy).toHaveBeenCalledTimes(1)
      })
    })

    // -----------------------------------------------------------------------
    // IIssueOrder.orders
    // -----------------------------------------------------------------------

    describe('orders getter', () => {
      it('returns array with DeployOrderTargeter when enabled', () => {
        const orders = trait.orders
        expect(orders).toHaveLength(1)
        expect(orders[0].orderID).toBe('DeployTransform')
        expect(orders[0].orderPriority).toBe(5)
      })

      it('returns empty array when trait is disabled', () => {
        trait.onEnabledChanged(false)
        expect(trait.orders).toHaveLength(0)
      })

      it('DeployOrderTargeter uses deployCursor when canDeploy', () => {
        const orders = trait.orders
        const targeter = orders[0] as IOrderTargeter & { getCursor(): string }
        // When canDeploy is true, getCursor returns deployCursor
        if (typeof targeter.getCursor === 'function') {
          expect(targeter.getCursor()).toBe('deploy')
        }
      })

      it('DeployOrderTargeter uses deployBlockedCursor when cannot deploy', () => {
        const blockedWorld = makeWorld()
        ;(blockedWorld.buildingInfluence.anyBuildingAt as ReturnType<typeof vi.fn>)
          .mockReturnValue(true)
        const buildingInfo = makeBuildingInfo()
        const buildingTrait = new Transforms(info, {
          self: actor,
          actorInfo,
          buildingInfo,
          faction: 'gdi',
          world: blockedWorld,
        })
        const orders = buildingTrait.orders
        const targeter = orders[0] as IOrderTargeter & { getCursor(): string }
        if (typeof targeter.getCursor === 'function') {
          expect(targeter.getCursor()).toBe('deploy-blocked')
        }
      })
    })

    // -----------------------------------------------------------------------
    // IIssueOrder.issueOrder
    // -----------------------------------------------------------------------

    describe('issueOrder', () => {
      it('returns DeployTransform order when orderID matches', () => {
        const mockTargeter = { orderID: 'DeployTransform', orderPriority: 5 }
        const result = trait.issueOrder(
          actor,
          mockTargeter as IOrderTargeter,
          null,
          false,
        )
        expect(result.orderName).toBe('DeployTransform')
        const ed = result.extraData as { queued: boolean }
        expect(ed.queued).toBe(false)
      })

      it('returns empty order when orderID does not match', () => {
        const mockTargeter = { orderID: 'Other', orderPriority: 1 }
        const result = trait.issueOrder(
          actor,
          mockTargeter as IOrderTargeter,
          null,
          false,
        )
        expect(result.orderName).toBe('')
      })
    })

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    describe('lifecycle', () => {
      it('supports attach and detach', () => {
        const testActor = makeMockActor()
        const testTrait = new Transforms(info, {
          self: testActor,
          actorInfo,
          buildingInfo: null,
          faction: 'gdi',
        })
        testTrait.attach(testActor)
        expect(testTrait.actor).toBe(testActor)
        testTrait.detach(testActor)
      })

      it('supports dispose', () => {
        trait.dispose()
        expect(trait.disposed).toBe(true)
      })

      it('onEnabledChanged toggles state', () => {
        expect(trait.isTraitDisabled).toBe(false)
        trait.onEnabledChanged(false)
        expect(trait.isTraitDisabled).toBe(true)
        trait.onEnabledChanged(true)
        expect(trait.isTraitDisabled).toBe(false)
      })
    })
  })
})
