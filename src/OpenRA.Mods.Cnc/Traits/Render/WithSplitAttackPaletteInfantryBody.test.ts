/**
 * WithSplitAttackPaletteInfantryBody.test.ts — Unit tests
 *
 * Tests focus on: Attacking state handling, visibility toggle, palette registration.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithSplitAttackPaletteInfantryBody,
  WithSplitAttackPaletteInfantryBodyInfo,
  InfantryAnimationState,
  type ISplitAttackRenderSprites,
  type ISplitAttackAnimation,
  type ISplitAttackInfantryBody,
  type IArmamentAccess,
  type IBarrelAccess,
} from './WithSplitAttackPaletteInfantryBody.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActors(): {
  actor: IGameActor
  renderSprites: ISplitAttackRenderSprites & { remove: ReturnType<typeof vi.fn> }
  body: ISplitAttackInfantryBody
  splitAnim: ISplitAttackAnimation & { playThenCalls: string[]; seqCalls: string[] }
} {
  const seqCalls: string[] = []
  const playThenCalls: string[] = []
  const removeSpy = vi.fn()

  const splitAnim: ISplitAttackAnimation & { playThenCalls: string[]; seqCalls: string[] } = {
    name: 'test',
    currentSequence: { name: 'stand' },
    hasSequence: vi.fn().mockReturnValue(true),
    playThen(sequence: string, onComplete: () => void) {
      playThenCalls.push(sequence)
      onComplete()
    },
    playThenCalls,
    seqCalls,
  }

  const renderSprites = {
    getImage: vi.fn().mockReturnValue('infantry'),
    add: vi.fn(),
    remove: removeSpy,
  }

  const body: ISplitAttackInfantryBody = {
    info: {
      name: 'body',
      enabledByDefault: true,
      splitAttackPalette: 'muzzle',
      splitAttackSuffix: 'muzzle',
    },
    defaultAnimation: splitAnim,
    attacking: vi.fn(),
    isTraitDisabled: false,
    state: InfantryAnimationState.Idle,
  }

  const actor = {
    trait(name: string): unknown {
      if (name === 'RenderSprites') return renderSprites
      return body
    },
  } as unknown as IGameActor

  return { actor, renderSprites: { ...renderSprites, remove: removeSpy }, body, splitAnim }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithSplitAttackPaletteInfantryBodyInfo', () => {
  it('should have default values', () => {
    const info = new WithSplitAttackPaletteInfantryBodyInfo()
    expect(info.splitAttackPalette).toBeNull()
    expect(info.splitAttackSuffix).toBe('muzzle')
    expect(info.enabledByDefault).toBe(true)
  })

  it('should accept custom values', () => {
    const info = new WithSplitAttackPaletteInfantryBodyInfo({
      splitAttackPalette: 'player',
      splitAttackSuffix: 'fire',
    })
    expect(info.splitAttackPalette).toBe('player')
    expect(info.splitAttackSuffix).toBe('fire')
  })
})

describe('WithSplitAttackPaletteInfantryBody', () => {
  it('should register split animation with RenderSprites on construction', () => {
    const { actor, renderSprites } = makeActors()
    const info = new WithSplitAttackPaletteInfantryBodyInfo({
      splitAttackPalette: 'muzzle',
    })
    new WithSplitAttackPaletteInfantryBody(actor, info)
    expect(renderSprites.add).toHaveBeenCalled()
  })

  it('should start with visible = false', () => {
    const { actor } = makeActors()
    const info = new WithSplitAttackPaletteInfantryBodyInfo()
    const trait = new WithSplitAttackPaletteInfantryBody(actor, info)
    expect(trait.visible).toBe(false)
  })

  it('should set visible true when Attacking in Attacking state', () => {
    const { actor, body } = makeActors()
    ;(body as any).state = InfantryAnimationState.Attacking
    const info = new WithSplitAttackPaletteInfantryBodyInfo({
      splitAttackSuffix: 'muzzle',
    })
    const trait = new WithSplitAttackPaletteInfantryBody(actor, info)
    // Override _body to actually be the mock body
    ;(trait as any)._body = body

    const armament: IArmamentAccess = { info: { name: 'primary' } }
    const barrel: IBarrelAccess = {}
    trait.attacking(actor, armament, barrel)

    expect(trait.visible).toBe(true) // visible was set to true by attacking()
  })

  it('should not show when state is Idle', () => {
    const { actor, body } = makeActors()
    ;(body as any).state = InfantryAnimationState.Idle
    const info = new WithSplitAttackPaletteInfantryBodyInfo()
    const trait = new WithSplitAttackPaletteInfantryBody(actor, info)
    ;(trait as any)._body = body

    trait.attacking(actor, { info: { name: 'primary' } }, {})
    expect(trait.visible).toBe(false)
  })

  it('should allow setting visibility directly', () => {
    const { actor } = makeActors()
    const info = new WithSplitAttackPaletteInfantryBodyInfo()
    const trait = new WithSplitAttackPaletteInfantryBody(actor, info)

    trait.setVisible(true)
    expect(trait.visible).toBe(true)

    trait.setVisible(false)
    expect(trait.visible).toBe(false)
  })

  it('should dispose cleanly and remove from RenderSprites', () => {
    const { actor, renderSprites } = makeActors()
    const info = new WithSplitAttackPaletteInfantryBodyInfo()
    const trait = new WithSplitAttackPaletteInfantryBody(actor, info)

    trait.dispose()
    expect(renderSprites.remove).toHaveBeenCalledTimes(1)
  })

  it('should create via factory method', () => {
    const { actor } = makeActors()
    const info = new WithSplitAttackPaletteInfantryBodyInfo()
    const trait = info.create(actor)
    expect(trait).toBeInstanceOf(WithSplitAttackPaletteInfantryBody)
  })
})
