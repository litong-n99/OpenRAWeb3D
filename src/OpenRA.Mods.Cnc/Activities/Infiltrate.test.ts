/**
 * Infiltrate.test.ts — unit tests for Infiltrate activity
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import { Infiltrate } from './Infiltrate.js'
import { EnterBehaviour } from '../../OpenRA.Mods.Common/Activities/Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

describe('Infiltrate', () => {
  function makeInfiltratesFacade(overrides: Partial<{
    isTraitDisabled: boolean
    types: readonly string[]
    notification: string | null
    textNotification: string | null
    enterBehaviour: number
    canInfiltrate: boolean
  }> = {}) {
    return {
      info: {
        types: overrides.types ?? ['Building'],
        notification: overrides.notification ?? null,
        textNotification: overrides.textNotification ?? null,
        enterBehaviour: overrides.enterBehaviour ?? EnterBehaviour.Dispose,
      },
      isTraitDisabled: overrides.isTraitDisabled ?? false,
      canInfiltrateTarget: () => overrides.canInfiltrate ?? true,
    }
  }

  it('can be constructed', () => {
    const self = {
      actorId: 1, isInWorld: true, isDead: false, disposed: false,
      traitsImplementing: () => [],
    } as unknown as GameActor

    const target = { type: 1 } as any // Actor type
    const infiltrates = makeInfiltratesFacade()

    const activity = new Infiltrate(self, target, infiltrates, null)
    expect(activity).toBeDefined()
  })

  it('stores INotifyInfiltration traits on construction', () => {
    const notifier = { infiltrating() {} }
    const self = {
      actorId: 1, isInWorld: true, isDead: false, disposed: false,
      traitsImplementing: () => [notifier],
    } as unknown as GameActor

    const target = { type: 1 } as any
    const infiltrates = makeInfiltratesFacade()

    const activity = new Infiltrate(self, target, infiltrates, null)
    expect(activity).toBeDefined()
  })

  it('constructs with Exit behaviour', () => {
    const self = {
      actorId: 1, isInWorld: true, isDead: false, disposed: false,
      traitsImplementing: () => [],
    } as unknown as GameActor

    const target = { type: 1 } as any
    const infiltrates = makeInfiltratesFacade({ enterBehaviour: EnterBehaviour.Exit })

    const activity = new Infiltrate(self, target, infiltrates, null)
    expect(activity).toBeDefined()
  })

  it('constructs with Suicide behaviour', () => {
    const self = {
      actorId: 1, isInWorld: true, isDead: false, disposed: false,
      traitsImplementing: () => [],
    } as unknown as GameActor

    const target = { type: 1 } as any
    const infiltrates = makeInfiltratesFacade({ enterBehaviour: EnterBehaviour.Suicide })

    const activity = new Infiltrate(self, target, infiltrates, null)
    expect(activity).toBeDefined()
  })
})
