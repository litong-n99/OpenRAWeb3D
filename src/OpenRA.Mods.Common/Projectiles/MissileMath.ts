/**
 * MissileMath.ts — 导弹轨迹数学函数（纯函数，从 Missile.cs 提取，可独立测试）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/Missile.cs static methods
 *
 * 核心范式转换:
 * - C# 静态/实例方法 in Missile class → TypeScript 独立纯函数模块
 * - C# int 整数运算 → TypeScript number (JS float, 但所有计算保持整数)
 *
 * 所有函数都是纯函数，无副作用，无 Babylon.js 依赖。
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'

// ---------------------------------------------------------------------------
// InaccuracyType — shared enum (exported here for shared utility usage)
// ---------------------------------------------------------------------------

export const InaccuracyType = {
  Maximum: 0,
  PerCellIncrement: 1,
  Absolute: 2,
} as const
export type InaccuracyType = (typeof InaccuracyType)[keyof typeof InaccuracyType]

// ---------------------------------------------------------------------------
// loopRadius
// ---------------------------------------------------------------------------

/** Compute the loop radius for a given speed and rotation rate.
 *
 * OpenRA 对照: Missile.LoopRadius(int speed, int rot)
 *
 * @param speed — current speed in WDist units per tick
 * @param rot — vertical rate of turn in facing units per tick
 * @returns loop radius in WDist units
 */
export function loopRadius(speed: number, rot: number): number {
  if (rot <= 0) return speed * 6400
  return Math.trunc((speed * 6400) / (157 * rot))
}

// ---------------------------------------------------------------------------
// willClimbWithinDistance
// ---------------------------------------------------------------------------

export function willClimbWithinDistance(
  vFacing: number,
  lpRadius: number,
  predClfDist: number,
  diffClfMslHgt: number,
): boolean {
  const missDist = Math.trunc((lpRadius * WAngle.fromFacing(vFacing).sin()) / 1024)
  const missHgt = Math.trunc((lpRadius * (1024 - WAngle.fromFacing(vFacing).cos())) / 1024)
  const hgtChg = Math.trunc(((predClfDist - missDist) * WAngle.fromFacing(vFacing).tan()) / 1024)
  return hgtChg + missHgt >= diffClfMslHgt
}

// ---------------------------------------------------------------------------
// isNearInclineTop
// ---------------------------------------------------------------------------

export function isNearInclineTop(
  vFacing: number,
  lpRadius: number,
  predClfDist: number,
): boolean {
  if (vFacing < 0) return false
  const horizontalRange = Math.trunc((lpRadius * (1024 - WAngle.fromFacing(vFacing).sin())) / 1024)
  return predClfDist <= horizontalRange
}

// ---------------------------------------------------------------------------
// willClimbAroundInclineTop
// ---------------------------------------------------------------------------

export function willClimbAroundInclineTop(
  vFacing: number,
  lpRadius: number,
  predClfDist: number,
  diffClfMslHgt: number,
): boolean {
  const rotAngle = WAngle.fromFacing(Math.max(0, 64 - vFacing))
  const radiusVec = new WVec(lpRadius, 0, 0).rotate(
    new WRot(WAngle.Zero, WAngle.Zero, rotAngle),
  )

  const topX = predClfDist - radiusVec.X
  const topY = diffClfMslHgt + 64 - radiusVec.Y
  const topZ = 0 - radiusVec.Z

  return topX * topX + topY * topY + topZ * topZ <= lpRadius * lpRadius
}

// ---------------------------------------------------------------------------
// bisectionSearch
// ---------------------------------------------------------------------------

export function bisectionSearch(
  lowerBound: number,
  upperBound: number,
  testCriterion: (value: number) => boolean,
): number {
  while (upperBound - lowerBound > 1) {
    const middle = Math.trunc((upperBound + lowerBound) / 2)
    if (testCriterion(middle)) {
      lowerBound = middle
    } else {
      upperBound = middle
    }
  }
  return lowerBound
}

// ---------------------------------------------------------------------------
// increaseAltitude
// ---------------------------------------------------------------------------

export function increaseAltitude(
  vFacing: number,
  lpRadius: number,
  predClfDist: number,
  diffClfMslHgt: number,
  relTarHorDist: number,
  verticalRateOfTurn: number,
  hasAcceleration: boolean,
): number {
  let desiredVFacing = vFacing

  if (vFacing < 0) {
    desiredVFacing = verticalRateOfTurn
  } else if (
    isNearInclineTop(vFacing, lpRadius, predClfDist) &&
    willClimbAroundInclineTop(vFacing, lpRadius, predClfDist, diffClfMslHgt)
  ) {
    desiredVFacing = 0
  } else if (!willClimbWithinDistance(vFacing, lpRadius, predClfDist, diffClfMslHgt)) {
    for (let vFac = Math.min(vFacing + verticalRateOfTurn - 1, 63); vFac >= vFacing; vFac--) {
      if (
        !willClimbWithinDistance(vFac, lpRadius, predClfDist, diffClfMslHgt) &&
        !(
          predClfDist <= Math.trunc((lpRadius * (1024 - WAngle.fromFacing(vFac).sin())) / 1024) &&
          willClimbAroundInclineTop(vFac, lpRadius, predClfDist, diffClfMslHgt)
        )
      ) {
        desiredVFacing = vFac + 1
        break
      }
    }
  }

  if (hasAcceleration) {
    const predAttHght =
      Math.trunc((lpRadius * (1024 - WAngle.fromFacing(vFacing).cos())) / 1024) - diffClfMslHgt
    const slowDown =
      (desiredVFacing !== 0 &&
        (predClfDist <= Math.trunc((lpRadius * (1024 - WAngle.fromFacing(vFacing).sin())) / 1024) ||
          relTarHorDist <=
            2 * Math.trunc((lpRadius * (2048 - WAngle.fromFacing(vFacing).sin())) / 1024) - predClfDist)) ||
      (desiredVFacing === 0 &&
        relTarHorDist <=
          Math.trunc((lpRadius * WAngle.fromFacing(vFacing).sin()) / 1024) +
            isqrt(Math.max(0, predAttHght * (2 * lpRadius - predAttHght))))
    void slowDown
  }

  return desiredVFacing
}

// ---------------------------------------------------------------------------
// isqrt
// ---------------------------------------------------------------------------

function isqrt(n: number): number {
  if (n <= 0) return 0
  let x = n
  let y = Math.trunc((x + 1) / 2)
  while (y < x) {
    x = y
    y = Math.trunc((x + Math.trunc(n / x)) / 2)
  }
  return x
}

// ---------------------------------------------------------------------------
// normaliseFacing
// ---------------------------------------------------------------------------

/**
 * Normalise a facing delta to the range of 0..255.
 *
 * OpenRA 对照: Util.NormalizeFacing(int f)
 */
export function normaliseFacing(facing: number): number {
  if (facing >= 0) return facing & 0xFF
  const negative = (-facing) & 0xFF
  return negative === 0 ? 0 : 256 - negative
}

// ---------------------------------------------------------------------------
// tickFacing
// ---------------------------------------------------------------------------

export function tickFacing(
  facing: number,
  desiredFacing: number,
  rateOfTurn: number,
): number {
  const leftTurn = (facing - desiredFacing) & 0xFF
  const rightTurn = (desiredFacing - facing) & 0xFF
  if (Math.min(leftTurn, rightTurn) < rateOfTurn) {
    return desiredFacing & 0xFF
  }
  if (rightTurn < leftTurn) {
    return (facing + rateOfTurn) & 0xFF
  }
  return (facing - rateOfTurn) & 0xFF
}

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

// ---------------------------------------------------------------------------
// applyPercentageModifiers
// ---------------------------------------------------------------------------

/** Apply sequential percentage modifiers to a base value.
 *
 * OpenRA 对照: Util.ApplyPercentageModifiers(int number, IEnumerable<int> percentages)
 *
 * C# uses decimal arithmetic and truncates ONLY at the end ((int)a).
 * We accumulate in JS float then truncate once, matching C# semantics.
 * Each modifier p applies: result = result * p / 100.
 */
export function applyPercentageModifiers(value: number, modifiers: number[]): number {
  let result = value
  for (const m of modifiers) {
    result = (result * m) / 100
  }
  return Math.trunc(result)
}

// ---------------------------------------------------------------------------
// getVerticalAngle — shared utility (MAJOR 12: extracted from duplicates)
// OpenRA 对照: Util.GetVerticalAngle(WPos from, WPos to)
// ---------------------------------------------------------------------------

/**
 * Compute the vertical angle between two world positions.
 *
 * OpenRA 对照: Util.GetVerticalAngle(WPos from, WPos to)
 *
 * Returns zero if the horizontal displacement is zero.
 *
 * @param from — start position
 * @param to — end position
 * @returns the vertical pitch angle (WAngle)
 */
export function getVerticalAngle(from: WPos, to: WPos): WAngle {
  // OpenRA: return new WVec(-delta.Z, -horizontalDelta, 0).Yaw
  const delta = WPos.subtract(to, from)
  const horizontalDelta = delta.horizontalLength
  if (horizontalDelta === 0) return WAngle.Zero
  const verticalVector = new WVec(-delta.Z, -horizontalDelta, 0)
  return verticalVector.yaw
}

// ---------------------------------------------------------------------------
// getProjectileInaccuracy — shared utility (MAJOR 13: extracted from duplicates)
// OpenRA 对照: Util.GetProjectileInaccuracy()
// ---------------------------------------------------------------------------

/**
 * Compute the inaccuracy offset for a projectile.
 *
 * OpenRA 对照: Util.GetProjectileInaccuracy(int inaccuracy, InaccuracyType, ProjectileArgs)
 *
 * Three modes:
 * - Maximum: scales linearly from 0 to max inaccuracy with range
 * - PerCellIncrement: accumulates per cell of range
 * - Absolute: returns the fixed value regardless of range
 *
 * @param inaccuracy — max inaccuracy distance (length units)
 * @param type — how inaccuracy scales with range
 * @param range — the total range from source to passive target (length units)
 * @param inaccuracySource — the inaccuracy source distance (length units)
 * @returns inaccuracy offset distance in integer units
 */
export function getProjectileInaccuracy(
  inaccuracyLength: number,
  type: InaccuracyType,
  range: number,
  inaccuracySourceLength: number,
): number {
  switch (type) {
    case InaccuracyType.Maximum:
      return Math.min(
        inaccuracyLength,
        Math.trunc(range / Math.max(1, inaccuracySourceLength)),
      )
    case InaccuracyType.PerCellIncrement: {
      const cells = Math.max(0, Math.trunc(range / 1024))
      return cells * inaccuracyLength
    }
    case InaccuracyType.Absolute:
      return inaccuracyLength
    default:
      return 0
  }
}
