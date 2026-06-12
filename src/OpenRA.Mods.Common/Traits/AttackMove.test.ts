/**
 * AttackMove.test.ts -- Unit tests for AttackMove
 */

import { describe, it, expect } from 'vitest'
import { AttackMove, AttackMoveInfo } from './AttackMove.js'

describe('AttackMove', () => {
  describe('AttackMoveInfo', () => {
    it('has default voice "Action"', () => {
      const info = new AttackMoveInfo()
      expect(info.voice).toBe('Action')
    })

    it('has default moveIntoShroud true', () => {
      const info = new AttackMoveInfo()
      expect(info.moveIntoShroud).toBe(true)
    })

    it('has default targetLineColor "OrangeRed"', () => {
      const info = new AttackMoveInfo()
      expect(info.targetLineColor).toBe('OrangeRed')
    })

    it('accepts custom values', () => {
      const info = new AttackMoveInfo({
        voice: 'Move',
        moveIntoShroud: false,
        attackMoveCondition: 'AttackMoving',
      })
      expect(info.voice).toBe('Move')
      expect(info.moveIntoShroud).toBe(false)
      expect(info.attackMoveCondition).toBe('AttackMoving')
    })
  })

  describe('AttackMove trait', () => {
    it('voicePhraseForOrder returns voice for AttackMove order', () => {
      const info = new AttackMoveInfo({ voice: 'Attack' })
      const am = new AttackMove(info)
      const result = am.voicePhraseForOrder({} as never, {
        orderName: 'AttackMove',
        targetString: 'test',
      } as never)
      expect(result).toBe('Attack')
    })

    it('voicePhraseForOrder returns voice for AssaultMove order', () => {
      const info = new AttackMoveInfo({ voice: 'Assault' })
      const am = new AttackMove(info)
      const result = am.voicePhraseForOrder({} as never, {
        orderName: 'AssaultMove',
        targetString: 'test',
      } as never)
      expect(result).toBe('Assault')
    })

    it('voicePhraseForOrder returns empty for unknown order', () => {
      const info = new AttackMoveInfo({ voice: 'Attack' })
      const am = new AttackMove(info)
      const result = am.voicePhraseForOrder({} as never, {
        orderName: 'Move',
        targetString: 'test',
      } as never)
      expect(result).toBe('')
    })

    it('resolveOrder handles AttackMove order', () => {
      const info = new AttackMoveInfo()
      const am = new AttackMove(info)
      expect(() =>
        am.resolveOrder({} as never, {
          orderName: 'AttackMove',
          targetString: 'test',
        } as never),
      ).not.toThrow()
    })

    it('resolveOrder handles AssaultMove order', () => {
      const info = new AttackMoveInfo()
      const am = new AttackMove(info)
      expect(() =>
        am.resolveOrder({} as never, {
          orderName: 'AssaultMove',
          targetString: 'test',
        } as never),
      ).not.toThrow()
    })
  })
})
