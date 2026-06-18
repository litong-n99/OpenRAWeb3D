/**
 * WithGunboatBody.test.ts — Unit tests
 *
 * Tests focus on: left/right facing toggle, wake animation, turret resolution,
 * damage prefix normalization.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithGunboatBody,
  WithGunboatBodyInfo,
  GunboatDamageState,
  type IGunboatFacing,
  type IGunboatTurreted,
  type IGunboatAnimation,
} from './WithGunboatBody.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTurreted(name: string): IGunboatTurreted {
  return {
    name,
    worldOrientation: { yaw: WAngle.Zero },
    quantizedFacings: 8,
  }
}

function makeFacing(angle: number): IGunboatFacing {
  return { facing: new WAngle(angle) }
}

function makeBodyAnimation(replaceCalls?: string[]): IGunboatAnimation {
  const _replaceCalls: string[] = replaceCalls ?? []
  return {
    name: 'gunboat',
    currentSequence: { name: 'idle', facings: 8 },
    playFetchIndex() {},
    playRepeating() {},
    replaceAnim(seq: string) { _replaceCalls.push(seq) },
    hasSequence() { return true },
  }
}

function makeBodyAnimationWithHasSequence(
  hasSeqFn: (seq: string) => boolean,
): IGunboatAnimation {
  return {
    name: 'gunboat',
    currentSequence: { name: 'idle', facings: 8 },
    playFetchIndex() {},
    playRepeating() {},
    replaceAnim() {},
    hasSequence: hasSeqFn,
  }
}

function makeActor(
  turrets: IGunboatTurreted[],
  facing: IGunboatFacing,
  opts?: {
    getDamageState?: () => number
    hasBodyAnim?: boolean
  },
): IGameActor {
  const damageState = opts?.getDamageState
  return {
    trait(name: string): unknown {
      if (name === 'IFacing') return facing
      if (name === 'RenderSprites') return {
        getImage: () => 'gunboat-image',
        add: vi.fn(),
      }
      return null
    },
    traitsImplementing(name: string): unknown[] {
      if (name === 'Turreted') return turrets
      return []
    },
    getDamageState: damageState
      ? damageState
      : undefined,
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithGunboatBodyInfo', () => {
  it('should have default values', () => {
    const info = new WithGunboatBodyInfo()
    expect(info.turret).toBe('primary')
    expect(info.leftSequence).toBe('left')
    expect(info.rightSequence).toBe('right')
    expect(info.wakeLeftSequence).toBe('wake-left')
    expect(info.wakeRightSequence).toBe('wake-right')
  })
})

describe('WithGunboatBody', () => {
  it('should throw if no matching Turreted found', () => {
    const turreted = makeTurreted('other')
    const facing = makeFacing(0)
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo({ turret: 'primary' })
    expect(() => new WithGunboatBody(actor, info)).toThrow()
  })

  it('should find turret by name', () => {
    const turret1 = makeTurreted('primary')
    const turret2 = makeTurreted('secondary')
    const facing = makeFacing(0)
    const actor = makeActor([turret1, turret2], facing)
    const info = new WithGunboatBodyInfo({ turret: 'primary' })
    const body = new WithGunboatBody(actor, info)
    expect(body.turret).toBe(turret1)
  })

  it('should use right-facing sequence when angle <= 512', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(256) // Right side
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    const replaceCalls: string[] = []
    const anim = makeBodyAnimation(replaceCalls)
    ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

    body.tick(actor)
    expect(replaceCalls.some((c) => c.includes('right'))).toBe(true)
  })

  it('should use left-facing sequence when angle > 512', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(768) // Left side
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    const replaceCalls: string[] = []
    const anim = makeBodyAnimation(replaceCalls)
    ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

    body.tick(actor)
    expect(replaceCalls.some((c) => c.includes('left'))).toBe(true)
  })

  it('should update quantizedFacings on traitEnabled', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(0)
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    const anim = makeBodyAnimation()
    ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

    body.traitEnabled({} as unknown as IGameActor)
    expect(turreted.quantizedFacings).toBe(8)
  })

  describe('normalizeSequence (damage prefix lookup)', () => {
    it('should return sequence as-is when undamaged and no prefix matches', () => {
      const turreted = makeTurreted('primary')
      const facing = makeFacing(0)
      const actor = makeActor([turreted], facing, {
        getDamageState: () => GunboatDamageState.Undamaged,
      })
      const info = new WithGunboatBodyInfo({
        leftSequence: 'left',
        rightSequence: 'right',
      })
      const body = new WithGunboatBody(actor, info)
      const anim = makeBodyAnimationWithHasSequence(() => false)
      ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

      const result = body.normalizeSequence(actor, 'right')
      expect(result).toBe('right')
    })

    it('should return sequence as-is when damage state >= threshold but sequence does not exist', () => {
      const turreted = makeTurreted('primary')
      const facing = makeFacing(0)
      const actor = makeActor([turreted], facing, {
        getDamageState: () => GunboatDamageState.Critical,
      })
      const info = new WithGunboatBodyInfo({ rightSequence: 'right' })
      const body = new WithGunboatBody(actor, info)
      const anim = makeBodyAnimationWithHasSequence(() => false)
      ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

      const result = body.normalizeSequence(actor, 'right')
      expect(result).toBe('right')
    })

    it('should prepend critical- prefix when heavily damaged and sequence exists', () => {
      const turreted = makeTurreted('primary')
      const facing = makeFacing(0)
      const actor = makeActor([turreted], facing, {
        getDamageState: () => GunboatDamageState.Critical,
      })
      const info = new WithGunboatBodyInfo({ rightSequence: 'right' })
      const body = new WithGunboatBody(actor, info)
      const anim = makeBodyAnimationWithHasSequence(
        (seq: string) => seq === 'critical-right',
      )
      ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

      const result = body.normalizeSequence(actor, 'right')
      expect(result).toBe('critical-right')
    })

    it('should prepend damaged- prefix when heavily damaged and critical- does not exist', () => {
      const turreted = makeTurreted('primary')
      const facing = makeFacing(0)
      const actor = makeActor([turreted], facing, {
        getDamageState: () => GunboatDamageState.Heavy,
      })
      const info = new WithGunboatBodyInfo({ leftSequence: 'left' })
      const body = new WithGunboatBody(actor, info)
      const anim = makeBodyAnimationWithHasSequence(
        (seq: string) => seq === 'damaged-left',
      )
      ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

      const result = body.normalizeSequence(actor, 'left')
      expect(result).toBe('damaged-left')
    })

    it('should strip existing damage prefix before re-normalizing', () => {
      const turreted = makeTurreted('primary')
      const facing = makeFacing(0)
      const actor = makeActor([turreted], facing, {
        getDamageState: () => GunboatDamageState.Heavy,
      })
      const info = new WithGunboatBodyInfo({ rightSequence: 'right' })
      const body = new WithGunboatBody(actor, info)
      // Animation has 'damaged-right' but not 'critical-right'
      const anim = makeBodyAnimationWithHasSequence(
        (seq: string) => seq === 'damaged-right',
      )
      ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

      // Input already has critical- prefix, but that sequence doesn't exist
      // Should strip critical-, then try prefixes, finding damaged-right
      const result = body.normalizeSequence(actor, 'critical-right')
      expect(result).toBe('damaged-right')
    })

    it('should default to Undamaged when getDamageState is absent', () => {
      const turreted = makeTurreted('primary')
      const facing = makeFacing(0)
      const actor = makeActor([turreted], facing)
      const info = new WithGunboatBodyInfo()
      const body = new WithGunboatBody(actor, info)
      const anim = makeBodyAnimationWithHasSequence(() => true)
      ;(body as any)._body = { info: { name: 'body' }, defaultAnimation: anim }

      const result = body.normalizeSequence(actor, 'right')
      // Without damage state, stays Undamaged (0), so no prefix matches
      // unless the animation has the prefixed sequence AND damage=0 >= threshold
      // For Light (state=1), Undamaged (0) is NOT >= 1, so no prefix
      expect(result).toBe('right')
    })
  })

  it('should dispose cleanly', () => {
    const turreted = makeTurreted('primary')
    const facing = makeFacing(0)
    const actor = makeActor([turreted], facing)
    const info = new WithGunboatBodyInfo()
    const body = new WithGunboatBody(actor, info)
    expect(() => body.dispose()).not.toThrow()
  })
})
