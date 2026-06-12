/**
 * AnimationWithOffset.test.ts — AnimationWithOffset 单元测试
 *
 * AnimationWithOffset 是纯逻辑类（无 Babylon.js 依赖），所有功能均可单元测试。
 * 测试范围: 构造函数、构造重载、Render、ScreenBounds、fromAnimation 工厂方法。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnimationWithOffset, type IHasCenterPosition } from './AnimationWithOffset'
import type { Animation, IRenderable, IPaletteRef, IWorldRenderer } from './Animation'
import { WPos } from '../WPos'
import { WVec } from '../WVec'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAnimation(overrides: Partial<Animation> = {}): Animation {
  return {
    name: 'test',
    currentSequence: null,
    isDecoration: false,
    hasSequence: () => false,
    getSequence: () => ({ name: '', length: 0, tick: 40, scale: 1, zOffset: 0, shadowZOffset: 0, ignoreWorldTint: false, bounds: { x: 0, y: 0, width: 0, height: 0 }, getSprite: vi.fn(), getSpriteWithRotation: vi.fn(), getAlpha: vi.fn(), getShadow: vi.fn() }),
    render: vi.fn().mockReturnValue([]),
    renderFlat: vi.fn().mockReturnValue([]),
    screenBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 0, height: 0 }),
    tick: vi.fn(),
    ...overrides,
  } as unknown as Animation
}

function createMockPalette(): IPaletteRef {
  return {
    name: 'test-palette',
    textureIndex: 0,
    hasColorShift: false,
  }
}

function createMockSelf(centerPos?: WPos): IHasCenterPosition {
  return {
    CenterPosition: centerPos ?? new WPos(100, 200, 50),
  }
}

function createMockWorldRenderer(): IWorldRenderer {
  return {
    screenPxPosition: vi.fn((pos: WPos) => ({ x: pos.X, y: pos.Y })),
    screenPxOffset: vi.fn((offset: WVec) => ({ x: offset.X, y: offset.Y })),
    screenVectorComponents: vi.fn((offset: WVec) => ({ x: offset.X, y: offset.Y, z: offset.Z })),
  }
}

// ---------------------------------------------------------------------------
// Tests: AnimationWithOffset
// ---------------------------------------------------------------------------

describe('AnimationWithOffset', () => {
  let mockAnim: Animation
  let mockPal: IPaletteRef
  let mockSelf: IHasCenterPosition

  beforeEach(() => {
    mockAnim = createMockAnimation()
    mockPal = createMockPalette()
    mockSelf = createMockSelf()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should construct with all null callbacks', () => {
      const awo = new AnimationWithOffset(mockAnim, null, null, null)
      expect(awo.Animation).toBe(mockAnim)
      expect(awo.OffsetFunc).toBeNull()
      expect(awo.DisableFunc).toBeNull()
      expect(awo.ZOffset).toBeNull()
    })

    it('should construct with offset function', () => {
      const offsetFn = () => new WVec(10, 20, 30)
      const awo = new AnimationWithOffset(mockAnim, offsetFn, null, null)
      expect(awo.OffsetFunc).toBe(offsetFn)
      expect(awo.DisableFunc).toBeNull()
    })

    it('should construct with disable function', () => {
      const disableFn = () => true
      const awo = new AnimationWithOffset(mockAnim, null, disableFn, null)
      expect(awo.DisableFunc).toBe(disableFn)
    })

    it('should construct with constant zOffset (number)', () => {
      const awo = new AnimationWithOffset(mockAnim, null, null, 5)
      expect(awo.ZOffset).not.toBeNull()
      // ZOffset function should return the constant value
      const pos = new WPos(0, 0, 0)
      const result = awo.ZOffset!(pos)
      expect(result).toBe(5)
    })

    it('should construct with dynamic zOffset (function)', () => {
      const zFn = (p: WPos) => p.Y + p.Z
      const awo = new AnimationWithOffset(mockAnim, null, null, zFn)
      expect(awo.ZOffset).toBe(zFn)
      const pos = new WPos(0, 100, 50)
      const result = awo.ZOffset!(pos)
      expect(result).toBe(150)
    })

    it('should construct with no zOffset (undefined)', () => {
      const awo = new AnimationWithOffset(mockAnim, null, null, undefined)
      expect(awo.ZOffset).toBeNull()
    })

    it('should accept all three callbacks', () => {
      const offsetFn = () => new WVec(1, 2, 3)
      const disableFn = () => false
      const zFn = (p: WPos) => p.X
      const awo = new AnimationWithOffset(mockAnim, offsetFn, disableFn, zFn)
      expect(awo.OffsetFunc).toBe(offsetFn)
      expect(awo.DisableFunc).toBe(disableFn)
      expect(awo.ZOffset).toBe(zFn)
    })
  })

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  describe('render', () => {
    it('should call Animation.render with center position and zero offset when no OffsetFunc', () => {
      const awo = new AnimationWithOffset(mockAnim, null, null, null)
      const renderSpy = mockAnim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([{ pos: mockSelf.CenterPosition, zOffset: 0 }])

      awo.render(mockSelf, mockPal)

      expect(renderSpy).toHaveBeenCalledTimes(1)
      const callArgs = renderSpy.mock.calls[0]!
      // First arg: center position (actor's CenterPosition)
      expect(callArgs[0]).toEqual(mockSelf.CenterPosition)
      // Second arg: offset (zero when OffsetFunc is null)
      expect(callArgs[1]).toEqual(WVec.Zero)
      // Third arg: z (0 when ZOffset is null)
      expect(callArgs[2]).toBe(0)
      // Fourth arg: palette
      expect(callArgs[3]).toBe(mockPal)
    })

    it('should apply OffsetFunc when provided', () => {
      const offsetFn = () => new WVec(10, 20, 30)
      const awo = new AnimationWithOffset(mockAnim, offsetFn, null, null)
      const renderSpy = mockAnim.render as ReturnType<typeof vi.fn>

      awo.render(mockSelf, mockPal)

      expect(renderSpy).toHaveBeenCalledTimes(1)
      const callArgs = renderSpy.mock.calls[0]!
      expect(callArgs[1]).toEqual(new WVec(10, 20, 30))
    })

    it('should apply ZOffset when provided', () => {
      const zFn = vi.fn((p: WPos) => p.Y + 10)
      const awo = new AnimationWithOffset(mockAnim, null, null, zFn)
      const renderSpy = mockAnim.render as ReturnType<typeof vi.fn>

      awo.render(mockSelf, mockPal)

      // ZOffset is called with center + offset position
      expect(zFn).toHaveBeenCalledTimes(1)
      const renderCall = renderSpy.mock.calls[0]!
      expect(renderCall[2]).toBe(210) // mockSelf.CenterPosition.Y (200) + 10
    })

    it('should compute correct position with both offset and zOffset', () => {
      const offsetFn = () => new WVec(5, 10, 15)
      const zFn = (p: WPos) => p.Y + p.Z
      const awo = new AnimationWithOffset(mockAnim, offsetFn, null, zFn)
      const renderSpy = mockAnim.render as ReturnType<typeof vi.fn>

      // CenterPosition = (100, 200, 50)
      // Offset = (5, 10, 15)
      // center + offset = (105, 210, 65)
      // ZOffset = 210 + 65 = 275
      awo.render(mockSelf, mockPal)

      const callArgs = renderSpy.mock.calls[0]!
      expect(callArgs[0]).toEqual(mockSelf.CenterPosition) // center unchanged for render
      expect(callArgs[1]).toEqual(new WVec(5, 10, 15))
      expect(callArgs[2]).toBe(275) // 210 + 65
    })

    it('should return the renderables from Animation.render', () => {
      const expectedRenderables = [
        { pos: new WPos(0, 0, 0), zOffset: 0 },
        { pos: new WPos(0, 0, 0), zOffset: 1 },
      ] as unknown as IRenderable[]
      const renderSpy = mockAnim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue(expectedRenderables)

      const awo = new AnimationWithOffset(mockAnim, null, null, null)
      const result = awo.render(mockSelf, mockPal)

      expect(result).toEqual(expectedRenderables)
    })

    it('should pass the palette reference through', () => {
      const customPal = { name: 'custom', textureIndex: 5, hasColorShift: true } as IPaletteRef
      const awo = new AnimationWithOffset(mockAnim, null, null, null)
      const renderSpy = mockAnim.render as ReturnType<typeof vi.fn>

      awo.render(mockSelf, customPal)

      expect(renderSpy.mock.calls[0]![3]).toBe(customPal)
    })
  })

  // -----------------------------------------------------------------------
  // ScreenBounds
  // -----------------------------------------------------------------------

  describe('screenBounds', () => {
    it('should delegate to Animation.screenBounds with correct parameters', () => {
      const wr = createMockWorldRenderer()
      const awo = new AnimationWithOffset(mockAnim, null, null, null)
      const screenBoundsSpy = mockAnim.screenBounds as ReturnType<typeof vi.fn>
      screenBoundsSpy.mockReturnValue({ x: 10, y: 20, width: 32, height: 32 })

      const result = awo.screenBounds(mockSelf, wr)

      expect(screenBoundsSpy).toHaveBeenCalledTimes(1)
      const callArgs = screenBoundsSpy.mock.calls[0]!
      expect(callArgs[0]).toBe(wr)
      expect(callArgs[1]).toEqual(mockSelf.CenterPosition)
      expect(callArgs[2]).toEqual(WVec.Zero) // zero offset when no OffsetFunc
      expect(result).toEqual({ x: 10, y: 20, width: 32, height: 32 })
    })

    it('should apply OffsetFunc to screenBounds', () => {
      const wr = createMockWorldRenderer()
      const offsetFn = () => new WVec(15, 25, 35)
      const awo = new AnimationWithOffset(mockAnim, offsetFn, null, null)
      const screenBoundsSpy = mockAnim.screenBounds as ReturnType<typeof vi.fn>

      awo.screenBounds(mockSelf, wr)

      const callArgs = screenBoundsSpy.mock.calls[0]!
      expect(callArgs[2]).toEqual(new WVec(15, 25, 35))
    })

    it('should use zero offset when OffsetFunc is null', () => {
      const wr = createMockWorldRenderer()
      const awo = new AnimationWithOffset(mockAnim, null, null, null)
      const screenBoundsSpy = mockAnim.screenBounds as ReturnType<typeof vi.fn>

      awo.screenBounds(mockSelf, wr)

      expect(screenBoundsSpy.mock.calls[0]![2]).toEqual(WVec.Zero)
    })
  })

  // -----------------------------------------------------------------------
  // fromAnimation (implicit operator equivalent)
  // -----------------------------------------------------------------------

  describe('fromAnimation', () => {
    it('should create AnimationWithOffset with all null callbacks', () => {
      const awo = AnimationWithOffset.fromAnimation(mockAnim)

      expect(awo.Animation).toBe(mockAnim)
      expect(awo.OffsetFunc).toBeNull()
      expect(awo.DisableFunc).toBeNull()
      expect(awo.ZOffset).toBeNull()
    })

    it('should produce renderable output equivalent to Animation.renderFlat', () => {
      const awo = AnimationWithOffset.fromAnimation(mockAnim)
      const renderSpy = mockAnim.render as ReturnType<typeof vi.fn>
      renderSpy.mockReturnValue([])

      awo.render(mockSelf, mockPal)

      // Should call render with center, zero offset, zero zOffset
      expect(renderSpy.mock.calls[0]![1]).toEqual(WVec.Zero)
      expect(renderSpy.mock.calls[0]![2]).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // ZOffset function overloads
  // -----------------------------------------------------------------------

  describe('ZOffset overloads', () => {
    it('constant zOffset should always return same value', () => {
      const awo = new AnimationWithOffset(mockAnim, null, null, 42)
      expect(awo.ZOffset).not.toBeNull()
      expect(awo.ZOffset!(new WPos(0, 0, 0))).toBe(42)
      expect(awo.ZOffset!(new WPos(100, 200, 300))).toBe(42)
    })

    it('function zOffset should use the position', () => {
      const awo = new AnimationWithOffset(mockAnim, null, null, (p: WPos) => p.X + p.Y + p.Z)
      expect(awo.ZOffset!(new WPos(10, 20, 30))).toBe(60)
      expect(awo.ZOffset!(new WPos(1, 2, 3))).toBe(6)
    })
  })
})
