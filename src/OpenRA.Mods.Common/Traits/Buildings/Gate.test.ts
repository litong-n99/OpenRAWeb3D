/**
 * Gate.test.ts — Gate migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: GateInfo configuration, default values, gate opening/closing
 * animation state machine, ITemporaryBlocker, IBlocksProjectiles,
 * INotifyBlockingMove, footprint management, blocking checks, and lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { GateInfo, Gate } from './Gate.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 10000

function makeCPos(x: number, y: number): CPos {
  return { X: x, Y: y, _brand: 'CPos' } as unknown as CPos
}

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: nextId++,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

function makePlayer(overrides: {
  actorId?: number
  allyWith?: PlayerStub | null
} = {}): PlayerStub {
  const player: PlayerStub & {
    relationshipWith?(other: unknown): PlayerRelationship
  } = {
    playerName: `Player-${overrides.actorId ?? nextId++}`,
  }

  if (overrides.allyWith !== undefined) {
    player.relationshipWith = (other: unknown) => {
      if (other === overrides.allyWith || (overrides.allyWith === null && other === player)) {
        return PlayerRelationship.Ally
      }
      return PlayerRelationship.Neutral
    }
  }

  return player
}

/** Builder pattern for creating actors with a Building trait mock. */
function makeGateActor(
  overrides: {
    footprint?: CPos[]
    owner?: PlayerStub
    world?: IGameActor['world']
  } = {},
): IGameActor {
  const footprint: CPos[] = overrides.footprint ?? [
    makeCPos(10, 20),
    makeCPos(11, 20),
  ]

  const buildingTrait = {
    info: {
      tiles: (_location: CPos) => footprint.map((c) => ({ cell: c, subCell: 0 })),
    },
    location: makeCPos(10, 20),
  }

  const actor = makeActor()
  if (overrides.owner) actor.owner = overrides.owner
  if (overrides.world) actor.world = overrides.world

  ;(actor as unknown as Record<string, unknown>).trait = (name: string) => {
    if (name === 'Building') return buildingTrait
    return undefined
  }

  return actor
}

// ---------------------------------------------------------------------------
// GateInfo
// ---------------------------------------------------------------------------

describe('GateInfo', () => {
  it('has correct default values', () => {
    const info = new GateInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.requiresCondition).toBeUndefined()
    expect(info.openingSound).toBeNull()
    expect(info.closingSound).toBeNull()
    expect(info.closeDelay).toBe(150)
    expect(info.transitionDelay).toBe(33)
    expect(info.blocksProjectilesHeight.length).toBe(640)

    const expectedRel =
      PlayerRelationship.Ally |
      PlayerRelationship.Neutral |
      PlayerRelationship.Enemy
    expect(info.blocksProjectilesValidRelationships).toBe(expectedRel)
  })

  it('accepts custom openingSound and closingSound', () => {
    const info = new GateInfo({
      openingSound: 'gate_open.wav',
      closingSound: 'gate_close.wav',
    })
    expect(info.openingSound).toBe('gate_open.wav')
    expect(info.closingSound).toBe('gate_close.wav')
  })

  it('accepts custom closeDelay and transitionDelay', () => {
    const info = new GateInfo({
      closeDelay: 200,
      transitionDelay: 50,
    })
    expect(info.closeDelay).toBe(200)
    expect(info.transitionDelay).toBe(50)
  })

  it('accepts custom blocksProjectilesHeight', () => {
    const height = { length: 1024, _brand: 'WDist' } as unknown as import('../../../OpenRA.Game/WDist.js').WDist
    const info = new GateInfo({ blocksProjectilesHeight: height })
    expect(info.blocksProjectilesHeight.length).toBe(1024)
  })

  it('accepts custom blocksProjectilesValidRelationships', () => {
    const info = new GateInfo({
      blocksProjectilesValidRelationships: PlayerRelationship.Enemy as PlayerRelationship,
    })
    expect(info.blocksProjectilesValidRelationships).toBe(PlayerRelationship.Enemy)
  })
})

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

describe('Gate', () => {
  let info: GateInfo
  let trait: Gate
  let actor: IGameActor

  beforeEach(() => {
    info = new GateInfo()
    trait = new Gate(info)
    actor = makeGateActor()
    trait.attach(actor)
  })

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('starts fully open (Position === transitionDelay)', () => {
      expect(trait.position).toBe(info.transitionDelay)
    })

    it('starts with blocking height 0 (fully open)', () => {
      expect(trait.blockingHeight.length).toBe(0)
    })

    it('has correct validRelationships from info', () => {
      const expectedRel =
        PlayerRelationship.Ally |
        PlayerRelationship.Neutral |
        PlayerRelationship.Enemy
      expect(trait.validRelationships).toBe(expectedRel)
    })
  })

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('addedToWorld sets blockedPositions from footprint', () => {
      trait.addedToWorld(actor)

      // blockedPositions is private, but we can verify via isBlocking
      const cellInFootprint = makeCPos(10, 20)
      // Gate starts open (Position === transitionDelay) so NOT blocking
      expect(trait.isBlocking(actor, cellInFootprint)).toBe(false)
    })

    it('removedFromWorld clears blockedPositions', () => {
      trait.addedToWorld(actor)
      trait.removedFromWorld(actor)

      // After removal, blockedPositions is empty
      // Gate remains open so not blocking
      const cellInFootprint = makeCPos(10, 20)
      expect(trait.isBlocking(actor, cellInFootprint)).toBe(false)
    })

    it('attaches and detaches cleanly', () => {
      const a = makeGateActor()
      const t = new Gate(info)

      t.attach(a)
      t.addedToWorld(a)
      t.removedFromWorld(a)
      expect(() => t.detach(a)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // ITemporaryBlocker
  // -----------------------------------------------------------------------

  describe('ITemporaryBlocker', () => {
    it('isBlocking returns false when gate is fully open', () => {
      trait.addedToWorld(actor)
      // Position === openPosition by default
      expect(trait.position).toBe(info.transitionDelay)
      const cell = makeCPos(10, 20)
      expect(trait.isBlocking(actor, cell)).toBe(false)
    })

    it('isBlocking returns true when gate is not fully open and cell in footprint', () => {
      trait.addedToWorld(actor)
      // Force position to 0 (closed)
      trait.position = 0

      const cellInFootprint = makeCPos(10, 20)
      expect(trait.isBlocking(actor, cellInFootprint)).toBe(true)
    })

    it('isBlocking returns false for cell outside footprint', () => {
      trait.addedToWorld(actor)
      trait.position = 0

      const cellOutside = makeCPos(99, 99)
      expect(trait.isBlocking(actor, cellOutside)).toBe(false)
    })

    it('canRemoveBlockage returns true for friendly actor', () => {
      const owner = makePlayer({ actorId: 10100 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Ally

      const gateActor = makeGateActor({ owner })
      const gateTrait = new Gate(info)
      gateTrait.attach(gateActor)

      const friendly = makeActor()
      friendly.owner = makePlayer({ actorId: 10101, allyWith: owner })

      expect(gateTrait.canRemoveBlockage(gateActor, friendly)).toBe(true)
    })

    it('canRemoveBlockage returns false when trait disabled', () => {
      ;(trait as unknown as Record<string, boolean>)._enabled = false

      const friendly = makeActor()
      expect(trait.canRemoveBlockage(actor, friendly)).toBe(false)
    })

    it('canRemoveBlockage returns false when trait paused', () => {
      ;(trait as unknown as Record<string, boolean>)._paused = true

      const friendly = makeActor()
      expect(trait.canRemoveBlockage(actor, friendly)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyBlockingMove
  // -----------------------------------------------------------------------

  describe('INotifyBlockingMove', () => {
    it('sets desiredPosition to open when friendly blocked', () => {
      const owner = makePlayer({ actorId: 10200 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Ally

      const gateActor = makeGateActor({ owner })
      const gateTrait = new Gate(info)
      gateTrait.attach(gateActor)
      gateTrait.addedToWorld(gateActor)

      // Force closed
      gateTrait.position = 0

      const friendly = makeActor()
      friendly.owner = makePlayer({ actorId: 10201, allyWith: owner })

      gateTrait.onNotifyBlockingMove(gateActor, friendly)

      // After notification, gate should start opening
      // The tick will move position toward desiredPosition
      gateTrait.tick(gateActor)
      expect(gateTrait.position).toBe(1) // moved from 0 toward transitionDelay
    })

    it('does not open for non-friendly actors', () => {
      const owner = makePlayer({ actorId: 10210 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Neutral

      const gateActor = makeGateActor({ owner })
      const gateTrait = new Gate(info)
      gateTrait.attach(gateActor)
      gateTrait.addedToWorld(gateActor)
      gateTrait.position = 0

      const enemy = makeActor()
      enemy.owner = makePlayer({ actorId: 10211 })

      gateTrait.onNotifyBlockingMove(gateActor, enemy)

      // Should not change — enemy not friendly
      gateTrait.tick(gateActor)
      expect(gateTrait.position).toBe(0)
    })

    it('does not open when gate is already open', () => {
      trait.addedToWorld(actor)
      // Already at open position
      expect(trait.position).toBe(info.transitionDelay)

      const friendly = makeActor()
      // Should not change anything
      trait.onNotifyBlockingMove(actor, friendly)
      expect(trait.position).toBe(info.transitionDelay)
    })
  })

  // -----------------------------------------------------------------------
  // IBlocksProjectiles
  // -----------------------------------------------------------------------

  describe('IBlocksProjectiles', () => {
    it('blockingHeight is 0 when fully open', () => {
      trait.position = info.transitionDelay
      expect(trait.blockingHeight.length).toBe(0)
    })

    it('blockingHeight is full when fully closed', () => {
      trait.position = 0
      expect(trait.blockingHeight.length).toBe(info.blocksProjectilesHeight.length)
    })

    it('blockingHeight scales with position', () => {
      // Half open
      const halfPos = Math.floor(info.transitionDelay / 2)
      trait.position = halfPos
      const height = trait.blockingHeight.length
      expect(height).toBeGreaterThan(0)
      expect(height).toBeLessThan(info.blocksProjectilesHeight.length)
    })
  })

  // -----------------------------------------------------------------------
  // ITick — animation state machine
  // -----------------------------------------------------------------------

  describe('ITick — animation', () => {
    it('does nothing when trait disabled', () => {
      trait.addedToWorld(actor)
      trait.position = 0
      ;(trait as unknown as Record<string, boolean>)._enabled = false

      // Force desiredPosition to open
      const owner = makePlayer({ actorId: 10300 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Ally
      const gateActor = makeGateActor({ owner })
      const gateTrait = new Gate(info)
      gateTrait.attach(gateActor)
      gateTrait.addedToWorld(gateActor)
      gateTrait.position = 0
      ;(gateTrait as unknown as Record<string, boolean>)._enabled = false

      gateTrait.tick(gateActor)
      expect(gateTrait.position).toBe(0)
    })

    it('does nothing when trait paused', () => {
      trait.addedToWorld(actor)
      trait.position = 0
      ;(trait as unknown as Record<string, boolean>)._paused = true

      trait.tick(actor)
      expect(trait.position).toBe(0)
    })

    it('opens when desiredPosition > position', () => {
      trait.addedToWorld(actor)
      trait.position = 0

      // Simulate INotifyBlockingMove setting desiredPosition via friendly actor
      const owner = makePlayer({ actorId: 10310 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Ally
      const gateActor = makeGateActor({ owner })
      const gateTrait = new Gate(info)
      gateTrait.attach(gateActor)
      gateTrait.addedToWorld(gateActor)
      gateTrait.position = 0

      const friendly = makeActor()
      friendly.owner = makePlayer({ actorId: 10311, allyWith: owner })

      gateTrait.onNotifyBlockingMove(gateActor, friendly)

      // Tick to animate one step
      gateTrait.tick(gateActor)
      expect(gateTrait.position).toBe(1)
    })

    it('closes when desiredPosition < position', () => {
      trait.addedToWorld(actor)
      // Set to slightly open
      trait.position = 5

      // Force close by setting private desiredPosition via reflection-like access
      ;(trait as unknown as Record<string, number>)._desiredPosition = 0

      trait.tick(actor)
      expect(trait.position).toBe(4) // moved one step toward closed
    })

    it('opens fully after enough ticks', () => {
      trait.addedToWorld(actor)
      trait.position = 0

      // Trigger open
      const owner = makePlayer({ actorId: 10320 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Ally
      const gateActor = makeGateActor({ owner })
      const gateTrait = new Gate(info)
      gateTrait.attach(gateActor)
      gateTrait.addedToWorld(gateActor)
      gateTrait.position = 0

      const friendly = makeActor()
      friendly.owner = makePlayer({ actorId: 10321, allyWith: owner })
      gateTrait.onNotifyBlockingMove(gateActor, friendly)

      // Tick enough times to fully open
      for (let i = 0; i < info.transitionDelay; i++) {
        gateTrait.tick(gateActor)
      }

      expect(gateTrait.position).toBe(info.transitionDelay)
    })

    it('stays open while blocked', () => {
      const owner = makePlayer({ actorId: 10330 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Ally

      const footprint = [makeCPos(5, 5)]
      const actors: IGameActor[] = []
      const world = {
        actors,
        actorMap: {
          getActorsAt: (_cell: CPos) => {
            // Return another actor (not self) to simulate blocking
            return [makeActor()]
          },
          addInfluence: () => {},
          removeInfluence: () => {},
        },
      }

      const gateActor = makeGateActor({ owner, footprint, world })
      const gateTrait = new Gate(new GateInfo({ transitionDelay: 10, closeDelay: 50 }))
      gateTrait.attach(gateActor)
      gateTrait.addedToWorld(gateActor)

      // Fully open
      gateTrait.position = 10
      ;(gateTrait as unknown as Record<string, number>)._desiredPosition = 10

      // Tick — should reset remainingOpenTime because blocked
      for (let i = 0; i < 50; i++) {
        gateTrait.tick(gateActor)
      }

      // Should still be open (reset timer on each tick while blocked)
      expect(gateTrait.position).toBe(10)
    })
  })

  // -----------------------------------------------------------------------
  // ISync
  // -----------------------------------------------------------------------

  describe('ISync', () => {
    it('position is syncable', () => {
      expect(trait.position).toBeDefined()
      expect(typeof trait.position).toBe('number')
    })
  })
})
