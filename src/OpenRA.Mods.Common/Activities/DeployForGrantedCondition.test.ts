/**
 * DeployForGrantedCondition.test.ts — DeployForGrantedCondition 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeployForGrantedCondition } from './DeployForGrantedCondition.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import {
  DeployState,
  type GrantConditionOnDeployLike,
} from './UtilityActivityInterfaces.js'

class StubActivity extends Activity { override tick(): boolean { return true } }

function createSelfActor(hasIFacing: boolean = false): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    info: { hasTraitInfo: (name: string) => name === 'IFacing' ? hasIFacing : false },
  } as unknown as GameActor
}

function createDeploy(state: DeployState = DeployState.Undeployed): GrantConditionOnDeployLike {
  return {
    deployState: state,
    info: { facing: new WAngle(512) },
    deploy: vi.fn(),
    undeploy: vi.fn(),
  }
}

describe('DeployForGrantedCondition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    DeployForGrantedCondition._turnFactory = null
  })

  describe('construction', () => {
    it('stores deploy trait', () => {
      const self = createSelfActor()
      const deploy = createDeploy()
      const activity = new DeployForGrantedCondition(self, deploy)
      expect(activity).toBeDefined()
    })
  })

  describe('onFirstRun', () => {
    it('queues Turn when undeployed with facing', () => {
      const self = createSelfActor(true)
      const deploy = createDeploy(DeployState.Undeployed)
      const turnCalls: unknown[] = []
      DeployForGrantedCondition._turnFactory = (a, f) => { turnCalls.push({ a, f }); return new StubActivity() }

      const activity = new DeployForGrantedCondition(self, deploy)
      activity['onFirstRun'](self)
      expect(turnCalls.length).toBe(1)
    })

    it('does not queue Turn when already deployed', () => {
      const self = createSelfActor(true)
      const deploy = createDeploy(DeployState.Deployed)
      DeployForGrantedCondition._turnFactory = () => new StubActivity()

      const activity = new DeployForGrantedCondition(self, deploy)
      activity['onFirstRun'](self)
      // Turn should not be queued because state is Deployed
    })

    it('does not queue Turn when moving', () => {
      const self = createSelfActor(true)
      const deploy = createDeploy(DeployState.Undeployed)
      DeployForGrantedCondition._turnFactory = () => new StubActivity()

      const activity = new DeployForGrantedCondition(self, deploy, true)
      activity['onFirstRun'](self)
      // Turn should not be queued because moving=true
    })
  })

  describe('tick', () => {
    it('returns true when cancelling', () => {
      const self = createSelfActor()
      const deploy = createDeploy()
      const activity = new DeployForGrantedCondition(self, deploy)
      activity.cancel(self)
      expect(activity.tick(self)).toBe(true)
    })

    it('queues DeployInner and returns true', () => {
      const self = createSelfActor()
      const deploy = createDeploy(DeployState.Undeployed)
      const activity = new DeployForGrantedCondition(self, deploy)
      const result = activity.tick(self)
      expect(result).toBe(true)
    })
  })
})
