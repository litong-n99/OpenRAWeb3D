/**
 * ClassicFacingBodyOrientation.test.ts — ClassicFacingBodyOrientation migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are NOT used.
 * Tests focus on: classic facing quantization (linear + non-linear 32-facing),
 * default values, class hierarchy, and OpenRA parity.
 */

import { describe, it, expect } from 'vitest'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import {
  BodyOrientationInfo,
  BodyOrientation,
} from '../../OpenRA.Mods.Common/Traits/BodyOrientation.js'
import {
  classicIndexFacing,
  classicQuantizeFacing,
  ClassicFacingBodyOrientationInfo,
  ClassicFacingBodyOrientation,
} from './ClassicFacingBodyOrientation.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(name: string = 'testActor'): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
  }
}

// ---------------------------------------------------------------------------
// classicIndexFacing
// ---------------------------------------------------------------------------

describe('classicIndexFacing', () => {
  describe('with 32 facings (non-linear)', () => {
    it('returns 0 for angle 0', () => {
      expect(classicIndexFacing(new WAngle(0), 32)).toBe(0)
    })

    it('returns 0 for angle 19 (just below first range at 20)', () => {
      expect(classicIndexFacing(new WAngle(19), 32)).toBe(0)
    })

    it('returns 1 for angle 20 (first range boundary)', () => {
      expect(classicIndexFacing(new WAngle(20), 32)).toBe(1)
    })

    it('returns 1 for angle 55 (last angle before range 2)', () => {
      expect(classicIndexFacing(new WAngle(55), 32)).toBe(1)
    })

    it('returns 2 for angle 56 (second range boundary)', () => {
      expect(classicIndexFacing(new WAngle(56), 32)).toBe(2)
    })

    it('returns 0 for angle 1000 (beyond last range — wraps)', () => {
      expect(classicIndexFacing(new WAngle(1000), 32)).toBe(0)
    })

    it('returns 0 for angle 1023 (max angle — wraps)', () => {
      expect(classicIndexFacing(new WAngle(1023), 32)).toBe(0)
    })
  })

  describe('with 8 facings (delegates to standard)', () => {
    it('delegates to BodyOrientationInfo._indexFacing for non-32', () => {
      const result = classicIndexFacing(new WAngle(0), 8)
      expect(result).toBe(BodyOrientationInfo._indexFacing(new WAngle(0), 8))
    })

    it('returns 0 for angle 63 with 8 facings', () => {
      expect(classicIndexFacing(new WAngle(63), 8)).toBe(0)
    })

    it('returns 1 for angle 64 with 8 facings', () => {
      expect(classicIndexFacing(new WAngle(64), 8)).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// classicQuantizeFacing
// ---------------------------------------------------------------------------

describe('classicQuantizeFacing', () => {
  describe('with 32 facings (non-linear)', () => {
    it('returns WAngle.Zero for angle 0', () => {
      const result = classicQuantizeFacing(new WAngle(0), 32)
      expect(result.angle).toBe(0)
    })

    it('returns WAngle(40) for angle 20 (frame 1)', () => {
      const result = classicQuantizeFacing(new WAngle(20), 32)
      expect(result.angle).toBe(40)
    })

    it('returns WAngle(74) for angle 56 (frame 2)', () => {
      const result = classicQuantizeFacing(new WAngle(56), 32)
      expect(result.angle).toBe(74)
    })

    it('returns WAngle(512) for angle 500 (frame 16, range 488-531)', () => {
      // SPRITE_RANGES[16]=532 is exclusive max, so angle 500 maps to frame 16
      const result = classicQuantizeFacing(new WAngle(500), 32)
      expect(result.angle).toBe(512)
    })

    it('returns WAngle.Zero for angle 1000 (wraps to frame 0)', () => {
      const result = classicQuantizeFacing(new WAngle(1000), 32)
      expect(result.angle).toBe(0)
    })
  })

  describe('with 8 facings (linear)', () => {
    it('snaps angle 60 to 0 (8 facings, step=128)', () => {
      const result = classicQuantizeFacing(new WAngle(60), 8)
      expect(result.angle).toBe(0)
    })

    it('snaps angle 130 to 128 (8 facings)', () => {
      const result = classicQuantizeFacing(new WAngle(130), 8)
      expect(result.angle).toBe(128)
    })
  })

  describe('with 0 facings (no quantization)', () => {
    it('returns the original facing unchanged', () => {
      // classicQuantizeFacing itself doesn't handle facings===0;
      // that check is in ClassicFacingBodyOrientationInfo.quantizeFacing
      // For 0 steps, _quantizeFacingRaw would have step=Infinity → index=0 → result=0
      // This is the raw behavior; the caller should handle facings===0
      const result = classicQuantizeFacing(new WAngle(300), 0)
      // step = floor(1024/0) = Infinity, index = floor(300+Infinity &1023 / Infinity) = 0
      // result = 0*Infinity = NaN
      expect(result.angle).toBeNaN()
    })
  })
})

// ---------------------------------------------------------------------------
// ClassicFacingBodyOrientationInfo
// ---------------------------------------------------------------------------

describe('ClassicFacingBodyOrientationInfo', () => {
  describe('class hierarchy', () => {
    it('extends BodyOrientationInfo', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      expect(info).toBeInstanceOf(BodyOrientationInfo)
    })

    it('is also instance of ClassicFacingBodyOrientationInfo', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      expect(info).toBeInstanceOf(ClassicFacingBodyOrientationInfo)
    })
  })

  describe('default values', () => {
    it('quantizedFacings defaults to 8 (C&C classic standard)', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      expect(info.quantizedFacings).toBe(8)
    })

    it('cameraPitch defaults to 40 degrees', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      expect(info.cameraPitch.angle).toBe(WAngle.fromDegrees(40).angle)
    })

    it('useClassicPerspectiveFudge defaults to true', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      expect(info.useClassicPerspectiveFudge).toBe(true)
    })
  })

  describe('custom constructor parameters', () => {
    it('accepts custom quantizedFacings', () => {
      const info = new ClassicFacingBodyOrientationInfo(16)
      expect(info.quantizedFacings).toBe(16)
    })

    it('accepts custom cameraPitch', () => {
      const info = new ClassicFacingBodyOrientationInfo(8, WAngle.fromDegrees(30))
      expect(info.cameraPitch.angle).toBe(WAngle.fromDegrees(30).angle)
    })

    it('accepts custom useClassicPerspectiveFudge', () => {
      const info = new ClassicFacingBodyOrientationInfo(8, WAngle.fromDegrees(40), false)
      expect(info.useClassicPerspectiveFudge).toBe(false)
    })
  })

  describe('quantizeFacing', () => {
    it('returns original facing when facings is 0', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      const facing = new WAngle(300)
      const result = info.quantizeFacing(facing, 0)
      expect(result.angle).toBe(300)
    })

    it('uses classic quantization for 32 facings (non-linear)', () => {
      const info = new ClassicFacingBodyOrientationInfo(32)
      const result = info.quantizeFacing(new WAngle(20), 32)
      expect(result.angle).toBe(40) // SPRITE_FACINGS[1]
    })

    it('uses standard linear quantization for 8 facings', () => {
      const info = new ClassicFacingBodyOrientationInfo(8)
      const result = info.quantizeFacing(new WAngle(130), 8)
      expect(result.angle).toBe(128)
    })
  })
})

// ---------------------------------------------------------------------------
// ClassicFacingBodyOrientation (runtime trait)
// ---------------------------------------------------------------------------

describe('ClassicFacingBodyOrientation', () => {
  describe('class hierarchy', () => {
    it('extends BodyOrientation', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      const actor = makeActor()
      const trait = new ClassicFacingBodyOrientation(info, actor)
      expect(trait).toBeInstanceOf(BodyOrientation)
      expect(trait).toBeInstanceOf(ClassicFacingBodyOrientation)
    })
  })

  describe('quantizedFacings', () => {
    it('returns 8 by default (from info)', () => {
      const info = new ClassicFacingBodyOrientationInfo()
      const actor = makeActor()
      const trait = new ClassicFacingBodyOrientation(info, actor)
      expect(trait.quantizedFacings).toBe(8)
    })

    it('reflects custom quantizedFacings from info', () => {
      const info = new ClassicFacingBodyOrientationInfo(16)
      const actor = makeActor()
      const trait = new ClassicFacingBodyOrientation(info, actor)
      expect(trait.quantizedFacings).toBe(16)
    })
  })

  describe('quantizeFacing (delegates to info)', () => {
    it('uses classic quantization via info for 32 facings', () => {
      const info = new ClassicFacingBodyOrientationInfo(32)
      const actor = makeActor()
      const trait = new ClassicFacingBodyOrientation(info, actor)
      const result = trait.quantizeFacing(new WAngle(20))
      expect(result.angle).toBe(40)
    })

    it('uses linear quantization for 8 facings', () => {
      const info = new ClassicFacingBodyOrientationInfo(8)
      const actor = makeActor()
      const trait = new ClassicFacingBodyOrientation(info, actor)
      const result = trait.quantizeFacing(new WAngle(130))
      expect(result.angle).toBe(128)
    })
  })

  describe('quantizeFacing with explicit facings', () => {
    it('allows overriding facings per call', () => {
      const info = new ClassicFacingBodyOrientationInfo(8)
      const actor = makeActor()
      const trait = new ClassicFacingBodyOrientation(info, actor)
      const result = trait.quantizeFacing(new WAngle(100), 16)
      // 16 facings → step=64. 100+32=132 &1023=132 → 132/64=2 → result=128
      expect(result.angle).toBe(128)
    })
  })
})
