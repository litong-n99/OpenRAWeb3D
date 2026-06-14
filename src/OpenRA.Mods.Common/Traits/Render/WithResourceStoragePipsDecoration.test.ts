/**
 * WithResourceStoragePipsDecoration.test.ts — WithResourceStoragePipsDecoration unit tests
 *
 * 测试纯逻辑: pip 计数计算、pip 数据生成、配置默认值、边界情况。
 * 由于 happy-dom 无 WebGL，不使用 Babylon.js mock。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  WithResourceStoragePipsDecoration,
  WithResourceStoragePipsDecorationInfo,
  calculateFilledPips,
  generatePipData,
} from './WithResourceStoragePipsDecoration.js'
import type { IPlayerResourcesStub } from './WithResourceLevelOverlay.js'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makePlayerResources(resources: number, capacity: number): IPlayerResourcesStub {
  return { resources, resourceCapacity: capacity }
}

// ---------------------------------------------------------------------------
// calculateFilledPips
// ---------------------------------------------------------------------------

describe('calculateFilledPips', () => {
  describe('basic counting', () => {
    it('returns 0 when resources is 0', () => {
      expect(calculateFilledPips(0, 100, 5)).toBe(0)
    })

    it('returns all pips filled when resources == capacity', () => {
      expect(calculateFilledPips(100, 100, 5)).toBe(5)
    })

    it('returns half filled for 50/100 with 10 pips', () => {
      // C#: 50*10=500 > 0,100,200,300,400 but not 500 → 5 filled
      expect(calculateFilledPips(50, 100, 10)).toBe(5)
    })

    it('returns 1 filled for 20/100 with 5 pips', () => {
      expect(calculateFilledPips(20, 100, 5)).toBe(1)
    })

    it('returns 2 filled for 40/100 with 5 pips', () => {
      expect(calculateFilledPips(40, 100, 5)).toBe(2)
    })

    it('returns 3 filled for 60/100 with 5 pips', () => {
      expect(calculateFilledPips(60, 100, 5)).toBe(3)
    })

    it('returns 4 filled for 80/100 with 5 pips', () => {
      expect(calculateFilledPips(80, 100, 5)).toBe(4)
    })
  })

  describe('edge cases', () => {
    it('returns 0 when capacity is 0', () => {
      expect(calculateFilledPips(50, 0, 5)).toBe(0)
    })

    it('returns 0 when pipCount is 0', () => {
      expect(calculateFilledPips(50, 100, 0)).toBe(0)
    })

    it('returns 0 when pipCount is negative', () => {
      expect(calculateFilledPips(50, 100, -1)).toBe(0)
    })

    it('returns 0 when capacity is negative', () => {
      expect(calculateFilledPips(50, -100, 5)).toBe(0)
    })

    it('clamps to pipCount when resources > capacity', () => {
      expect(calculateFilledPips(200, 100, 5)).toBe(5)
    })

    it('returns 0 when resources are negative', () => {
      // resources < 0 => negative fill rate, but we clamp to 0
      const result = calculateFilledPips(-10, 100, 5)
      // -10*5/100 = -50/100 = 0 (floor), then clamped to 0
      expect(result).toBe(0)
    })
  })

  describe('with 1 pip', () => {
    it('returns 0 pip when resources is 0', () => {
      expect(calculateFilledPips(0, 100, 1)).toBe(0)
    })

    it('returns 1 pip when resources > 0 and < capacity', () => {
      // C#: 50*1=50 > 0*100=0 (true) → 1 filled
      expect(calculateFilledPips(50, 100, 1)).toBe(1)
    })

    it('returns 1 pip when resources == capacity', () => {
      expect(calculateFilledPips(100, 100, 1)).toBe(1)
    })
  })

  describe('uniform boundary thresholds', () => {
    it('boundaries are correct for 10 pips over 100 capacity', () => {
      // C# strict-greater-than: resources*PipCount > i*capacity
      // 0*10=0  → 0>0 false, 0>100 false... → 0 filled
      expect(calculateFilledPips(0, 100, 10)).toBe(0)
      // 9*10=90  → 90>0 true, 90>100 false → 1 filled
      expect(calculateFilledPips(9, 100, 10)).toBe(1)
      // 10*10=100 → 100>0 true, 100>100 false → 1 filled
      expect(calculateFilledPips(10, 100, 10)).toBe(1)
      // 19*10=190 → 190>0 true, 190>100 true, 190>200 false → 2 filled
      expect(calculateFilledPips(19, 100, 10)).toBe(2)
      // 20*10=200 → 200>0 true, 200>100 true, 200>200 false → 2 filled
      expect(calculateFilledPips(20, 100, 10)).toBe(2)
      // 90*10=900 → 900>0..800 all true, 900>900 false → 9 filled
      expect(calculateFilledPips(90, 100, 10)).toBe(9)
      // 99*10=990 → 990>0..900 all true → 10 filled
      expect(calculateFilledPips(99, 100, 10)).toBe(10)
      // 100*10=1000 → 1000>0..900 all true → 10 filled
      expect(calculateFilledPips(100, 100, 10)).toBe(10)
    })
  })
})

// ---------------------------------------------------------------------------
// generatePipData
// ---------------------------------------------------------------------------

describe('generatePipData', () => {
  it('returns empty array when pipCount is 0', () => {
    const result = generatePipData(50, 100, 0, 'full', 'empty')
    expect(result).toHaveLength(0)
  })

  it('returns all empty pips when resources is 0', () => {
    const result = generatePipData(0, 100, 5, 'full', 'empty')
    expect(result).toHaveLength(5)
    for (const pip of result) {
      expect(pip.isFilled).toBe(false)
      expect(pip.sequence).toBe('empty')
    }
  })

  it('returns all full pips when resources == capacity', () => {
    const result = generatePipData(100, 100, 5, 'full', 'empty')
    expect(result).toHaveLength(5)
    for (const pip of result) {
      expect(pip.isFilled).toBe(true)
      expect(pip.sequence).toBe('full')
    }
  })

  it('returns correct mix of full/empty', () => {
    const result = generatePipData(40, 100, 5, 'pip-green', 'pip-empty')
    expect(result).toHaveLength(5)
    // C#: 40*5=200 > 0,100 but not 200 → 2 filled
    expect(result[0].isFilled).toBe(true)
    expect(result[1].isFilled).toBe(true)
    expect(result[2].isFilled).toBe(false)
    expect(result[3].isFilled).toBe(false)
    expect(result[4].isFilled).toBe(false)
  })

  it('preserves sequence names in output', () => {
    const result = generatePipData(60, 100, 5, 'pip-blue', 'pip-dark')
    // C#: 60*5=300 > 0,100,200 but not 300 → 3 filled
    expect(result[0].sequence).toBe('pip-blue')
    expect(result[2].sequence).toBe('pip-blue')
    expect(result[3].sequence).toBe('pip-dark')
    expect(result[4].sequence).toBe('pip-dark')
  })

  it('indices are correct', () => {
    const result = generatePipData(80, 100, 5, 'f', 'e')
    // C#: 80*5=400 > 0,100,200,300 but not 400 → 4 filled
    for (let i = 0; i < 5; i++) {
      expect(result[i].index).toBe(i)
    }
  })

  it('handles capacity = 0 by returning all empty', () => {
    const result = generatePipData(50, 0, 5, 'f', 'e')
    for (const pip of result) {
      expect(pip.isFilled).toBe(false)
      expect(pip.sequence).toBe('e')
    }
  })

  it('matches OpenRA strict-greater-than semantics for non-integer ratios', () => {
    const result = generatePipData(50, 100, 5, 'full', 'empty')
    // C#: 50*5=250 > 0,100,200 but not 300,400 → 3 full
    expect(result[0].isFilled).toBe(true)
    expect(result[1].isFilled).toBe(true)
    expect(result[2].isFilled).toBe(true)
    expect(result[3].isFilled).toBe(false)
    expect(result[4].isFilled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WithResourceStoragePipsDecorationInfo
// ---------------------------------------------------------------------------

describe('WithResourceStoragePipsDecorationInfo', () => {
  it('defaults pipCount to 0', () => {
    const info = new WithResourceStoragePipsDecorationInfo()
    expect(info.pipCount).toBe(0)
  })

  it('defaults image to "pips"', () => {
    const info = new WithResourceStoragePipsDecorationInfo()
    expect(info.image).toBe('pips')
  })

  it('defaults emptySequence to "pip-empty"', () => {
    const info = new WithResourceStoragePipsDecorationInfo()
    expect(info.emptySequence).toBe('pip-empty')
  })

  it('defaults fullSequence to "pip-green"', () => {
    const info = new WithResourceStoragePipsDecorationInfo()
    expect(info.fullSequence).toBe('pip-green')
  })

  it('defaults palette to "chrome"', () => {
    const info = new WithResourceStoragePipsDecorationInfo()
    expect(info.palette).toBe('chrome')
  })

  it('accepts custom pipCount', () => {
    const info = new WithResourceStoragePipsDecorationInfo({ pipCount: 10 })
    expect(info.pipCount).toBe(10)
  })

  it('accepts custom pipStride', () => {
    const info = new WithResourceStoragePipsDecorationInfo({ pipStride: { x: 5, y: 0 } })
    expect(info.pipStride.x).toBe(5)
    expect(info.pipStride.y).toBe(0)
  })

  it('accepts custom sequences', () => {
    const info = new WithResourceStoragePipsDecorationInfo({
      emptySequence: 'e',
      fullSequence: 'f',
    })
    expect(info.emptySequence).toBe('e')
    expect(info.fullSequence).toBe('f')
  })

  it('accepts requiresCondition', () => {
    const info = new WithResourceStoragePipsDecorationInfo({ requiresCondition: '!dead' })
    expect(info.requiresCondition).toBe('!dead')
  })
})

// ---------------------------------------------------------------------------
// WithResourceStoragePipsDecoration
// ---------------------------------------------------------------------------

describe('WithResourceStoragePipsDecoration', () => {
  let info: WithResourceStoragePipsDecorationInfo
  let deco: WithResourceStoragePipsDecoration

  beforeEach(() => {
    info = new WithResourceStoragePipsDecorationInfo({ pipCount: 5 })
    deco = new WithResourceStoragePipsDecoration(info)
  })

  describe('initial state', () => {
    it('starts with empty pip data', () => {
      expect(deco.pipData).toHaveLength(0)
    })

    it('starts with 0 filled pips', () => {
      expect(deco.filledPipCount).toBe(0)
    })

    it('starts with isTraitDisabled = false', () => {
      expect(deco.isTraitDisabled).toBe(false)
    })
  })

  describe('updatePipData', () => {
    it('sets pip data from PlayerResources', () => {
      const pr = makePlayerResources(40, 100)
      deco.setPlayerResolver(() => pr)
      deco.updatePipData()

      expect(deco.pipData).toHaveLength(5)
      expect(deco.filledPipCount).toBe(2)
    })

    it('all pips filled when resources == capacity', () => {
      const pr = makePlayerResources(100, 100)
      deco.setPlayerResolver(() => pr)
      deco.updatePipData()

      expect(deco.filledPipCount).toBe(5)
      for (const pip of deco.pipData) {
        expect(pip.isFilled).toBe(true)
        expect(pip.sequence).toBe('pip-green')
      }
    })

    it('all pips empty when resources == 0', () => {
      const pr = makePlayerResources(0, 100)
      deco.setPlayerResolver(() => pr)
      deco.updatePipData()

      expect(deco.filledPipCount).toBe(0)
      for (const pip of deco.pipData) {
        expect(pip.isFilled).toBe(false)
        expect(pip.sequence).toBe('pip-empty')
      }
    })

    it('all pips empty when resolver returns null', () => {
      deco.setPlayerResolver(() => null)
      deco.updatePipData()

      expect(deco.filledPipCount).toBe(0)
      for (const pip of deco.pipData) {
        expect(pip.isFilled).toBe(false)
      }
    })

    it('all pips empty when no resolver set', () => {
      deco.updatePipData()
      expect(deco.filledPipCount).toBe(0)
    })
  })

  describe('pip data with custom sequences', () => {
    it('uses custom full and empty sequences', () => {
      const info2 = new WithResourceStoragePipsDecorationInfo({
        pipCount: 3,
        fullSequence: 'pip-blue',
        emptySequence: 'pip-dark',
      })
      const deco2 = new WithResourceStoragePipsDecoration(info2)
      const pr = makePlayerResources(50, 100)
      deco2.setPlayerResolver(() => pr)
      deco2.updatePipData()

      // C#: 50*3=150 > 0,100 but not 200 → 2 filled
      expect(deco2.filledPipCount).toBe(2)
      expect(deco2.pipData[0].sequence).toBe('pip-blue')
      expect(deco2.pipData[1].sequence).toBe('pip-blue')
      expect(deco2.pipData[2].sequence).toBe('pip-dark')
    })
  })

  describe('onOwnerChanged', () => {
    it('does not throw', () => {
      expect(() => {
        deco.onOwnerChanged(
          { world: null } as unknown as any,
          { playerName: 'old' },
          { playerName: 'new' },
        )
      }).not.toThrow()
    })
  })

  describe('conditional trait integration', () => {
    it('isTraitDisabled is true with unmet condition', () => {
      const info2 = new WithResourceStoragePipsDecorationInfo({
        pipCount: 5,
        requiresCondition: 'alive',
      })
      const deco2 = new WithResourceStoragePipsDecoration(info2)
      // Default state: enabled until condition manager explicitly disables it
      expect(deco2.isTraitDisabled).toBe(false)
      // After condition manager disables:
      deco2.onEnabledChanged(false)
      expect(deco2.isTraitDisabled).toBe(true)
    })

    it('isTraitDisabled becomes false when condition met', () => {
      const info2 = new WithResourceStoragePipsDecorationInfo({
        pipCount: 5,
        requiresCondition: 'alive',
      })
      const deco2 = new WithResourceStoragePipsDecoration(info2)
      deco2.onEnabledChanged(true)
      expect(deco2.isTraitDisabled).toBe(false)
    })
  })

  describe('dynamic resource updates', () => {
    it('tracks changing resource levels', () => {
      let pr = makePlayerResources(20, 100)
      deco.setPlayerResolver(() => pr)
      deco.updatePipData()
      // C#: 20*5=100 > 0 but not 100 → 1 filled
      expect(deco.filledPipCount).toBe(1)

      // Increase
      pr = makePlayerResources(60, 100)
      deco.updatePipData()
      // C#: 60*5=300 > 0,100,200 but not 300 → 3 filled
      expect(deco.filledPipCount).toBe(3)

      // Decrease
      pr = makePlayerResources(10, 100)
      deco.updatePipData()
      // C#: 10*5=50 > 0 but not 100 → 1 filled
      expect(deco.filledPipCount).toBe(1)
    })
  })
})
