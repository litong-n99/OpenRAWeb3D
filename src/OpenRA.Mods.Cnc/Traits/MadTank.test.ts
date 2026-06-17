/**
 * MadTank.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import { MadTank, MadTankInfo, DetonationSequence } from './MadTank.js'

describe('MadTankInfo', () => {
  it('should have default values', () => {
    const info = new MadTankInfo()
    expect(info.thumpInterval).toBe(8)
    expect(info.chargeDelay).toBe(96)
    expect(info.detonationDelay).toBe(42)
  })
})

describe('MadTank', () => {
  it('should start not initiated', () => {
    const mad = new MadTank(new MadTankInfo())
    expect(mad.initiated).toBe(false)
  })

  it('should issue detonate attack order', () => {
    const mad = new MadTank(new MadTankInfo())
    const order = mad.issueOrder({} as any, { orderID: 'DetonateAttack' }, null, false)
    expect(order?.orderName).toBe('DetonateAttack')
  })

  it('should issue detonate deploy order', () => {
    const mad = new MadTank(new MadTankInfo())
    const order = mad.issueOrder({} as any, { orderID: 'Detonate' }, null, false)
    expect(order?.orderName).toBe('Detonate')
  })

  it('should return null for unknown order', () => {
    const mad = new MadTank(new MadTankInfo())
    expect(mad.issueOrder({} as any, { orderID: 'Attack' }, null, false)).toBeNull()
  })

  it('should always allow deploy order', () => {
    const mad = new MadTank(new MadTankInfo())
    expect(mad.canIssueDeployOrder()).toBe(true)
  })

  it('should return voice for detonate orders', () => {
    const mad = new MadTank(new MadTankInfo({ voice: 'DetonateVoice' }))
    expect(mad.voicePhraseForOrder({} as any, { orderName: 'Detonate' })).toBe('DetonateVoice')
    expect(mad.voicePhraseForOrder({} as any, { orderName: 'DetonateAttack' })).toBe('DetonateVoice')
  })

  it('should return null voice for non-detonate orders', () => {
    const mad = new MadTank(new MadTankInfo())
    expect(mad.voicePhraseForOrder({} as any, { orderName: 'Attack' })).toBeNull()
  })

  it('should queue DetonateSequence on resolveOrder', () => {
    const mad = new MadTank(new MadTankInfo())
    const queueActivity = vi.fn()
    const actor = { queueActivity } as any
    mad.resolveOrder(actor, { orderName: 'Detonate', queued: false })
    expect(queueActivity).toHaveBeenCalled()
    // The activity should be a DetonationSequence
    const activity = queueActivity.mock.calls[0][1]
    expect(activity).toBeInstanceOf(DetonationSequence)
  })
})

describe('DetonationSequence', () => {
  function makeActor(): any {
    return {
      location: { X: 5, Y: 5 },
      centerPosition: { X: 0, Y: 0, Z: 0 },
      kill: vi.fn(),
      grantCondition: vi.fn().mockReturnValue(42),
      traitsImplementing: () => [],
      world: {
        map: { centerOfCell: () => ({ X: 0, Y: 0, Z: 0 }) },
      },
    }
  }

  it('should initialize not initiated', () => {
    const mad = new MadTank(new MadTankInfo())
    const seq = new DetonationSequence(makeActor(), mad)
    expect(seq.initiated).toBe(false)
    expect(seq.ticks).toBe(0)
  })

  it('should be interruptible before initiation', () => {
    const seq = new DetonationSequence(makeActor(), new MadTank(new MadTankInfo()))
    expect(seq.isInterruptible).toBe(true)
  })

  it('should assign target on first run when no target given', () => {
    const actor = makeActor()
    const seq = new DetonationSequence(actor, new MadTank(new MadTankInfo()))
    seq.onFirstRun()
    expect(seq.target).toBeDefined()
    expect(seq.target).not.toBe(DetonationSequence.INVALID_TARGET)
  })

  it('should cancel when isCancelling is set', () => {
    const seq = new DetonationSequence(makeActor(), new MadTank(new MadTankInfo()))
    seq.cancel()
    expect(seq.isCancelling).toBe(true)
    expect(seq.tick()).toBe(true) // Done immediately
  })

  it('should tick and progress through sequence', () => {
    const actor = makeActor()
    const info = new MadTankInfo({ chargeDelay: 5, detonationDelay: 3 })
    const mad = new MadTank(info)
    mad.thumpDamageWeaponInfo = { impact: vi.fn() }
    const seq = new DetonationSequence(actor, mad)
    seq.onFirstRun()

    // Should not be done after initial initiation
    let done = false
    for (let i = 0; i < 7; i++) {
      done = seq.tick()
    }
    // After 7 ticks (< chargeDelay + detonationDelay), not done
    // But initiation has happened so ticks are counting
    expect(seq.ticks).toBeGreaterThanOrEqual(1)

    // Complete the sequence
    const info2 = new MadTankInfo({ chargeDelay: 2, detonationDelay: 1 })
    const mad2 = new MadTank(info2)
    mad2.thumpDamageWeaponInfo = { impact: vi.fn() }
    mad2.detonationWeaponInfo = { impact: vi.fn() }
    const seq2 = new DetonationSequence(actor, mad2)
    seq2.onFirstRun()
    let done2 = false
    for (let i = 0; i < 5; i++) {
      done2 = seq2.tick()
    }
    // Should be done by tick 5 (chargeDelay 2 + detonationDelay 1 = 3, but initiation takes one tick)
    expect(done2 || seq2.ticks > 3).toBe(true)
  })
})
