/**
 * WithMuzzleOverlay.test.ts — WithMuzzleOverlay migration unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WithMuzzleOverlay, WithMuzzleOverlayInfo } from './WithMuzzleOverlay.js'
import type { Barrel } from '../CombatInterfaces.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'

function makeBarrel(offsetX = 10, yawAngle = 0): Barrel {
  return { offset: new WVec(offsetX, 5, 0), yaw: new WAngle(yawAngle) }
}

function makeMockArmament(
  name = 'primary',
  muzzleSequence = 'muzzle',
  turret = 'primary',
  barrels: Barrel[] = [makeBarrel()],
) {
  return {
    info: { name, muzzleSequence, turret, muzzlePalette: 'effect' },
    barrels,
  }
}

function makeMockTurreted(name = 'primary', yawAngle = 0) {
  return {
    name,
    worldOrientation: { yaw: { angle: yawAngle } },
  }
}

describe('WithMuzzleOverlayInfo', () => {
  it('ignoreOffset defaults to false', () => {
    const info = new WithMuzzleOverlayInfo()
    expect(info.ignoreOffset).toBe(false)
  })

  it('accepts custom ignoreOffset', () => {
    const info = new WithMuzzleOverlayInfo({ ignoreOffset: true })
    expect(info.ignoreOffset).toBe(true)
  })
})

describe('WithMuzzleOverlay', () => {
  let mockArmaments: ReturnType<typeof makeMockArmament>[]

  beforeEach(() => {
    mockArmaments = [makeMockArmament()]
  })

  it('creates barrel entries for armaments with muzzle sequence', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)
    const turreteds = [makeMockTurreted('primary', 512)]

    overlay.init(mockArmaments, turreteds, null, {})

    expect(overlay.barrels.length).toBe(1)
    expect(overlay.barrels[0].visible).toBe(false)
  })

  it('skips armaments without muzzle sequence', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)

    const noMuzzle = makeMockArmament('secondary', null as unknown as string)
    overlay.init([noMuzzle], [], null, {})

    expect(overlay.armaments.length).toBe(0)
    expect(overlay.barrels.length).toBe(0)
  })

  it('builds barrel entries with turreted facing callback', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)
    const turreteds = [makeMockTurreted('primary', 768)]

    overlay.init(mockArmaments, turreteds, null, {})

    const entry = overlay.barrels[0]
    const facingAngle = entry.getFacing()
    expect(facingAngle).toBe(768)
  })

  it('falls back to IFacing when no Turreted matches', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)
    const facing = { facing: new WAngle(256), turnSpeed: WAngle.Zero, orientation: {} as never }

    overlay.init(mockArmaments, [], facing, {})

    const entry = overlay.barrels[0]
    const facingAngle = entry.getFacing()
    expect(facingAngle).toBe(256)
  })

  it('sets barrel visible on attacking', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)

    const arm = makeMockArmament('primary', 'muzzle')
    overlay.init([arm], [], null, {})
    // Override the animation to avoid null checks
    const entry = overlay.barrels[0]
    entry.animation = { animation: { playThen: vi.fn() } }

    overlay.attacking({} as never, {} as never, arm, arm.barrels[0])

    expect(entry.visible).toBe(true)
  })

  it('isBarrelVisible reflects barrel state', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)
    const arm = makeMockArmament()
    overlay.init([arm], [], null, {})

    const barrel = arm.barrels[0]
    expect(overlay.isBarrelVisible(barrel)).toBe(false)
  })

  it('getBarrelAnimation returns barrel entry animation', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)
    const arm = makeMockArmament()
    overlay.init([arm], [], null, {})

    const barrel = arm.barrels[0]
    expect(overlay.getBarrelAnimation(barrel)).toBeNull()
  })

  it('tick calls animation tick on all barrels', () => {
    const info = new WithMuzzleOverlayInfo()
    const overlay = new WithMuzzleOverlay(info)
    const mockTick = vi.fn()
    const arm = makeMockArmament()
    overlay.init([arm], [], null, {})

    const entry = overlay.barrels[0]
    entry.animation = { animation: { tick: mockTick } }

    overlay.tick({} as never)
    expect(mockTick).toHaveBeenCalled()
  })
})
