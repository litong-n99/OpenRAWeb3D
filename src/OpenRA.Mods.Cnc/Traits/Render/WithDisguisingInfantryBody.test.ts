/**
 * WithDisguisingInfantryBody.test.ts — Unit tests
 *
 * Tests focus on: disguise state change detection, animation/image swapping.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithDisguisingInfantryBody,
  WithDisguisingInfantryBodyInfo,
  type IDisguiseAccess,
  type IDisguiseInfantryBody,
  type IDisguiseRenderSprites,
  type IDisguiseAnimation,
} from './WithDisguisingInfantryBody.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeAnimation(): IDisguiseAnimation & { changeImageCalls: string[][] } {
  const changeImageCalls: string[][] = []
  return {
    name: 'infantry',
    currentSequence: { name: 'stand' },
    getRandomExistingSequence: vi.fn().mockReturnValue('stand'),
    changeImage(image: string, sequence: string) {
      changeImageCalls.push([image, sequence])
    },
    playFetchIndex: vi.fn(),
    changeImageCalls,
  }
}

function makeRenderSprites(): IDisguiseRenderSprites & { getImageCalls: number; updatePaletteCalls: number } {
  let getImageCalls = 0
  let updatePaletteCalls = 0
  return {
    getImage: vi.fn().mockImplementation(() => { getImageCalls++; return 'infantry-image' }),
    updatePalette: vi.fn().mockImplementation(() => { updatePaletteCalls++ }),
    getImageCalls,
    updatePaletteCalls,
  }
}

function makeBody(anim: IDisguiseAnimation, renderSprites: IDisguiseRenderSprites): IDisguiseInfantryBody {
  return {
    info: { name: 'body', standSequences: ['stand'] },
    defaultAnimation: anim,
    renderSprites,
    playStandAnimation: vi.fn(),
    tick: vi.fn(),
    getDisplayInfo() {
      return { name: '', enabledByDefault: true, standSequences: ['stand'] }
    },
  }
}

function makeDisguise(
  asActor: unknown = null,
  asPlayer: { faction?: { internalName: string } } | null = null,
): IDisguiseAccess {
  return {
    asActor: asActor as IDisguiseAccess['asActor'],
    asPlayer: asPlayer as IDisguiseAccess['asPlayer'],
  }
}

function makeActor(
  rs: IDisguiseRenderSprites,
  disguise: IDisguiseAccess,
): IGameActor {
  return {
    trait(name: string): unknown {
      if (name === 'RenderSprites') return rs
      if (name === 'Disguise') return disguise
      return null
    },
  } as unknown as IGameActor
}

describe('WithDisguisingInfantryBodyInfo', () => {
  it('should have default values', () => {
    const info = new WithDisguisingInfantryBodyInfo()
    expect(info.standSequences).toEqual(['stand'])
    expect(info.enabledByDefault).toBe(true)
  })
})

describe('WithDisguisingInfantryBody', () => {
  it('should get display info from base when not disguised', () => {
    const anim = makeAnimation()
    const rs = makeRenderSprites()
    const mockBody = makeBody(anim, rs)
    const disguise = makeDisguise()
    const actor = makeActor(rs, disguise)
    const info = new WithDisguisingInfantryBodyInfo()
    const trait = new WithDisguisingInfantryBody(actor, info)
    ;(trait as any)._body = mockBody

    const displayInfo = trait.getDisplayInfo()
    expect(displayInfo.enabledByDefault).toBe(true)
  })

  it('should return null disguiseImage when not disguised', () => {
    const anim = makeAnimation()
    const rs = makeRenderSprites()
    const mockBodyImg = makeBody(anim, rs)
    const disguise = makeDisguise()
    const actor = makeActor(rs, disguise)
    const info = new WithDisguisingInfantryBodyInfo()
    const trait = new WithDisguisingInfantryBody(actor, info)
    ;(trait as any)._body = mockBodyImg

    expect(trait.disguiseImage).toBeNull()
  })

  it('should return null disguiseInfantryBody when not disguised', () => {
    const anim = makeAnimation()
    const rs = makeRenderSprites()
    const mockBody2 = makeBody(anim, rs)
    const disguise = makeDisguise()
    const actor = makeActor(rs, disguise)
    const info = new WithDisguisingInfantryBodyInfo()
    const trait = new WithDisguisingInfantryBody(actor, info)
    ;(trait as any)._body = mockBody2

    expect(trait.disguiseInfantryBody).toBeNull()
  })

  it('should detect disguise change and update animation', () => {
    const anim = makeAnimation()
    const rs = makeRenderSprites()
    const body = makeBody(anim, rs)
    const disguise = makeDisguise(
      { traitInfoOrDefault: () => null },
      { faction: { internalName: 'allies' } },
    )
    const actor = makeActor(rs, disguise)
    const info = new WithDisguisingInfantryBodyInfo()
    const trait = new WithDisguisingInfantryBody(actor, info)
    ;(trait as any)._body = body

    // Trigger tick which should detect disguise change
    trait.tick(actor)
    expect(anim.changeImageCalls.length).toBeGreaterThan(0)
    expect(anim.changeImageCalls[0]![1]).toBe('stand')
  })

  it('should play stand animation when disguise changes', () => {
    const anim = makeAnimation()
    const rs = makeRenderSprites()
    const mockBodyStand = makeBody(anim, rs)
    const disguise = makeDisguise(
      { traitInfoOrDefault: () => null },
      { faction: { internalName: 'allies' } },
    )
    const actor = makeActor(rs, disguise)
    const info = new WithDisguisingInfantryBodyInfo()
    const trait = new WithDisguisingInfantryBody(actor, info)
    ;(trait as any)._body = mockBodyStand
    ;(trait as any)._disguise = disguise
    ;(trait as any)._prevDisguiseActor = null
    ;(trait as any)._prevDisguisePlayer = null

    trait.tick(actor)
    // Stand animation is called when disguise changes (asActor != _prevDisguiseActor)
    expect(mockBodyStand.playStandAnimation).toHaveBeenCalled()
  })

  it('should dispose cleanly', () => {
    const anim = makeAnimation()
    const rs = makeRenderSprites()
    const mockDisposeBody = makeBody(anim, rs)
    const disguise = makeDisguise()
    const actor = makeActor(rs, disguise)
    const info = new WithDisguisingInfantryBodyInfo()
    const trait = new WithDisguisingInfantryBody(actor, info)
    void mockDisposeBody
    expect(() => trait.dispose()).not.toThrow()
  })
})
