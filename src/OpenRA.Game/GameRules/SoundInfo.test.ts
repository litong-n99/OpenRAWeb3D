/**
 * SoundInfo.test.ts — SoundInfo migration unit tests
 *
 * SoundInfo and its dependencies (SoundPool, InterruptType) are pure logic.
 * No Babylon.js mocking required. Tests focus on fromJSON parsing,
 * lazy pool construction, and configuration defaults.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { SoundInfo, SoundPool, InterruptType } from './SoundInfo.js'

// ---------------------------------------------------------------------------
// fromJSON() tests
// ---------------------------------------------------------------------------

describe('SoundInfo.fromJSON', () => {
  it('parses empty JSON with all defaults', () => {
    const info = SoundInfo.fromJSON({})

    expect(info.defaultVariant).toBe('.aud')
    expect(info.defaultPrefix).toBe('')
    expect(info.variants.size).toBe(0)
    expect(info.prefixes.size).toBe(0)
    expect(info.voices.size).toBe(0)
    expect(info.notifications.size).toBe(0)
    expect(info.disableVariants.size).toBe(0)
    expect(info.disablePrefixes.size).toBe(0)
  })

  it('parses DefaultVariant and DefaultPrefix', () => {
    const info = SoundInfo.fromJSON({
      DefaultVariant: '.wav',
      DefaultPrefix: 'sounds/',
    })

    expect(info.defaultVariant).toBe('.wav')
    expect(info.defaultPrefix).toBe('sounds/')
  })

  it('parses Variants as string-array map', () => {
    const info = SoundInfo.fromJSON({
      Variants: {
        default: ['.aud', '.wav'],
        alt: ['.mp3'],
      },
    })

    expect(info.variants.get('default')).toEqual(['.aud', '.wav'])
    expect(info.variants.get('alt')).toEqual(['.mp3'])
    expect(info.variants.size).toBe(2)
  })

  it('parses Prefixes as string-array map', () => {
    const info = SoundInfo.fromJSON({
      Prefixes: {
        default: [''],
        tanks: ['tank_'],
      },
    })

    expect(info.prefixes.get('default')).toEqual([''])
    expect(info.prefixes.get('tanks')).toEqual(['tank_'])
  })

  it('parses Voices as string-array map', () => {
    const info = SoundInfo.fromJSON({
      Voices: {
        Move: ['move1.aud', 'move2.aud', 'move3.aud'],
        Attack: ['attack1.aud'],
        Die: ['die1.aud', 'die2.aud'],
      },
    })

    expect(info.voices.get('Move')).toEqual(['move1.aud', 'move2.aud', 'move3.aud'])
    expect(info.voices.get('Attack')).toEqual(['attack1.aud'])
    expect(info.voices.size).toBe(3)
  })

  it('parses Notifications as string-array map', () => {
    const info = SoundInfo.fromJSON({
      Notifications: {
        UnitReady: ['ready.aud'],
        BuildingCaptured: ['captured.aud'],
        LowPower: ['lowpower.aud'],
      },
    })

    expect(info.notifications.get('UnitReady')).toEqual(['ready.aud'])
    expect(info.notifications.size).toBe(3)
  })

  it('parses DisableVariants as string set', () => {
    const info = SoundInfo.fromJSON({
      DisableVariants: ['alt', 'vox'],
    })

    expect(info.disableVariants.has('alt')).toBe(true)
    expect(info.disableVariants.has('vox')).toBe(true)
    expect(info.disableVariants.has('default')).toBe(false)
    expect(info.disableVariants.size).toBe(2)
  })

  it('parses DisablePrefixes as string set', () => {
    const info = SoundInfo.fromJSON({
      DisablePrefixes: ['legacy_'],
    })

    expect(info.disablePrefixes.has('legacy_')).toBe(true)
    expect(info.disablePrefixes.size).toBe(1)
  })

  it('handles empty DisableVariants/DisablePrefixes', () => {
    const info = SoundInfo.fromJSON({
      DisableVariants: [],
      DisablePrefixes: [],
    })

    expect(info.disableVariants.size).toBe(0)
    expect(info.disablePrefixes.size).toBe(0)
  })

  it('handles non-object Variants gracefully', () => {
    const info = SoundInfo.fromJSON({
      Variants: 'not-an-object',
    })

    expect(info.variants.size).toBe(0)
  })

  it('handles non-array values in Variants gracefully', () => {
    const info = SoundInfo.fromJSON({
      Variants: {
        default: 'not-an-array',
        alt: ['valid.aud'],
      },
    })

    // Non-array values are skipped
    expect(info.variants.get('default')).toBeUndefined()
    expect(info.variants.get('alt')).toEqual(['valid.aud'])
    expect(info.variants.size).toBe(1)
  })

  it('converts non-string array items to strings', () => {
    const info = SoundInfo.fromJSON({
      DisableVariants: ['alt', 42, true],
    })

    expect(info.disableVariants.has('alt')).toBe(true)
    expect(info.disableVariants.has('42')).toBe(true)
    expect(info.disableVariants.has('true')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Lazy pool construction tests
// ---------------------------------------------------------------------------

describe('SoundInfo lazy pools', () => {
  it('voicePools are not created until accessed', () => {
    const info = SoundInfo.fromJSON({
      Voices: {
        Move: ['move1.aud', 'move2.aud'],
      },
    })

    // Access private field via type assertion for test verification
    const internal = info as unknown as { _voicePools: Map<string, SoundPool> | null }
    expect(internal._voicePools).toBeNull()
  })

  it('voicePools are created on first access', () => {
    const info = SoundInfo.fromJSON({
      Voices: {
        Move: ['move1.aud', 'move2.aud'],
        Attack: ['attack1.aud'],
      },
    })

    const pools = info.voicePools

    expect(pools.size).toBe(2)
    expect(pools.has('Move')).toBe(true)
    expect(pools.has('Attack')).toBe(true)
  })

  it('voicePools are cached after first access', () => {
    const info = SoundInfo.fromJSON({
      Voices: {
        Move: ['move1.aud'],
      },
    })

    const first = info.voicePools
    const second = info.voicePools

    expect(first).toBe(second) // same reference (cached)
  })

  it('constructed SoundPool has correct clips', () => {
    const info = SoundInfo.fromJSON({
      Voices: {
        Move: ['move1.aud', 'move2.aud'],
      },
    })

    const movePool = info.voicePools.get('Move')
    expect(movePool).toBeDefined()
    expect(movePool!.clips).toEqual(['move1.aud', 'move2.aud'])
  })

  it('constructed SoundPool has default volume and interrupt type', () => {
    const info = SoundInfo.fromJSON({
      Voices: {
        Move: ['clip.aud'],
      },
    })

    const movePool = info.voicePools.get('Move')
    expect(movePool!.volumeModifier).toBe(1.0)
    expect(movePool!.type).toBe(SoundPool.DefaultInterruptType)
  })

  it('notificationsPools are lazy-constructed', () => {
    const info = SoundInfo.fromJSON({
      Notifications: {
        UnitReady: ['ready.aud'],
      },
    })

    const internal = info as unknown as { _notificationsPools: Map<string, SoundPool> | null }
    expect(internal._notificationsPools).toBeNull()

    const pools = info.notificationsPools
    expect(pools.size).toBe(1)
    expect(internal._notificationsPools).not.toBeNull()
  })

  it('notificationsPools are cached', () => {
    const info = SoundInfo.fromJSON({
      Notifications: {
        UnitReady: ['ready.aud'],
      },
    })

    const first = info.notificationsPools
    const second = info.notificationsPools
    expect(first).toBe(second)
  })

  it('empty voices produce empty voice pools', () => {
    const info = SoundInfo.fromJSON({})

    expect(info.voicePools.size).toBe(0)
    expect(info.notificationsPools.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SoundPool tests (via SoundInfo construction)
// ---------------------------------------------------------------------------

describe('SoundPool (via SoundInfo)', () => {
  it('SoundPool.DefaultInterruptType is DoNotPlay', () => {
    expect(SoundPool.DefaultInterruptType).toBe(InterruptType.DoNotPlay)
  })

  it('SoundPool.getNext() returns a clip from the pool', () => {
    const pool = new SoundPool(1.0, InterruptType.Overlap, ['a.aud', 'b.aud', 'c.aud'])
    const result = pool.getNext()
    expect(['a.aud', 'b.aud', 'c.aud']).toContain(result)
  })

  it('SoundPool.getNext() returns null when clips array is empty', () => {
    const pool = new SoundPool(1.0, InterruptType.Overlap, [])
    expect(pool.getNext()).toBeNull()
  })

  it('SoundPool.getNext() cycles through all clips before repeating', () => {
    const pool = new SoundPool(1.0, InterruptType.Overlap, ['a.aud', 'b.aud', 'c.aud'])
    const results: (string | null)[] = []
    for (let i = 0; i < 3; i++) {
      results.push(pool.getNext())
    }
    // All three clips should be returned (no repeats until exhausted)
    expect(results.filter(r => r !== null).length).toBe(3)
    const unique = new Set(results)
    expect(unique.size).toBe(3)
  })

  it('SoundPool.getNext() refills after exhaustion', () => {
    const pool = new SoundPool(1.0, InterruptType.Overlap, ['a.aud', 'b.aud'])
    const first = pool.getNext()
    const second = pool.getNext()
    const third = pool.getNext() // refills

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(third).not.toBeNull()
    // third could be either 'a.aud' or 'b.aud'
    expect(['a.aud', 'b.aud']).toContain(third)
  })

  it('SoundPool.reset() clears live clips', () => {
    const pool = new SoundPool(1.0, InterruptType.Overlap, ['a.aud', 'b.aud'])
    pool.getNext() // removes one
    pool.reset()
    const first = pool.getNext()!
    const second = pool.getNext()!
    expect(['a.aud', 'b.aud']).toContain(first)
    expect(['a.aud', 'b.aud']).toContain(second)
  })

  it('InterruptType values match expected enum', () => {
    expect(InterruptType.DoNotPlay).toBe(0)
    expect(InterruptType.Interrupt).toBe(1)
    expect(InterruptType.Overlap).toBe(2)
  })
})
