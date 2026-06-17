/**
 * ChronoshiftPostProcessEffect.test.ts — unit tests for chronoshift post-process effect
 *
 * Tests focus on: state management, enable/disable lifecycle, blend factor
 * computation, and tick-based countdown.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ChronoshiftPostProcessEffectInfo,
  ChronoshiftPostProcessEffect,
} from './ChronoshiftPostProcessEffect.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name: 'world' },
  }
}

// ---------------------------------------------------------------------------
// ChronoshiftPostProcessEffectInfo
// ---------------------------------------------------------------------------

describe('ChronoshiftPostProcessEffectInfo', () => {
  describe('defaults', () => {
    const info = new ChronoshiftPostProcessEffectInfo()

    it('has default chronoEffectLength of 60', () => {
      expect(info.chronoEffectLength).toBe(60)
    })
  })

  describe('custom params', () => {
    it('accepts custom chronoEffectLength', () => {
      const info = new ChronoshiftPostProcessEffectInfo({ chronoEffectLength: 120 })
      expect(info.chronoEffectLength).toBe(120)
    })
  })

  describe('create', () => {
    it('creates a ChronoshiftPostProcessEffect instance', () => {
      const info = new ChronoshiftPostProcessEffectInfo()
      const actor = makeActor()
      const effect = info.create(actor)
      expect(effect).toBeInstanceOf(ChronoshiftPostProcessEffect)
      expect(effect.info).toBe(info)
    })
  })
})

// ---------------------------------------------------------------------------
// ChronoshiftPostProcessEffect
// ---------------------------------------------------------------------------

describe('ChronoshiftPostProcessEffect', () => {
  let info: ChronoshiftPostProcessEffectInfo
  let effect: ChronoshiftPostProcessEffect
  let actor: IGameActor

  beforeEach(() => {
    info = new ChronoshiftPostProcessEffectInfo({ chronoEffectLength: 30 })
    effect = new ChronoshiftPostProcessEffect(info)
    actor = makeActor()
  })

  describe('initial state', () => {
    it('is not enabled initially', () => {
      expect(effect.enabled).toBe(false)
    })

    it('has remainingFrames of 0 initially', () => {
      expect(effect.remainingFrames).toBe(0)
    })

    it('has blendFactor of 0 initially', () => {
      expect(effect.blendFactor).toBe(0)
    })

    it('has correct passName', () => {
      expect(effect.passName).toBe('chronoshift')
    })
  })

  describe('enable()', () => {
    it('sets remainingFrames to chronoEffectLength', () => {
      effect.enable()
      expect(effect.remainingFrames).toBe(30)
    })

    it('sets enabled to true', () => {
      effect.enable()
      expect(effect.enabled).toBe(true)
    })

    it('has blendFactor of 1.0 immediately after enable', () => {
      effect.enable()
      expect(effect.blendFactor).toBeCloseTo(1.0, 5)
    })

    it('resets to full duration even if partially through', () => {
      effect.enable()
      for (let i = 0; i < 15; i++) effect.tick(actor)
      expect(effect.remainingFrames).toBe(15)
      effect.enable()
      expect(effect.remainingFrames).toBe(30)
    })

    it('restarts from zero state', () => {
      for (let i = 0; i < 30; i++) effect.tick(actor)
      expect(effect.enabled).toBe(false)
      effect.enable()
      expect(effect.enabled).toBe(true)
      expect(effect.remainingFrames).toBe(30)
    })
  })

  describe('tick()', () => {
    it('decrements remainingFrames', () => {
      effect.enable()
      effect.tick(actor)
      expect(effect.remainingFrames).toBe(29)
    })

    it('does nothing when not enabled', () => {
      effect.tick(actor)
      expect(effect.remainingFrames).toBe(0)
    })

    it('does not go below zero', () => {
      effect.enable()
      for (let i = 0; i < 50; i++) effect.tick(actor)
      expect(effect.remainingFrames).toBe(0)
      expect(effect.enabled).toBe(false)
    })

    it('disables after full countdown', () => {
      effect.enable()
      for (let i = 0; i < 30; i++) effect.tick(actor)
      expect(effect.enabled).toBe(false)
    })

    it('disables exactly on the last tick', () => {
      effect.enable()
      for (let i = 0; i < 29; i++) effect.tick(actor)
      expect(effect.enabled).toBe(true)
      expect(effect.remainingFrames).toBe(1)
      effect.tick(actor)
      expect(effect.enabled).toBe(false)
      expect(effect.remainingFrames).toBe(0)
    })
  })

  describe('blendFactor', () => {
    it('decreases linearly from 1.0', () => {
      effect.enable()
      expect(effect.blendFactor).toBeCloseTo(1.0, 5)
    })

    it('reaches 0.5 at halfway', () => {
      effect.enable()
      for (let i = 0; i < 15; i++) effect.tick(actor)
      expect(effect.blendFactor).toBeCloseTo(0.5, 5)
    })

    it('reaches 0.0 when expired', () => {
      effect.enable()
      for (let i = 0; i < 30; i++) effect.tick(actor)
      expect(effect.blendFactor).toBe(0)
    })

    it('is 0 when disabled', () => {
      expect(effect.blendFactor).toBe(0)
    })

    it('returns 0 when chronoEffectLength is 0 (edge case)', () => {
      const zeroInfo = new ChronoshiftPostProcessEffectInfo({ chronoEffectLength: 0 })
      const zeroEffect = new ChronoshiftPostProcessEffect(zeroInfo)
      zeroEffect.enable()
      // enabled remains false because remainingFrames starts at 0 and is NOT > 0
      // but wait: enable() sets remainingFrames to 0, so enabled is false
      expect(zeroEffect.enabled).toBe(false)
      expect(zeroEffect.blendFactor).toBe(0)
    })
  })

  describe('multiple enable cycles', () => {
    it('handles enable during active effect', () => {
      effect.enable()
      for (let i = 0; i < 10; i++) effect.tick(actor)
      expect(effect.remainingFrames).toBe(20)
      // Re-enable: resets to full duration (matching OpenRA behavior)
      effect.enable()
      expect(effect.remainingFrames).toBe(30)
      expect(effect.blendFactor).toBeCloseTo(1.0, 5)
    })

    it('handles enable after expiration', () => {
      effect.enable()
      for (let i = 0; i < 30; i++) effect.tick(actor)
      expect(effect.enabled).toBe(false)
      effect.enable()
      expect(effect.enabled).toBe(true)
      expect(effect.blendFactor).toBeCloseTo(1.0, 5)
    })
  })
})
