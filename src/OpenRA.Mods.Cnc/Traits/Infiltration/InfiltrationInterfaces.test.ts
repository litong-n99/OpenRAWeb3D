/**
 * InfiltrationInterfaces.test.ts — unit tests for infiltration interfaces and type guards
 */

import { describe, it, expect } from 'vitest'
import {
  type INotifyInfiltrated,
  isINotifyInfiltrated,
  type INotifyInfiltration,
  isINotifyInfiltration,
} from './InfiltrationInterfaces.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Minimal actor stub for testing
// ---------------------------------------------------------------------------

function makeActor(): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
  }
}

describe('InfiltrationInterfaces', () => {
  describe('INotifyInfiltrated', () => {
    it('type guard returns true for valid implementation', () => {
      const trait: INotifyInfiltrated = {
        infiltrated(
          _self: IGameActor,
          _infiltrator: IGameActor,
          _types: readonly string[],
        ): void {
          // no-op
        },
      }
      expect(isINotifyInfiltrated(trait)).toBe(true)
    })

    it('type guard returns false for null', () => {
      expect(isINotifyInfiltrated(null)).toBe(false)
    })

    it('type guard returns false for object without infiltrated method', () => {
      expect(isINotifyInfiltrated({ notInfiltrated: true })).toBe(false)
    })

    it('type guard returns false for object with infiltrated as non-function', () => {
      expect(isINotifyInfiltrated({ infiltrated: 'not a function' })).toBe(false)
    })

    it('calls infiltrated with correct arguments', () => {
      const self = makeActor()
      const infiltrator = makeActor()
      const types: readonly string[] = ['Building', 'Defense']
      let capturedSelf: IGameActor | null = null
      let capturedInfiltrator: IGameActor | null = null
      let capturedTypes: readonly string[] | null = null

      const trait: INotifyInfiltrated = {
        infiltrated(s, i, t) {
          capturedSelf = s
          capturedInfiltrator = i
          capturedTypes = t
        },
      }

      trait.infiltrated(self, infiltrator, types)
      expect(capturedSelf).toBe(self)
      expect(capturedInfiltrator).toBe(infiltrator)
      expect(capturedTypes).toBe(types)
    })
  })

  describe('INotifyInfiltration', () => {
    it('type guard returns true for valid implementation', () => {
      const trait: INotifyInfiltration = {
        infiltrating(_self: IGameActor): void {
          // no-op
        },
      }
      expect(isINotifyInfiltration(trait)).toBe(true)
    })

    it('type guard returns false for null', () => {
      expect(isINotifyInfiltration(null)).toBe(false)
    })

    it('type guard returns false for object without infiltrating method', () => {
      expect(isINotifyInfiltration({ infiltrating: 123 })).toBe(false)
    })

    it('calls infiltrating with correct argument', () => {
      const self = makeActor()
      let capturedSelf: IGameActor | null = null

      const trait: INotifyInfiltration = {
        infiltrating(s) {
          capturedSelf = s
        },
      }

      trait.infiltrating(self)
      expect(capturedSelf).toBe(self)
    })
  })
})
