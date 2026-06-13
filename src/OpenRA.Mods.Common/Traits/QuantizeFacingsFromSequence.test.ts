/**
 * QuantizeFacingsFromSequence.test.ts — QuantizeFacingsFromSequence migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are NOT used.
 * Tests focus on: sequence facings detection, error handling, conditional trait
 * integration, and default parameter values.
 */

import { describe, it, expect } from 'vitest'
import {
  QuantizeFacingsFromSequenceInfo,
  QuantizeFacingsFromSequence,
  type SequenceSetStub,
  type SequenceStub,
  type RenderSpritesInfoStub,
} from './QuantizeFacingsFromSequence.js'
import type { ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSequence(facings: number): SequenceStub {
  return { Facings: facings }
}

function makeSequenceSet(
  image: string,
  sequenceName: string,
  facings: number,
): SequenceSetStub {
  const seq = makeSequence(facings)
  return {
    getSequence(img: string, name: string): SequenceStub {
      if (img === image && name === sequenceName) return seq
      throw new Error(`Sequence not found: ${img}/${name}`)
    },
  }
}

function makeActorInfo(
  name: string,
  image: string,
): ActorInfoStub & { getRenderSpritesInfo(): RenderSpritesInfoStub } {
  return {
    name,
    getRenderSpritesInfo(): RenderSpritesInfoStub {
      return {
        getImage(_ai: ActorInfoStub, _faction: string): string {
          return image
        },
      }
    },
  }
}

function makeActorInfoWithoutRenderSprites(name: string): ActorInfoStub {
  return { name }
}

// ---------------------------------------------------------------------------
// QuantizeFacingsFromSequenceInfo
// ---------------------------------------------------------------------------

describe('QuantizeFacingsFromSequenceInfo', () => {
  describe('defaults', () => {
    it('has sequence default "idle"', () => {
      const info = new QuantizeFacingsFromSequenceInfo()
      expect(info.sequence).toBe('idle')
    })

    it('has undefined requiresCondition by default', () => {
      const info = new QuantizeFacingsFromSequenceInfo()
      expect(info.requiresCondition).toBeUndefined()
    })

    it('has undefined instanceName by default', () => {
      const info = new QuantizeFacingsFromSequenceInfo()
      expect(info.instanceName).toBeUndefined()
    })
  })

  describe('custom constructor parameters', () => {
    it('accepts custom sequence name', () => {
      const info = new QuantizeFacingsFromSequenceInfo('run')
      expect(info.sequence).toBe('run')
    })

    it('accepts requiresCondition', () => {
      const info = new QuantizeFacingsFromSequenceInfo('idle', '!disabled')
      expect(info.requiresCondition).toBe('!disabled')
    })

    it('accepts instanceName', () => {
      const info = new QuantizeFacingsFromSequenceInfo('idle', undefined, 'myInstance')
      expect(info.instanceName).toBe('myInstance')
    })
  })

  describe('quantizedBodyFacings', () => {
    it('returns facings count from the named sequence', () => {
      const info = new QuantizeFacingsFromSequenceInfo('idle')
      const ai = makeActorInfo('e1', 'e1')
      const sequences = makeSequenceSet('e1', 'idle', 8)

      const result = info.quantizedBodyFacings(ai, sequences, 'allies')
      expect(result).toBe(8)
    })

    it('returns 16 facings when sequence has 16 facings', () => {
      const info = new QuantizeFacingsFromSequenceInfo('idle')
      const ai = makeActorInfo('tank', 'tank')
      const sequences = makeSequenceSet('tank', 'idle', 16)

      const result = info.quantizedBodyFacings(ai, sequences, 'soviet')
      expect(result).toBe(16)
    })

    it('returns 32 facings when sequence has 32 facings', () => {
      const info = new QuantizeFacingsFromSequenceInfo('idle')
      const ai = makeActorInfo('helo', 'helo')
      const sequences = makeSequenceSet('helo', 'idle', 32)

      const result = info.quantizedBodyFacings(ai, sequences, 'allies')
      expect(result).toBe(32)
    })

    it('throws when sequence name is empty string', () => {
      const info = new QuantizeFacingsFromSequenceInfo('')
      const ai = makeActorInfo('badUnit', 'badUnit')
      const sequences = makeSequenceSet('badUnit', 'idle', 8)

      expect(() => info.quantizedBodyFacings(ai, sequences, 'allies'))
        .toThrow(/missing sequence/)
    })

    it('throws when facings count is zero', () => {
      const info = new QuantizeFacingsFromSequenceInfo('idle')
      const ai = makeActorInfo('zeroUnit', 'zeroUnit')
      const sequences = makeSequenceSet('zeroUnit', 'idle', 0)

      expect(() => info.quantizedBodyFacings(ai, sequences, 'allies'))
        .toThrow(/zero facings/)
    })

    it('passes actor name in error message for zero facings', () => {
      const info = new QuantizeFacingsFromSequenceInfo('idle')
      const ai = makeActorInfo('testUnit42', 'img42')
      const sequences = makeSequenceSet('img42', 'idle', 0)

      expect(() => info.quantizedBodyFacings(ai, sequences, 'gdi'))
        .toThrow(/testUnit42/)
    })

    it('uses custom sequence name in lookup', () => {
      const info = new QuantizeFacingsFromSequenceInfo('run')
      const ai = makeActorInfo('soldier', 'soldier_img')
      const sequences = {
        getSequence(img: string, name: string): SequenceStub {
          // Verify the correct image and sequence name are passed
          if (img === 'soldier_img' && name === 'run') return { Facings: 8 }
          throw new Error(`Unexpected: ${img}/${name}`)
        },
      }

      const result = info.quantizedBodyFacings(ai, sequences, 'allies')
      expect(result).toBe(8)
    })

    it('handles actor without RenderSpritesInfo gracefully', () => {
      // When actor doesn't have getRenderSpritesInfo, image defaults to ''
      // and getSequence will throw for empty image
      const info = new QuantizeFacingsFromSequenceInfo('idle')
      const ai = makeActorInfoWithoutRenderSprites('bareUnit')
      const sequences = makeSequenceSet('expected', 'idle', 8)

      // getImage returns '' (no RenderSpritesInfo), then getSequence('', 'idle') fails
      expect(() => info.quantizedBodyFacings(ai, sequences, 'allies'))
        .toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// QuantizeFacingsFromSequence (runtime trait)
// ---------------------------------------------------------------------------

describe('QuantizeFacingsFromSequence', () => {
  it('creates a runtime trait instance', () => {
    const info = new QuantizeFacingsFromSequenceInfo('idle')
    const trait = new QuantizeFacingsFromSequence(info)
    expect(trait.info).toBe(info)
  })

  it('info is the same object passed to constructor', () => {
    const info = new QuantizeFacingsFromSequenceInfo('run', '!disabled')
    const trait = new QuantizeFacingsFromSequence(info)
    expect(trait.info.sequence).toBe('run')
    expect(trait.info.requiresCondition).toBe('!disabled')
  })

  it('isTraitDisabled defaults to false for no-condition traits', () => {
    const info = new QuantizeFacingsFromSequenceInfo('idle')
    const trait = new QuantizeFacingsFromSequence(info)
    expect(trait.isTraitDisabled).toBe(false)
  })
})
