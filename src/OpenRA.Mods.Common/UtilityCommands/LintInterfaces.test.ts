/**
 * LintInterfaces.test.ts — Lint pass 接口和注册表单元测试
 *
 * 测试焦点:
 * - lintPassRegistry 全局单例的状态管理（注册、清除）
 * - ILintPass, ILintMapPass, ILintRulesPass, ILintSequencesPass 类型检查
 * - emitError / emitWarning 回调签名
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  lintPassRegistry,
  type ILintPass,
  type ILintMapPass,
  type ILintRulesPass,
  type ILintSequencesPass,
  type EmitErrorFn,
  type EmitWarningFn,
} from './LintInterfaces.js'

describe('LintInterfaces', () => {
  beforeEach(() => {
    lintPassRegistry.clear()
  })

  describe('lintPassRegistry singleton', () => {
    it('should start empty', () => {
      expect(lintPassRegistry.passes).toHaveLength(0)
      expect(lintPassRegistry.mapPasses).toHaveLength(0)
      expect(lintPassRegistry.rulesPasses).toHaveLength(0)
      expect(lintPassRegistry.sequencesPasses).toHaveLength(0)
    })

    it('should register ILintPass implementations', () => {
      const errors: string[] = []
      const warnings: string[] = []
      const emitError: EmitErrorFn = (msg) => errors.push(msg)
      const emitWarning: EmitWarningFn = (msg) => warnings.push(msg)

      const pass: ILintPass = {
        run(e, w) {
          e('test error')
          w('test warning')
        },
      }

      lintPassRegistry.register(pass)
      expect(lintPassRegistry.passes).toHaveLength(1)

      lintPassRegistry.passes[0].run(emitError, emitWarning, {} as never)
      expect(errors).toEqual(['test error'])
      expect(warnings).toEqual(['test warning'])
    })

    it('should register ILintMapPass implementations', () => {
      const pass: ILintMapPass = {
        run() {},
      }
      lintPassRegistry.registerMap(pass)
      expect(lintPassRegistry.mapPasses).toHaveLength(1)
      expect(pass).toBe(lintPassRegistry.mapPasses[0])
    })

    it('should register ILintRulesPass implementations', () => {
      const pass: ILintRulesPass = {
        run() {},
      }
      lintPassRegistry.registerRules(pass)
      expect(lintPassRegistry.rulesPasses).toHaveLength(1)
    })

    it('should register ILintSequencesPass implementations', () => {
      const pass: ILintSequencesPass = {
        run() {},
      }
      lintPassRegistry.registerSequences(pass)
      expect(lintPassRegistry.sequencesPasses).toHaveLength(1)
    })

    it('should support multiple registrations per category', () => {
      lintPassRegistry.register({ run() {} })
      lintPassRegistry.register({ run() {} })
      lintPassRegistry.register({ run() {} })

      expect(lintPassRegistry.passes).toHaveLength(3)
    })

    it('should clear all registrations', () => {
      lintPassRegistry.register({ run() {} })
      lintPassRegistry.registerMap({ run() {} })
      lintPassRegistry.registerRules({ run() {} })
      lintPassRegistry.registerSequences({ run() {} })

      lintPassRegistry.clear()

      expect(lintPassRegistry.passes).toHaveLength(0)
      expect(lintPassRegistry.mapPasses).toHaveLength(0)
      expect(lintPassRegistry.rulesPasses).toHaveLength(0)
      expect(lintPassRegistry.sequencesPasses).toHaveLength(0)
    })

    it('should return readonly arrays', () => {
      lintPassRegistry.register({ run() {} })
      // readonly array — no push/pop allowed at type level
      const passes = lintPassRegistry.passes
      expect(Array.isArray(passes)).toBe(true)
    })
  })

  describe('ILintPass type', () => {
    it('should accept run with emit error and warning callbacks', () => {
      const errors: string[] = []
      const warnings: string[] = []

      const myPass: ILintPass = {
        run(emitError, emitWarning, _modData) {
          emitError('E1')
          emitWarning('W1')
          emitError('E2')
        },
      }

      myPass.run(
        (msg) => errors.push(msg),
        (msg) => warnings.push(msg),
        {} as never,
      )

      expect(errors).toEqual(['E1', 'E2'])
      expect(warnings).toEqual(['W1'])
    })
  })

  describe('ILintMapPass type', () => {
    it('should accept run with modData and map parameters', () => {
      let capturedMapId = ''
      const pass: ILintMapPass = {
        run(_e, _w, _modData, map) {
          capturedMapId = map.title
        },
      }
      pass.run(
        () => {},
        () => {},
        {} as never,
        { title: 'Test Map' } as never,
      )
      expect(capturedMapId).toBe('Test Map')
    })
  })

  describe('ILintRulesPass type', () => {
    it('should accept run with rules parameter', () => {
      let captured = false
      const pass: ILintRulesPass = {
        run(_e, _w, _modData, rules) {
          if (rules) captured = true
        },
      }
      pass.run(() => {}, () => {}, {} as never, {} as never)
      expect(captured).toBe(true)
    })
  })

  describe('ILintSequencesPass type', () => {
    it('should accept run with sequences parameter', () => {
      let capturedKeysCount = 0
      const pass: ILintSequencesPass = {
        run(_e, _w, _modData, _rules, sequences) {
          capturedKeysCount = Object.keys(sequences).length
        },
      }
      pass.run(
        () => {},
        () => {},
        {} as never,
        {} as never,
        { seq1: {}, seq2: {} },
      )
      expect(capturedKeysCount).toBe(2)
    })
  })
})
