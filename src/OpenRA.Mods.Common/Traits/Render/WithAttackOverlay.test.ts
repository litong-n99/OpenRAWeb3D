/**
 * WithAttackOverlay.test.ts — WithAttackOverlay migration unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WithAttackOverlay, WithAttackOverlayInfo } from './WithAttackOverlay.js'
import { AttackDelayType } from '../CombatInterfaces.js'

describe('WithAttackOverlayInfo', () => {
  it('defaults armament to null (all armaments)', () => {
    const info = new WithAttackOverlayInfo()
    expect(info.armament).toBeNull()
  })

  it('defaults delay to 0', () => {
    const info = new WithAttackOverlayInfo()
    expect(info.delay).toBe(0)
  })

  it('defaults delayRelativeTo to Preparation', () => {
    const info = new WithAttackOverlayInfo()
    expect(info.delayRelativeTo).toBe(AttackDelayType.Preparation)
  })

  it('defaults isDecoration to false', () => {
    const info = new WithAttackOverlayInfo()
    expect(info.isDecoration).toBe(false)
  })

  it('accepts custom armament name', () => {
    const info = new WithAttackOverlayInfo({ armament: 'primary', sequence: 'muzzle' })
    expect(info.armament).toBe('primary')
    expect(info.sequence).toBe('muzzle')
  })
})

describe('WithAttackOverlay', () => {
  let mockAnimation: { playThen: ReturnType<typeof vi.fn> }
  let mockRenderSprites: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
  let mockAnimWithOffset: unknown

  beforeEach(() => {
    mockAnimation = { playThen: vi.fn() }
    mockRenderSprites = { add: vi.fn(), remove: vi.fn() }
    mockAnimWithOffset = {}
  })

  it('starts as not attacking', () => {
    const info = new WithAttackOverlayInfo()
    const overlay = new WithAttackOverlay(info)
    expect(overlay.attackingState).toBe(false)
  })

  it('init registers with RenderSprites', () => {
    const info = new WithAttackOverlayInfo({ palette: 'testPal', isPlayerPalette: true })
    const overlay = new WithAttackOverlay(info)
    overlay.init(mockRenderSprites, mockAnimation, mockAnimWithOffset)
    expect(mockRenderSprites.add).toHaveBeenCalledWith(
      mockAnimWithOffset,
      'testPal',
      true,
    )
  })

  it('preparingAttack triggers overlay when delay=0 and delayRelativeTo=Preparation', () => {
    const info = new WithAttackOverlayInfo({ delay: 0, delayRelativeTo: AttackDelayType.Preparation })
    const overlay = new WithAttackOverlay(info)
    overlay.init(mockRenderSprites, mockAnimation, mockAnimWithOffset)

    overlay.preparingAttack({} as never, {} as never, { info: { name: 'primary' } }, {} as never)
    expect(overlay.attackingState).toBe(true)
    expect(mockAnimation.playThen).toHaveBeenCalled()
  })

  it('attacking triggers overlay when delay=0 and delayRelativeTo=Attack', () => {
    const info = new WithAttackOverlayInfo({ delay: 0, delayRelativeTo: AttackDelayType.Attack })
    const overlay = new WithAttackOverlay(info)
    overlay.init(mockRenderSprites, mockAnimation, mockAnimWithOffset)

    overlay.attacking({} as never, {} as never, { info: { name: 'primary' } }, {} as never)
    expect(overlay.attackingState).toBe(true)
  })

  it('filters by armament name when configured', () => {
    const info = new WithAttackOverlayInfo({ armament: 'secondary', delay: 0 })
    const overlay = new WithAttackOverlay(info)
    overlay.init(mockRenderSprites, mockAnimation, mockAnimWithOffset)

    overlay.attacking({} as never, {} as never, { info: { name: 'primary' } }, {} as never)
    expect(overlay.attackingState).toBe(false)
  })

  it('delay countdown via tick', () => {
    const info = new WithAttackOverlayInfo({ delay: 3, delayRelativeTo: AttackDelayType.Attack })
    const overlay = new WithAttackOverlay(info)
    overlay.init(mockRenderSprites, mockAnimation, mockAnimWithOffset)

    overlay.attacking({} as never, {} as never, { info: { name: 'primary' } }, {} as never)
    expect(overlay.attackingState).toBe(false)

    overlay.tick({} as never)
    expect((overlay as unknown as { tickCount: number }).tickCount).toBe(2)

    overlay.tick({} as never)
    overlay.tick({} as never)
    expect(overlay.attackingState).toBe(true)
  })

  it('dispose removes from RenderSprites', () => {
    const info = new WithAttackOverlayInfo()
    const overlay = new WithAttackOverlay(info)
    overlay.init(mockRenderSprites, mockAnimation, mockAnimWithOffset)
    overlay.dispose()
    expect(mockRenderSprites.remove).toHaveBeenCalled()
  })

  it('playOverlay callback sets attackingState to false', () => {
    const info = new WithAttackOverlayInfo({ delay: 0 })
    const overlay = new WithAttackOverlay(info)
    const anim = { playThen: vi.fn() }
    overlay.init(mockRenderSprites, anim, mockAnimWithOffset)

    overlay.preparingAttack({} as never, {} as never, { info: { name: 'primary' } }, {} as never)
    expect(anim.playThen).toHaveBeenCalled()
    // Get the callback and invoke it
    const callback = anim.playThen.mock.calls[0][1]
    callback()
    expect(overlay.attackingState).toBe(false)
  })
})
