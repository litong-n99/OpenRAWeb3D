/**
 * TransferTimedExternalConditionOnTransform.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import {
  TransferTimedExternalConditionOnTransform,
  TransferTimedExternalConditionOnTransformInfo,
} from './TransferTimedExternalConditionOnTransform.js'

describe('TransferTimedExternalConditionOnTransform', () => {
  it('should create with given condition', () => {
    const info = new TransferTimedExternalConditionOnTransformInfo({ condition: 'testCond' })
    expect(info.condition).toBe('testCond')
  })

  it('should track duration and remaining', () => {
    const trait = new TransferTimedExternalConditionOnTransform(
      new TransferTimedExternalConditionOnTransformInfo({ condition: 'test' }),
    )
    trait.update(100, 50)
    expect(trait.durationTicks).toBe(100)
    expect(trait.remainingTicks).toBe(50)
    expect(trait.condition).toBe('test')
  })

  it('should not transfer when remaining <= 0', () => {
    const trait = new TransferTimedExternalConditionOnTransform(
      new TransferTimedExternalConditionOnTransformInfo({ condition: 'test' }),
    )
    const toActor = {} as any
    expect(() => trait.afterTransform(toActor)).not.toThrow()
  })

  it('should report remainingTicks correctly when zero', () => {
    const trait = new TransferTimedExternalConditionOnTransform(
      new TransferTimedExternalConditionOnTransformInfo(),
    )
    expect(trait.remainingTicks).toBe(0)
    expect(trait.durationTicks).toBe(0)
  })

  it('should be no-ops for beforeTransform and onTransform', () => {
    const trait = new TransferTimedExternalConditionOnTransform(
      new TransferTimedExternalConditionOnTransformInfo(),
    )
    expect(() => trait.beforeTransform({} as any)).not.toThrow()
    expect(() => trait.onTransform({} as any)).not.toThrow()
  })
})
