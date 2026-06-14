/**
 * RallyPoint.test.ts — RallyPoint migration unit tests
 *
 * Tests focus on:
 * - RallyPointInfo defaults and custom constructor params
 * - RallyPoint path initialization from offsets
 * - RallyPoint resetPath
 * - RallyPoint setRallyPoint (append vs replace)
 * - RallyPoint clearPath
 * - RallyPoint onOwnerChanged updates palette
 * - RallyPoint.isForceSet static helper
 * - Edge cases: empty path, single offset, multiple offsets
 */

import { describe, it, expect } from 'vitest'
import { RallyPoint, RallyPointInfo } from './RallyPoint'
import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCPos(x: number, y: number): CPos {
  return new CPos(x, y, 0)
}

function createCVec(x: number, y: number): CVec {
  return new CVec(x, y)
}

function createPlayer(name: string = 'player1'): PlayerStub {
  return { playerName: name }
}

// ---------------------------------------------------------------------------
// RallyPointInfo
// ---------------------------------------------------------------------------

describe('RallyPointInfo', () => {
  it('defaults image to "rallypoint"', () => {
    const info = new RallyPointInfo()
    expect(info.image).toBe('rallypoint')
  })

  it('defaults lineWidth to 1', () => {
    const info = new RallyPointInfo()
    expect(info.lineWidth).toBe(1)
  })

  it('defaults flagSequence to "flag"', () => {
    const info = new RallyPointInfo()
    expect(info.flagSequence).toBe('flag')
  })

  it('defaults circlesSequence to "circles"', () => {
    const info = new RallyPointInfo()
    expect(info.circlesSequence).toBe('circles')
  })

  it('defaults cursor to "ability"', () => {
    const info = new RallyPointInfo()
    expect(info.cursor).toBe('ability')
  })

  it('defaults palette to "player"', () => {
    const info = new RallyPointInfo()
    expect(info.palette).toBe('player')
  })

  it('defaults isPlayerPalette to true', () => {
    const info = new RallyPointInfo()
    expect(info.isPlayerPalette).toBe(true)
  })

  it('defaults path to empty array', () => {
    const info = new RallyPointInfo()
    expect(info.path).toEqual([])
  })

  it('defaults notification to null', () => {
    const info = new RallyPointInfo()
    expect(info.notification).toBeNull()
  })

  it('defaults textNotification to null', () => {
    const info = new RallyPointInfo()
    expect(info.textNotification).toBeNull()
  })

  it('defaults forceSetType to null', () => {
    const info = new RallyPointInfo()
    expect(info.forceSetType).toBeNull()
  })

  it('accepts custom path offsets', () => {
    const info = new RallyPointInfo({ path: [createCVec(1, 0), createCVec(2, 0)] })
    expect(info.path.length).toBe(2)
    expect(info.path[0]).toEqual(createCVec(1, 0))
  })
})

// ---------------------------------------------------------------------------
// RallyPoint
// ---------------------------------------------------------------------------

describe('RallyPoint', () => {
  it('initializes path from offsets', () => {
    const info = new RallyPointInfo({ path: [createCVec(2, 3)] })
    const location = createCPos(10, 20)
    const rp = new RallyPoint(info, location, 'player1')
    expect(rp.path.length).toBe(1)
    expect(rp.path[0]).toEqual(createCPos(12, 23))
  })

  it('initializes with empty path when no offsets', () => {
    const info = new RallyPointInfo()
    const location = createCPos(10, 20)
    const rp = new RallyPoint(info, location, 'player1')
    expect(rp.path.length).toBe(0)
  })

  it('initializes with multiple offsets', () => {
    const info = new RallyPointInfo({ path: [createCVec(1, 0), createCVec(2, 0), createCVec(3, 0)] })
    const location = createCPos(10, 20)
    const rp = new RallyPoint(info, location, 'player1')
    expect(rp.path.length).toBe(3)
    expect(rp.path[0]).toEqual(createCPos(11, 20))
    expect(rp.path[1]).toEqual(createCPos(12, 20))
    expect(rp.path[2]).toEqual(createCPos(13, 20))
  })

  it('sets paletteName with player prefix when isPlayerPalette', () => {
    const info = new RallyPointInfo({ isPlayerPalette: true, palette: 'player' })
    const rp = new RallyPoint(info, createCPos(0, 0), 'soviet')
    expect(rp.paletteName).toBe('playersoviet')
  })

  it('sets paletteName without player prefix when not isPlayerPalette', () => {
    const info = new RallyPointInfo({ isPlayerPalette: false, palette: 'chrome' })
    const rp = new RallyPoint(info, createCPos(0, 0), 'soviet')
    expect(rp.paletteName).toBe('chrome')
  })

  it('resetPath updates path from new location', () => {
    const info = new RallyPointInfo({ path: [createCVec(2, 3)] })
    const rp = new RallyPoint(info, createCPos(10, 20), 'player1')
    rp.resetPath(createCPos(100, 200))
    expect(rp.path.length).toBe(1)
    expect(rp.path[0]).toEqual(createCPos(102, 203))
  })

  it('setRallyPoint replaces path by default', () => {
    const info = new RallyPointInfo({ path: [createCVec(1, 0)] })
    const rp = new RallyPoint(info, createCPos(10, 20), 'player1')
    expect(rp.path.length).toBe(1)
    rp.setRallyPoint(createCPos(50, 60))
    expect(rp.path.length).toBe(1)
    expect(rp.path[0]).toEqual(createCPos(50, 60))
  })

  it('setRallyPoint appends when specified', () => {
    const info = new RallyPointInfo({ path: [createCVec(1, 0)] })
    const rp = new RallyPoint(info, createCPos(10, 20), 'player1')
    rp.setRallyPoint(createCPos(50, 60), true)
    expect(rp.path.length).toBe(2)
    expect(rp.path[0]).toEqual(createCPos(11, 20))
    expect(rp.path[1]).toEqual(createCPos(50, 60))
  })

  it('clearPath empties the path', () => {
    const info = new RallyPointInfo({ path: [createCVec(1, 0)] })
    const rp = new RallyPoint(info, createCPos(10, 20), 'player1')
    rp.clearPath()
    expect(rp.path.length).toBe(0)
  })

  it('onOwnerChanged updates paletteName when isPlayerPalette', () => {
    const info = new RallyPointInfo({ isPlayerPalette: true, palette: 'player' })
    const rp = new RallyPoint(info, createCPos(0, 0), 'allies')
    expect(rp.paletteName).toBe('playerallies')
    rp.onOwnerChanged({} as any, createPlayer('allies'), createPlayer('soviet'))
    expect(rp.paletteName).toBe('playersoviet')
  })

  it('onOwnerChanged does not update paletteName when not isPlayerPalette', () => {
    const info = new RallyPointInfo({ isPlayerPalette: false, palette: 'chrome' })
    const rp = new RallyPoint(info, createCPos(0, 0), 'allies')
    rp.onOwnerChanged({} as any, createPlayer('allies'), createPlayer('soviet'))
    expect(rp.paletteName).toBe('chrome')
  })
})

// ---------------------------------------------------------------------------
// RallyPoint.isForceSet
// ---------------------------------------------------------------------------

describe('RallyPoint.isForceSet', () => {
  it('returns true for SetRallyPoint with extraData=1', () => {
    expect(RallyPoint.isForceSet('SetRallyPoint', 1)).toBe(true)
  })

  it('returns false for SetRallyPoint with extraData=0', () => {
    expect(RallyPoint.isForceSet('SetRallyPoint', 0)).toBe(false)
  })

  it('returns false for other order names', () => {
    expect(RallyPoint.isForceSet('Stop', 1)).toBe(false)
  })
})
