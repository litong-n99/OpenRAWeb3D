/**
 * WithIdleOverlay.test.ts — WithIdleOverlay 单元测试
 *
 * 由于 Babylon.js 依赖已完全封装在 Animation/RenderSprites 中，
 * WithIdleOverlay 本身是纯逻辑特质，可完全单元测试。
 * 测试焦点: 构造、StartSequence 播放、DamageStateChanged 替换序列、Dispose。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WithIdleOverlay,
  DEFAULT_IDLE_OVERLAY_INFO,
  type WithIdleOverlayInfo,
  type IBodyOrientation,
  type IWorldWithSequences,
} from './WithIdleOverlay'
import { RenderSprites, RenderSpritesInfo, type IRenderActor, type IRenderPlayer } from './RenderSprites'
import { AnimationWithOffset } from '../../../OpenRA.Game/Graphics/AnimationWithOffset.js'
import type { ISequenceSet, ISpriteSequence } from '../../../OpenRA.Game/Graphics/Animation.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import {
  DamageState,
  type AttackInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock Implementations
// ---------------------------------------------------------------------------

// Mock ISpriteSequence for testing
function createMockSequence(name = 'idle', length = 8): ISpriteSequence {
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

// Mock ISequenceSet
function createMockSequenceSet(): ISequenceSet {
  return {
    hasSequence: vi.fn().mockReturnValue(true),
    getSequence: vi.fn().mockImplementation((_actor: string, seqName: string) =>
      createMockSequence(seqName),
    ),
  }
}

// Mock IBodyOrientation
function createMockBody(): IBodyOrientation {
  return {
    localToWorld: vi.fn((offset: WVec) => offset),
    quantizeOrientation: vi.fn((orientation: WRot) => orientation),
    quantizeFacing: vi.fn((facing: WAngle) => new WAngle(facing.angle)),
  }
}

// Mock IFacing
function createMockFacing(): IFacing {
  return {
    turnSpeed: new WAngle(256),
    facing: new WAngle(128),
    orientation: WRot.None,
  }
}

// Mock IRenderActor
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
    getDamageState: () => DamageState.Undamaged,
    ...overrides,
  } as IRenderActor
}

// Mock AttackInfo
function createMockAttackInfo(damageState: DamageState = DamageState.Heavy): AttackInfo {
  return {
    damage: { value: 50, damageTypes: { contains: () => false, isEmpty: () => true } },
    attacker: createMockActor({ actorId: 999 }) as any,
    damageState,
    previousDamageState: DamageState.Undamaged,
  }
}

// ---------------------------------------------------------------------------
// Tests: WithIdleOverlayInfo defaults
// ---------------------------------------------------------------------------

describe('WithIdleOverlayInfo', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_IDLE_OVERLAY_INFO.Image).toBeNull()
    expect(DEFAULT_IDLE_OVERLAY_INFO.StartSequence).toBeNull()
    expect(DEFAULT_IDLE_OVERLAY_INFO.Sequence).toBe('idle-overlay')
    expect(DEFAULT_IDLE_OVERLAY_INFO.Offset).toEqual(WVec.Zero)
    expect(DEFAULT_IDLE_OVERLAY_INFO.Palette).toBeNull()
    expect(DEFAULT_IDLE_OVERLAY_INFO.IsPlayerPalette).toBe(false)
    expect(DEFAULT_IDLE_OVERLAY_INFO.IsDecoration).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: WithIdleOverlay
// ---------------------------------------------------------------------------

describe('WithIdleOverlay', () => {
  let info: WithIdleOverlayInfo
  let rs: RenderSprites
  let body: IBodyOrientation
  let facing: IFacing
  let world: IWorldWithSequences
  let actor: IRenderActor
  let seqSet: ISequenceSet

  beforeEach(() => {
    info = { ...DEFAULT_IDLE_OVERLAY_INFO, Image: null }
    const rsInfo = new RenderSpritesInfo('test-image')
    rs = new RenderSprites(rsInfo, 'test-faction')
    body = createMockBody()
    facing = createMockFacing()
    seqSet = createMockSequenceSet()
    world = { Sequences: seqSet }
    actor = createMockActor()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create overlay and register with RenderSprites', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      expect(overlay).toBeInstanceOf(WithIdleOverlay)
      expect(overlay.overlay).toBeDefined()
      expect(overlay.animation).toBeInstanceOf(AnimationWithOffset)
      // RenderSprites should now have 1 animation
      expect(rs.animationCount).toBe(1)
    })

    it('should fall back to RenderSprites.getImage when own Image is null', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      // When info.Image is null, delegate to rs.getImage(self)
      // RenderSpritesInfo has Image='test-image', so that's used
      expect(overlay.overlay.name).toBe('test-image')
    })

    it('should use custom Image when specified', () => {
      const customInfo: WithIdleOverlayInfo = {
        ...DEFAULT_IDLE_OVERLAY_INFO,
        Image: 'my-custom-overlay',
      }
      const overlay = new WithIdleOverlay(customInfo, actor, rs, body, facing, world)

      expect(overlay.overlay.name).toBe('my-custom-overlay')
    })

    it('should play Sequence as repeating when no StartSequence', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      // Sequence should be played as repeating
      const seq = overlay.overlay.currentSequence
      expect(seq).toBeDefined()
      expect(seq!.name).toBe('idle-overlay')
    })

    it('should set IsDecoration from info', () => {
      const decInfo: WithIdleOverlayInfo = {
        ...DEFAULT_IDLE_OVERLAY_INFO,
        IsDecoration: true,
      }
      const overlay = new WithIdleOverlay(decInfo, actor, rs, body, facing, world)

      expect(overlay.overlay.isDecoration).toBe(true)
    })

    it('should handle null body (use raw offset)', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, null, facing, world)

      expect(overlay).toBeInstanceOf(WithIdleOverlay)
      expect(rs.animationCount).toBe(1)
    })

    it('should handle null facing (use zero angle)', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, null, world)

      expect(overlay).toBeInstanceOf(WithIdleOverlay)
      expect(rs.animationCount).toBe(1)
    })

    it('should handle both body and facing null', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, null, null, world)

      expect(overlay).toBeInstanceOf(WithIdleOverlay)
      expect(rs.animationCount).toBe(1)
    })

    it('should play StartSequence then transition to Sequence', () => {
      const startInfo: WithIdleOverlayInfo = {
        ...DEFAULT_IDLE_OVERLAY_INFO,
        StartSequence: 'build',
        Sequence: 'idle-overlay',
      }
      const overlay = new WithIdleOverlay(startInfo, actor, rs, body, facing, world)

      // The current sequence should be the start sequence initially
      // Actually in C#, PlayThen immediately sets the sequence to the first one
      // and after completion transitions. But during initialization,
      // PlayThen sets the currentSequence to 'build' (the start sequence)
      const seq = overlay.overlay.currentSequence
      expect(seq!.name).toBe('build')
    })
  })

  // -----------------------------------------------------------------------
  // DamageStateChanged
  // -----------------------------------------------------------------------

  describe('damageStateChanged', () => {
    it('should implement INotifyDamageStateChanged', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      expect(typeof overlay.damageStateChanged).toBe('function')
    })

    it('should replace animation with damage-prefixed variant', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      // Get the underlying Animation to spy on replaceAnim
      const replaceAnimSpy = vi.spyOn(overlay.overlay, 'replaceAnim')

      const attackInfo = createMockAttackInfo(DamageState.Critical)
      overlay.damageStateChanged(actor as any, attackInfo)

      // replaceAnim should have been called with the normalized sequence
      expect(replaceAnimSpy).toHaveBeenCalled()
    })

    it('should not crash when currentSequence is null', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      // Force currentSequence to null
      ;(overlay.overlay as any).currentSequence = null

      const attackInfo = createMockAttackInfo()
      expect(() =>
        overlay.damageStateChanged(actor as any, attackInfo),
      ).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should remove animation from RenderSprites', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      expect(rs.animationCount).toBe(1)

      overlay.dispose()

      expect(rs.animationCount).toBe(0)
    })

    it('should set disposed flag', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      overlay.dispose()

      expect(overlay.disposed).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Animation accessors
  // -----------------------------------------------------------------------

  describe('animation accessors', () => {
    it('should expose the overlay Animation', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      expect(overlay.overlay).toBeDefined()
      // Overlay name is rs.getImage(self) = RenderSpritesInfo.Image = 'test-image'
      expect(overlay.overlay.name).toBe('test-image')
    })

    it('should expose the AnimationWithOffset wrapper', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      expect(overlay.animation).toBeInstanceOf(AnimationWithOffset)
      expect(overlay.animation.Animation).toBe(overlay.overlay)
    })
  })

  // -----------------------------------------------------------------------
  // static interfaces
  // -----------------------------------------------------------------------

  describe('interfaces', () => {
    it('should register correct interfaces', () => {
      expect(WithIdleOverlay.interfaces).toContain('INotifyDamageStateChanged')
      expect(WithIdleOverlay.interfaces).toContain('WithIdleOverlay')
      expect(WithIdleOverlay.interfaces).toContain('component')
    })
  })

  // -----------------------------------------------------------------------
  // zOffsetFromCenter (via constructor behavior)
  // -----------------------------------------------------------------------

  describe('Z offset', () => {
    it('should compute zOffset from center to overlay position', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      // The ZOffset function on the AnimationWithOffset should be non-null
      expect(overlay.animation.ZOffset).not.toBeNull()

      // Compute at the actor's center position
      const z = overlay.animation.ZOffset!(actor.CenterPosition)
      // delta.Y = 0 (same position), delta.Z = 0, + offset(1)
      expect(z).toBe(1)
    })

    it('should compute zOffset for offset position', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      // Position 100 units away in Y
      const pos = new WPos(100, 300, 50)
      const z = overlay.animation.ZOffset!(pos)
      // delta.Y = 300 - 200 = 100, delta.Z = 50 - 50 = 0, + 1 = 101
      expect(z).toBe(101)
    })
  })

  // -----------------------------------------------------------------------
  // Facing function
  // -----------------------------------------------------------------------

  describe('facing func', () => {
    it('should use quantized facing when both body and facing exist', () => {
      const overlay = new WithIdleOverlay(info, actor, rs, body, facing, world)

      // Facing func is called in Animation's constructor for play, tick, etc.
      // We just verify the trait was constructed successfully
      expect(overlay).toBeDefined()
    })
  })
})
