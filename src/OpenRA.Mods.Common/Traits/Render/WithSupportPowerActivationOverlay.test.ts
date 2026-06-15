/**
 * WithSupportPowerActivationOverlay.test.ts — unit tests
 *
 * Since Babylon.js dependencies are fully encapsulated in Animation/RenderSprites,
 * WithSupportPowerActivationOverlay is pure logic and can be fully unit tested.
 * Test focus: construction, activation (visible=true), sequence replay, dispose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WithSupportPowerActivationOverlay,
  DEFAULT_ACTIVATION_OVERLAY_INFO,
  type WithSupportPowerActivationOverlayInfo,
  type IWorldWithSequences,
} from './WithSupportPowerActivationOverlay.js'
import {
  RenderSprites,
  RenderSpritesInfo,
  type IRenderActor,
  type IRenderPlayer,
} from './RenderSprites.js'
import { type IBodyOrientation } from './WithIdleOverlay.js'
import { AnimationWithOffset } from '../../../OpenRA.Game/Graphics/AnimationWithOffset.js'
import type { ISequenceSet, ISpriteSequence } from '../../../OpenRA.Game/Graphics/Animation.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock Implementations
// ---------------------------------------------------------------------------

function createMockSequence(name = 'active', length = 8): ISpriteSequence {
  return {
    name,
    length,
    tick: 40,
    scale: 1,
    zOffset: 0,
    shadowZOffset: 0,
    ignoreWorldTint: false,
    bounds: { x: 0, y: 0, width: 32, height: 32 },
    getSprite: vi.fn().mockReturnValue(null),
    getSpriteWithRotation: vi.fn().mockReturnValue({ sprite: null, rotation: 0 }),
    getAlpha: vi.fn().mockReturnValue(1),
    getShadow: vi.fn().mockReturnValue(null),
  }
}

function createMockSequenceSet(): ISequenceSet {
  return {
    hasSequence: vi.fn().mockReturnValue(true),
    getSequence: vi.fn().mockImplementation((_actor: string, seqName: string) =>
      createMockSequence(seqName),
    ),
  }
}

function createMockBody(): IBodyOrientation {
  return {
    localToWorld: vi.fn((offset: WVec) => offset),
    quantizeOrientation: vi.fn((orientation: WRot) => orientation),
    quantizeFacing: vi.fn((facing: WAngle) => new WAngle(facing.angle)),
  }
}

function createMockFacing(): IFacing {
  return {
    turnSpeed: new WAngle(256),
    facing: new WAngle(128),
    orientation: WRot.None,
  }
}

function createMockActor(overrides: Partial<IRenderActor> = {}): IRenderActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    CenterPosition: new WPos(100, 200, 50),
    Info: { Name: 'test-actor' },
    Owner: {
      playerName: 'test-player',
      InternalName: 'test-player-internal',
      Faction: { InternalName: 'test-faction' },
    } as IRenderPlayer,
    EffectiveOwner: null,
    World: {
      ScreenMap: { addOrUpdate: vi.fn() },
    },
    getDamageState: () => 1,
    ...overrides,
  } as IRenderActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithSupportPowerActivationOverlayInfo', () => {
  it('has correct default values', () => {
    expect(DEFAULT_ACTIVATION_OVERLAY_INFO.sequence).toBe('active')
    expect(DEFAULT_ACTIVATION_OVERLAY_INFO.offset).toEqual(WVec.Zero)
    expect(DEFAULT_ACTIVATION_OVERLAY_INFO.palette).toBeNull()
    expect(DEFAULT_ACTIVATION_OVERLAY_INFO.isPlayerPalette).toBe(false)
  })
})

describe('WithSupportPowerActivationOverlay', () => {
  let info: WithSupportPowerActivationOverlayInfo
  let rs: RenderSprites
  let body: IBodyOrientation
  let facing: IFacing
  let world: IWorldWithSequences
  let actor: IRenderActor
  let seqSet: ISequenceSet

  beforeEach(() => {
    info = { ...DEFAULT_ACTIVATION_OVERLAY_INFO }
    const rsInfo = new RenderSpritesInfo('test-image')
    rs = new RenderSprites(rsInfo, 'test-faction')
    body = createMockBody()
    facing = createMockFacing()
    seqSet = createMockSequenceSet()
    world = { Sequences: seqSet }
    actor = createMockActor()
  })

  describe('construction', () => {
    it('creates overlay and registers with RenderSprites', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      expect(overlay).toBeInstanceOf(WithSupportPowerActivationOverlay)
      expect(overlay.overlay).toBeDefined()
      expect(overlay._testAnim).toBeInstanceOf(AnimationWithOffset)
      // RenderSprites has one animation registered
      expect(rs.animationCount).toBe(1)
    })

    it('starts with visible=false', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      expect(overlay._testVisible).toBe(false)
    })

    it('plays the initial sequence', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      expect(overlay.overlay.currentSequence).toBeDefined()
      expect(overlay.overlay.currentSequence!.name).toBe('active')
    })

    it('uses RenderSprites.getImage for image name', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      expect(overlay.overlay.name).toBe('test-image')
    })

    it('constructs with custom sequence name', () => {
      const customInfo: WithSupportPowerActivationOverlayInfo = {
        ...DEFAULT_ACTIVATION_OVERLAY_INFO,
        sequence: 'powerActivate',
      }
      const overlay = new WithSupportPowerActivationOverlay(
        customInfo,
        actor,
        rs,
        body,
        facing,
        world,
      )

      expect(overlay.overlay.currentSequence!.name).toBe('powerActivate')
    })

    it('constructs with custom offset', () => {
      const customInfo: WithSupportPowerActivationOverlayInfo = {
        ...DEFAULT_ACTIVATION_OVERLAY_INFO,
        offset: new WVec(10, 20, 30),
      }
      const overlay = new WithSupportPowerActivationOverlay(
        customInfo,
        actor,
        rs,
        body,
        facing,
        world,
      )

      expect(overlay).toBeDefined()
      // The offset is used in the position function, verified indirectly
      // via construction success
    })
  })

  describe('charged', () => {
    it('is a no-op', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      const prevVisible = overlay._testVisible
      overlay.charged(actor as any)
      expect(overlay._testVisible).toBe(prevVisible)
    })
  })

  describe('activated', () => {
    it('sets visible=true and replays sequence', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      overlay.activated(actor as any)

      expect(overlay._testVisible).toBe(true)
      // replayed the sequence
      expect(overlay.overlay.currentSequence).toBeDefined()
      expect(overlay.overlay.currentSequence!.name).toBe('active')
    })
  })

  describe('dispose', () => {
    it('removes the animation from RenderSprites', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      expect(rs.animationCount).toBe(1)
      overlay.dispose()
      expect(rs.animationCount).toBe(0)
    })
  })

  describe('facing function', () => {
    it('returns 0 when facing is null', () => {
      const fn = WithSupportPowerActivationOverlay.makeFacingFunc(null, body)
      expect(fn()).toBe(0)
    })

    it('returns quantized facing when facing is provided', () => {
      const fn = WithSupportPowerActivationOverlay.makeFacingFunc(facing, body)
      const result = fn()
      expect(typeof result).toBe('number')
      expect(result).toBeGreaterThanOrEqual(0)
    })
  })

  describe('traitDisabled interaction', () => {
    it('activated works after construction', () => {
      const overlay = new WithSupportPowerActivationOverlay(
        info,
        actor,
        rs,
        body,
        facing,
        world,
      )

      // Initially not visible
      expect(overlay._testVisible).toBe(false)

      // Activate
      overlay.activated(actor as any)
      expect(overlay._testVisible).toBe(true)
    })
  })
})
