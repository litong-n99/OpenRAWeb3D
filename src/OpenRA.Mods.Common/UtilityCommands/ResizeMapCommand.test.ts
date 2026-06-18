/**
 * ResizeMapCommand.test.ts — ResizeMapCommand 迁移单元测试
 *
 * 测试焦点: 参数解析、尺寸验证、边界过滤逻辑
 */

import { describe, it, expect } from 'vitest'
import {
  ResizeMapCommand,
  isCellInBounds,
  filterActorsInBounds,
} from './ResizeMapCommand'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResizeMapCommand', () => {
  function createCommand(): ResizeMapCommand {
    return new ResizeMapCommand()
  }

  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  it('has correct command name', () => {
    const cmd = createCommand()
    expect(cmd.name).toBe('--resize-map')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects too few args (<4)', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--resize-map'])).toBe(false)
      expect(cmd.validateArguments(['--resize-map', 'path'])).toBe(false)
      expect(cmd.validateArguments(['--resize-map', 'path', '128'])).toBe(false)
    })

    it('accepts valid args with numeric width and height', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--resize-map', 'map.oramap', '128', '128'])).toBe(true)
    })

    it('rejects non-numeric width', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--resize-map', 'map.oramap', 'abc', '128'])).toBe(false)
    })

    it('rejects non-numeric height', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--resize-map', 'map.oramap', '128', 'abc'])).toBe(false)
    })

    it('rejects zero width', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--resize-map', 'map.oramap', '0', '128'])).toBe(false)
    })

    it('rejects negative height', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--resize-map', 'map.oramap', '128', '-5'])).toBe(false)
    })

    it('rejects negative width', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--resize-map', 'map.oramap', '-64', '128'])).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = createCommand()
      // Set up valid args
      cmd.validateArguments(['--resize-map', 'test.oramap', '128', '128'])
      // We need a utility mock — but for this test, we just test that
      // no unhandled errors occur
      const mockUtility = {
        modData: {
          modFiles: {},
          mapCache: {},
        },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--resize-map', 'test.oramap', '128', '128'])
      }).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// isCellInBounds
// ---------------------------------------------------------------------------

describe('isCellInBounds', () => {
  it('returns true for cell at origin', () => {
    expect(isCellInBounds(0, 0, 64, 64)).toBe(true)
  })

  it('returns true for cell at max boundary', () => {
    expect(isCellInBounds(63, 63, 64, 64)).toBe(true)
  })

  it('returns false for x out of bounds', () => {
    expect(isCellInBounds(64, 0, 64, 64)).toBe(false)
  })

  it('returns false for y out of bounds', () => {
    expect(isCellInBounds(0, 64, 64, 64)).toBe(false)
  })

  it('returns false for negative x', () => {
    expect(isCellInBounds(-1, 0, 64, 64)).toBe(false)
  })

  it('returns false for negative y', () => {
    expect(isCellInBounds(0, -1, 64, 64)).toBe(false)
  })

  it('handles rectangular maps correctly', () => {
    expect(isCellInBounds(127, 63, 128, 64)).toBe(true)
    expect(isCellInBounds(128, 63, 128, 64)).toBe(false)
    expect(isCellInBounds(127, 64, 128, 64)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// filterActorsInBounds
// ---------------------------------------------------------------------------

describe('filterActorsInBounds', () => {
  it('keeps all actors when all are in bounds', () => {
    const actors = [
      { type: 'e1', location: { x: 0, y: 0 } },
      { type: 'e2', location: { x: 63, y: 63 } },
    ]
    const result = filterActorsInBounds(actors, 64, 64)
    expect(result).toHaveLength(2)
  })

  it('removes actors outside new bounds', () => {
    const actors = [
      { type: 'e1', location: { x: 50, y: 50 } },
      { type: 'e2', location: { x: 100, y: 50 } },
      { type: 'e3', location: { x: 50, y: 100 } },
    ]
    // Resize to 64x64, removing actors at (100,50) and (50,100)
    const result = filterActorsInBounds(actors, 64, 64)
    expect(result).toHaveLength(1)
    expect(result[0]!.type).toBe('e1')
  })

  it('keeps actors without location (always valid)', () => {
    const actors = [
      { type: 'e1', location: { x: 0, y: 0 } },
      { type: 'waypoint' }, // no location — should stay
      { type: 'e2', location: { x: 99, y: 99 } },
    ]
    const result = filterActorsInBounds(actors, 64, 64)
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.type)).toEqual(['e1', 'waypoint'])
  })

  it('handles empty input', () => {
    const result = filterActorsInBounds([], 64, 64)
    expect(result).toHaveLength(0)
  })

  it('handles resize to larger map (keeps all)', () => {
    const actors = [
      { type: 'e1', location: { x: 30, y: 30 } },
      { type: 'e2', location: { x: 60, y: 60 } },
    ]
    // Resize from 64x64 to 128x128
    const result = filterActorsInBounds(actors, 128, 128)
    expect(result).toHaveLength(2)
  })
})
