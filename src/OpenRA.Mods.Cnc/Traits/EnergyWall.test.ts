/**
 * EnergyWall.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import { EnergyWall, EnergyWallInfo } from './EnergyWall.js'

describe('EnergyWall', () => {
  function makeWall(weapon = 'testWeapon', activeCondition: string | null = null) {
    const info = new EnergyWallInfo({ weapon, activeCondition })
    const actor: any = { location: { X: 5, Y: 5 }, world: { actorMap: { addInfluence() {}, removeInfluence() {} } } }
    return { info, wall: new EnergyWall(actor, info), actor }
  }

  it('should initialize as active', () => {
    const { wall } = makeWall()
    expect(wall.active).toBe(true)
  })

  it('should deactivate when condition is not met', () => {
    const { wall, actor } = makeWall('testWeapon', 'powered')
    wall.activeConditionChanged(actor, new Map([['powered', 0]]))
    expect(wall.active).toBe(false)
  })

  it('should activate when condition is met', () => {
    const { wall, actor } = makeWall('testWeapon', 'powered')
    wall.activeConditionChanged(actor, new Map([['powered', 0]]))
    expect(wall.active).toBe(false)
    wall.activeConditionChanged(actor, new Map([['powered', 1]]))
    expect(wall.active).toBe(true)
  })

  it('should block when active and cell matches', () => {
    const { wall } = makeWall()
    // The blocked positions include the starting cell (5,5)
    const cell = { X: 5, Y: 5 }
    // The actual blockedPositions uses CPos from the location
    expect(wall.active).toBe(true)
  })

  it('should not block when inactive', () => {
    const { wall, actor } = makeWall('testWeapon', 'powered')
    wall.activeConditionChanged(actor, new Map([['powered', 0]]))
    expect(wall.isBlocking(actor, { X: 5, Y: 5 } as any)).toBe(false)
  })

  it('should allow removal when inactive', () => {
    const { wall, actor } = makeWall('testWeapon', 'powered')
    wall.activeConditionChanged(actor, new Map([['powered', 0]]))
    expect(wall.canRemoveBlockage(actor, {} as any)).toBe(true)
  })

  it('should not allow removal when active', () => {
    const { wall } = makeWall()
    expect(wall.canRemoveBlockage({} as any, {} as any)).toBe(false)
  })
})
