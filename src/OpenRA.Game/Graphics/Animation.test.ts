/**
 * Animation.test.ts — Animation 单元测试
 *
 * 测试: 6 种播放模式、Tick 计时、CurrentFrame 计算、facing/paused 回调。
 * Animation 是纯逻辑类，无 Babylon.js 依赖。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Animation } from './Animation'
import type { ISpriteSequence, ISequenceSet, WAngle } from './Animation'
import type { Sprite } from './Sprite'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSprite(): Sprite {
  return {
    sheet: {} as any,
    bounds: { x: 0, y: 0, width: 32, height: 32 },
    blendMode: 'Alpha',
    channel: 4,
    zRamp: 0,
    size: { x: 32, y: 32, z: 0 },
    offset: { x: 0, y: 0, z: 0 },
    top: 0, left: 0, bottom: 1, right: 1,
  } as Sprite
}

function createMockSequence(
  length = 8,
  tick = 40,
  scale = 1,
): ISpriteSequence {
  const mockSprite = createMockSprite()
  return {
    name: 'idle',
    length,
    tick,
    scale,
    zOffset: 0,
    shadowZOffset: 0,
    ignoreWorldTint: false,
    bounds: { x: 0, y: 0, width: 32, height: 32 },
    getSprite: vi.fn((_frame: number, _facing: WAngle) => mockSprite),
    getSpriteWithRotation: vi.fn((_frame: number, _facing: WAngle) => ({
      sprite: mockSprite, rotation: 0,
    })),
    getAlpha: vi.fn((_frame: number) => 1),
    getShadow: vi.fn((_frame: number, _facing: WAngle) => null),
  }
}

function createMockSequenceSet(sequences: Record<string, ISpriteSequence> = {}): ISequenceSet {
  return {
    hasSequence: vi.fn((_actorName: string, seqName: string) => seqName in sequences),
    getSequence: vi.fn((_actorName: string, seqName: string) => {
      const seq = sequences[seqName]
      if (!seq) throw new Error(`Sequence ${seqName} not found`)
      return seq
    }),
  }
}

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

describe('Animation construction', () => {
  it('initializes with name and sequences', () => {
    const seqSet = createMockSequenceSet()
    const anim = new Animation(seqSet, 'testActor')
    expect(anim.name).toBe('testactor') // toLowerCase
    expect(anim.currentSequence).toBeNull()
  })

  it('accepts facing function and paused callback', () => {
    const seqSet = createMockSequenceSet()
    const facing = vi.fn(() => 128)
    const paused = vi.fn(() => false)

    const anim = new Animation(seqSet, 'actor', facing, paused)
    expect(anim.name).toBe('actor')
  })

  it('defaults facing to 0 and paused to null', () => {
    const seqSet = createMockSequenceSet()
    const anim = new Animation(seqSet, 'x')
    // Defaults should not throw
    expect(anim.isDecoration).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PlayRepeating
// ---------------------------------------------------------------------------

describe('PlayRepeating', () => {
  let seqSet: ISequenceSet
  let seq: ISpriteSequence

  beforeEach(() => {
    seq = createMockSequence(8, 40)
    seqSet = createMockSequenceSet({ idle: seq })
  })

  it('sets currentSequence and starts at frame 0', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.playRepeating('idle')

    expect(anim.currentSequence).toBe(seq)
    expect(anim.currentFrame).toBe(0)
  })

  it('cycles frame back to 0 after exceeding length', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.playRepeating('idle')

    // Tick through 8 frames
    for (let i = 0; i < 8; i++) {
      anim.tick()
      expect(anim.currentFrame).toBe((i + 1) % 8)
    }
    // After 8 ticks, should wrap back to frame 0
    expect(anim.currentFrame).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Play (convenience method)
// ---------------------------------------------------------------------------

describe('Play (convenience method)', () => {
  let seqSet: ISequenceSet

  beforeEach(() => {
    const seq = createMockSequence(4, 40)
    seqSet = createMockSequenceSet({ idle: seq })
  })

  it('delegates to playThen (plays once, stops at last frame)', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.play('idle')

    expect(anim.currentSequence).not.toBeNull()

    // Tick through all frames
    anim.tick() // frame=1
    anim.tick() // frame=2
    anim.tick() // frame=3 (last)
    expect(anim.currentFrame).toBe(3)

    // One more tick should not advance past last frame
    anim.tick()
    expect(anim.currentFrame).toBe(3)
  })

  it('starts at frame 0', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.play('idle')
    expect(anim.currentFrame).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PlayThen
// ---------------------------------------------------------------------------

describe('PlayThen', () => {
  let seqSet: ISequenceSet

  beforeEach(() => {
    const seq = createMockSequence(4, 40)
    seqSet = createMockSequenceSet({ build: seq })
  })

  it('stops at last frame and calls after callback', () => {
    const anim = new Animation(seqSet, 'actor')
    const after = vi.fn()
    anim.playThen('build', after)

    // 4 ticks should reach last frame
    anim.tick() // frame=1
    anim.tick() // frame=2
    anim.tick() // frame=3 (last)
    expect(anim.currentFrame).toBe(3)

    // One more tick triggers after and stays at last frame
    anim.tick()
    expect(after).toHaveBeenCalledOnce()
    expect(anim.currentFrame).toBe(3) // Stays at last
  })

  it('works without after callback', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.playThen('build')

    // Should not throw
    for (let i = 0; i < 10; i++) anim.tick()
    expect(anim.currentFrame).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// PlayBackwardsThen
// ---------------------------------------------------------------------------

describe('PlayBackwardsThen', () => {
  it('reverses frame order', () => {
    const seq = createMockSequence(4, 40)
    const seqSet = createMockSequenceSet({ reverse: seq })
    const anim = new Animation(seqSet, 'actor')
    anim.playBackwardsThen('reverse')

    // backwards=true: CurrentFrame = length - frame - 1
    // frame starts at 0 → CurrentFrame = 4 - 0 - 1 = 3
    expect(anim.currentFrame).toBe(3)

    anim.tick() // frame becomes 1 → CurrentFrame = 4 - 1 - 1 = 2
    expect(anim.currentFrame).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// PlayFetchIndex
// ---------------------------------------------------------------------------

describe('PlayFetchIndex', () => {
  it('uses func to set frame every tick (tickAlways=true)', () => {
    const seq = createMockSequence(10, 40)
    const seqSet = createMockSequenceSet({ build: seq })
    const anim = new Animation(seqSet, 'actor')

    let externalFrame = 3
    anim.playFetchIndex('build', () => externalFrame)

    expect(anim.currentFrame).toBe(3)

    // tickAlways: every tick updates frame from func
    externalFrame = 7
    anim.tick()
    expect(anim.currentFrame).toBe(7)

    // Multiple ticks
    externalFrame = 0
    anim.tick()
    expect(anim.currentFrame).toBe(0)
  })

  it('tickAlways ignores time accumulation', () => {
    const seq = createMockSequence(5, 1000) // Very long tick time
    const seqSet = createMockSequenceSet({ slow: seq })
    const anim = new Animation(seqSet, 'actor')

    let called = 0
    anim.playFetchIndex('slow', () => {
      called++
      return called
    })

    // Each tick should call func exactly once
    anim.tick()
    anim.tick()
    anim.tick()
    expect(called).toBe(4) // Initial + 3 ticks
  })
})

// ---------------------------------------------------------------------------
// PlayFetchDirection
// ---------------------------------------------------------------------------

describe('PlayFetchDirection', () => {
  let seqSet: ISequenceSet

  beforeEach(() => {
    const seq = createMockSequence(4, 40)
    seqSet = createMockSequenceSet({ walk: seq })
  })

  it('advances frame when direction > 0', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.playFetchDirection('walk', () => 1)

    expect(anim.currentFrame).toBe(0)
    anim.tick()
    expect(anim.currentFrame).toBe(1)
    anim.tick()
    expect(anim.currentFrame).toBe(2)
  })

  it('reverses frame when direction < 0', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.playFetchDirection('walk', () => -1)

    // Start at 0, negative → wraps to last frame (3)
    anim.tick()
    expect(anim.currentFrame).toBe(3)
    anim.tick()
    expect(anim.currentFrame).toBe(2)
  })

  it('stays at current frame when direction === 0', () => {
    const anim = new Animation(seqSet, 'actor')
    anim.playFetchDirection('walk', () => 0)

    expect(anim.currentFrame).toBe(0)
    anim.tick()
    expect(anim.currentFrame).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ReplaceAnim
// ---------------------------------------------------------------------------

describe('ReplaceAnim', () => {
  it('replaces sequence and wraps frame position', () => {
    const seq1 = createMockSequence(8, 40)
    const seq2 = createMockSequence(4, 40)
    const seqSet = createMockSequenceSet({ idle: seq1, walk: seq2 })
    const anim = new Animation(seqSet, 'actor')

    anim.playRepeating('idle')
    // Advance to frame 5
    for (let i = 0; i < 5; i++) anim.tick()
    expect(anim.currentFrame).toBe(5)

    // Replace with shorter sequence (4 frames)
    anim.replaceAnim('walk')
    expect(anim.currentFrame).toBe(1) // 5 % 4 = 1
    expect(anim.currentSequence).toBe(seq2)
  })

  it('returns false for non-existent sequence', () => {
    const seq1 = createMockSequence(8, 40)
    const seqSet = createMockSequenceSet({ idle: seq1 })
    const anim = new Animation(seqSet, 'actor')
    anim.playRepeating('idle')

    expect(anim.replaceAnim('nonexistent')).toBe(false)
    // currentSequence should remain unchanged
    expect(anim.currentSequence).toBe(seq1)
  })
})

// ---------------------------------------------------------------------------
// Tick 计时（非 tickAlways）
// ---------------------------------------------------------------------------

describe('Tick timing', () => {
  it('accumulates time and triggers tickFunc at correct intervals', () => {
    const seq = createMockSequence(4, 80) // 80ms per frame
    const seqSet = createMockSequenceSet({ slow: seq })
    const anim = new Animation(seqSet, 'actor')
    anim.playRepeating('slow')

    // Default tick = 40ms
    // After 1 tick: timeUntilNextFrame = 80 - 40 = 40 (no frame change)
    anim.tick()
    expect(anim.currentFrame).toBe(0)

    // After 2nd tick: timeUntilNextFrame = 40 - 40 = 0 → trigger → +80 → = 80
    anim.tick()
    expect(anim.currentFrame).toBe(1)
  })

  it('handles large time steps (multiple frames in one tick)', () => {
    const seq = createMockSequence(4, 40)
    const seqSet = createMockSequenceSet({ fast: seq })
    const anim = new Animation(seqSet, 'actor')
    anim.playRepeating('fast')

    // 160ms step = 4 frames
    anim.tickMs(160)
    // 40ms per frame, 160ms → advance 4 frames
    expect(anim.currentFrame).toBe(0) // wraps: 0→1,1→2,2→3,3→0
  })

  it('respects paused callback (skips tick when paused)', () => {
    let paused = true
    const seq = createMockSequence(4, 40)
    const seqSet = createMockSequenceSet({ idle: seq })
    const anim = new Animation(seqSet, 'actor', () => 0, () => paused)
    anim.playRepeating('idle')

    anim.tick()
    expect(anim.currentFrame).toBe(0) // Should not change (paused)

    paused = false
    anim.tick()
    expect(anim.currentFrame).toBe(1) // Now should advance
  })
})

// ---------------------------------------------------------------------------
// CurrentFrame（反向播放）
// ---------------------------------------------------------------------------

describe('CurrentFrame', () => {
  it('calculates from end when backwards', () => {
    const seq = createMockSequence(5, 40)
    const seqSet = createMockSequenceSet({ back: seq })
    const anim = new Animation(seqSet, 'actor')
    anim.playBackwardsThen('back')

    // frame=0, backwards: 5 - 0 - 1 = 4
    expect(anim.currentFrame).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// hasSequence / getSequence
// ---------------------------------------------------------------------------

describe('hasSequence and getSequence', () => {
  it('delegates to sequence set', () => {
    const seq = createMockSequence(4, 40)
    const seqSet = createMockSequenceSet({ idle: seq })
    const anim = new Animation(seqSet, 'warfactory')

    expect(anim.hasSequence('idle')).toBe(true)
    expect(anim.hasSequence('attack')).toBe(false)
    expect(anim.getSequence('idle')).toBe(seq)
    expect(() => anim.getSequence('attack')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// getRandomExistingSequence
// ---------------------------------------------------------------------------

describe('getRandomExistingSequence', () => {
  it('selects from available sequences', () => {
    const seq = createMockSequence(4, 40)
    const seqSet = createMockSequenceSet({ a: seq, b: seq, c: seq })
    const anim = new Animation(seqSet, 'actor')

    // Always return index 1
    const result = anim.getRandomExistingSequence(['a', 'b', 'c', 'nonexistent'], () => 0.5)
    expect(result).toBe('b') // floor(0.5 * 3) = 1 → 'b'
  })

  it('returns empty string when no sequences available', () => {
    const seqSet = createMockSequenceSet({})
    const anim = new Animation(seqSet, 'actor')

    const result = anim.getRandomExistingSequence(['none'], () => 0)
    expect(result).toBe('')
  })
})
