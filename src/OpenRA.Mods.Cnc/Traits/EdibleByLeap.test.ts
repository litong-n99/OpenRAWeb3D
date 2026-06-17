/**
 * EdibleByLeap.test.ts — EdibleByLeap trait unit tests
 */

import { describe, it, expect } from 'vitest'
import { EdibleByLeap, EdibleByLeapInfo } from './EdibleByLeap.js'

function makeActor(dead = false, id = 1): any {
  return { id, isDead: dead }
}

describe('EdibleByLeapInfo', () => {
  it('should create an EdibleByLeap instance', () => {
    const info = new EdibleByLeapInfo()
    const trait = info.create({} as any)
    expect(trait).toBeInstanceOf(EdibleByLeap)
  })
})

describe('EdibleByLeap', () => {
  it('should allow leap when no leaper exists', () => {
    const edible = new EdibleByLeap()
    const targeter = makeActor()
    expect(edible.canLeap(targeter)).toBe(true)
  })

  it('should allow leap when leaper is dead', () => {
    const edible = new EdibleByLeap()
    const deadLeaper = makeActor(true)
    const targeter = makeActor(false, 2)
    edible.getLeapAtBy(deadLeaper)
    expect(edible.canLeap(targeter)).toBe(true)
  })

  it('should allow leap when it is the same leaper', () => {
    const edible = new EdibleByLeap()
    const targeter = makeActor()
    edible.getLeapAtBy(targeter)
    expect(edible.canLeap(targeter)).toBe(true)
  })

  it('should reject leap when another leaper is active', () => {
    const edible = new EdibleByLeap()
    const leaper1 = makeActor(false, 1)
    const leaper2 = makeActor(false, 2)
    edible.getLeapAtBy(leaper1)
    expect(edible.canLeap(leaper2)).toBe(false)
  })

  it('should claim successfully when no leaper exists', () => {
    const edible = new EdibleByLeap()
    const targeter = makeActor()
    expect(edible.getLeapAtBy(targeter)).toBe(true)
  })

  it('should reject claim when another live leaper exists', () => {
    const edible = new EdibleByLeap()
    const leaper1 = makeActor(false, 1)
    const leaper2 = makeActor(false, 2)
    edible.getLeapAtBy(leaper1)
    expect(edible.getLeapAtBy(leaper2)).toBe(false)
  })
})
