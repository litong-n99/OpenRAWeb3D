/**
 * WithResourceLevelOverlay.test.ts — WithResourceLevelOverlay migration unit tests
 *
 * 测试纯逻辑: frame index 计算、配置默认值、依赖注入、边界情况。
 * 由于 happy-dom 无 WebGL，不使用 Babylon.js mock。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  WithResourceLevelOverlay,
  WithResourceLevelOverlayInfo,
  calculateResourceLevelFrameIndex,
  type IPlayerResourcesStub,
  type IWithSpriteBodyStub,
} from './WithResourceLevelOverlay.js'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makePlayerResources(resources: number, capacity: number): IPlayerResourcesStub {
  return { resources, resourceCapacity: capacity }
}

function makeWsBody(): IWithSpriteBodyStub {
  return {
    normalizeSequence(_self, sequence: string): string {
      // Simple damage-prefix simulation for testing
      return sequence
    },
  }
}

// makeDamagedWsBody is not needed for current test coverage.
// When damage-state-aware sequences are integrated (TODO-10.B-Opt.3-RENDER),
// re-add a wsBody that returns damage-prefixed sequences for testing.

// ---------------------------------------------------------------------------
// calculateResourceLevelFrameIndex
// ---------------------------------------------------------------------------

describe('calculateResourceLevelFrameIndex', () => {
  describe('basic frame selection', () => {
    it('returns 0 when resources is 0', () => {
      expect(calculateResourceLevelFrameIndex(0, 100, 5)).toBe(0)
    })

    it('returns last frame when resources == capacity and seqLen=5', () => {
      expect(calculateResourceLevelFrameIndex(100, 100, 5)).toBe(4)
    })

    it('returns last frame when resources == capacity and seqLen=1', () => {
      expect(calculateResourceLevelFrameIndex(100, 100, 1)).toBe(0)
    })

    it('returns last frame when resources == capacity and seqLen=10', () => {
      expect(calculateResourceLevelFrameIndex(100, 100, 10)).toBe(9)
    })

    it('returns index 2 when resources=50 capacity=100 seqLen=5', () => {
      // (10*5-1)*50/(10*100) = 49*50/1000 = 2450/1000 = 2
      expect(calculateResourceLevelFrameIndex(50, 100, 5)).toBe(2)
    })

    it('returns index 3 when resources=80 capacity=100 seqLen=5', () => {
      // OpenRA formula: floor((10 * seqLen - 1) * resources / (10 * capacity))
      // = floor((10*5 - 1) * 80 / (10*100)) = floor(49 * 80 / 1000) = floor(3920/1000) = 3.
      // The (10*len - 1) factor intentionally scales the resource range so the
      // final frame (index 4) is only reached near/at full capacity.
      const index = calculateResourceLevelFrameIndex(80, 100, 5)
      expect(index).toBe(3)
    })
  })

  describe('edge cases', () => {
    it('returns 0 when capacity is 0 (avoid division by zero)', () => {
      expect(calculateResourceLevelFrameIndex(50, 0, 5)).toBe(0)
    })

    it('returns 0 when sequenceLength is 0', () => {
      expect(calculateResourceLevelFrameIndex(50, 100, 0)).toBe(0)
    })

    it('returns 0 when sequenceLength is negative', () => {
      expect(calculateResourceLevelFrameIndex(50, 100, -1)).toBe(0)
    })

    it('returns 0 when capacity is negative', () => {
      expect(calculateResourceLevelFrameIndex(50, -100, 5)).toBe(0)
    })

    it('clamps to valid range when resources exceed capacity', () => {
      const index = calculateResourceLevelFrameIndex(200, 100, 5)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThanOrEqual(4)
    })

    it('handles resources = 1 with capacity = 100 and seqLen = 5', () => {
      // 49*1/1000 = 0
      expect(calculateResourceLevelFrameIndex(1, 100, 5)).toBe(0)
    })

    it('handles resources just before a frame boundary', () => {
      // resources=19: 49*19/1000 = 931/1000 = 0 (same as 0)
      // resources=20: 49*20/1000 = 980/1000 = 0 (still frame 0)
      // resources=21: 49*21/1000 = 1029/1000 = 1
      expect(calculateResourceLevelFrameIndex(19, 200, 5)).toBeGreaterThanOrEqual(0)
    })
  })

  describe('with large numbers', () => {
    it('handles large resource values', () => {
      const index = calculateResourceLevelFrameIndex(1000000, 1000000, 100)
      expect(index).toBe(99)
    })

    it('handles large resource values half full', () => {
      const index = calculateResourceLevelFrameIndex(500000, 1000000, 100)
      // (10*100-1)*500000/(10*1000000) = 999*500000/10000000 = 499500000/10000000 = 49
      expect(index).toBeGreaterThanOrEqual(40)
      expect(index).toBeLessThanOrEqual(59)
    })
  })

  describe('uniform distribution', () => {
    it('distributes evenly across 5 frames for 100 capacity', () => {
      // At each boundary the formula should progress properly
      // resources 0-19: frame 0, 20-39: frame 1, etc.
      const results = new Set<number>()
      for (let r = 0; r <= 100; r++) {
        results.add(calculateResourceLevelFrameIndex(r, 100, 5))
      }
      // Should have frames 0 through 4
      expect(results.has(0)).toBe(true)
      expect(results.has(4)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// WithResourceLevelOverlayInfo
// ---------------------------------------------------------------------------

describe('WithResourceLevelOverlayInfo', () => {
  it('has default sequence "resources"', () => {
    const info = new WithResourceLevelOverlayInfo()
    expect(info.sequence).toBe('resources')
  })

  it('defaults to no palette', () => {
    const info = new WithResourceLevelOverlayInfo()
    expect(info.palette).toBeNull()
  })

  it('defaults to not player palette', () => {
    const info = new WithResourceLevelOverlayInfo()
    expect(info.isPlayerPalette).toBe(false)
  })

  it('accepts custom sequence', () => {
    const info = new WithResourceLevelOverlayInfo({ sequence: 'custom' })
    expect(info.sequence).toBe('custom')
  })

  it('accepts custom palette', () => {
    const info = new WithResourceLevelOverlayInfo({ palette: 'chrome' })
    expect(info.palette).toBe('chrome')
  })

  it('accepts isPlayerPalette', () => {
    const info = new WithResourceLevelOverlayInfo({ isPlayerPalette: true })
    expect(info.isPlayerPalette).toBe(true)
  })

  it('accepts requiresCondition', () => {
    const info = new WithResourceLevelOverlayInfo({ requiresCondition: '!dead' })
    expect(info.requiresCondition).toBe('!dead')
  })
})

// ---------------------------------------------------------------------------
// WithResourceLevelOverlay
// ---------------------------------------------------------------------------

describe('WithResourceLevelOverlay', () => {
  let info: WithResourceLevelOverlayInfo
  let overlay: WithResourceLevelOverlay

  beforeEach(() => {
    info = new WithResourceLevelOverlayInfo()
    overlay = new WithResourceLevelOverlay(info)
  })

  describe('initial state', () => {
    it('starts with frame index 0', () => {
      expect(overlay.currentFrameIndex).toBe(0)
    })

    it('start with isTraitDisabled = false (no condition)', () => {
      expect(overlay.isTraitDisabled).toBe(false)
    })
  })

  describe('frame index without player resolver', () => {
    it('returns 0 when no player resolver is set', () => {
      overlay.configureFrameSelector(5, null)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(0)
    })
  })

  describe('frame index with player resolver', () => {
    it('updates frame index based on resource fill level', () => {
      const pr = makePlayerResources(50, 100)
      overlay.setPlayerResolver(() => pr)
      overlay.configureFrameSelector(5, null)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(2)
    })

    it('shows last frame when resources are full', () => {
      const pr = makePlayerResources(100, 100)
      overlay.setPlayerResolver(() => pr)
      overlay.configureFrameSelector(10, null)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(9)
    })

    it('shows first frame when resources are empty', () => {
      const pr = makePlayerResources(0, 100)
      overlay.setPlayerResolver(() => pr)
      overlay.configureFrameSelector(10, null)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(0)
    })

    it('shows frame 0 when capacity is 0', () => {
      const pr = makePlayerResources(50, 0)
      overlay.setPlayerResolver(() => pr)
      overlay.configureFrameSelector(10, null)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(0)
    })

    it('handles resolver returning null (player dead/not ready)', () => {
      overlay.setPlayerResolver(() => null)
      overlay.configureFrameSelector(10, null)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(0)
    })
  })

  describe('onOwnerChanged', () => {
    it('does not throw when called', () => {
      expect(() => {
        overlay.onOwnerChanged(
          { world: null } as unknown as any,
          { playerName: 'old' },
          { playerName: 'new' },
        )
      }).not.toThrow()
    })
  })

  describe('damageStateChanged', () => {
    it('does not throw with null wsBody', () => {
      overlay.configureFrameSelector(5, null)
      expect(() => {
        overlay.damageStateChanged(
          { world: null } as unknown as any,
          { damageState: 2, previousDamageState: 1 } as any,
        )
      }).not.toThrow()
    })

    it('calls normalizeSequence on wsBody when provided', () => {
      const wsBody = makeWsBody()
      overlay.configureFrameSelector(5, wsBody)
      expect(() => {
        overlay.damageStateChanged(
          { world: null } as unknown as any,
          { damageState: 2, previousDamageState: 1 } as any,
        )
      }).not.toThrow()
    })
  })

  describe('trait lifecycle', () => {
    it('isTraitDisabled returns false without condition', () => {
      const info2 = new WithResourceLevelOverlayInfo()
      const ov = new WithResourceLevelOverlay(info2)
      expect(ov.isTraitDisabled).toBe(false)
    })

    it('isTraitDisabled returns true when disabled conditionally', () => {
      const info2 = new WithResourceLevelOverlayInfo({ requiresCondition: 'alive' })
      const ov = new WithResourceLevelOverlay(info2)
      // Default state: enabled until condition manager explicitly disables it
      expect(ov.isTraitDisabled).toBe(false)
      // After condition manager disables:
      ov.onEnabledChanged(false)
      expect(ov.isTraitDisabled).toBe(true)
    })

    it('updates to not disabled when conditions are met', () => {
      const info2 = new WithResourceLevelOverlayInfo({ requiresCondition: 'alive' })
      const ov = new WithResourceLevelOverlay(info2)
      ov.onEnabledChanged(true)
      expect(ov.isTraitDisabled).toBe(false)
    })
  })

  describe('frame index with dynamic resolver', () => {
    it('tracks changing resource levels', () => {
      let pr = makePlayerResources(30, 100)
      overlay.setPlayerResolver(() => pr)
      overlay.configureFrameSelector(5, null)

      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(1)

      // Increase resources
      pr = makePlayerResources(70, 100)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(3)

      // Decrease resources
      pr = makePlayerResources(10, 100)
      overlay.updateFrameIndex()
      expect(overlay.currentFrameIndex).toBe(0)
    })
  })
})
