/**
 * Direction.test.ts — Direction enum and utility functions migration unit tests
 *
 * Since Direction is pure math/logic (no Babylon.js dependency), no mocks
 * are needed. Tests focus on: const object values, directionFromOffset
 * sign-based classification, oppositeDirection 180-degree flip,
 * directionToInt2 roundtrip, closestDirectionFromOffset angle-based
 * classification, DirectionMask bit operations, and edge cases.
 */

import { describe, it, expect } from 'vitest'

import {
  Direction,
  DirectionMask,
  ALL_DIRECTIONS,
  Spread4D,
  Spread4,
  Spread4CVec,
  Spread8D,
  Spread8,
  Spread8CVec,
  EuclideanSpread8D,
  directionToInt2,
  directionToCVec,
  directionFromOffset,
  directionFromCVec,
  closestDirectionFromOffset,
  closestDirectionFromCVec,
  closestInMaskFromOffset,
  closestInMaskFromCVec,
  directionFromNonDiagonal,
  directionFromCVecNonDiagonal,
  oppositeDirection,
  directionToMask,
  directionMaskCount,
  directionFromMask,
  directionIsDiagonal,
} from './Direction.js'
import { CVec } from '../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// Direction values
// ---------------------------------------------------------------------------

describe('Direction', () => {
  it('None = -1', () => {
    expect(Direction.None).toBe(-1)
  })

  it('has 8 valid directions with values 0-7', () => {
    expect(Direction.R).toBe(0)
    expect(Direction.RD).toBe(1)
    expect(Direction.D).toBe(2)
    expect(Direction.LD).toBe(3)
    expect(Direction.L).toBe(4)
    expect(Direction.LU).toBe(5)
    expect(Direction.U).toBe(6)
    expect(Direction.RU).toBe(7)
  })

  it('ALL_DIRECTIONS has 8 items in clockwise order', () => {
    expect(ALL_DIRECTIONS).toHaveLength(8)
    expect(ALL_DIRECTIONS[0]).toBe(Direction.R)
    expect(ALL_DIRECTIONS[1]).toBe(Direction.RD)
    expect(ALL_DIRECTIONS[2]).toBe(Direction.D)
    expect(ALL_DIRECTIONS[3]).toBe(Direction.LD)
    expect(ALL_DIRECTIONS[4]).toBe(Direction.L)
    expect(ALL_DIRECTIONS[5]).toBe(Direction.LU)
    expect(ALL_DIRECTIONS[6]).toBe(Direction.U)
    expect(ALL_DIRECTIONS[7]).toBe(Direction.RU)
  })
})

// ---------------------------------------------------------------------------
// directionFromOffset — sign-based classification
// ---------------------------------------------------------------------------

describe('directionFromOffset', () => {
  it('(1, 0) → R', () => {
    expect(directionFromOffset(1, 0)).toBe(Direction.R)
  })

  it('(1, 1) → RD', () => {
    expect(directionFromOffset(1, 1)).toBe(Direction.RD)
  })

  it('(0, 1) → D', () => {
    expect(directionFromOffset(0, 1)).toBe(Direction.D)
  })

  it('(-1, 1) → LD', () => {
    expect(directionFromOffset(-1, 1)).toBe(Direction.LD)
  })

  it('(-1, 0) → L', () => {
    expect(directionFromOffset(-1, 0)).toBe(Direction.L)
  })

  it('(-1, -1) → LU', () => {
    expect(directionFromOffset(-1, -1)).toBe(Direction.LU)
  })

  it('(0, -1) → U', () => {
    expect(directionFromOffset(0, -1)).toBe(Direction.U)
  })

  it('(1, -1) → RU', () => {
    expect(directionFromOffset(1, -1)).toBe(Direction.RU)
  })

  it('(5, 2) → RD (large positive both)', () => {
    expect(directionFromOffset(5, 2)).toBe(Direction.RD)
  })

  it('(-3, 0) → L (pure negative X)', () => {
    expect(directionFromOffset(-3, 0)).toBe(Direction.L)
  })

  it('throws on zero offset', () => {
    expect(() => directionFromOffset(0, 0)).toThrow('Bad direction')
  })

  it('directionFromCVec delegates to directionFromOffset', () => {
    expect(directionFromCVec(new CVec(1, 0))).toBe(Direction.R)
    expect(directionFromCVec(new CVec(-1, 1))).toBe(Direction.LD)
    expect(directionFromCVec(new CVec(0, -1))).toBe(Direction.U)
  })

  it('directionFromCVec throws on zero CVec', () => {
    expect(() => directionFromCVec(CVec.Zero)).toThrow('Bad direction')
  })
})

// ---------------------------------------------------------------------------
// oppositeDirection — 180-degree flip
// ---------------------------------------------------------------------------

describe('oppositeDirection', () => {
  it('R ↔ L', () => {
    expect(oppositeDirection(Direction.R)).toBe(Direction.L)
    expect(oppositeDirection(Direction.L)).toBe(Direction.R)
  })

  it('D ↔ U', () => {
    expect(oppositeDirection(Direction.D)).toBe(Direction.U)
    expect(oppositeDirection(Direction.U)).toBe(Direction.D)
  })

  it('RD ↔ LU', () => {
    expect(oppositeDirection(Direction.RD)).toBe(Direction.LU)
    expect(oppositeDirection(Direction.LU)).toBe(Direction.RD)
  })

  it('LD ↔ RU', () => {
    expect(oppositeDirection(Direction.LD)).toBe(Direction.RU)
    expect(oppositeDirection(Direction.RU)).toBe(Direction.LD)
  })

  it('None → None', () => {
    expect(oppositeDirection(Direction.None)).toBe(Direction.None)
  })

  it('double flip returns original', () => {
    for (const d of ALL_DIRECTIONS) {
      expect(oppositeDirection(oppositeDirection(d))).toBe(d)
    }
  })
})

// ---------------------------------------------------------------------------
// directionToInt2 — direction to offset
// ---------------------------------------------------------------------------

describe('directionToInt2', () => {
  it('R → [1, 0]', () => {
    expect(directionToInt2(Direction.R)).toEqual([1, 0])
  })

  it('D → [0, 1]', () => {
    expect(directionToInt2(Direction.D)).toEqual([0, 1])
  })

  it('L → [-1, 0]', () => {
    expect(directionToInt2(Direction.L)).toEqual([-1, 0])
  })

  it('U → [0, -1]', () => {
    expect(directionToInt2(Direction.U)).toEqual([0, -1])
  })

  it('RD → [1, 1]', () => {
    expect(directionToInt2(Direction.RD)).toEqual([1, 1])
  })

  it('LU → [-1, -1]', () => {
    expect(directionToInt2(Direction.LU)).toEqual([-1, -1])
  })

  it('every direction roundtrips with directionFromOffset (sign-based)', () => {
    for (const d of ALL_DIRECTIONS) {
      const [dx, dy] = directionToInt2(d)
      expect(directionFromOffset(dx, dy)).toBe(d)
    }
  })

  it('throws on None', () => {
    expect(() => directionToInt2(Direction.None)).toThrow('Bad direction')
  })

  it('throws on out-of-range value', () => {
    expect(() => directionToInt2(8 as Direction)).toThrow('Bad direction')
  })
})

// ---------------------------------------------------------------------------
// directionToCVec
// ---------------------------------------------------------------------------

describe('directionToCVec', () => {
  it('R → CVec(1, 0)', () => {
    const v = directionToCVec(Direction.R)
    expect(v.X).toBe(1)
    expect(v.Y).toBe(0)
  })

  it('U → CVec(0, -1)', () => {
    const v = directionToCVec(Direction.U)
    expect(v.X).toBe(0)
    expect(v.Y).toBe(-1)
  })

  it('every direction roundtrips via CVec + directionFromCVec', () => {
    for (const d of ALL_DIRECTIONS) {
      const cvec = directionToCVec(d)
      expect(directionFromCVec(cvec)).toBe(d)
    }
  })

  it('throws on None', () => {
    expect(() => directionToCVec(Direction.None)).toThrow('Bad direction')
  })
})

// ---------------------------------------------------------------------------
// closestDirectionFromOffset — angle-based
// ---------------------------------------------------------------------------

describe('closestDirectionFromOffset', () => {
  it('(10, 0) → R (pure right, angle 0)', () => {
    expect(closestDirectionFromOffset(10, 0)).toBe(Direction.R)
  })

  it('(0, 10) → D (pure down, angle 90)', () => {
    expect(closestDirectionFromOffset(0, 10)).toBe(Direction.D)
  })

  it('(0, -10) → U (pure up, angle -90)', () => {
    expect(closestDirectionFromOffset(0, -10)).toBe(Direction.U)
  })

  it('(10, 10) → RD (45-degree diagonal)', () => {
    expect(closestDirectionFromOffset(10, 10)).toBe(Direction.RD)
  })

  it('(10, 3) → R (shallow angle, tan ~ 0.3 < tan(22.5))', () => {
    // 3/10 ≈ 0.3, tan(22.5°) ≈ 408/985 ≈ 0.414
    // Since 3/10 < 408/985, this should resolve to cardinal R
    expect(closestDirectionFromOffset(10, 3)).toBe(Direction.R)
  })

  it('(10, 5) → RD (steeper angle, tan ~ 0.5 > tan(22.5))', () => {
    // 5/10 = 0.5, tan(22.5°) ≈ 408/985 ≈ 0.414
    // Since 0.5 > 0.414, this should resolve to diagonal RD
    expect(closestDirectionFromOffset(10, 5)).toBe(Direction.RD)
  })

  it('(-10, 5) → LD', () => {
    expect(closestDirectionFromOffset(-10, 5)).toBe(Direction.LD)
  })

  it('throws on zero offset', () => {
    expect(() => closestDirectionFromOffset(0, 0)).toThrow('Bad direction')
  })

  it('closestDirectionFromCVec delegates correctly', () => {
    expect(closestDirectionFromCVec(new CVec(3, 10))).toBe(Direction.D)
    expect(closestDirectionFromCVec(new CVec(-3, -10))).toBe(Direction.U)
  })
})

// ---------------------------------------------------------------------------
// Spread arrays correctness
// ---------------------------------------------------------------------------

describe('Spread arrays', () => {
  it('Spread4D has 4 cardinal entries with directions', () => {
    expect(Spread4D).toHaveLength(4)
    expect(Spread4D[0]).toEqual([1, 0, Direction.R])
    expect(Spread4D[1]).toEqual([0, 1, Direction.D])
    expect(Spread4D[2]).toEqual([-1, 0, Direction.L])
    expect(Spread4D[3]).toEqual([0, -1, Direction.U])
  })

  it('Spread4 has 4 cardinal offsets without directions', () => {
    expect(Spread4).toHaveLength(4)
    expect(Spread4[0]).toEqual([1, 0])
    expect(Spread4[3]).toEqual([0, -1])
  })

  it('Spread4CVec has 4 CVec objects', () => {
    expect(Spread4CVec).toHaveLength(4)
    expect(Spread4CVec[0]!.X).toBe(1)
    expect(Spread4CVec[0]!.Y).toBe(0)
  })

  it('Spread8D has 8 entries in clockwise order', () => {
    expect(Spread8D).toHaveLength(8)
    expect(Spread8D[0]).toEqual([1, 0, Direction.R])
    expect(Spread8D[1]).toEqual([1, 1, Direction.RD])
    expect(Spread8D[7]).toEqual([1, -1, Direction.RU])
  })

  it('Spread8 has 8 offset pairs', () => {
    expect(Spread8).toHaveLength(8)
    expect(Spread8[0]).toEqual([1, 0])
  })

  it('Spread8CVec has 8 CVec objects', () => {
    expect(Spread8CVec).toHaveLength(8)
    expect(Spread8CVec[0]!.X).toBe(1)
    expect(Spread8CVec[0]!.Y).toBe(0)
  })

  it('EuclideanSpread8D has 1024-length vectors', () => {
    expect(EuclideanSpread8D).toHaveLength(8)
    expect(EuclideanSpread8D[0]).toEqual([1024, 0, Direction.R])
    expect(EuclideanSpread8D[2]).toEqual([0, 1024, Direction.D])
    // Diagonal 45°: ≈ 1024 * cos(45°) ≈ 724
    expect(EuclideanSpread8D[1]![0]).toBe(724)
    expect(EuclideanSpread8D[1]![1]).toBe(724)
  })
})

// ---------------------------------------------------------------------------
// DirectionMask operations
// ---------------------------------------------------------------------------

describe('DirectionMask', () => {
  it('None is 0', () => {
    expect(DirectionMask.None).toBe(0)
  })

  it('MR = 1 << R = 1', () => {
    expect(DirectionMask.MR).toBe(1 << Direction.R)
    expect(DirectionMask.MR).toBe(1)
  })

  it('All has all 8 bits set', () => {
    expect(DirectionMask.All).toBe(0xff)
  })

  it('directionToMask produces correct single-bit masks', () => {
    expect(directionToMask(Direction.R)).toBe(1 << 0)
    expect(directionToMask(Direction.D)).toBe(1 << 2)
    expect(directionToMask(Direction.LU)).toBe(1 << 5)
  })

  it('directionToMask returns None for None', () => {
    expect(directionToMask(Direction.None)).toBe(DirectionMask.None)
  })
})

// ---------------------------------------------------------------------------
// directionMaskCount
// ---------------------------------------------------------------------------

describe('directionMaskCount', () => {
  it('None = 0 bits', () => {
    expect(directionMaskCount(DirectionMask.None)).toBe(0)
  })

  it('single bit = 1', () => {
    expect(directionMaskCount(DirectionMask.MR)).toBe(1)
    expect(directionMaskCount(DirectionMask.MU)).toBe(1)
  })

  it('two bits = 2', () => {
    expect(directionMaskCount(DirectionMask.MR | DirectionMask.MD)).toBe(2)
  })

  it('All = 8', () => {
    expect(directionMaskCount(DirectionMask.All)).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// directionFromMask
// ---------------------------------------------------------------------------

describe('directionFromMask', () => {
  it('single-bit mask → correct direction', () => {
    expect(directionFromMask(DirectionMask.MR)).toBe(Direction.R)
    expect(directionFromMask(DirectionMask.MD)).toBe(Direction.D)
    expect(directionFromMask(DirectionMask.MLU)).toBe(Direction.LU)
  })

  it('zero mask → None', () => {
    expect(directionFromMask(DirectionMask.None)).toBe(Direction.None)
  })

  it('multi-bit mask → None', () => {
    expect(
      directionFromMask(DirectionMask.MR | DirectionMask.MD),
    ).toBe(Direction.None)
  })
})

// ---------------------------------------------------------------------------
// directionIsDiagonal
// ---------------------------------------------------------------------------

describe('directionIsDiagonal', () => {
  it('cardinal directions (R, D, L, U) are NOT diagonal', () => {
    expect(directionIsDiagonal(Direction.R)).toBe(false)
    expect(directionIsDiagonal(Direction.D)).toBe(false)
    expect(directionIsDiagonal(Direction.L)).toBe(false)
    expect(directionIsDiagonal(Direction.U)).toBe(false)
  })

  it('diagonal directions (RD, LD, LU, RU) ARE diagonal', () => {
    expect(directionIsDiagonal(Direction.RD)).toBe(true)
    expect(directionIsDiagonal(Direction.LD)).toBe(true)
    expect(directionIsDiagonal(Direction.LU)).toBe(true)
    expect(directionIsDiagonal(Direction.RU)).toBe(true)
  })

  it('throws on None', () => {
    expect(() => directionIsDiagonal(Direction.None)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// closestInMaskFromOffset
// ---------------------------------------------------------------------------

describe('closestInMaskFromOffset', () => {
  const cardinalMask =
    DirectionMask.MR |
    DirectionMask.MD |
    DirectionMask.ML |
    DirectionMask.MU

  it('picks R from cardinal mask for (10, 3)', () => {
    const result = closestInMaskFromOffset(10, 3, cardinalMask)
    expect(result).toBe(Direction.R)
  })

  it('picks D from cardinal mask for (3, 10)', () => {
    const result = closestInMaskFromOffset(3, 10, cardinalMask)
    expect(result).toBe(Direction.D)
  })

  it('picks L from cardinal mask for (-10, 0)', () => {
    const result = closestInMaskFromOffset(-10, 0, cardinalMask)
    expect(result).toBe(Direction.L)
  })

  it('picks U from cardinal mask for (0, -10)', () => {
    const result = closestInMaskFromOffset(0, -10, cardinalMask)
    expect(result).toBe(Direction.U)
  })

  it('throws on zero offset', () => {
    expect(() =>
      closestInMaskFromOffset(0, 0, DirectionMask.All),
    ).toThrow('Bad direction')
  })

  it('throws on empty mask', () => {
    expect(() =>
      closestInMaskFromOffset(10, 10, DirectionMask.None),
    ).toThrow('Empty mask')
  })

  it('closestInMaskFromCVec delegates correctly', () => {
    // (-10, -3): X dominates → closest cardinal is L (West)
    const result = closestInMaskFromCVec(
      new CVec(-10, -3),
      cardinalMask,
    )
    expect(result).toBe(Direction.L)
  })
})

// ---------------------------------------------------------------------------
// Non-diagonal direction
// ---------------------------------------------------------------------------

describe('directionFromNonDiagonal', () => {
  it('(10, 3) → R', () => {
    expect(directionFromNonDiagonal(10, 3)).toBe(Direction.R)
  })

  it('(-3, 10) → D', () => {
    expect(directionFromNonDiagonal(-3, 10)).toBe(Direction.D)
  })

  it('(-10, -3) → L', () => {
    expect(directionFromNonDiagonal(-10, -3)).toBe(Direction.L)
  })

  it('(3, -10) → U', () => {
    expect(directionFromNonDiagonal(3, -10)).toBe(Direction.U)
  })

  it('directionFromCVecNonDiagonal delegates', () => {
    expect(directionFromCVecNonDiagonal(new CVec(10, 1))).toBe(Direction.R)
    expect(directionFromCVecNonDiagonal(new CVec(0, -5))).toBe(Direction.U)
  })
})

// ---------------------------------------------------------------------------
// Roundtrip: sign-based offset ↔ direction for all directions
// ---------------------------------------------------------------------------

describe('direction roundtrip (sign-based)', () => {
  it('all 8 directions survive offset→direction→offset', () => {
    for (const d of ALL_DIRECTIONS) {
      const [dx, dy] = directionToInt2(d)
      const recovered = directionFromOffset(dx, dy)
      expect(recovered).toBe(d)
    }
  })
})
