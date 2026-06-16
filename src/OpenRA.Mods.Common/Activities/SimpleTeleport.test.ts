/**
 * SimpleTeleport.test.ts — SimpleTeleport 活动单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { SimpleTeleport } from './SimpleTeleport.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { ActivityState } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

function createMockActor(location: CPos = new CPos(3, 3)): {
  actor: GameActor
  setPositionSpy: ReturnType<typeof vi.fn>
} {
  const setPositionSpy = vi.fn()
  const mobile = {
    setPosition: setPositionSpy,
    setCenterPosition: vi.fn(),
  }
  const actor = {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    generation: 5,
    location,
    centerPosition: { X: location.X * 1024, Y: location.Y * 1024, Z: 0 },
    traits: new Map<string, unknown>([['Mobile', mobile]]),
    owner: { playerName: 'Test' },
  } as unknown as GameActor

  return { actor, setPositionSpy }
}

describe('SimpleTeleport', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('constructor', () => {
    it('stores destination cell', () => {
      const dest = new CPos(10, 20)
      const t = new SimpleTeleport(dest)
      expect(t.destination).toEqual(dest)
    })

    it('starts in Queued state', () => {
      const t = new SimpleTeleport(new CPos(0, 0))
      expect(t.state).toBe(ActivityState.Queued)
    })
  })

  describe('tick', () => {
    it('sets position and returns true', () => {
      const { actor, setPositionSpy } = createMockActor()
      const dest = new CPos(10, 20)
      const t = new SimpleTeleport(dest)

      const result = t.tick(actor)

      expect(result).toBe(true)
      expect(setPositionSpy).toHaveBeenCalledWith(actor, dest)
    })

    it('increments generation', () => {
      const { actor } = createMockActor()
      const t = new SimpleTeleport(new CPos(0, 0))
      const genBefore = (actor as unknown as { generation: number }).generation

      t.tick(actor)

      expect((actor as unknown as { generation: number }).generation).toBe(genBefore + 1)
    })
  })

  describe('error handling', () => {
    it('throws if no Mobile trait', () => {
      const actor = {
        actorId: 1,
        isDead: false,
        isInWorld: true,
        traits: new Map<string, unknown>(),
      } as unknown as GameActor
      const t = new SimpleTeleport(new CPos(0, 0))

      expect(() => t.tick(actor)).toThrow('SimpleTeleport requires a')
    })
  })
})
