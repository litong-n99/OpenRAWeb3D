/**
 * Transform.test.ts — Transform 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Transform } from './Transform.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Activity } from '../../OpenRA.Game/Activities/Activity.js'

class StubActivity extends Activity { override tick(): boolean { return true } }

function createSelfActor(overrides: { canDeploy?: boolean; hasIFacing?: boolean; hasAircraft?: boolean } = {}): GameActor {
  const { canDeploy = true, hasIFacing = false, hasAircraft = false } = overrides
  const traits = new Map<string, unknown>()

  const transforms = { canDeploy: vi.fn(() => canDeploy) }
  traits.set('Transforms', transforms)

  const frameEndActions: (() => void)[] = []
  const createdActors: { name: string; init: Map<string, unknown> }[] = []

  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 0,
    dispose: vi.fn(),
    location: { X: 10, Y: 20 },
    owner: { playerName: 'Test' },
    info: { hasTraitInfo: (name: string) => name === 'IFacing' ? hasIFacing : name === 'Aircraft' ? hasAircraft : false },
    traits,
    world: {
      queueFrameEndAction: vi.fn((action: () => void) => { frameEndActions.push(action) }),
      createActor: vi.fn((name: string, init: Map<string, unknown>) => {
        createdActors.push({ name, init })
        return { actorId: 999, isInWorld: true, isDead: false } as GameActor
      }),
    },
    _frameEndActions: frameEndActions,
    _createdActors: createdActors,
  } as unknown as GameActor
}

describe('Transform', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Transform._turnFactory = null
    Transform._landFactory = null
  })

  describe('construction', () => {
    it('stores toActor', () => {
      const t = new Transform('mcv')
      expect(t.toActor).toBe('mcv')
    })

    it('has default offset and facing', () => {
      const t = new Transform('mcv')
      expect(t.offset).toEqual(CVec.Zero)
      expect(t.facing).toEqual(new WAngle(384))
    })
  })

  describe('onFirstRun', () => {
    it('queues Turn when has IFacing', () => {
      const self = createSelfActor({ hasIFacing: true })
      const turnCalls: unknown[] = []
      Transform._turnFactory = (a, f) => { turnCalls.push({ a, f }); return new StubActivity() }

      const t = new Transform('mcv')
      t['onFirstRun'](self)
      expect(turnCalls.length).toBe(1)
    })

    it('queues Land when has Aircraft', () => {
      const self = createSelfActor({ hasAircraft: true })
      const landCalls: unknown[] = []
      Transform._landFactory = (a) => { landCalls.push(a); return new StubActivity() }

      const t = new Transform('mcv')
      t['onFirstRun'](self)
      expect(landCalls.length).toBe(1)
    })
  })

  describe('tick', () => {
    it('returns true when cancelled', () => {
      const self = createSelfActor()
      const t = new Transform('mcv')
      t.cancel(self)
      expect(t.tick(self)).toBe(true)
    })

    it('returns true when cannot deploy', () => {
      const self = createSelfActor({ canDeploy: false })
      const t = new Transform('mcv')
      expect(t.tick(self)).toBe(true)
    })

    it('triggers doTransform when skipMakeAnims', () => {
      const self = createSelfActor({ canDeploy: true })
      const t = new Transform('mcv')
      t.skipMakeAnims = true

      const result = t.tick(self)
      expect(result).toBe(true)
    })
  })
})
