/**
 * SimpleTeleport.ts — 即时传送活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/SimpleTeleport.cs
 *
 * 核心范式转换:
 * - C# self.Trait<IPositionable>().SetPosition(self, destination) → TypeScript duck-typed Mobile lookup
 * - C# self.Generation++ → TypeScript self.generation++ (for sync hash invalidation)
 * - C# return true (single-tick activity) → TypeScript same pattern
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// SimpleTeleport
// ---------------------------------------------------------------------------

/**
 * 即时将 actor 传送到目标单元格。
 *
 * OpenRA 对照: SimpleTeleport activity
 *
 * 这是一个单 tick 活动 — 在 tick() 中设置位置并立即返回 true。
 */
export class SimpleTeleport extends Activity {
  readonly destination: CPos

  constructor(destination: CPos) {
    super()
    this.destination = destination
  }

  override tick(self: GameActor): boolean {
    // Resolve Mobile/IPositionable via duck-typed lookup
    const pos = SimpleTeleport._resolvePositionable(self)
    // setPosition on Mobile takes (self, cell, subCell)
    pos.setPosition(self, this.destination)

    // Increment generation for sync-hash invalidation
    const actorAny = self as unknown as { generation: number }
    actorAny.generation++

    return true
  }

  /** Resolve a positionable trait via duck-typed lookup.
   *
   *  OpenRA 对照: self.Trait<IPositionable>()
   *  Note: setPosition(cell, subCell) is on Mobile/OccupiesSpace, which extends IPositionable
   */
  private static _resolvePositionable(self: GameActor): PositionableLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    // Try Mobile first (has setPosition with cell+subCell)
    const mobile = traits?.get('Mobile')
    if (mobile !== undefined && typeof (mobile as { setPosition?: unknown }).setPosition === 'function') {
      return mobile as PositionableLike
    }
    // Fallback: check any trait with setPosition
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<PositionableLike>
      if (typeof t.setPosition === 'function' && typeof t.setCenterPosition === 'function') {
        return t as PositionableLike
      }
    }
    throw new Error('SimpleTeleport requires a Mobile/IPositionable trait on the actor')
  }
}

// ---------------------------------------------------------------------------
// PositionableLike — 可定位 trait 最小接口
// ---------------------------------------------------------------------------

interface PositionableLike {
  setPosition(self: GameActor, cell: CPos, subCell?: number): void
  setCenterPosition(self: GameActor, pos: unknown): void
}
