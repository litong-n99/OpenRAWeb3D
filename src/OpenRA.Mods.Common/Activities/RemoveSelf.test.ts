/**
 * RemoveSelf.test.ts — RemoveSelf 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoveSelf } from './RemoveSelf.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

describe('RemoveSelf', () => {
  let disposeSpy: ReturnType<typeof vi.fn>
  let actor: GameActor

  beforeEach(() => {
    vi.clearAllMocks()
    disposeSpy = vi.fn()
    actor = {
      actorId: 1,
      isDead: false,
      isInWorld: true,
      disposed: false,
      dispose: disposeSpy,
    } as unknown as GameActor
  })

  it('calls dispose on the actor', () => {
    const activity = new RemoveSelf()
    activity.tick(actor)
    expect(disposeSpy).toHaveBeenCalled()
  })

  it('returns true', () => {
    const activity = new RemoveSelf()
    expect(activity.tick(actor)).toBe(true)
  })

  it('returns true early when cancelling', () => {
    const activity = new RemoveSelf()
    activity.cancel(actor)
    expect(activity.tick(actor)).toBe(true)
    expect(disposeSpy).not.toHaveBeenCalled()
  })
})
