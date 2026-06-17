/**
 * TDGunboat.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import { TDGunboat, TDGunboatInfo } from './TDGunboat.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WVec } from '../../OpenRA.Game/WVec.js'

describe('TDGunboatInfo', () => {
  it('should create with default values', () => {
    const info = new TDGunboatInfo()
    expect(info.speed).toBe(28)
    expect(info.initialFacing.angle).toBe(256)
  })
})

describe('TDGunboat', () => {
  function makeActor(initData?: Map<string, unknown>): any {
    return {
      init: initData ?? new Map(),
      world: { map: { contains: () => true }, actorMap: {}, updateMaps() {}, addToMaps() {}, removeFromMaps() {} },
    }
  }

  it('should initialize with left facing', () => {
    const actor = makeActor()
    const boat = new TDGunboat(actor, new TDGunboatInfo())
    expect(boat.facing.angle).toBe(256) // Left
  })

  it('should clamp invalid facing to left or right', () => {
    const init = new Map<string, unknown>()
    init.set('FacingInit', new WAngle(500)) // Between 256 and 768, should become left
    const actor = makeActor(init)
    const boat = new TDGunboat(actor, new TDGunboatInfo())
    expect(boat.facing.angle).toBe(256) // < 511 → Left
  })

  it('should clamp high facing to right', () => {
    const init = new Map<string, unknown>()
    init.set('FacingInit', new WAngle(900)) // > 511 → Right
    const actor = makeActor(init)
    const boat = new TDGunboat(actor, new TDGunboatInfo())
    expect(boat.facing.angle).toBe(768)
  })

  it('should have zero turn speed', () => {
    const boat = new TDGunboat(makeActor(), new TDGunboatInfo())
    expect(boat.turnSpeed.angle).toBe(0)
  })

  it('should be able to exist in any cell', () => {
    const boat = new TDGunboat(makeActor(), new TDGunboatInfo())
    expect(boat.canExistInCell({ X: 0, Y: 0 })).toBe(true)
  })

  it('should compute move step', () => {
    const step = TDGunboat.computeMoveStep(28, new WAngle(256)) // Left
    expect(step.X).not.toBeNaN()
    expect(step.Y).not.toBeNaN()
  })

  it('should move forward on tick', () => {
    const actor = makeActor()
    const boat = new TDGunboat(actor, new TDGunboatInfo())
    const oldPos = { ...boat.centerPosition }
    boat.tick(actor)
    // Position should have changed
    expect(boat.centerPosition.X !== oldPos.X || boat.centerPosition.Y !== oldPos.Y).toBe(true)
  })

  it('should toggle facing on turn', () => {
    const boat = new TDGunboat(makeActor(), new TDGunboatInfo())
    expect(boat.facing.angle).toBe(256) // Left
    ;(boat as any)._turn()
    expect(boat.facing.angle).toBe(768) // Right
    ;(boat as any)._turn()
    expect(boat.facing.angle).toBe(256) // Left again
  })

  it('should estimate move duration', () => {
    const boat = new TDGunboat(makeActor(), new TDGunboatInfo())
    const dur = boat.estimatedMoveDuration({ X: 0, Y: 0, Z: 0 }, { X: 280, Y: 0, Z: 0 })
    expect(dur).toBeGreaterThanOrEqual(0)
  })
})
