/**
 * LineBuild.test.ts — LineBuild migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: LineBuildDirection enum, init classes, LineBuildInfo
 * configuration, LineBuild trait lifecycle (addedToWorld, removedFromWorld,
 * killed), segment tracking, parent node notification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ActorInitializer } from '../../../OpenRA.Game/ActorInitializer.js'

import {
  LineBuildDirection,
  LineBuildDirectionInit,
  LineBuildParentInit,
  LineBuildInfo,
  LineBuild,
  INotifyLineBuildSegmentsChanged_ID,
} from './LineBuild.js'

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  AttackInfo,
  Damage,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helper: create a minimal mock IGameActor
// ---------------------------------------------------------------------------

let nextId = 1000

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: nextId++,
    isInWorld: false,
    isDead: false,
    disposed: false,
    traitsImplementing: vi.fn().mockReturnValue([]),
    kill: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// LineBuildDirection
// ---------------------------------------------------------------------------

describe('LineBuildDirection', () => {
  it('has three values: Unset, X, Y', () => {
    expect(LineBuildDirection.Unset).toBe(0)
    expect(LineBuildDirection.X).toBe(1)
    expect(LineBuildDirection.Y).toBe(2)
  })

  it('values are distinct', () => {
    expect(LineBuildDirection.Unset).not.toBe(LineBuildDirection.X)
    expect(LineBuildDirection.X).not.toBe(LineBuildDirection.Y)
    expect(LineBuildDirection.Unset).not.toBe(LineBuildDirection.Y)
  })
})

// ---------------------------------------------------------------------------
// LineBuildDirectionInit
// ---------------------------------------------------------------------------

describe('LineBuildDirectionInit', () => {
  it('stores direction value', () => {
    const init = new LineBuildDirectionInit(LineBuildDirection.X)
    expect(init.value).toBe(LineBuildDirection.X)
  })

  it('key is "lineBuildDirection"', () => {
    const init = new LineBuildDirectionInit(LineBuildDirection.Y)
    expect(init.key).toBe('lineBuildDirection')
  })

  it('implements ISingleInstanceInit (marker)', () => {
    const init = new LineBuildDirectionInit(LineBuildDirection.Unset)
    expect(init).toBeInstanceOf(LineBuildDirectionInit)
    // Marker interface — no runtime check needed
  })
})

// ---------------------------------------------------------------------------
// LineBuildParentInit
// ---------------------------------------------------------------------------

describe('LineBuildParentInit', () => {
  it('stores direct parent actors', () => {
    const parent = makeActor()
    const init = new LineBuildParentInit([parent])
    const result = init.actorValue()
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(parent)
  })

  it('empty array when constructed with null', () => {
    const init = new LineBuildParentInit(null)
    const result = init.actorValue()
    expect(result).toEqual([])
  })

  it('empty array when constructed with empty string array', () => {
    const init = new LineBuildParentInit([])
    const result = init.actorValue()
    expect(result).toEqual([])
  })

  it('key is "lineBuildParent"', () => {
    const parent = makeActor()
    const init = new LineBuildParentInit([parent])
    expect(init.key).toBe('lineBuildParent')
  })

  it('constructor with string[] stores null for deferred resolution', () => {
    // strings → _parentActors = null, resolved in actorValue(world)
    const init = new LineBuildParentInit(['actor1', 'actor2'])
    // Without world, returns empty array (stub)
    const result = init.actorValue()
    expect(result).toEqual([])
  })

  it('implements ISingleInstanceInit (marker)', () => {
    const init = new LineBuildParentInit(null)
    expect(init).toBeInstanceOf(LineBuildParentInit)
  })

  it('multiple parents stored correctly', () => {
    const p1 = makeActor()
    const p2 = makeActor()
    const init = new LineBuildParentInit([p1, p2])
    const result = init.actorValue()
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(p1)
    expect(result[1]).toBe(p2)
  })
})

// ---------------------------------------------------------------------------
// LineBuildInfo
// ---------------------------------------------------------------------------

describe('LineBuildInfo', () => {
  it('has correct default values', () => {
    const info = new LineBuildInfo()
    expect(info.range).toBe(5)
    expect(info.nodeTypes).toEqual(new Set(['wall']))
    expect(info.nodeTypes.has('wall')).toBe(true)
    expect(info.segmentType).toBeNull()
    expect(info.segmentsRequireNode).toBe(false)
    expect(info.instanceName).toBeUndefined()
  })

  it('accepts custom range', () => {
    const info = new LineBuildInfo({ range: 10 })
    expect(info.range).toBe(10)
  })

  it('accepts custom nodeTypes', () => {
    const info = new LineBuildInfo({ nodeTypes: ['fence', 'hedge'] })
    expect(info.nodeTypes.has('fence')).toBe(true)
    expect(info.nodeTypes.has('hedge')).toBe(true)
    expect(info.nodeTypes.has('wall')).toBe(false)
    expect(info.nodeTypes.size).toBe(2)
  })

  it('accepts segmentType', () => {
    const info = new LineBuildInfo({ segmentType: 'wall_segment' })
    expect(info.segmentType).toBe('wall_segment')
  })

  it('accepts segmentsRequireNode', () => {
    const info = new LineBuildInfo({ segmentsRequireNode: true })
    expect(info.segmentsRequireNode).toBe(true)
  })

  it('accepts instanceName', () => {
    const info = new LineBuildInfo({ instanceName: 'wall-builder' })
    expect(info.instanceName).toBe('wall-builder')
  })

  it('nodeTypes is a Set with has() semantics', () => {
    const info = new LineBuildInfo({ nodeTypes: ['wall', 'gate'] })
    expect(info.nodeTypes.has('wall')).toBe(true)
    expect(info.nodeTypes.has('gate')).toBe(true)
    expect(info.nodeTypes.has('fence')).toBe(false)
  })

  it('create() returns a LineBuild instance', () => {
    const info = new LineBuildInfo()
    const init = new ActorInitializer([])
    const lb = info.create(init)
    expect(lb).toBeInstanceOf(LineBuild)
    expect(lb.info).toBe(info)
  })
})

// ---------------------------------------------------------------------------
// LineBuild
// ---------------------------------------------------------------------------

describe('LineBuild', () => {
  let info: LineBuildInfo
  let init: ActorInitializer

  beforeEach(() => {
    info = new LineBuildInfo()
    init = new ActorInitializer([])
  })

  it('constructs with no parent nodes', () => {
    const lb = new LineBuild(init, info)
    expect(lb.info).toBe(info)
    expect(lb.segments.size).toBe(0)
  })

  it('constructs with parent nodes from init', () => {
    const parent = makeActor()
    const parentInit = new LineBuildParentInit([parent])
    init.set('lineBuildParent', parentInit)
    const lb = new LineBuild(init, info)
    // Can't check private _parentNodes directly, but lifecycle tests verify
    expect(lb).toBeInstanceOf(LineBuild)
  })

  it('segments starts empty', () => {
    const lb = new LineBuild(init, info)
    expect(lb.segments.size).toBe(0)
  })

  it('segmentAdded adds segment to set', () => {
    const lb = new LineBuild(init, info)
    const self = makeActor()
    const segment = makeActor()

    lb.segmentAdded(self, segment)
    expect(lb.segments.size).toBe(1)
    expect(lb.segments.has(segment)).toBe(true)
  })

  it('segmentAdded with multiple segments', () => {
    const lb = new LineBuild(init, info)
    const self = makeActor()
    const s1 = makeActor()
    const s2 = makeActor()
    const s3 = makeActor()

    lb.segmentAdded(self, s1)
    lb.segmentAdded(self, s2)
    lb.segmentAdded(self, s3)
    expect(lb.segments.size).toBe(3)
    expect(lb.segments.has(s1)).toBe(true)
    expect(lb.segments.has(s2)).toBe(true)
    expect(lb.segments.has(s3)).toBe(true)
  })

  it('segmentRemoved removes segment from set', () => {
    const lb = new LineBuild(init, info)
    const self = makeActor()
    const segment = makeActor()

    lb.segmentAdded(self, segment)
    expect(lb.segments.size).toBe(1)

    lb.segmentRemoved(self, segment)
    expect(lb.segments.size).toBe(0)
    expect(lb.segments.has(segment)).toBe(false)
  })

  it('segmentRemoved on non-existent segment is safe', () => {
    const lb = new LineBuild(init, info)
    const self = makeActor()
    const segment = makeActor()

    // Removing from empty set — should not throw
    expect(() => lb.segmentRemoved(self, segment)).not.toThrow()
    expect(lb.segments.size).toBe(0)
  })

  it('segmentAdded idempotent — same segment added twice', () => {
    const lb = new LineBuild(init, info)
    const self = makeActor()
    const segment = makeActor()

    lb.segmentAdded(self, segment)
    lb.segmentAdded(self, segment)
    expect(lb.segments.size).toBe(1) // Set prevents duplicates
  })

  it('segments getter returns ReadonlySet', () => {
    const lb = new LineBuild(init, info)
    expect(lb.segments).toBeInstanceOf(Set)
  })
})

// ---------------------------------------------------------------------------
// LineBuild lifecycle: addedToWorld
// ---------------------------------------------------------------------------

describe('LineBuild.addedToWorld', () => {
  it('notifies parent node traits with segmentAdded', () => {
    const info = new LineBuildInfo()
    const parent = makeActor()
    const init = new ActorInitializer([])
    const parentInit = new LineBuildParentInit([parent])
    init.set('lineBuildParent', parentInit)

    // Create a mock handler to verify calls
    const mockHandler = {
      segmentAdded: vi.fn(),
      segmentRemoved: vi.fn(),
    }

    // Set up parent's traitsImplementing to return our mock handler
    parent.traitsImplementing = vi
      .fn()
      .mockReturnValue([mockHandler])

    const lb = new LineBuild(init, info)
    const self = makeActor()

    lb.addedToWorld(self)

    // Verify parent's traitsImplementing was called with correct interface ID
    expect(parent.traitsImplementing).toHaveBeenCalledWith(
      INotifyLineBuildSegmentsChanged_ID,
    )

    // Verify segmentAdded was called on the handler
    expect(mockHandler.segmentAdded).toHaveBeenCalledWith(parent, self)
    expect(mockHandler.segmentRemoved).not.toHaveBeenCalled()
  })

  it('skips disposed parent nodes', () => {
    const info = new LineBuildInfo()
    const parent = makeActor({ disposed: true })
    const init = new ActorInitializer([])
    const parentInit = new LineBuildParentInit([parent])
    init.set('lineBuildParent', parentInit)

    const mockHandler = {
      segmentAdded: vi.fn(),
      segmentRemoved: vi.fn(),
    }

    parent.traitsImplementing = vi
      .fn()
      .mockReturnValue([mockHandler])

    const lb = new LineBuild(init, info)
    const self = makeActor()

    lb.addedToWorld(self)

    // Should NOT call traitsImplementing on disposed parent
    expect(parent.traitsImplementing).not.toHaveBeenCalled()
    expect(mockHandler.segmentAdded).not.toHaveBeenCalled()
  })

  it('handles parent without traitsImplementing gracefully', () => {
    const info = new LineBuildInfo()
    const parent = makeActor()
    // No traitsImplementing set — stub actor
    delete (parent as any).traitsImplementing

    const init = new ActorInitializer([])
    const parentInit = new LineBuildParentInit([parent])
    init.set('lineBuildParent', parentInit)

    const lb = new LineBuild(init, info)
    const self = makeActor()

    // Should not throw
    expect(() => lb.addedToWorld(self)).not.toThrow()
  })

  it('notifies multiple parent nodes', () => {
    const info = new LineBuildInfo()
    const parent1 = makeActor()
    const parent2 = makeActor()

    const handler1 = { segmentAdded: vi.fn(), segmentRemoved: vi.fn() }
    const handler2 = { segmentAdded: vi.fn(), segmentRemoved: vi.fn() }

    parent1.traitsImplementing = vi.fn().mockReturnValue([handler1])
    parent2.traitsImplementing = vi.fn().mockReturnValue([handler2])

    const init = new ActorInitializer([])
    const parentInit = new LineBuildParentInit([parent1, parent2])
    init.set('lineBuildParent', parentInit)

    const lb = new LineBuild(init, info)
    const self = makeActor()

    lb.addedToWorld(self)

    expect(handler1.segmentAdded).toHaveBeenCalledWith(parent1, self)
    expect(handler2.segmentAdded).toHaveBeenCalledWith(parent2, self)
  })
})

// ---------------------------------------------------------------------------
// LineBuild lifecycle: removedFromWorld
// ---------------------------------------------------------------------------

describe('LineBuild.removedFromWorld', () => {
  it('notifies parent node traits with segmentRemoved', () => {
    const info = new LineBuildInfo()
    const parent = makeActor()
    const init = new ActorInitializer([])
    const parentInit = new LineBuildParentInit([parent])
    init.set('lineBuildParent', parentInit)

    const mockHandler = {
      segmentAdded: vi.fn(),
      segmentRemoved: vi.fn(),
    }

    parent.traitsImplementing = vi
      .fn()
      .mockReturnValue([mockHandler])

    const lb = new LineBuild(init, info)
    const self = makeActor()
    lb.removedFromWorld(self)

    expect(parent.traitsImplementing).toHaveBeenCalledWith(
      INotifyLineBuildSegmentsChanged_ID,
    )
    expect(mockHandler.segmentRemoved).toHaveBeenCalledWith(parent, self)
    expect(mockHandler.segmentAdded).not.toHaveBeenCalled()
  })

  it('disposes segments when segmentsRequireNode is true', () => {
    const info = new LineBuildInfo({ segmentsRequireNode: true })
    const lb = new LineBuild(new ActorInitializer([]), info)
    const self = makeActor()
    const segment1 = makeActor()
    const segment2 = makeActor()

    lb.segmentAdded(self, segment1)
    lb.segmentAdded(self, segment2)

    lb.removedFromWorld(self)

    // Segments should be disposed
    expect(segment1.dispose).toHaveBeenCalled()
    expect(segment2.dispose).toHaveBeenCalled()
  })

  it('does NOT dispose segments when segmentsRequireNode is false', () => {
    const info = new LineBuildInfo({ segmentsRequireNode: false })
    const lb = new LineBuild(new ActorInitializer([]), info)
    const self = makeActor()
    const segment = makeActor()

    lb.segmentAdded(self, segment)
    lb.removedFromWorld(self)

    expect(segment.dispose).not.toHaveBeenCalled()
  })

  it('skips disposed parent nodes during removedFromWorld', () => {
    const info = new LineBuildInfo()
    const parent = makeActor({ disposed: true })
    const init = new ActorInitializer([])
    const parentInit = new LineBuildParentInit([parent])
    init.set('lineBuildParent', parentInit)

    const mockHandler = {
      segmentAdded: vi.fn(),
      segmentRemoved: vi.fn(),
    }

    parent.traitsImplementing = vi
      .fn()
      .mockReturnValue([mockHandler])

    const lb = new LineBuild(init, info)
    const self = makeActor()

    lb.removedFromWorld(self)

    expect(parent.traitsImplementing).not.toHaveBeenCalled()
    expect(mockHandler.segmentRemoved).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// LineBuild lifecycle: killed
// ---------------------------------------------------------------------------

describe('LineBuild.killed', () => {
  it('kills child segments when segmentsRequireNode is true', () => {
    const info = new LineBuildInfo({ segmentsRequireNode: true })
    const lb = new LineBuild(new ActorInitializer([]), info)
    const self = makeActor()
    const segment1 = makeActor()
    const segment2 = makeActor()

    lb.segmentAdded(self, segment1)
    lb.segmentAdded(self, segment2)

    const attacker = makeActor()
    const attackInfo = new AttackInfo(
      new Damage(100),
      attacker,
      32, // DamageState.Dead
      1, // DamageState.Undamaged
    )

    lb.killed(self, attackInfo)

    expect(segment1.kill).toHaveBeenCalledWith(attacker)
    expect(segment2.kill).toHaveBeenCalledWith(attacker)
  })

  it('does NOT kill segments when segmentsRequireNode is false', () => {
    const info = new LineBuildInfo({ segmentsRequireNode: false })
    const lb = new LineBuild(new ActorInitializer([]), info)
    const self = makeActor()
    const segment = makeActor()

    lb.segmentAdded(self, segment)

    const attacker = makeActor()
    const attackInfo2 = new AttackInfo(
      new Damage(100),
      attacker,
      32, // DamageState.Dead
      1, // DamageState.Undamaged
    )

    lb.killed(self, attackInfo2)

    expect(segment.kill).not.toHaveBeenCalled()
  })

  it('does nothing when no segments exist', () => {
    const info = new LineBuildInfo({ segmentsRequireNode: true })
    const lb = new LineBuild(new ActorInitializer([]), info)
    const self = makeActor()

    // Create a full AttackInfo with all required fields
    const attacker = makeActor()
    const attackInfo3 = new AttackInfo(
      new Damage(50),
      attacker,
      4, // DamageState.Medium
      1, // DamageState.Undamaged
    )

    // Should not throw
    expect(() => lb.killed(self, attackInfo3)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// LineBuild full lifecycle integration
// ---------------------------------------------------------------------------

describe('LineBuild integration', () => {
  it('supports full lifecycle: addedToWorld -> segment tracking -> removedFromWorld', () => {
    const info = new LineBuildInfo({ segmentsRequireNode: false })

    // Create parent node with LineBuild trait
    const parentHb = new LineBuild(new ActorInitializer([]), info)
    const parent = makeActor({
      traitsImplementing: vi.fn().mockReturnValue([parentHb]),
    })

    // Create segment actor with LineBuild trait, parented to the node
    const init = new ActorInitializer([])
    init.set('lineBuildParent', new LineBuildParentInit([parent]))
    const segmentHb = new LineBuild(init, info)
    const segment = makeActor()

    // Add segment to world → parent tracks it
    segmentHb.addedToWorld(segment)

    // Parent's LineBuild trait should now have one segment
    expect(parentHb.segments.size).toBe(1)
    expect(parentHb.segments.has(segment)).toBe(true)

    // Remove segment from world → parent untracks it
    segmentHb.removedFromWorld(segment)

    expect(parentHb.segments.size).toBe(0)
  })

  it('segmentsRequireNode cascades kill to child segments', () => {
    const nodeInfo = new LineBuildInfo({ segmentsRequireNode: true })

    // Node actor
    const nodeHb = new LineBuild(new ActorInitializer([]), nodeInfo)
    const node = makeActor({
      traitsImplementing: vi.fn().mockReturnValue([nodeHb]),
    })

    // Segment actor
    const init = new ActorInitializer([])
    init.set('lineBuildParent', new LineBuildParentInit([node]))
    const segmentHb = new LineBuild(init, new LineBuildInfo())
    const segment = makeActor()

    segmentHb.addedToWorld(segment)

    // Node has the segment tracked
    expect(nodeHb.segments.size).toBe(1)

    // Kill the node
    const attacker = makeActor()
    const attackInfo4 = new AttackInfo(
      new Damage(200),
      attacker,
      32, // DamageState.Dead
      1, // DamageState.Undamaged
    )

    nodeHb.killed(node, attackInfo4)

    // Segment should be killed with same attacker
    expect(segment.kill).toHaveBeenCalledWith(attacker)
  })
})
