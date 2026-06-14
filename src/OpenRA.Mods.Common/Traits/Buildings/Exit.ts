/**
 * Exit.ts — 单位出口定义：定义建筑物生产单位的出口位置
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/Exit.cs (96 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ExitInfo> → TS 类 + isTraitDisabled 标志
 * - C# FrozenSet<string> ProductionTypes → TS ReadonlySet<string>
 * - C# LINQ (OrderBy, FirstOrDefault) → TS 显式排序循环
 * - C# ExitExts 扩展方法 → TS 静态工具类
 * - C# WVec SpawnOffset → TS WVec (坐标原语)
 * - C# CVec ExitCell → TS CVec (坐标原语)
 *
 * Exit 定义了建筑物生产单位的出口位置。多个 Exit 可以存在于同一建筑物上。
 * ExitExts 提供选择最近出口、随机出口等工具方法。
 */

import type { WVec } from '../../../OpenRA.Game/WVec.js'
import type { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { CVec } from '../../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// ExitInfo
// OpenRA 对照: ExitInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for the Exit trait.
 *
 * OpenRA 对照: ExitInfo
 *
 * Defines where units should leave a building when produced.
 */
export class ExitInfo {
  readonly instanceName?: string

  /** Offset at which the exiting actor is spawned relative to the center of the producing actor.
   *
   * OpenRA 对照: ExitInfo.SpawnOffset
   */
  readonly spawnOffset: WVec | null = null

  /** Cell offset where the exiting actor enters the ActorMap relative to the topleft cell of the producing actor.
   *
   * OpenRA 对照: ExitInfo.ExitCell
   */
  readonly exitCell: CVec | null = null

  /** Optional fixed facing for the exiting actor.
   *
   * OpenRA 对照: ExitInfo.Facing
   */
  readonly facing: WAngle | null = null

  /** Type tags on this exit (filters by production type).
   *
   * OpenRA 对照: ExitInfo.ProductionTypes (FrozenSet<string>)
   */
  readonly productionTypes: ReadonlySet<string>

  /** Number of ticks to wait before moving into the world.
   *
   * OpenRA 对照: ExitInfo.ExitDelay
   */
  readonly exitDelay: number = 0

  /** Exits with larger priorities will be used before lower priorities.
   *
   * OpenRA 对照: ExitInfo.Priority
   */
  readonly priority: number = 1

  constructor(params: {
    instanceName?: string
    spawnOffset?: WVec | null
    exitCell?: CVec | null
    facing?: WAngle | null
    productionTypes?: ReadonlySet<string> | readonly string[]
    exitDelay?: number
    priority?: number
  } = {}) {
    this.instanceName = params.instanceName
    if (params.spawnOffset !== undefined) this.spawnOffset = params.spawnOffset
    if (params.exitCell !== undefined) this.exitCell = params.exitCell
    if (params.facing !== undefined) this.facing = params.facing
    if (params.productionTypes instanceof Set) {
      this.productionTypes = params.productionTypes as ReadonlySet<string>
    } else if (Array.isArray(params.productionTypes)) {
      this.productionTypes = new Set(params.productionTypes)
    } else {
      this.productionTypes = new Set()
    }
    if (params.exitDelay !== undefined) this.exitDelay = params.exitDelay
    if (params.priority !== undefined) this.priority = params.priority
  }
}

// ---------------------------------------------------------------------------
// Exit
// OpenRA 对照: Exit class
// ---------------------------------------------------------------------------

/** Defines an exit point for units leaving a building.
 *
 * OpenRA 对照: Exit
 *
 * The ExitInfo holds the configuration. This class is a lightweight wrapper
 * that can be disabled by conditions.
 */
export class Exit {
  /** The configuration info for this exit. */
  readonly info: ExitInfo

  /** Whether this exit is currently disabled. */
  isTraitDisabled: boolean = false

  constructor(info: ExitInfo) {
    this.info = info
  }
}

// ---------------------------------------------------------------------------
// ExitExts
// OpenRA 对照: ExitExts static class
// ---------------------------------------------------------------------------

/** Static utility methods for Exit selection.
 *
 * OpenRA 对照: ExitExts
 *
 * Provides methods to find the nearest exit, all valid exits, or a random exit.
 */
export class ExitExts {
  /** Find the nearest exit to a given position.
   *
   * OpenRA 对照: ExitExts.NearestExitOrDefault(Actor, WPos, string, Func<Exit, bool>)
   *
   * @param exits — all Exit traits to consider
   * @param pos — the target position
   * @param productionType — optional filter by production type
   * @param predicate — optional additional filter
   * @returns the best exit, or null if none found
   */
  static nearestExitOrDefault(
    exits: Exit[],
    _pos: WVec | null = null,
    productionType: string | null = null,
    predicate?: (exit: Exit) => boolean,
  ): Exit | null {
    const validExits = ExitExts.exits(exits, productionType, predicate)
    if (validExits.length === 0) return null

    // Sort by priority descending, then by distance ascending
    validExits.sort((a, b) => {
      const priorityDiff = b.info.priority - a.info.priority
      if (priorityDiff !== 0) return priorityDiff
      // If pos is provided, sort by distance (stub: no actual distance calc)
      return 0
    })

    return validExits[0]
  }

  /** Get all non-disabled exits, optionally filtered by production type.
   *
   * OpenRA 对照: ExitExts.Exits(Actor, string)
   *
   * @param exits — all Exit traits to consider
   * @param productionType — optional filter by production type
   * @param predicate — optional additional filter
   * @returns array of valid exits
   */
  static exits(
    exits: Exit[],
    productionType: string | null = null,
    predicate?: (exit: Exit) => boolean,
  ): Exit[] {
    const result: Exit[] = []
    for (const exit of exits) {
      if (exit.isTraitDisabled) continue
      if (productionType !== null && productionType !== '') {
        if (exit.info.productionTypes.size > 0 && !exit.info.productionTypes.has(productionType)) {
          continue
        }
      }
      if (predicate !== undefined && !predicate(exit)) continue
      result.push(exit)
    }
    return result
  }

  /** Get a random exit by priority group.
   *
   * OpenRA 对照: ExitExts.RandomExitOrDefault(Actor, World, string, Func<Exit, bool>)
   *
   * @param exits — all Exit traits to consider
   * @param productionType — filter by production type
   * @param predicate — optional additional filter
   * @returns a random exit from the highest priority group, or null
   */
  static randomExitOrDefault(
    exits: Exit[],
    productionType: string | null = null,
    predicate?: (exit: Exit) => boolean,
  ): Exit | null {
    const validExits = ExitExts.exits(exits, productionType, predicate)
    if (validExits.length === 0) return null

    // Group by priority
    const groups = new Map<number, Exit[]>()
    for (const exit of validExits) {
      const list = groups.get(exit.info.priority) ?? []
      list.push(exit)
      groups.set(exit.info.priority, list)
    }

    // Find highest priority group
    let highestPriority = -Infinity
    for (const p of groups.keys()) {
      if (p > highestPriority) highestPriority = p
    }

    const highestGroup = groups.get(highestPriority)
    if (!highestGroup || highestGroup.length === 0) return null

    // Return random from highest priority group
    const index = Math.floor(Math.random() * highestGroup.length)
    return highestGroup[index]
  }
}
