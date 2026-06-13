/**
 * BodyOrientation.test.ts — BodyOrientation migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are NOT used.
 * Tests focus on: facing quantization logic, coordinate transforms, lazy init,
 * error handling, and OpenRA parity.
 */

import { describe, it, expect } from 'vitest'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import {
  BodyOrientationInfo,
  BodyOrientation,
  type IQuantizeBodyOrientationInfo,
} from './BodyOrientation.js'
import type { ActorInfoStub, IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(
  name: string = 'testActor',
): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
  }
}

function makeQboi(facings: number): IQuantizeBodyOrientationInfo {
  return {
    quantizedBodyFacings(
      _ai: ActorInfoStub,
      _sequences: unknown,
      _faction: string,
    ): number {
      return facings
    },
  }
}

// ---------------------------------------------------------------------------
// BodyOrientationInfo static methods
// ---------------------------------------------------------------------------

describe('BodyOrientationInfo._indexFacing', () => {
  it('returns 0 for angle near step 0 (8 facings, step=128)', () => {
    // facings=8 → step=128. Half-step=64.
    // Angles 0..63 map to index 0 (angle+64 < 128).
    expect(BodyOrientationInfo._indexFacing(new WAngle(0), 8)).toBe(0)
    expect(BodyOrientationInfo._indexFacing(new WAngle(63), 8)).toBe(0)
  })

  it('returns 1 for angle near 128 (8 facings)', () => {
    // angle 64+64=128 → index=1
    expect(BodyOrientationInfo._indexFacing(new WAngle(64), 8)).toBe(1)
    // angle 191+64=255 → 255/128=1 → index=1
    expect(BodyOrientationInfo._indexFacing(new WAngle(191), 8)).toBe(1)
  })

  it('returns 7 for angle near 896 (8 facings, last step)', () => {
    // step=128, last step starts at 7*128=896
    // 896+64=960 → 960/128=7
    expect(BodyOrientationInfo._indexFacing(new WAngle(896), 8)).toBe(7)
    expect(BodyOrientationInfo._indexFacing(new WAngle(959), 8)).toBe(7)
  })

  it('returns correct index for 16 facings', () => {
    // facings=16 → step=64. Half-step=32.
    // 0+32=32 → 32/64=0
    expect(BodyOrientationInfo._indexFacing(new WAngle(0), 16)).toBe(0)
    // 31+32=63 → 63/64=0
    expect(BodyOrientationInfo._indexFacing(new WAngle(31), 16)).toBe(0)
    // 32+32=64 → 64/64=1
    expect(BodyOrientationInfo._indexFacing(new WAngle(32), 16)).toBe(1)
    // 512+32=544 → 544/64=8
    expect(BodyOrientationInfo._indexFacing(new WAngle(512), 16)).toBe(8)
  })

  it('handles angle wrapping at 1023 boundary (round half-step)', () => {
    // facings=32 → step=32
    // angle 1023 + half-step(16) = 1039 → wrapped to (1039 & 1023) = 15
    // 15 / 32 = 0 → maps to index 0
    // This tests the boundary wrapping behavior
    const index = BodyOrientationInfo._indexFacing(new WAngle(1023), 32)
    expect(index).toBe(0)
  })
})

describe('BodyOrientationInfo._quantizeFacingRaw', () => {
  it('returns identity-facing for 8 facings at angle 0', () => {
    const result = BodyOrientationInfo._quantizeFacingRaw(new WAngle(0), 8)
    expect(result.angle).toBe(0)
  })

  it('snaps angle 60 to nearest step at 0 (8 facings)', () => {
    // 8 facings → step=128. 60+64=124 → 124/128=0 → result 0.
    const result = BodyOrientationInfo._quantizeFacingRaw(new WAngle(60), 8)
    expect(result.angle).toBe(0)
  })

  it('snaps angle 130 to step at 128 (8 facings)', () => {
    // 130 > 128+64 → should favor index 1 → result 128
    const result = BodyOrientationInfo._quantizeFacingRaw(new WAngle(130), 8)
    expect(result.angle).toBe(128)
  })

  it('with 16 facings, angle 50 snaps to step 64', () => {
    // 16 facings → step=64. 50+32=82 &1023 → 82/64=1 → result=64
    const result = BodyOrientationInfo._quantizeFacingRaw(new WAngle(50), 16)
    expect(result.angle).toBe(64)
  })

  it('with 32 facings, angle 20 snaps to step 32', () => {
    // 32 facings → step=32. 20+16=36 &1023 → 36/32=1 → result=32
    const result = BodyOrientationInfo._quantizeFacingRaw(new WAngle(20), 32)
    expect(result.angle).toBe(32)
  })
})

// ---------------------------------------------------------------------------
// BodyOrientationInfo
// ---------------------------------------------------------------------------

describe('BodyOrientationInfo', () => {
  it('has correct default values', () => {
    const info = new BodyOrientationInfo()
    expect(info.quantizedFacings).toBe(-1)
    // CameraPitch default is WAngle.fromDegrees(40)
    expect(info.cameraPitch.angle).toBe(WAngle.fromDegrees(40).angle)
    expect(info.useClassicPerspectiveFudge).toBe(true)
  })

  it('accepts custom constructor parameters', () => {
    const info = new BodyOrientationInfo(8, WAngle.fromDegrees(30), false)
    expect(info.quantizedFacings).toBe(8)
    expect(info.cameraPitch.angle).toBe(WAngle.fromDegrees(30).angle)
    expect(info.useClassicPerspectiveFudge).toBe(false)
  })

  describe('quantizeFacing', () => {
    it('returns original facing when facings is 0', () => {
      const info = new BodyOrientationInfo()
      const facing = new WAngle(300)
      const result = info.quantizeFacing(facing, 0)
      expect(result.angle).toBe(300)
    })

    it('snaps facing to nearest discrete step', () => {
      const info = new BodyOrientationInfo()
      const result = info.quantizeFacing(new WAngle(150), 8)
      // 8 facings → step=128. 150+64=214 &1023=214 → 214/128=1 → result=128
      expect(result.angle).toBe(128)
    })
  })

  describe('quantizeOrientation', () => {
    it('returns original orientation when facings is 0', () => {
      const info = new BodyOrientationInfo()
      const rot = new WRot(WAngle.fromDegrees(10), WAngle.fromDegrees(5), WAngle.fromDegrees(45))
      const result = info.quantizeOrientation(rot, 0)
      expect(result.roll.angle).toBe(rot.roll.angle)
      expect(result.pitch.angle).toBe(rot.pitch.angle)
      expect(result.yaw.angle).toBe(rot.yaw.angle)
    })

    it('zeros out roll and pitch when quantizing yaw', () => {
      const info = new BodyOrientationInfo()
      // Use yaw=30° (not on a step boundary for 8 facings)
      // 30° → 30*1024/360=85. 8 facings → step=128. 85+64=149 → 149/128=1 → result=128
      const rot = new WRot(WAngle.fromDegrees(10), WAngle.fromDegrees(5), WAngle.fromDegrees(30))
      const result = info.quantizeOrientation(rot, 8)
      expect(result.roll.angle).toBe(0)
      expect(result.pitch.angle).toBe(0)
      // yaw should be quantized (85 → 128)
      expect(result.yaw.angle).toBe(128)
      expect(result.yaw.angle).not.toBe(rot.yaw.angle)
    })

    it('quantizes yaw to nearest discrete step', () => {
      const info = new BodyOrientationInfo()
      const yaw = WAngle.fromDegrees(50) // 50 * 1024/360 ≈ 142
      const rot = new WRot(WAngle.Zero, WAngle.Zero, yaw)
      const result = info.quantizeOrientation(rot, 8)
      // 8 facings → step=128. yaw≈142 → 142+64=206 &1023=206 → 206/128=1 → result=128
      expect(result.yaw.angle).toBe(128)
    })
  })

  describe('localToWorld', () => {
    it('rotates by 90 degrees when classic fudge is disabled', () => {
      const info = new BodyOrientationInfo(-1, WAngle.fromDegrees(40), false)
      const result = info.localToWorld(new WVec(10, 5, 3))
      // Rotate by 90°: (vec.Y, -vec.X, vec.Z) = (5, -10, 3)
      expect(result.X).toBe(5)
      expect(result.Y).toBe(-10)
      expect(result.Z).toBe(3)
    })

    it('fudges Y axis with camera pitch when classic fudge enabled', () => {
      // cameraPitch default = 40 degrees → sin(40°) lookup
      const info = new BodyOrientationInfo(-1, WAngle.fromDegrees(40), true)
      const pitchSin = info.cameraPitch.sin()
      const result = info.localToWorld(new WVec(10, 5, 3))
      // vec.Y = 5, vec.X = 10
      // result.X = vec.Y = 5
      // result.Y = -(pitchSin * vec.X / 1024)
      // result.Z = vec.Z = 3
      expect(result.X).toBe(5)
      expect(result.Y).toBe(-Math.trunc((pitchSin * 10) / 1024))
      expect(result.Z).toBe(3)
    })

    it('handles zero vector with fudge enabled', () => {
      const info = new BodyOrientationInfo()
      const result = info.localToWorld(new WVec(0, 0, 0))
      expect(result.X).toBe(0)
      expect(result.Y).toBe(0)
      expect(result.Z).toBe(0)
    })

    it('handles zero vector with fudge disabled', () => {
      const info = new BodyOrientationInfo(-1, WAngle.fromDegrees(40), false)
      const result = info.localToWorld(new WVec(0, 0, 0))
      expect(result.X).toBe(0)
      expect(result.Y).toBe(0)
      expect(result.Z).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// BodyOrientation (runtime trait)
// ---------------------------------------------------------------------------

describe('BodyOrientation', () => {
  describe('construction with explicit quantizedFacings', () => {
    it('uses configured quantizedFacings when >= 0', () => {
      const actor = makeActor()
      const info = new BodyOrientationInfo(8)
      const body = new BodyOrientation(info, actor)
      expect(body.quantizedFacings).toBe(8)
    })

    it('caches quantizedFacings after first access', () => {
      const actor = makeActor()
      const info = new BodyOrientationInfo(16)
      const body = new BodyOrientation(info, actor)
      expect(body.quantizedFacings).toBe(16)
      // Second access should still be 16 (cached)
      expect(body.quantizedFacings).toBe(16)
    })
  })

  describe('construction with IQuantizeBodyOrientationInfo', () => {
    it('uses IQuantizeBodyOrientationInfo when config is -1', () => {
      const actor = makeActor('myUnit')
      const info = new BodyOrientationInfo(-1) // auto-detect
      const qboi = makeQboi(32)
      const body = new BodyOrientation(info, actor, qboi)
      expect(body.quantizedFacings).toBe(32)
    })

    it('throws when no IQuantizeBodyOrientationInfo and config < 0', () => {
      const actor = makeActor('noQboiUnit')
      const info = new BodyOrientationInfo(-1)
      const body = new BodyOrientation(info, actor, null)
      expect(() => body.quantizedFacings).toThrow(
        /does not define a quantized body orientation/,
      )
    })

    it('throws when IQuantizeBodyOrientationInfo returns 0 facings', () => {
      const actor = makeActor('zeroFacingUnit')
      const info = new BodyOrientationInfo(-1)
      const qboi = makeQboi(0) // returns 0 → error
      const body = new BodyOrientation(info, actor, qboi)
      expect(() => body.quantizedFacings).toThrow(
        /with zero facings/,
      )
    })

    it('prefers configured value over IQuantizeBodyOrientationInfo when >= 0', () => {
      const actor = makeActor('configOverride')
      const info = new BodyOrientationInfo(8)
      const qboi = makeQboi(16) // This should be ignored since config is >= 0
      const body = new BodyOrientation(info, actor, qboi)
      expect(body.quantizedFacings).toBe(8)
    })
  })

  describe('cameraPitch', () => {
    it('returns the camera pitch from info', () => {
      const actor = makeActor()
      const info = new BodyOrientationInfo(8, WAngle.fromDegrees(30))
      const body = new BodyOrientation(info, actor)
      expect(body.cameraPitch.angle).toBe(WAngle.fromDegrees(30).angle)
    })
  })

  describe('localToWorld', () => {
    it('delegates to info.localToWorld', () => {
      const actor = makeActor()
      const info = new BodyOrientationInfo(8, WAngle.fromDegrees(40), false)
      const body = new BodyOrientation(info, actor)
      const result = body.localToWorld(new WVec(10, 5, 3))
      expect(result.X).toBe(5)
      expect(result.Y).toBe(-10)
      expect(result.Z).toBe(3)
    })
  })

  describe('quantizeOrientation', () => {
    it('delegates to info with cached facings', () => {
      const actor = makeActor()
      const info = new BodyOrientationInfo(8)
      const body = new BodyOrientation(info, actor)
      const rot = new WRot(WAngle.fromDegrees(10), WAngle.fromDegrees(5), WAngle.fromDegrees(45))
      const result = body.quantizeOrientation(rot)
      expect(result.roll.angle).toBe(0)
      expect(result.pitch.angle).toBe(0)
    })
  })

  describe('quantizeFacing', () => {
    it('quantizeFacing(facing) uses cached facings', () => {
      const actor = makeActor()
      const info = new BodyOrientationInfo(8)
      const body = new BodyOrientation(info, actor)
      const result = body.quantizeFacing(new WAngle(150))
      // With 8 facings: step=128 → result=128
      expect(result.angle).toBe(128)
    })

    it('quantizeFacing(facing, facings) uses explicit facings', () => {
      const actor = makeActor()
      const info = new BodyOrientationInfo(8) // configured but not used in 2-arg form
      const body = new BodyOrientation(info, actor)
      const result = body.quantizeFacing(new WAngle(100), 16)
      // With 16 facings: step=64 → 100+32=132 &1023=132 → 132/64=2 → result=128
      expect(result.angle).toBe(128)
    })
  })
})
