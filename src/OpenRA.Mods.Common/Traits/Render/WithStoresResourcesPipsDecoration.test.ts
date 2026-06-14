/**
 * WithStoresResourcesPipsDecoration.test.ts — WithStoresResourcesPipsDecoration unit tests
 *
 * 测试纯逻辑: 按资源类型分区分配 pip、自定义序列、边界情况。
 * 由于 happy-dom 无 WebGL，不使用 Babylon.js mock。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  WithStoresResourcesPipsDecoration,
  WithStoresResourcesPipsDecorationInfo,
  getPipSequence,
  isPipFilled,
  generateResourcePipsData,
} from './WithStoresResourcesPipsDecoration.js'
import type { IStoresResources } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

/** Create an IStoresResources stub with given contents and capacity. */
function makeStoresResources(
  contents: ReadonlyMap<string, number>,
  capacity: number = 100,
): IStoresResources {
  let sum = 0
  for (const v of contents.values()) sum += v
  return {
    capacity,
    contents,
    contentsSum: sum,
    hasType(type: string): boolean { return contents.has(type) },
    addResource(_type: string, value: number): number { return value },
    removeResource(_type: string, value: number): number { return value },
  }
}

// ---------------------------------------------------------------------------
// getPipSequence
// ---------------------------------------------------------------------------

describe('getPipSequence', () => {
  const fullSeq = 'pip-green'
  const emptySeq = 'pip-empty'
  const resourceSeqs: Record<string, string> = {
    Tiberium: 'pip-green',
    Ore: 'pip-orange',
    Gems: 'pip-blue',
  }

  describe('single resource type', () => {
    it('first pips are filled with resource type sequence', () => {
      const contents = new Map([['Tiberium', 100]])
      // Threshold for pip 0: 0*100/10 = 0 < 100 → Tiberium
      expect(getPipSequence(0, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-green')
      // Threshold for pip 5: 5*100/10 = 50 < 100 → Tiberium
      expect(getPipSequence(5, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-green')
      // Threshold for pip 9: 9*100/10 = 90 < 100 → Tiberium
      expect(getPipSequence(9, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-green')
    })

    it('pips beyond capacity are empty', () => {
      const contents = new Map([['Tiberium', 50]])
      // Threshold for pip 5: 5*100/10 = 50 → not < 50 (first entry), n becomes 0 → no more → empty
      expect(getPipSequence(5, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe(emptySeq)
      // Threshold for pip 9: 9*100/10 = 90 → 90 >= 50, n = 40 → no more → empty
      expect(getPipSequence(9, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe(emptySeq)
    })
  })

  describe('multiple resource types', () => {
    it('partitions pips by resource amounts', () => {
      // 50 Tiberium, 50 Ore = total 100
      const contents = new Map([['Tiberium', 50], ['Ore', 50]])

      // Pip 0: threshold=0 < 50 → Tiberium → pip-green
      expect(getPipSequence(0, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-green')
      // Pip 4: threshold=40 < 50 → Tiberium → pip-green
      expect(getPipSequence(4, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-green')
      // Pip 5: threshold=50, n = 50-50=0 → 0 < 50 (Ore) → Ore → pip-orange
      expect(getPipSequence(5, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-orange')
      // Pip 9: threshold=90, n = 90-50=40 < 50 (Ore) → Ore → pip-orange
      expect(getPipSequence(9, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-orange')
    })

    it('handles three resource types', () => {
      // 30 Tiberium, 40 Ore, 30 Gems = total 100
      const contents = new Map([['Tiberium', 30], ['Ore', 40], ['Gems', 30]])

      // Pip 0: 0 < 30 → Tiberium
      expect(getPipSequence(0, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-green')
      // Pip 2: 20 < 30 → Tiberium
      expect(getPipSequence(2, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-green')
      // Pip 3: 30, n=0 → 0 < 40 → Ore
      expect(getPipSequence(3, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-orange')
      // Pip 6: 60, n=30 → 30 < 40 → Ore
      expect(getPipSequence(6, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-orange')
      // Pip 7: 70, n=40 → 40 >= 30 (Gems), n=10 → no more → empty!
      // Wait: 40 >= 30, so n=70-30-40=0. 0 < 30 (Gems) → Gems
      // Let me recalculate: Pip 7 → threshold = 7*100/10 = 70
      // Tiberium: 70 >= 30, n = 40. Ore: 40 >= 40, n = 0. Gems: 0 < 30 → Gems
      expect(getPipSequence(7, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-blue')
      // Pip 9: 90 → Tiberium: 90 >= 30, n=60. Ore: 60 >= 40, n=20. Gems: 20 < 30 → Gems
      expect(getPipSequence(9, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe('pip-blue')
    })
  })

  describe('without resourceSequences', () => {
    it('uses fullSequence when no custom sequence for resource type', () => {
      const contents = new Map([['UnknownResource', 100]])
      const result = getPipSequence(0, 100, 10, contents, {}, fullSeq, emptySeq)
      expect(result).toBe(fullSeq)
    })
  })

  describe('edge cases', () => {
    it('returns emptySequence when pipCount is 0', () => {
      const contents = new Map([['Tiberium', 100]])
      expect(getPipSequence(0, 100, 0, contents, resourceSeqs, fullSeq, emptySeq)).toBe(emptySeq)
    })

    it('returns emptySequence when capacity is 0', () => {
      const contents = new Map([['Tiberium', 100]])
      expect(getPipSequence(0, 0, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe(emptySeq)
    })

    it('returns emptySequence when contents is empty', () => {
      const contents = new Map<string, number>()
      expect(getPipSequence(0, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe(emptySeq)
    })

    it('returns empty for pip index beyond stored amount', () => {
      const contents = new Map([['Tiberium', 30]])
      // Pip 3: threshold=30 >= 30 (Tiberium), n=0, no more → empty
      expect(getPipSequence(3, 100, 10, contents, resourceSeqs, fullSeq, emptySeq)).toBe(emptySeq)
    })
  })
})

// ---------------------------------------------------------------------------
// isPipFilled
// ---------------------------------------------------------------------------

describe('isPipFilled', () => {
  it('returns true for pips within stored amount', () => {
    const contents = new Map([['Tiberium', 50]])
    expect(isPipFilled(0, 100, 10, contents)).toBe(true)
    expect(isPipFilled(4, 100, 10, contents)).toBe(true)
  })

  it('returns false for pips beyond stored amount', () => {
    const contents = new Map([['Tiberium', 50]])
    expect(isPipFilled(5, 100, 10, contents)).toBe(false)
    expect(isPipFilled(9, 100, 10, contents)).toBe(false)
  })

  it('returns false when pipCount is 0', () => {
    const contents = new Map([['Tiberium', 100]])
    expect(isPipFilled(0, 100, 0, contents)).toBe(false)
  })

  it('returns false when capacity is 0', () => {
    const contents = new Map([['Tiberium', 100]])
    expect(isPipFilled(0, 0, 10, contents)).toBe(false)
  })

  it('returns false when contents is empty', () => {
    const contents = new Map<string, number>()
    expect(isPipFilled(5, 100, 10, contents)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generateResourcePipsData
// ---------------------------------------------------------------------------

describe('generateResourcePipsData', () => {
  const resourceSeqs: Record<string, string> = {
    Tiberium: 'pip-green',
    Ore: 'pip-orange',
    Gems: 'pip-blue',
  }

  it('returns empty array when pipCount is 0', () => {
    const contents = new Map([['Tiberium', 100]])
    const result = generateResourcePipsData(0, 100, contents, resourceSeqs, 'full', 'empty')
    expect(result).toHaveLength(0)
  })

  it('all pips filled when contents sum == capacity', () => {
    const contents = new Map([['Tiberium', 100]])
    const result = generateResourcePipsData(10, 100, contents, resourceSeqs, 'full', 'empty')
    expect(result).toHaveLength(10)
    for (const pip of result) {
      expect(pip.isFilled).toBe(true)
      expect(pip.sequence).toBe('pip-green')
      expect(pip.resourceType).toBe('Tiberium')
    }
  })

  it('all pips empty when contents is empty', () => {
    const contents = new Map<string, number>()
    const result = generateResourcePipsData(10, 100, contents, resourceSeqs, 'full', 'empty')
    for (const pip of result) {
      expect(pip.isFilled).toBe(false)
      expect(pip.sequence).toBe('empty')
      expect(pip.resourceType).toBeNull()
    }
  })

  it('partitions pips by resource amounts', () => {
    // 30 Tiberium, 40 Ore, 30 Gems = total capacity 100
    const contents = new Map([['Tiberium', 30], ['Ore', 40], ['Gems', 30]])
    const result = generateResourcePipsData(10, 100, contents, resourceSeqs, 'full', 'empty')

    expect(result).toHaveLength(10)

    // Pips 0-2: Tiberium
    for (let i = 0; i < 3; i++) {
      expect(result[i].resourceType).toBe('Tiberium')
      expect(result[i].isFilled).toBe(true)
      expect(result[i].sequence).toBe('pip-green')
    }

    // Pips 3-6: Ore
    for (let i = 3; i < 7; i++) {
      expect(result[i].resourceType).toBe('Ore')
      expect(result[i].isFilled).toBe(true)
      expect(result[i].sequence).toBe('pip-orange')
    }

    // Pips 7-9: Gems
    for (let i = 7; i < 10; i++) {
      expect(result[i].resourceType).toBe('Gems')
      expect(result[i].isFilled).toBe(true)
      expect(result[i].sequence).toBe('pip-blue')
    }
  })

  it('handles partial fill with multiple resource types', () => {
    // 20 Tiberium, 10 Ore = total 30 (out of 100 capacity)
    const contents = new Map([['Tiberium', 20], ['Ore', 10]])
    const result = generateResourcePipsData(10, 100, contents, resourceSeqs, 'full', 'empty')

    // Pips 0-1: Tiberium (2 pips)
    // Pip 2: Ore (1 pip)
    // Pips 3-9: empty (7 pips)
    expect(result[0].resourceType).toBe('Tiberium')
    expect(result[1].resourceType).toBe('Tiberium')
    expect(result[2].resourceType).toBe('Ore')
    for (let i = 3; i < 10; i++) {
      expect(result[i].isFilled).toBe(false)
      expect(result[i].resourceType).toBeNull()
    }
  })

  it('uses FullSequence as fallback when resource type not in ResourceSequences', () => {
    const contents = new Map([['UnknownResource', 50]])
    const result = generateResourcePipsData(10, 100, contents, {}, 'pip-green', 'pip-empty')

    for (let i = 0; i < 5; i++) {
      expect(result[i].sequence).toBe('pip-green')
    }
    for (let i = 5; i < 10; i++) {
      expect(result[i].sequence).toBe('pip-empty')
    }
  })

  it('indices are correct', () => {
    const contents = new Map([['Tiberium', 100]])
    const result = generateResourcePipsData(5, 100, contents, resourceSeqs, 'f', 'e')
    for (let i = 0; i < 5; i++) {
      expect(result[i].index).toBe(i)
    }
  })
})

// ---------------------------------------------------------------------------
// WithStoresResourcesPipsDecorationInfo
// ---------------------------------------------------------------------------

describe('WithStoresResourcesPipsDecorationInfo', () => {
  it('defaults pipCount to 0', () => {
    const info = new WithStoresResourcesPipsDecorationInfo()
    expect(info.pipCount).toBe(0)
  })

  it('defaults image to "pips"', () => {
    const info = new WithStoresResourcesPipsDecorationInfo()
    expect(info.image).toBe('pips')
  })

  it('defaults emptySequence to "pip-empty"', () => {
    const info = new WithStoresResourcesPipsDecorationInfo()
    expect(info.emptySequence).toBe('pip-empty')
  })

  it('defaults fullSequence to "pip-green"', () => {
    const info = new WithStoresResourcesPipsDecorationInfo()
    expect(info.fullSequence).toBe('pip-green')
  })

  it('defaults palette to "chrome"', () => {
    const info = new WithStoresResourcesPipsDecorationInfo()
    expect(info.palette).toBe('chrome')
  })

  it('defaults resourceSequences to empty object', () => {
    const info = new WithStoresResourcesPipsDecorationInfo()
    expect(info.resourceSequences).toEqual({})
  })

  it('accepts custom pipCount', () => {
    const info = new WithStoresResourcesPipsDecorationInfo({ pipCount: 15 })
    expect(info.pipCount).toBe(15)
  })

  it('accepts custom resourceSequences', () => {
    const info = new WithStoresResourcesPipsDecorationInfo({
      resourceSequences: { Tiberium: 'pip-blue', Ore: 'pip-red' },
    })
    expect(info.resourceSequences).toEqual({ Tiberium: 'pip-blue', Ore: 'pip-red' })
  })

  it('accepts requiresCondition', () => {
    const info = new WithStoresResourcesPipsDecorationInfo({ requiresCondition: '!dead' })
    expect(info.requiresCondition).toBe('!dead')
  })
})

// ---------------------------------------------------------------------------
// WithStoresResourcesPipsDecoration
// ---------------------------------------------------------------------------

describe('WithStoresResourcesPipsDecoration', () => {
  let info: WithStoresResourcesPipsDecorationInfo
  let deco: WithStoresResourcesPipsDecoration

  beforeEach(() => {
    info = new WithStoresResourcesPipsDecorationInfo({
      pipCount: 10,
      resourceSequences: { Tiberium: 'pip-green', Ore: 'pip-orange', Gems: 'pip-blue' },
    })
    deco = new WithStoresResourcesPipsDecoration(info)
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
    it('sets pip data from IStoresResources', () => {
      const contents = new Map([['Tiberium', 50], ['Ore', 50]])
      const sr = makeStoresResources(contents, 100)
      deco.setStoresResources(sr)
      deco.updatePipData()

      expect(deco.pipData).toHaveLength(10)
      expect(deco.filledPipCount).toBe(10)

      // Pips 0-4: Tiberium, Pips 5-9: Ore
      for (let i = 0; i < 5; i++) {
        expect(deco.pipData[i].resourceType).toBe('Tiberium')
      }
      for (let i = 5; i < 10; i++) {
        expect(deco.pipData[i].resourceType).toBe('Ore')
      }
    })

    it('with partially filled storage, shows empty pips at end', () => {
      const contents = new Map([['Tiberium', 30]])
      const sr = makeStoresResources(contents, 100)
      deco.setStoresResources(sr)
      deco.updatePipData()

      // 30/100 * 10 = 3 filled pips
      expect(deco.filledPipCount).toBe(3)

      for (let i = 0; i < 3; i++) {
        expect(deco.pipData[i].isFilled).toBe(true)
      }
      for (let i = 3; i < 10; i++) {
        expect(deco.pipData[i].isFilled).toBe(false)
        expect(deco.pipData[i].resourceType).toBeNull()
      }
    })

    it('returns empty pip data when no storesResources set', () => {
      deco.updatePipData()
      expect(deco.pipData).toHaveLength(0)
    })
  })

  describe('dynamic storage updates', () => {
    it('tracks changing storage contents', () => {
      // Initial: 10 Tiberium
      let contents = new Map([['Tiberium', 10]])
      let sr = makeStoresResources(contents, 100)
      deco.setStoresResources(sr)
      deco.updatePipData()
      expect(deco.filledPipCount).toBe(1)

      // When done: more resources added
      contents = new Map([['Tiberium', 50]])
      sr = makeStoresResources(contents, 100)
      deco.setStoresResources(sr)
      deco.updatePipData()
      expect(deco.filledPipCount).toBe(5)

      // When done: emptied
      contents = new Map<string, number>()
      sr = makeStoresResources(contents, 100)
      deco.setStoresResources(sr)
      deco.updatePipData()
      expect(deco.filledPipCount).toBe(0)
    })
  })

  describe('conditional trait integration', () => {
    it('isTraitDisabled is true with unmet condition', () => {
      const info2 = new WithStoresResourcesPipsDecorationInfo({
        pipCount: 5,
        requiresCondition: 'alive',
      })
      const deco2 = new WithStoresResourcesPipsDecoration(info2)
      // Default state: enabled until condition manager explicitly disables it
      expect(deco2.isTraitDisabled).toBe(false)
      // After condition manager disables:
      deco2.onEnabledChanged(false)
      expect(deco2.isTraitDisabled).toBe(true)
    })

    it('isTraitDisabled becomes false when condition met', () => {
      const info2 = new WithStoresResourcesPipsDecorationInfo({
        pipCount: 5,
        requiresCondition: 'alive',
      })
      const deco2 = new WithStoresResourcesPipsDecoration(info2)
      deco2.onEnabledChanged(true)
      expect(deco2.isTraitDisabled).toBe(false)
    })
  })
})
