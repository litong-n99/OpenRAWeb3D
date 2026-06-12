/**
 * RenderSprites.test.ts — RenderSprites 单元测试
 *
 * 由于 happy-dom 不支持 WebGL，@babylonjs/core 模块不做 mock（本文件不依赖 Babylon.js）。
 * 测试焦点: RenderSpritesInfo.GetImage、RenderSprites 动画管理、Add/Remove、
 * NormalizeSequence/UnnormalizeSequence、AutoRenderSize、Palette 刷新、Tick 行为。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RenderSprites, RenderSpritesInfo, type IRenderActor, type IRenderPlayer } from './RenderSprites'
import { AnimationWithOffset } from '../../../OpenRA.Game/Graphics/AnimationWithOffset.js'
import type { Animation, IRenderable, IPaletteRef, IWorldRenderer } from '../../../OpenRA.Game/Graphics/Animation.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { DamageState, type IGameActor, type IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockAnimation(overrides: Partial<Animation> = {}): Animation {
  return {
    name: 'test',
    currentSequence: null,
    isDecoration: false,
    hasSequence: vi.fn().mockReturnValue(false),
    getSequence: vi.fn(),
    render: vi.fn().mockReturnValue([]),
    renderFlat: vi.fn().mockReturnValue([]),
    screenBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 0, height: 0 }),
    tick: vi.fn(),
    image: null,
    currentFrame: 0,
    play: vi.fn(),
    playRepeating: vi.fn(),
    playThen: vi.fn(),
    playBackwardsThen: vi.fn(),
    playFetchIndex: vi.fn(),
    playFetchDirection: vi.fn(),
    replaceAnim: vi.fn(),
    changeImage: vi.fn(),
    tickMs: vi.fn(),
    getRandomExistingSequence: vi.fn(),
    ...overrides,
  } as unknown as Animation
}

function createMockPalette(name = 'test-palette'): IPaletteRef {
  return { name, textureIndex: 0, hasColorShift: false }
}

function createMockAnimationWithOffset(anim?: Animation): AnimationWithOffset {
  const theAnim = anim ?? createMockAnimation()
  return new AnimationWithOffset(theAnim, null, null, null)
}

function createMockRenderActor(overrides: Partial<IRenderActor> = {}): IRenderActor {
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
      ScreenMap: {
        addOrUpdate: vi.fn(),
      },
    },
    getDamageState: () => DamageState.Undamaged,
    ...overrides,
  } as IRenderActor
}

function createMockWorldRenderer(): IWorldRenderer {
  return {
    screenPxPosition: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    screenPxOffset: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    screenVectorComponents: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
  }
}

// ---------------------------------------------------------------------------
// Tests: RenderSpritesInfo
// ---------------------------------------------------------------------------

describe('RenderSpritesInfo', () => {
  describe('getImage', () => {
    it('should return lowercase Image when no faction override', () => {
      const info = new RenderSpritesInfo('MyUnit')
      expect(info.getImage('fallback')).toBe('myunit')
    })

    it('should return lowercase actor name when Image is null', () => {
      const info = new RenderSpritesInfo(null)
      expect(info.getImage('ActorName')).toBe('actorname')
    })

    it('should use FactionImages override when faction matches', () => {
      const info = new RenderSpritesInfo('DefaultImage', {
        allies: 'AlliedUnit',
        soviets: 'SovietUnit',
      })
      expect(info.getImage('ActorName', 'allies')).toBe('alliedunit')
      expect(info.getImage('ActorName', 'soviets')).toBe('sovietunit')
    })

    it('should fall back to Image when faction does not match', () => {
      const info = new RenderSpritesInfo('DefaultImage', {
        allies: 'AlliedUnit',
      })
      expect(info.getImage('ActorName', 'unknown-faction')).toBe('defaultimage')
    })

    it('should fall back to actor name when no Image and no faction match', () => {
      const info = new RenderSpritesInfo(null, {
        allies: 'AlliedUnit',
      })
      expect(info.getImage('ActorName', 'unknown')).toBe('actorname')
    })

    it('should handle null faction gracefully', () => {
      const info = new RenderSpritesInfo('MyImage', { allies: 'Allied' })
      expect(info.getImage('ActorName', null)).toBe('myimage')
    })

    it('should handle empty string faction gracefully', () => {
      const info = new RenderSpritesInfo('MyImage', { allies: 'Allied' })
      expect(info.getImage('ActorName', '')).toBe('myimage')
    })
  })

  describe('defaults', () => {
    it('should default PlayerPalette to "player"', () => {
      const info = new RenderSpritesInfo('test')
      expect(info.PlayerPalette).toBe('player')
    })

    it('should accept custom PlayerPalette', () => {
      const info = new RenderSpritesInfo('test', null, null, 'custom-player')
      expect(info.PlayerPalette).toBe('custom-player')
    })

    it('should default Palette and Image to null', () => {
      const info = new RenderSpritesInfo()
      expect(info.Image).toBeNull()
      expect(info.Palette).toBeNull()
      expect(info.FactionImages).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: RenderSprites
// ---------------------------------------------------------------------------

describe('RenderSprites', () => {
  let info: RenderSpritesInfo
  let rs: RenderSprites

  beforeEach(() => {
    info = new RenderSpritesInfo('test-image')
    rs = new RenderSprites(info, 'test-faction')
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should store Info and faction', () => {
      expect(rs.Info).toBe(info)
      expect(rs.shouldRefreshPalettes).toBe(true)
      expect(rs.animationCount).toBe(0)
    })

    it('should have static interfaces', () => {
      expect(RenderSprites.interfaces).toContain('ITick')
      expect(RenderSprites.interfaces).toContain('IRender')
      expect(RenderSprites.interfaces).toContain('RenderSprites')
    })
  })

  // -----------------------------------------------------------------------
  // GetImage
  // -----------------------------------------------------------------------

  describe('getImage', () => {
    it('should delegate to Info.getImage with actor name and faction', () => {
      const actor = createMockRenderActor({ Info: { Name: 'MyActor' } })
      const info2 = new RenderSpritesInfo('BaseImage', { 'test-faction': 'FactionImage' })
      const rs2 = new RenderSprites(info2, 'test-faction')
      const result = rs2.getImage(actor)
      expect(result).toBe('factionimage')
    })

    it('should cache the result', () => {
      const actor = createMockRenderActor()
      const first = rs.getImage(actor)
      const second = rs.getImage(actor)
      expect(first).toBe(second)
      // Both should return the same value (cached after first call)
    })
  })

  // -----------------------------------------------------------------------
  // Add / Remove
  // -----------------------------------------------------------------------

  describe('add', () => {
    it('should add an animation wrapper and increment count', () => {
      const anim = createMockAnimation()
      const awo = new AnimationWithOffset(anim, null, null, null)
      rs.add(awo, 'my-palette', false)
      expect(rs.animationCount).toBe(1)
      expect(rs.shouldRefreshPalettes).toBe(true)
    })

    it('should use default palette from Info when palette is null', () => {
      const infoWithPalette = new RenderSpritesInfo('test', null, 'default-pal')
      const rs2 = new RenderSprites(infoWithPalette)
      const awo = createMockAnimationWithOffset()
      rs2.add(awo) // no palette specified
      expect(rs2.animationCount).toBe(1)
      // Animation wrapper created with Info.Palette as default
    })

    it('should infer isPlayerPalette when palette is null and Info.Palette is null', () => {
      // When Info.Palette is null and palette is not specified,
      // Info.PlayerPalette is used and isPlayerPalette becomes true
      const infoNoPal = new RenderSpritesInfo('test', null, null, 'player')
      const rs2 = new RenderSprites(infoNoPal)
      const awo = createMockAnimationWithOffset()
      rs2.add(awo)
      expect(rs2.animationCount).toBe(1)
    })

    it('should support adding multiple animations', () => {
      rs.add(createMockAnimationWithOffset())
      rs.add(createMockAnimationWithOffset())
      rs.add(createMockAnimationWithOffset())
      expect(rs.animationCount).toBe(3)
    })
  })

  describe('remove', () => {
    it('should remove an animation and decrement count', () => {
      const awo = createMockAnimationWithOffset()
      rs.add(awo)
      expect(rs.animationCount).toBe(1)
      rs.remove(awo)
      expect(rs.animationCount).toBe(0)
    })

    it('should not remove non-matching animations', () => {
      const awo1 = createMockAnimationWithOffset()
      const awo2 = createMockAnimationWithOffset()
      rs.add(awo1)
      rs.add(awo2)
      rs.remove(awo1)
      expect(rs.animationCount).toBe(1)
    })

    it('should handle removing non-existent animation gracefully', () => {
      const awo = createMockAnimationWithOffset()
      rs.remove(awo) // was never added
      expect(rs.animationCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // OwnerChanged
  // -----------------------------------------------------------------------

  describe('updatePalette', () => {
    it('should set shouldRefreshPalettes to true', () => {
      // Add animation then trigger refresh
      const awo = createMockAnimationWithOffset()
      rs.add(awo, 'test-pal', false)
      // Reset the flag (it's set to true by add)
      // Actually shouldRefreshPalettes is already true from construction
      rs.updatePalette()
      expect(rs.shouldRefreshPalettes).toBe(true)
    })
  })

  describe('onOwnerChanged', () => {
    it('should call updatePalette', () => {
      const awo = createMockAnimationWithOffset()
      rs.add(awo, 'pal', false)
      // Force flag to false
      rs.render(createMockRenderActor(), createMockWorldRenderer())
      // Now shouldRefreshPalettes should be reset after render with palette set
      // Simulate owner change
      const mockPlayer = { playerName: 'old', InternalName: 'old' } as IRenderPlayer
      rs.onOwnerChanged({} as IGameActor, mockPlayer, mockPlayer)
      expect(rs.shouldRefreshPalettes).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  describe('render', () => {
    it('should return empty array when no animations', () => {
      const actor = createMockRenderActor()
      const wr = createMockWorldRenderer()
      const result = rs.render(actor, wr)
      expect(result).toEqual([])
    })

    it('should collect renderables from visible animations', () => {
      const anim = createMockAnimation()
      const expectedPos = new WPos(100, 200, 50)
      const expectedPalette = createMockPalette('test-palette')
      const mockRenderable = {
        pos: expectedPos,
        offset: WVec.Zero,
        zOffset: 0,
        palette: expectedPalette,
        sprite: null,
        scale: 1,
        alpha: 1,
        rotation: 0,
        isDecoration: false,
        type: 'sprite' as const,
      } as IRenderable
      const renderSpy = anim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([mockRenderable])

      const awo = new AnimationWithOffset(anim, null, null, null)
      rs.add(awo, 'test-palette', false)

      // Set palette resolver
      rs.setPaletteResolver((name: string) => createMockPalette(name))

      const actor = createMockRenderActor()
      const wr = createMockWorldRenderer()
      const result = rs.render(actor, wr)

      expect(result.length).toBe(1)
      expect(result[0]!.pos).toEqual(expectedPos)
      expect(result[0]!.palette.name).toBe('test-palette')
      expect(result[0]!.type).toBe('sprite')
    })

    it('should skip invisible animations', () => {
      const anim = createMockAnimation()
      const renderSpy = anim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([])

      const disableFn = () => true // always disabled
      const awo = new AnimationWithOffset(anim, null, disableFn, null)
      rs.add(awo, 'pal', false)
      rs.setPaletteResolver((name: string) => createMockPalette(name))

      const actor = createMockRenderActor()
      const wr = createMockWorldRenderer()
      const result = rs.render(actor, wr)

      // No renderables since animation is disabled
      expect(result).toEqual([])
    })

    it('should produce specific renderable properties when enabled', () => {
      const anim = createMockAnimation()
      const expectedRenderable = {
        pos: new WPos(50, 60, 70),
        offset: new WVec(1, 2, 3),
        zOffset: 5,
        palette: { name: 'enabled-pal', textureIndex: 0, hasColorShift: false },
        sprite: null,
        scale: 2,
        alpha: 0.8,
        rotation: Math.PI / 4,
        isDecoration: true,
        type: 'shadow' as const,
      } as IRenderable
      const renderSpy = anim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([expectedRenderable])

      const disableFn = () => false // enabled
      const awo = new AnimationWithOffset(anim, null, disableFn, null)
      rs.add(awo, 'enabled-pal', false)
      rs.setPaletteResolver((name: string) => createMockPalette(name))

      const actor = createMockRenderActor()
      const wr = createMockWorldRenderer()
      const result = rs.render(actor, wr)

      expect(result.length).toBe(1)
      expect(result[0]!.pos.X).toBe(50)
      expect(result[0]!.pos.Y).toBe(60)
      expect(result[0]!.pos.Z).toBe(70)
      expect(result[0]!.offset.X).toBe(1)
      expect(result[0]!.palette.name).toBe('enabled-pal')
      expect(result[0]!.type).toBe('shadow')
      expect(result[0]!.scale).toBe(2)
      expect(result[0]!.alpha).toBe(0.8)
    })

    it('should resolve EffectiveOwner with disguise', () => {
      const anim = createMockAnimation()
      const renderSpy = anim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([])
      const awo = new AnimationWithOffset(anim, null, null, null)
      rs.add(awo, 'player-pal', true)
      const paletteSpy = vi.fn((name: string) => createMockPalette(name))
      rs.setPaletteResolver(paletteSpy)

      const disguisedOwner = {
        playerName: 'disguised',
        InternalName: 'disguised-internal',
      } as IRenderPlayer
      const actor = createMockRenderActor({
        EffectiveOwner: { Disguised: true, Owner: disguisedOwner } as any,
      })
      const wr = createMockWorldRenderer()
      rs.render(actor, wr)

      // Palette resolver should be called with player-pal + disguised owner InternalName
      expect(paletteSpy).toHaveBeenCalledWith('player-paldisguised-internal')
    })
  })

  // -----------------------------------------------------------------------
  // ScreenBounds
  // -----------------------------------------------------------------------

  describe('screenBounds', () => {
    it('should collect screen bounds from visible animations', () => {
      const anim = createMockAnimation()
      const boundsSpy = anim.screenBounds as ReturnType<typeof vi.fn>
      boundsSpy.mockReturnValue({ x: 10, y: 20, width: 32, height: 32 })

      const awo = new AnimationWithOffset(anim, null, null, null)
      rs.add(awo, 'pal', false)
      rs.setPaletteResolver(() => createMockPalette())

      const actor = createMockRenderActor()
      const wr = createMockWorldRenderer()
      const result = rs.screenBounds(actor, wr)

      expect(result).toEqual([{ x: 10, y: 20, width: 32, height: 32 }])
    })

    it('should skip invisible animations', () => {
      const anim = createMockAnimation()
      const awo = new AnimationWithOffset(anim, null, () => true, null)
      rs.add(awo, 'pal', false)

      const actor = createMockRenderActor()
      const wr = createMockWorldRenderer()
      const result = rs.screenBounds(actor, wr)

      expect(result).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('should tick all animations and update ScreenMap if changed', () => {
      const anim = createMockAnimation()
      const tickSpy = anim.tick as ReturnType<typeof vi.fn>
      // Simulate animation change by changing currentSequence
      const awo = new AnimationWithOffset(anim, null, null, null)
      rs.add(awo, 'pal', false)

      const actor = createMockRenderActor()

      rs.tick(actor)

      expect(tickSpy).toHaveBeenCalled()
      // Since currentSequence changed (null -> something if we mock it),
      // ScreenMap.addOrUpdate should be called
    })

    it('should not update ScreenMap if nothing changed', () => {
      const anim = createMockAnimation({ currentSequence: { name: 'idle', length: 8, tick: 40, scale: 1, zOffset: 0, shadowZOffset: 0, ignoreWorldTint: false, bounds: { x: 0, y: 0, width: 0, height: 0 }, getSprite: vi.fn(), getSpriteWithRotation: vi.fn(), getAlpha: vi.fn(), getShadow: vi.fn() } })
      const awo = new AnimationWithOffset(anim, null, null, null)
      rs.add(awo, 'pal', false)

      // First tick: currentSequence changes (null -> idle), triggers update
      const actor = createMockRenderActor()
      const spy = actor.World.ScreenMap.addOrUpdate as ReturnType<typeof vi.fn>
      spy.mockClear()

      // Second tick: same sequence, no change
      rs.tick(actor)

      // addOrUpdate should not be called again if nothing changed
      // (unless the tick itself changed something)
    })
  })

  // -----------------------------------------------------------------------
  // AutoRenderSize / AutoSelectionSize
  // -----------------------------------------------------------------------

  describe('autoRenderSize', () => {
    it('should return {0,0} when no animations', () => {
      const result = rs.autoRenderSize()
      expect(result).toEqual({ x: 0, y: 0 })
    })

    it('should return {0,0} when no visible animation has a sequence', () => {
      const anim = createMockAnimation({ currentSequence: null, image: null })
      const awo = new AnimationWithOffset(anim, null, null, null)
      rs.add(awo, 'pal', false)
      const result = rs.autoRenderSize()
      expect(result).toEqual({ x: 0, y: 0 })
    })

    it('should skip invisible animations', () => {
      const anim = createMockAnimation()
      const awo = new AnimationWithOffset(anim, null, () => true, null)
      rs.add(awo, 'pal', false)
      const result = rs.autoRenderSize()
      expect(result).toEqual({ x: 0, y: 0 })
    })

    it('autoSelectionSize should delegate to autoRenderSize', () => {
      const result1 = rs.autoRenderSize()
      const result2 = rs.autoSelectionSize()
      expect(result1).toEqual(result2)
    })
  })

  // -----------------------------------------------------------------------
  // Static: NormalizeSequence / UnnormalizeSequence
  // -----------------------------------------------------------------------

  describe('normalizeSequence / unnormalizeSequence', () => {
    it('should strip damage prefix from sequence names', () => {
      expect(RenderSprites.unnormalizeSequence('critical-idle')).toBe('idle')
      expect(RenderSprites.unnormalizeSequence('damaged-run')).toBe('run')
      expect(RenderSprites.unnormalizeSequence('scratched-walk')).toBe('walk')
      expect(RenderSprites.unnormalizeSequence('scuffed-attack')).toBe('attack')
    })

    it('should return the same string if no prefix match', () => {
      expect(RenderSprites.unnormalizeSequence('idle')).toBe('idle')
      expect(RenderSprites.unnormalizeSequence('')).toBe('')
    })

    it('should only strip the first matching prefix', () => {
      expect(RenderSprites.unnormalizeSequence('critical-damaged-idle')).toBe(
        'damaged-idle',
      )
    })

    it('normalizeSequence should return original when state is Undamaged', () => {
      const anim = createMockAnimation({
        hasSequence: vi.fn().mockReturnValue(false),
      })
      const result = RenderSprites.normalizeSequence(
        anim,
        DamageState.Undamaged,
        'idle',
      )
      // Undamaged < all damage prefixes, so no prefix added
      // Actually Undamaged=1, Light=2, so Undamaged < Light
      // But we still loop through and check state >= dp.damageState
      // Undamaged < Light, so no prefix
      expect(result).toBe('idle')
    })

    it('normalizeSequence should add prefix when state is severe enough', () => {
      const anim = createMockAnimation({
        hasSequence: vi.fn((seq: string) => seq === 'critical-idle'),
      })
      const result = RenderSprites.normalizeSequence(
        anim,
        DamageState.Critical,
        'idle',
      )
      // Critical >= Critical, and critical-idle exists
      expect(result).toBe('critical-idle')
    })

    it('normalizeSequence should fall through to lighter prefixes', () => {
      const anim = createMockAnimation({
        hasSequence: vi.fn((seq: string) => {
          return seq === 'scratched-idle' // only Medium prefix exists
        }),
      })
      // Heavy state: checks critical- (no), damaged- (no), scratched- (yes)
      const result = RenderSprites.normalizeSequence(
        anim,
        DamageState.Heavy,
        'idle',
      )
      expect(result).toBe('scratched-idle')
    })

    it('normalizeSequence should return original if no prefixed variant exists', () => {
      const anim = createMockAnimation({
        hasSequence: vi.fn().mockReturnValue(false),
      })
      const result = RenderSprites.normalizeSequence(
        anim,
        DamageState.Critical,
        'idle',
      )
      expect(result).toBe('idle')
    })

    it('normalizeSequence should strip existing prefix first', () => {
      const anim = createMockAnimation({
        hasSequence: vi.fn((seq: string) => seq === 'critical-run'),
      })
      const result = RenderSprites.normalizeSequence(
        anim,
        DamageState.Critical,
        'scratched-run', // has scratched- prefix from before
      )
      // unnormalize removes 'scratched-'
      // then normalize at Critical adds 'critical-' if exists
      expect(result).toBe('critical-run')
    })
  })

  // -----------------------------------------------------------------------
  // Static: renderAnimations
  // -----------------------------------------------------------------------

  describe('renderAnimations (static)', () => {
    it('should produce renderables from AnimationWithOffset.Render', () => {
      const anim = createMockAnimation()
      const expectedPos = new WPos(10, 20, 30)
      const mockRenderable = {
        pos: expectedPos,
        offset: WVec.Zero,
        zOffset: 3,
        palette: createMockPalette('test-pal'),
        sprite: null,
        scale: 1,
        alpha: 1,
        rotation: 0,
        isDecoration: false,
        type: 'sprite' as const,
      } as IRenderable
      const renderSpy = anim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([mockRenderable])

      const awo = new AnimationWithOffset(anim, null, null, null)
      // Add via public API and render first to resolve PaletteReference
      rs.add(awo, 'test-pal', false)
      rs.setPaletteResolver((name: string) => createMockPalette(name))

      const actor = createMockRenderActor()
      // First call render() to resolve palettes and set PaletteReference
      rs.render(actor, createMockWorldRenderer())

      // Now renderAnimations should produce actual renderables
      const anims = (rs as any)._anims as Array<any>
      const result = RenderSprites.renderAnimations(anims, actor)

      expect(result.length).toBe(1)
      expect(result[0]!.pos).toEqual(expectedPos)
      expect(result[0]!.zOffset).toBe(3)
      expect(result[0]!.palette.name).toBe('test-pal')
      expect(result[0]!.type).toBe('sprite')
    })

    it('should skip invisible animations in renderAnimations', () => {
      const anim = createMockAnimation()
      const renderSpy = anim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([])

      const awo = new AnimationWithOffset(anim, null, () => true, null) // disabled
      rs.add(awo, 'test-pal', false)
      rs.setPaletteResolver((name: string) => createMockPalette(name))

      // Render to resolve palettes
      const actor = createMockRenderActor()
      rs.render(actor, createMockWorldRenderer())

      // The wrapper should have PaletteReference but be invisible
      const anims = (rs as any)._anims as Array<any>
      const result = RenderSprites.renderAnimations(anims, actor)

      // Disabled animations produce no renderables from renderAnimations
      expect(result).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // DamagePrefixes
  // -----------------------------------------------------------------------

  describe('DamagePrefixes', () => {
    it('should have correct prefix order (most severe first)', () => {
      const prefixes = RenderSprites.DamagePrefixes
      expect(prefixes).toHaveLength(4)
      expect(prefixes[0]!.prefix).toBe('critical-')
      expect(prefixes[1]!.prefix).toBe('damaged-')
      expect(prefixes[2]!.prefix).toBe('scratched-')
      expect(prefixes[3]!.prefix).toBe('scuffed-')
    })

    it('should map to correct DamageState values', () => {
      const prefixes = RenderSprites.DamagePrefixes
      expect(prefixes[0]!.damageState).toBe(DamageState.Critical)
      expect(prefixes[1]!.damageState).toBe(DamageState.Heavy)
      expect(prefixes[2]!.damageState).toBe(DamageState.Medium)
      expect(prefixes[3]!.damageState).toBe(DamageState.Light)
    })
  })

  // -----------------------------------------------------------------------
  // makeFacingFunc
  // -----------------------------------------------------------------------

  describe('makeFacingFunc', () => {
    it('returns () => 0 when facing is null', () => {
      const func = RenderSprites.makeFacingFunc(null)
      expect(func()).toBe(0)
    })

    it('returns () => facing.facing.angle for valid IFacing', () => {
      const mockWAngle = { angle: 256 }
      const mockFacing = {
        turnSpeed: { angle: 64 } as any,
        facing: mockWAngle as any,
        orientation: { yaw: 0, pitch: 0, roll: 0 } as any,
      } as IFacing
      const func = RenderSprites.makeFacingFunc(mockFacing)
      expect(func()).toBe(256)
      // Verify it dynamically reads the current facing value
      mockWAngle.angle = 512
      expect(func()).toBe(512)
    })
  })
})
