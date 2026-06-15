/**
 * ShroudExts.ts — Shroud extension methods (visibility query helpers)
 * OpenRA 对照: OpenRA.Mods.Common/ShroudExts.cs
 *
 * 核心范式转换:
 * - C# static extension methods (this Shroud) → standalone TypeScript functions
 *   with function overloading
 * - C# (CPos Cell, SubCell SubCell)[] named tuple → OccupiedCell[] interface
 * - C# method overload resolution at compile time → TS overload signatures +
 *   runtime property check ('cell' in item)
 * - PERF: manual for-of loops matching C# foreach, avoiding LINQ / Array.some()
 *   (same reason: no closure allocation in hot path)
 *
 * 使用者:
 * - FrozenUnderFog.ts (TODO-12.A.10) — uses anyExplored(cells) to decide freeze
 * - HiddenUnderFog.ts (TODO-12.A.12) — uses anyExplored(cells) for visibility
 * - HiddenUnderShroud.ts (TODO-12.A.11) — uses anyVisible(cells) for visibility
 */

import { Shroud } from '../OpenRA.Game/Traits/Player/Shroud.js'
import { PPos } from '../OpenRA.Game/MPos.js'
import type { OccupiedCell } from '../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// anyExplored — OccupiedCell[] overload
// ---------------------------------------------------------------------------

/**
 * Check if any cell in the array has been explored (was ever visible).
 *
 * OpenRA 对照: ShroudExts.AnyExplored(this Shroud, (CPos Cell, SubCell SubCell)[])
 *
 * @param shroud — the player's shroud to query
 * @param cells — array of occupied cells to check
 * @returns true if any cell is explored, false otherwise
 */
export function anyExplored(shroud: Shroud, cells: readonly OccupiedCell[]): boolean

// ---------------------------------------------------------------------------
// anyExplored — PPos[] overload
// ---------------------------------------------------------------------------

/**
 * Check if any projected cell in the array has been explored.
 *
 * OpenRA 对照: ShroudExts.AnyExplored(this Shroud, PPos[])
 *
 * @param shroud — the player's shroud to query
 * @param puvs — array of projected positions to check
 * @returns true if any projected cell is explored, false otherwise
 */
export function anyExplored(shroud: Shroud, puvs: readonly PPos[]): boolean

export function anyExplored(
  shroud: Shroud,
  arg: readonly OccupiedCell[] | readonly PPos[],
): boolean {
  // PERF: Avoid LINQ.
  // Distinguish between OccupiedCell[] and PPos[] by checking the first
  // element's shape. PPos has U/V, OccupiedCell has cell/subCell.
  if (arg.length > 0 && 'cell' in (arg[0] as unknown as object)) {
    // OccupiedCell[] path (对应 C# (CPos Cell, SubCell SubCell)[] overload)
    const cells = arg as readonly OccupiedCell[]
    for (const cell of cells) {
      if (shroud.isExplored(cell.cell)) {
        return true
      }
    }
  } else {
    // PPos[] path (对应 C# PPos[] overload)
    const puvs = arg as readonly PPos[]
    for (const puv of puvs) {
      if (shroud.isExplored(puv)) {
        return true
      }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// anyVisible — OccupiedCell[] only
// ---------------------------------------------------------------------------

/**
 * Check if any cell in the array is currently visible.
 *
 * OpenRA 对照: ShroudExts.AnyVisible(this Shroud, (CPos Cell, SubCell SubCell)[])
 *
 * @param shroud — the player's shroud to query
 * @param cells — array of occupied cells to check
 * @returns true if any cell is visible, false otherwise
 */
export function anyVisible(shroud: Shroud, cells: readonly OccupiedCell[]): boolean {
  // PERF: Avoid LINQ.
  for (const cell of cells) {
    if (shroud.isVisible(cell.cell)) {
      return true
    }
  }
  return false
}
