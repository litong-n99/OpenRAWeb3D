/**
 * TSTiberiumRenderer.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import {
  TSTiberiumRenderer,
  TSTiberiumRendererInfo,
} from './TSTiberiumRenderer.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

describe('TSTiberiumRenderer', () => {
  it('should create with empty ramp sequences', () => {
    const info = new TSTiberiumRendererInfo()
    expect(info.ramp1Sequences.size).toBe(0)
    expect(info.ramp2Sequences.size).toBe(0)
  })

  it('should choose variant from ramp type 1', () => {
    const info = new TSTiberiumRendererInfo({
      ramp1Sequences: new Map([['Tiberium', new Set(['tib_r1_a', 'tib_r1_b'])]]),
      resourceTypes: new Map([['Tiberium', {}]]),
    })
    const actor: any = {
      world: { map: { ramp: () => 1 }, localRandom: { nextInt: () => 0 } },
    }
    const renderer = new TSTiberiumRenderer(actor, info)
    const variant = renderer.chooseVariant('Tiberium', { X: 5, Y: 5 } as CPos)
    expect(variant).toBe('tib_r1_a') // First element with nextInt returning 0
  })

  it('should return null for unknown resource type', () => {
    const info = new TSTiberiumRendererInfo()
    const actor: any = {
      world: { map: { ramp: () => 0 }, localRandom: { nextInt: () => 0 } },
    }
    const renderer = new TSTiberiumRenderer(actor, info)
    expect(renderer.chooseVariant('Unknown', { X: 5, Y: 5 } as CPos)).toBeNull()
  })

  it('should fall back to default variants for flat terrain', () => {
    const info = new TSTiberiumRendererInfo()
    const actor: any = {
      world: { map: { ramp: () => 0 }, localRandom: { nextInt: () => 0 } },
    }
    const renderer = new TSTiberiumRenderer(actor, info)
    // Default variants are empty, so should return null
    expect(renderer.chooseVariant('Tiberium', { X: 5, Y: 5 } as CPos)).toBeNull()
  })
})
